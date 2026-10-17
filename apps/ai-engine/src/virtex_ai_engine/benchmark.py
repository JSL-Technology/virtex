"""Benchmark: which forecasting approach is most accurate on THIS tenant's data?

The engine's choice of models was justified by published evidence (M5, Nixtla's comparisons) and by
synthetic tests. Neither says what wins on a particular company's sales. This tool measures it, on
the company's own ledger, the way the engine is meant to be used:

    virtex-ai-benchmark --organization <uuid> [--horizon 28] [--windows 3]
                        [--candidates ensemble,lightgbm,lightgbm_exog,seasonal_naive,prophet,catboost]
                        [--max-series 300] [--output report.json]

It connects as `virtex_ai_engine` (row-level security applies; it reads one tenant and writes
nothing), cuts the history at `windows` successive points (rolling origin), fits every candidate on
what came before each cut, and scores the next `horizon` days against what actually sold:

  - **WAPE**   Σ|error| / Σ actual — the headline, comparable across products.
  - **MASE**   error relative to a seasonal-naive forecast's in-sample error; below 1 beats it.
  - **Bias**   Σ(forecast − actual) / Σ actual — systematic over- or under-forecasting.
  - **Coverage** share of actual days inside the P10–P90 band (target 80 %), where a candidate
    produces one.
  - **Seconds** wall time, because a model that wins by 1 % and costs ten times as much may not.

Prophet and CatBoost are optional (`pip install .[benchmark]`); a candidate whose library is missing
is reported as skipped rather than failing the run. `--synthetic` runs on generated data, for
trying the tool without a database.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import warnings
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from .forecasting import classify, exogenous, global_model, history, models

log = logging.getLogger("virtex_ai_engine.benchmark")

ALL_CANDIDATES = ["ensemble", "lightgbm", "lightgbm_exog", "seasonal_naive", "prophet", "catboost"]


@dataclass
class Score:
    candidate: str
    status: str
    wape: float | None = None
    mase: float | None = None
    bias: float | None = None
    coverage: float | None = None
    seconds: float | None = None
    series: int | None = None
    note: str | None = None


def _mase_scale(train: pd.DataFrame, season: int = 7) -> pd.Series:
    """Per series: in-sample mean absolute error of the seasonal-naive forecast."""

    def scale(y: pd.Series) -> float:
        values = y.to_numpy(dtype=float)
        if len(values) <= season:
            return np.nan
        return float(np.mean(np.abs(values[season:] - values[:-season])))

    return train.groupby("unique_id")["y"].apply(scale)


def _score(name: str, actual: pd.DataFrame, predicted: pd.DataFrame, scales: pd.Series, seconds: float) -> Score:
    merged = actual.merge(predicted, on=["unique_id", "ds"], how="inner")
    if merged.empty:
        return Score(name, "no_predictions", seconds=round(seconds, 2))
    y = merged["y"].to_numpy(dtype=float)
    p = merged["p50"].to_numpy(dtype=float)
    errors = merged.assign(abs_err=np.abs(y - p)).groupby("unique_id")["abs_err"].mean()
    ratio = (errors / scales.reindex(errors.index)).replace([np.inf, -np.inf], np.nan).dropna()
    coverage = None
    if {"p10", "p90"} <= set(merged.columns) and merged["p10"].notna().all():
        coverage = float(((y >= merged["p10"]) & (y <= merged["p90"])).mean())
    total = float(y.sum())
    return Score(
        candidate=name,
        status="ok",
        wape=round(models.wape(y, p), 4),
        mase=round(float(ratio.mean()), 4) if len(ratio) else None,
        bias=round(float((p - y).sum() / total), 4) if total else None,
        coverage=round(coverage, 4) if coverage is not None else None,
        seconds=round(seconds, 2),
        series=int(merged["unique_id"].nunique()),
    )


# ── Candidates: each takes (train, horizon, context) and returns unique_id, ds, p50[, p10, p90] ──


def _ensemble(train, horizon, ctx):
    result = models.forecast_all(train, classify.classify(train), horizon, exog=ctx.get("exog"))
    return result.forecasts[["unique_id", "ds", "p10", "p50", "p90"]]


def _seasonal_naive(train, horizon, ctx):
    last = train["ds"].max()
    future = pd.date_range(last + pd.Timedelta(days=1), periods=horizon, freq="D")
    tail = train[train["ds"] > last - pd.Timedelta(days=7)].copy()
    tail["dow"] = tail["ds"].dt.dayofweek
    frame = pd.DataFrame({"ds": future, "dow": future.dayofweek})
    out = frame.merge(tail[["unique_id", "dow", "y"]], on="dow").rename(columns={"y": "p50"})
    return out[["unique_id", "ds", "p50"]]


def _lightgbm(train, horizon, ctx, with_exog: bool):
    _, fc = global_model.cross_validate_and_forecast(
        train, horizon, models.CV_HORIZON, 1, exog=ctx.get("exog") if with_exog else None
    )
    if fc is None:
        raise RuntimeError("not enough series or history for the global model")
    return fc.rename(columns={global_model.ALIAS: "p50"})[["unique_id", "ds", "p50"]]


def _prophet(train, horizon, ctx):
    from prophet import Prophet

    logging.getLogger("cmdstanpy").setLevel(logging.ERROR)
    logging.getLogger("prophet").setLevel(logging.ERROR)
    country = ctx.get("country")
    frames = []
    for uid, group in train.groupby("unique_id"):
        m = Prophet(weekly_seasonality=True, yearly_seasonality=len(group) >= 365, daily_seasonality=False,
                    interval_width=0.8)
        if country:
            try:
                m.add_country_holidays(country_name=country.upper())
            except Exception:  # noqa: BLE001
                pass
        m.fit(group[["ds", "y"]])
        future = m.make_future_dataframe(periods=horizon, include_history=False)
        fc = m.predict(future)
        frames.append(pd.DataFrame({"unique_id": uid, "ds": fc["ds"], "p50": fc["yhat"].clip(lower=0),
                                    "p10": fc["yhat_lower"].clip(lower=0), "p90": fc["yhat_upper"].clip(lower=0)}))
    return pd.concat(frames, ignore_index=True)


def _catboost(train, horizon, ctx):
    from catboost import CatBoostRegressor
    from mlforecast import MLForecast
    from mlforecast.lag_transforms import RollingMean

    exog = ctx.get("exog")
    data, static = global_model._with_features(train, exog)  # noqa: SLF001 — same features, other learner
    if static:
        for column in static:
            data[column] = data[column].cat.codes
    mlf = MLForecast(
        models={"CatBoost": CatBoostRegressor(iterations=400, depth=6, learning_rate=0.05, loss_function="Tweedie:variance_power=1.2", verbose=0,
                                                allow_writing_files=False)},
        freq="D",
        lags=[1, 7, 14, 28],
        lag_transforms={1: [RollingMean(window_size=7), RollingMean(window_size=28)]},
        date_features=["dayofweek", "day", "month"],
    )
    mlf.fit(data, static_features=static)
    fc = mlf.predict(h=horizon, X_df=exog.future if exog is not None else None)
    return fc.rename(columns={"CatBoost": "p50"}).assign(p50=lambda d: d["p50"].clip(lower=0))[["unique_id", "ds", "p50"]]


CANDIDATES = {
    "ensemble": _ensemble,
    "seasonal_naive": _seasonal_naive,
    "lightgbm": lambda t, h, c: _lightgbm(t, h, c, with_exog=False),
    "lightgbm_exog": lambda t, h, c: _lightgbm(t, h, c, with_exog=True),
    "prophet": _prophet,
    "catboost": _catboost,
}


def run_benchmark(train_full: pd.DataFrame, *, horizon: int, windows: int, candidates: list[str],
                  exog_builder=None, country: str | None = None) -> list[Score]:
    """Rolling-origin evaluation. `exog_builder(train, horizon)` returns an `Exogenous` or None."""
    last = train_full["ds"].max()
    cuts = [last - pd.Timedelta(days=horizon * (k + 1)) for k in reversed(range(windows))]
    totals: dict[str, list[tuple[pd.DataFrame, pd.DataFrame, float]]] = {name: [] for name in candidates}
    skipped: dict[str, str] = {}
    actual_all = []

    for cut in cuts:
        train = train_full[train_full["ds"] <= cut]
        actual = train_full[(train_full["ds"] > cut) & (train_full["ds"] <= cut + pd.Timedelta(days=horizon))]
        actual_all.append(actual)
        ctx = {"country": country, "exog": exog_builder(train, horizon) if exog_builder else None}
        for name in candidates:
            if name in skipped:
                continue
            started = time.perf_counter()
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    predicted = CANDIDATES[name](train, horizon, ctx)
            except ImportError as error:
                skipped[name] = f"library not installed: {error.name}"
                continue
            except Exception as error:  # noqa: BLE001 — one candidate failing must not end the benchmark
                skipped[name] = f"{type(error).__name__}: {error}"[:200]
                continue
            totals[name].append((actual, predicted, time.perf_counter() - started))

    scales = _mase_scale(train_full[train_full["ds"] <= cuts[0]])
    scores = []
    for name in candidates:
        if name in skipped:
            scores.append(Score(name, "skipped", note=skipped[name]))
            continue
        runs = totals[name]
        actual = pd.concat([r[0] for r in runs], ignore_index=True)
        predicted = pd.concat([r[1] for r in runs], ignore_index=True)
        scores.append(_score(name, actual, predicted, scales, sum(r[2] for r in runs)))
    return sorted(scores, key=lambda s: (s.status != "ok", s.wape if s.wape is not None else 9e9))


def synthetic_history(n_series: int = 60, days: int = 700, seed: int = 0) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Weekly seasonality, promotions, Dominican holidays and some intermittent products."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range(end=pd.Timestamp.today().normalize() - pd.Timedelta(days=1), periods=days)
    cal = exogenous.holiday_flags("DO", dates[0], dates[-1]).set_index("ds")
    rows, prices, products = [], [], []
    for i in range(n_series):
        promo = np.zeros(days)
        for start in rng.choice(days - 14, 6, replace=False):
            promo[start : start + 7] = 1
        weekly = np.array([0.7, 0.9, 1, 1, 1.1, 1.5, 1.2])[dates.dayofweek]
        lam = (0.3 if i % 4 == 0 else 3 + i % 9) * weekly * (1 + promo) * np.where(cal.loc[dates, "is_pre_holiday"].to_numpy() == 1, 1.6, 1)
        rows.append(pd.DataFrame({"unique_id": f"p{i}|w", "ds": dates, "y": rng.poisson(lam).astype(float)}))
        prices.append(pd.DataFrame({"product_id": f"p{i}", "day": dates, "avg_price": 10.0, "discount_rate": promo * 0.2}))
        products.append({"product_id": f"p{i}", "price": 10.0, "category_id": f"c{i % 3}"})
    return pd.concat(rows, ignore_index=True), pd.concat(prices, ignore_index=True), pd.DataFrame(products)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--organization", help="tenant uuid (reads as virtex_ai_engine)")
    parser.add_argument("--synthetic", action="store_true", help="use generated data instead of a tenant")
    parser.add_argument("--horizon", type=int, default=28)
    parser.add_argument("--windows", type=int, default=3)
    parser.add_argument("--history-days", type=int, default=730)
    parser.add_argument("--candidates", default="ensemble,lightgbm,lightgbm_exog,seasonal_naive,prophet,catboost")
    parser.add_argument("--max-series", type=int, default=300, help="cap, by volume, to keep slow candidates bounded")
    parser.add_argument("--output", help="write the report as JSON here")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    candidates = [c.strip() for c in args.candidates.split(",") if c.strip()]
    unknown = sorted(set(candidates) - set(ALL_CANDIDATES))
    if unknown:
        parser.error(f"unknown candidates: {', '.join(unknown)}")

    country = None
    if args.synthetic:
        train, prices, products = synthetic_history()
        country = "DO"
    elif args.organization:
        from . import config
        from .db import Database
        from .forecasting import pipeline

        settings = config.load()
        db = Database(settings.dsn, max_size=1)
        today = pd.Timestamp.utcnow().tz_localize(None).normalize()
        params = pipeline.Params(history_days=args.history_days)
        with db.tenant_transaction(args.organization) as conn:
            data = pipeline.load(conn, args.organization, params, today)
        db.close()
        series = history.build_daily_series(data["demand"], data["net_moves"], data["on_hand"],
                                            today - pd.Timedelta(days=1), params.history_days)
        train = history.training_frame(series)
        prices, products = data["prices"], data["products"]
        country = data["organization"]["country"].iloc[0] if not data["organization"].empty else None
    else:
        parser.error("give --organization or --synthetic")

    if train.empty:
        print("No sales history to benchmark.", file=sys.stderr)
        return 1
    top = train.groupby("unique_id")["y"].sum().nlargest(args.max_series).index
    train = train[train["unique_id"].isin(top)]
    branch_of = {uid: "none" for uid in train["unique_id"].unique()}

    def exog_builder(cut_train: pd.DataFrame, horizon: int):
        cut = cut_train["ds"].max()
        return exogenous.build(cut_train, prices[pd.to_datetime(prices["day"]) <= cut], products, branch_of, country, horizon)

    scores = run_benchmark(train, horizon=args.horizon, windows=args.windows, candidates=candidates,
                           exog_builder=exog_builder, country=country)
    report = {
        "series": int(train["unique_id"].nunique()),
        "horizon": args.horizon,
        "windows": args.windows,
        "scores": [asdict(s) for s in scores],
    }
    print(f"{'candidate':<16}{'status':<10}{'WAPE':>8}{'MASE':>8}{'bias':>8}{'cover':>8}{'secs':>9}")
    for s in scores:
        fmt = lambda v: f"{v:.3f}" if isinstance(v, float) else "—"  # noqa: E731
        print(f"{s.candidate:<16}{s.status:<10}{fmt(s.wape):>8}{fmt(s.mase):>8}{fmt(s.bias):>8}{fmt(s.coverage):>8}{fmt(s.seconds):>9}"
              + (f"  ({s.note})" if s.note else ""))
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
