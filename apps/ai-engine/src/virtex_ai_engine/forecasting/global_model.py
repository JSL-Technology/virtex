"""One LightGBM model across all of a tenant's series.

A per-series model sees one product's history; a global model sees every product's, and learns the
shared shape of the week, the payday at mid-month and month end, and how a product's recent sales
predict its next ones. On many short, noisy series that sharing is worth more than any per-series
tuning, which is why gradient-boosted global models dominate retail forecasting benchmarks (M5).

It is only trained when there is enough to learn from; otherwise this returns nothing and the
statistical candidates compete alone.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

MIN_SERIES = 30
MIN_MEDIAN_HISTORY = 120

ALIAS = "LightGBM"


def _payday(dates: pd.DatetimeIndex) -> np.ndarray:
    """Within two days of the 15th or of month end: when wages are paid across the region."""
    day = dates.day
    last = dates.days_in_month
    return ((np.abs(day - 15) <= 1) | (day >= last - 1) | (day <= 1)).astype(int)


def _model():
    from lightgbm import LGBMRegressor
    from mlforecast import MLForecast
    from mlforecast.lag_transforms import RollingMean

    return MLForecast(
        models={
            ALIAS: LGBMRegressor(
                n_estimators=300,
                learning_rate=0.05,
                num_leaves=31,
                min_child_samples=20,
                subsample=0.8,
                subsample_freq=1,
                colsample_bytree=0.8,
                objective="tweedie",  # non-negative, many zeros: the standard for retail demand
                tweedie_variance_power=1.2,
                verbose=-1,
            )
        },
        freq="D",
        lags=[1, 7, 14, 28],
        lag_transforms={1: [RollingMean(window_size=7), RollingMean(window_size=28)], 7: [RollingMean(window_size=28)]},
        date_features=["dayofweek", "day", "month", _payday],
    )


def _with_features(train: pd.DataFrame, exog) -> tuple[pd.DataFrame, list[str]]:
    """Training frame with the exogenous columns joined in, and the names of the static ones."""
    if exog is None:
        return train, []
    from .exogenous import STATIC

    data = train.merge(exog.history, on=["unique_id", "ds"], how="left").merge(exog.static, on="unique_id", how="left")
    for column in STATIC:
        data[column] = data[column].astype(str).astype("category")
    for column in ("is_holiday", "is_pre_holiday", "promo"):
        data[column] = data[column].fillna(0).astype(int)
    data["price_index"] = data["price_index"].fillna(1.0)
    data["discount_rate"] = data["discount_rate"].fillna(0.0)
    return data, list(STATIC)


def cross_validate_and_forecast(train: pd.DataFrame, horizon: int, cv_horizon: int, cv_windows: int,
                                exog=None) -> tuple[pd.DataFrame | None, pd.DataFrame | None]:
    """Backtest and forecast with one LightGBM across all series.

    With `exog` (see `exogenous.py`) the model also sees holidays, price, discount and promotions as
    dynamic features and branch and category as categorical static ones; without it, only the
    series' own lags and the calendar.
    """
    if train.empty:
        return None, None
    lengths = train.groupby("unique_id").size()
    if len(lengths) < MIN_SERIES or float(lengths.median()) < MIN_MEDIAN_HISTORY:
        return None, None
    # Every series must be long enough for the lags and the backtest windows.
    eligible = lengths[lengths >= 28 + cv_horizon * cv_windows + 1].index
    base = train[train["unique_id"].isin(eligible)]
    if base["unique_id"].nunique() < MIN_SERIES:
        return None, None
    data, static = _with_features(base, exog)
    try:
        cv = _model().cross_validation(
            df=data, h=cv_horizon, n_windows=cv_windows, step_size=cv_horizon, static_features=static
        )
        fitted = _model()
        fitted.fit(data, static_features=static)
        if exog is not None:
            future = exog.future[exog.future["unique_id"].isin(eligible)]
            fc = fitted.predict(h=horizon, X_df=future)
        else:
            fc = fitted.predict(h=horizon)
        cv[ALIAS] = cv[ALIAS].clip(lower=0)
        fc[ALIAS] = fc[ALIAS].clip(lower=0)
        return cv[["unique_id", "ds", "cutoff", ALIAS]], fc[["unique_id", "ds", ALIAS]]
    except Exception:  # noqa: BLE001 — the global model is a candidate, never a dependency
        log.exception("global LightGBM model failed; statistical candidates only")
        return None, None
