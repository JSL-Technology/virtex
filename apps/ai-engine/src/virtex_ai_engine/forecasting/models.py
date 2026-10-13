"""Choosing and fitting the forecast for every series.

## The method, in four steps

1. **Candidates per demand class** (see `classify.py`): exponential smoothing, Theta and a
   seasonal-naive baseline for smooth demand; Croston SBA, TSB, ADIDA and IMAPA for intermittent
   demand; and, for tenants with enough series, one LightGBM model trained across all of them
   (`global_model.py`) — the approach that won the M5 competition on exactly this problem,
   products × stores at Walmart.
2. **Backtest** every candidate on the most recent weeks the model did not see (rolling origin,
   several windows) and score it by WAPE per series.
3. **Select per series**: the best candidate, or the average of the best two when they are within
   10 % of each other — combining two good forecasts is reliably at least as accurate as either.
4. **Intervals by split conformal prediction**: the absolute backtest errors of the chosen forecast
   give the band that contained the truth 80 % of the time on held-out data. P10/P90 come from that
   band, so their coverage is measured, not assumed from a distribution.

Products too new to backtest are forecast from their own short history — or, when the optional
foundation models are installed, by Chronos zero-shot (`foundation.py`).
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
from statsforecast import StatsForecast
from statsforecast.models import (
    ADIDA,
    IMAPA,
    TSB,
    AutoETS,
    AutoTheta,
    CrostonSBA,
    HistoricAverage,
    SeasonalNaive,
)

from . import global_model

log = logging.getLogger(__name__)

#: Backtest: this many windows, each this many days long, stepping by the same.
CV_WINDOWS = 3
CV_HORIZON = 28

#: Central coverage of the P10–P90 band.
BAND_COVERAGE = 0.80

#: Two models whose backtest WAPE is within this ratio are averaged rather than picked between.
COMBINE_WITHIN = 1.10

@dataclass
class ForecastResult:
    #: unique_id, ds, p10, p50, p90, model
    forecasts: pd.DataFrame
    #: unique_id, model, wape, demand_class
    accuracy: pd.DataFrame
    #: Run-level statistics for `ai_model_runs.metrics`.
    metrics: dict


def _smooth_models() -> list:
    # AutoARIMA is deliberately absent: measured at ~6 s per daily series (against ~0.2 s for ETS),
    # it would hold a worker for hours on a large catalogue, and on daily retail demand it is rarely
    # the best candidate once exponential smoothing, Theta and the global model are in the race.
    return [
        AutoETS(season_length=7, alias="AutoETS"),
        AutoTheta(season_length=7, alias="AutoTheta"),
        SeasonalNaive(season_length=7, alias="SeasonalNaive"),
    ]


def _intermittent_models() -> list:
    return [
        CrostonSBA(alias="CrostonSBA"),
        TSB(alpha_d=0.1, alpha_p=0.1, alias="TSB"),
        ADIDA(alias="ADIDA"),
        IMAPA(alias="IMAPA"),
    ]


def wape(actual: np.ndarray, predicted: np.ndarray) -> float:
    """Weighted absolute percentage error: Σ|error| / Σ actual. Infinite when nothing sold."""
    total = float(np.abs(actual).sum())
    err = float(np.abs(actual - predicted).sum())
    if total == 0:
        return 0.0 if err == 0 else math.inf
    return err / total


def conformal_halfwidth(abs_errors: np.ndarray, coverage: float = BAND_COVERAGE) -> float:
    """The split-conformal quantile: the ⌈(n+1)·coverage⌉-th smallest absolute error."""
    errors = np.sort(np.asarray(abs_errors, dtype=float))
    n = len(errors)
    if n == 0:
        return 0.0
    rank = min(n, math.ceil((n + 1) * coverage))
    return float(errors[rank - 1])


def _cross_validate(train: pd.DataFrame, models: list, n_jobs: int) -> pd.DataFrame:
    sf = StatsForecast(models=models, freq="D", n_jobs=n_jobs, fallback_model=HistoricAverage(alias="Fallback"))
    cv = sf.cross_validation(df=train, h=CV_HORIZON, n_windows=CV_WINDOWS, step_size=CV_HORIZON)
    return cv.reset_index() if "unique_id" not in cv.columns else cv


def _forecast(train: pd.DataFrame, models: list, horizon: int, n_jobs: int) -> pd.DataFrame:
    sf = StatsForecast(models=models, freq="D", n_jobs=n_jobs, fallback_model=HistoricAverage(alias="Fallback"))
    fc = sf.forecast(df=train, h=horizon)
    return fc.reset_index() if "unique_id" not in fc.columns else fc


def _select(cv: pd.DataFrame, model_names: list[str]) -> pd.DataFrame:
    """Per series: the chosen combination of models, its WAPE and its conformal half-width."""
    rows = []
    for uid, group in cv.groupby("unique_id"):
        actual = group["y"].to_numpy(dtype=float)
        scores = []
        for name in model_names:
            if name not in group:
                continue
            pred = group[name].to_numpy(dtype=float)
            if not np.all(np.isfinite(pred)):
                continue
            scores.append((wape(actual, np.clip(pred, 0, None)), name))
        if not scores:
            continue
        scores.sort()
        best_score, best = scores[0]
        chosen = [best]
        if len(scores) > 1 and math.isfinite(best_score):
            second_score, second = scores[1]
            if second_score <= best_score * COMBINE_WITHIN:
                chosen = [best, second]
        combined = np.clip(group[chosen].to_numpy(dtype=float).mean(axis=1), 0, None)
        rows.append(
            {
                "unique_id": uid,
                "models": chosen,
                "wape": wape(actual, combined),
                "halfwidth": conformal_halfwidth(np.abs(actual - combined)),
            }
        )
    return pd.DataFrame(rows, columns=["unique_id", "models", "wape", "halfwidth"])


def _assemble(fc: pd.DataFrame, selection: pd.DataFrame) -> pd.DataFrame:
    """Point forecast from the chosen models, band from the conformal half-width."""
    if fc.empty or selection.empty:
        return pd.DataFrame(columns=["unique_id", "ds", "p10", "p50", "p90", "model"])
    out = []
    for row in selection.itertuples(index=False):
        group = fc[fc["unique_id"] == row.unique_id]
        if group.empty:
            continue
        p50 = np.clip(group[row.models].to_numpy(dtype=float).mean(axis=1), 0, None)
        out.append(
            pd.DataFrame(
                {
                    "unique_id": row.unique_id,
                    "ds": group["ds"].to_numpy(),
                    "p10": np.clip(p50 - row.halfwidth, 0, None),
                    "p50": p50,
                    "p90": p50 + row.halfwidth,
                    "model": "+".join(row.models),
                }
            )
        )
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame(columns=["unique_id", "ds", "p10", "p50", "p90", "model"])


def _fit_group(train: pd.DataFrame, models: list, horizon: int, n_jobs: int,
               extra_cv: pd.DataFrame | None = None, extra_fc: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    names = [m.alias for m in models]
    cv = _cross_validate(train, models, n_jobs)
    fc = _forecast(train, models, horizon, n_jobs)
    if extra_cv is not None and not extra_cv.empty:
        cv = cv.merge(extra_cv, on=["unique_id", "ds", "cutoff"], how="left")
        fc = fc.merge(extra_fc, on=["unique_id", "ds"], how="left")
        names = names + [c for c in extra_cv.columns if c not in ("unique_id", "ds", "cutoff", "y")]
    selection = _select(cv, names)
    return _assemble(fc, selection), selection


def _short_history(train: pd.DataFrame, uids: list[str], horizon: int, foundation: bool) -> tuple[pd.DataFrame, pd.DataFrame]:
    """New products: too little history to backtest. Their own mean, or Chronos when installed."""
    subset = train[train["unique_id"].isin(uids)]
    if subset.empty:
        return pd.DataFrame(columns=["unique_id", "ds", "p10", "p50", "p90", "model"]), pd.DataFrame()
    if foundation:
        from . import foundation as fm

        result = fm.forecast(subset, horizon)
        if result is not None:
            return result, pd.DataFrame({"unique_id": uids, "models": [["Chronos"]] * len(uids), "wape": np.nan, "halfwidth": np.nan})

    rows = []
    last = subset["ds"].max()
    future = pd.date_range(last + pd.Timedelta(days=1), periods=horizon, freq="D")
    for uid, group in subset.groupby("unique_id"):
        y = group["y"].to_numpy(dtype=float)
        mean = float(y.mean())
        # Little history means wide uncertainty: the band is the observed spread, at least ±mean.
        half = max(float(np.quantile(np.abs(y - mean), BAND_COVERAGE)), mean)
        rows.append(pd.DataFrame({"unique_id": uid, "ds": future, "p10": max(mean - half, 0.0),
                                  "p50": mean, "p90": mean + half, "model": "HistoricAverage"}))
    fc = pd.concat(rows, ignore_index=True)
    sel = pd.DataFrame({"unique_id": uids, "models": [["HistoricAverage"]] * len(uids), "wape": np.nan, "halfwidth": np.nan})
    return fc, sel


def forecast_all(train: pd.DataFrame, classes: pd.DataFrame, horizon: int, *, n_jobs: int = -1,
                 foundation: bool = False) -> ForecastResult:
    """Forecast every series in `train` (unique_id, ds, y) `horizon` days ahead."""
    results: list[pd.DataFrame] = []
    selections: list[pd.DataFrame] = []
    class_of = classes.set_index("unique_id")["demand_class"]

    smooth = class_of[class_of.isin(["smooth", "erratic"])].index.tolist()
    sparse = class_of[class_of.isin(["intermittent", "lumpy"])].index.tolist()
    new = class_of[class_of == "new"].index.tolist()
    dead = class_of[class_of == "dead"].index.tolist()

    # The global model sees every backtestable series at once; its predictions join each group's
    # candidates and win only where they backtest better.
    lgbm_cv, lgbm_fc = global_model.cross_validate_and_forecast(
        train[train["unique_id"].isin(smooth + sparse)], horizon, CV_HORIZON, CV_WINDOWS
    )

    for uids, models in ((smooth, _smooth_models()), (sparse, _intermittent_models())):
        if not uids:
            continue
        subset = train[train["unique_id"].isin(uids)]
        extra_cv = lgbm_cv[lgbm_cv["unique_id"].isin(uids)] if lgbm_cv is not None else None
        extra_fc = lgbm_fc[lgbm_fc["unique_id"].isin(uids)] if lgbm_fc is not None else None
        try:
            fc, sel = _fit_group(subset, models, horizon, n_jobs, extra_cv, extra_fc)
        except Exception:  # noqa: BLE001 — one failing family must not lose the whole run
            log.exception("model family failed; falling back to short-history forecasts for %d series", len(uids))
            fc, sel = _short_history(train, uids, horizon, foundation=False)
        missing = sorted(set(uids) - set(sel["unique_id"]) if not sel.empty else set(uids))
        if missing:
            more_fc, more_sel = _short_history(train, missing, horizon, foundation=False)
            fc, sel = pd.concat([fc, more_fc], ignore_index=True), pd.concat([sel, more_sel], ignore_index=True)
        results.append(fc)
        selections.append(sel)

    if new:
        fc, sel = _short_history(train, new, horizon, foundation)
        results.append(fc)
        selections.append(sel)

    if dead:
        last = train["ds"].max()
        future = pd.date_range(last + pd.Timedelta(days=1), periods=horizon, freq="D")
        results.append(pd.DataFrame({"unique_id": np.repeat(dead, horizon), "ds": np.tile(future, len(dead)),
                                     "p10": 0.0, "p50": 0.0, "p90": 0.0, "model": "NoDemand"}))
        selections.append(pd.DataFrame({"unique_id": dead, "models": [["NoDemand"]] * len(dead), "wape": np.nan, "halfwidth": 0.0}))

    forecasts = pd.concat(results, ignore_index=True) if results else pd.DataFrame(columns=["unique_id", "ds", "p10", "p50", "p90", "model"])
    selection = pd.concat(selections, ignore_index=True) if selections else pd.DataFrame(columns=["unique_id", "models", "wape", "halfwidth"])
    accuracy = selection.merge(classes[["unique_id", "demand_class"]], on="unique_id", how="left")
    accuracy["model"] = accuracy["models"].apply(lambda m: "+".join(m) if isinstance(m, list) else str(m))

    finite = accuracy["wape"].replace([np.inf, -np.inf], np.nan).dropna()
    metrics = {
        "series": int(len(class_of)),
        "byClass": {k: int(v) for k, v in class_of.value_counts().items()},
        "medianWape": float(finite.median()) if len(finite) else None,
        "modelsChosen": {k: int(v) for k, v in accuracy["model"].value_counts().head(12).items()},
        "globalModel": lgbm_cv is not None,
        "bandCoverageTarget": BAND_COVERAGE,
    }
    return ForecastResult(forecasts=forecasts, accuracy=accuracy[["unique_id", "model", "wape", "demand_class"]], metrics=metrics)
