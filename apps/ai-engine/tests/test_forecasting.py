import math

import numpy as np
import pandas as pd
import pytest

from virtex_ai_engine.forecasting import classify, history, insights, models, reconcile

DAYS = pd.date_range("2025-01-01", periods=420, freq="D")
WEEKLY = np.array([0.6, 0.8, 1.0, 1.0, 1.2, 1.6, 1.3])


def _smooth(uid: str, base: float, rng, days=DAYS) -> pd.DataFrame:
    return pd.DataFrame({"unique_id": uid, "ds": days, "y": rng.poisson(base * WEEKLY[days.dayofweek]).astype(float)})


def _intermittent(uid: str, rng, days=DAYS, p=0.12) -> pd.DataFrame:
    y = (rng.random(len(days)) < p) * rng.integers(1, 6, len(days))
    return pd.DataFrame({"unique_id": uid, "ds": days, "y": y.astype(float)})


# ── History: censored demand ─────────────────────────────────────────────────────


def test_marks_days_that_started_with_an_empty_shelf_as_censored():
    end = pd.Timestamp("2025-01-10")
    demand = pd.DataFrame(
        {
            "product_id": ["p"] * 4,
            "warehouse_id": ["w"] * 4,
            "branch_id": ["b"] * 4,
            "day": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-08"]),
            "qty_sold": [5.0, 3.0, 2.0, 4.0],
            "qty_returned": [0.0, 0.0, 0.0, 0.0],
        }
    )
    # Opening 10 on Jan 1, sold out by Jan 3, restocked with 6 on Jan 7, 4 sold on Jan 8 → 2 left.
    net = pd.DataFrame(
        {
            "product_id": ["p"] * 5,
            "warehouse_id": ["w"] * 5,
            "day": pd.to_datetime(["2025-01-01", "2025-01-01", "2025-01-02", "2025-01-03", "2025-01-07"]),
            "net_quantity": [10.0, -5.0, -3.0, -2.0, 6.0],
        }
    )
    net = pd.concat([net, pd.DataFrame({"product_id": ["p"], "warehouse_id": ["w"], "day": [pd.Timestamp("2025-01-08")], "net_quantity": [-4.0]})])
    on_hand = pd.DataFrame({"product_id": ["p"], "warehouse_id": ["w"], "quantity_on_hand": [2.0]})

    series = history.build_daily_series(demand, net, on_hand, end, history_days=30)
    by_day = series.set_index("ds")

    # Jan 4–7 started with nothing on the shelf and sold nothing: censored, not "zero demand".
    for day in ["2025-01-04", "2025-01-05", "2025-01-06"]:
        assert bool(by_day.loc[day, "censored"]) is True
    # Jan 7 started empty too (the restock arrived during the day).
    assert bool(by_day.loc["2025-01-07", "censored"]) is True
    # Jan 9 started with 2 and sold nothing: a real zero.
    assert by_day.loc["2025-01-09", "stock_start"] == pytest.approx(2.0)
    assert bool(by_day.loc["2025-01-09", "censored"]) is False
    # The series starts at the first sale, not at the start of the window.
    assert series["ds"].min() == pd.Timestamp("2025-01-01")


def test_training_frame_does_not_teach_the_model_that_an_empty_shelf_is_zero_demand():
    series = pd.DataFrame(
        {
            "unique_id": ["a"] * 10,
            "ds": pd.date_range("2025-01-01", periods=10),
            "y": [4, 5, 4, 0, 0, 0, 5, 4, 5, 4],
            "censored": [False, False, False, True, True, True, False, False, False, False],
        }
    )
    train = history.training_frame(series)
    assert (train["y"].iloc[3:6] > 3).all()


# ── Classification ───────────────────────────────────────────────────────────────


def test_classifies_demand_the_syntetos_boylan_way():
    rng = np.random.default_rng(0)
    train = pd.concat(
        [
            _smooth("smooth", 8, rng),
            _intermittent("sparse", rng),
            pd.DataFrame({"unique_id": "new", "ds": DAYS[-40:], "y": rng.poisson(3, 40).astype(float)}),
            pd.DataFrame({"unique_id": "dead", "ds": DAYS, "y": 0.0}),
        ]
    )
    classes = classify.classify(train).set_index("unique_id")["demand_class"]
    assert classes["smooth"] == "smooth"
    assert classes["sparse"] in ("intermittent", "lumpy")
    assert classes["new"] == "new"
    assert classes["dead"] == "dead"


# ── Conformal bands ──────────────────────────────────────────────────────────────


def test_conformal_halfwidth_is_the_finite_sample_quantile():
    errors = np.arange(1, 11, dtype=float)  # 1..10
    # ⌈(10+1)·0.8⌉ = 9 → the 9th smallest.
    assert models.conformal_halfwidth(errors, 0.8) == 9.0
    assert models.conformal_halfwidth(np.array([]), 0.8) == 0.0


def test_wape():
    assert models.wape(np.array([10.0, 10.0]), np.array([8.0, 12.0])) == pytest.approx(0.2)
    assert models.wape(np.array([0.0]), np.array([0.0])) == 0.0
    assert math.isinf(models.wape(np.array([0.0]), np.array([1.0])))


@pytest.fixture(scope="module")
def portfolio():
    rng = np.random.default_rng(42)
    frames = [_smooth(f"s{i}", 4 + i % 9, rng) for i in range(36)] + [_intermittent(f"i{i}", rng) for i in range(12)]
    full = pd.concat(frames, ignore_index=True)
    cutoff = DAYS[-29]
    train = full[full["ds"] <= cutoff]
    test = full[full["ds"] > cutoff]
    result = models.forecast_all(train, classify.classify(train), horizon=28, n_jobs=1)
    return train, test, result


def test_every_series_gets_a_full_horizon(portfolio):
    train, _, result = portfolio
    sizes = result.forecasts.groupby("unique_id").size()
    assert set(sizes.index) == set(train["unique_id"].unique())
    assert (sizes == 28).all()
    assert (result.forecasts[["p10", "p50", "p90"]] >= 0).all().all()
    assert (result.forecasts["p10"] <= result.forecasts["p50"]).all()
    assert (result.forecasts["p50"] <= result.forecasts["p90"]).all()


def test_the_band_covers_about_what_it_promises_on_held_out_data(portfolio):
    _, test, result = portfolio
    merged = test.merge(result.forecasts, on=["unique_id", "ds"])
    smooth = merged[merged["unique_id"].str.startswith("s")]
    coverage = ((smooth["y"] >= smooth["p10"]) & (smooth["y"] <= smooth["p90"])).mean()
    # Target 80 %; on 36 series × 28 days the measured coverage must be close to it.
    assert 0.70 <= coverage <= 0.92, coverage


def test_beats_the_naive_baseline(portfolio):
    train, test, result = portfolio
    merged = test.merge(result.forecasts, on=["unique_id", "ds"])
    smooth = merged[merged["unique_id"].str.startswith("s")]
    model_wape = models.wape(smooth["y"].to_numpy(), smooth["p50"].to_numpy())
    # Naive: last week's value, repeated.
    last_week = train[train["ds"] > train["ds"].max() - pd.Timedelta(days=7)].copy()
    last_week["dow"] = last_week["ds"].dt.dayofweek
    naive = smooth.assign(dow=smooth["ds"].dt.dayofweek).merge(
        last_week[["unique_id", "dow", "y"]].rename(columns={"y": "naive"}), on=["unique_id", "dow"]
    )
    naive_wape = models.wape(naive["y"].to_numpy(), naive["naive"].to_numpy())
    assert model_wape < naive_wape


def test_intermittent_demand_is_not_forecast_as_a_daily_constant_of_whole_units(portfolio):
    _, _, result = portfolio
    sparse = result.forecasts[result.forecasts["unique_id"].str.startswith("i")]
    # ~12 % of days × ~3 units ≈ 0.36 a day: a sensible rate, not 3.
    assert sparse["p50"].mean() < 1.5
    assert result.metrics["byClass"].get("intermittent", 0) + result.metrics["byClass"].get("lumpy", 0) == 12


# ── Reconciliation ───────────────────────────────────────────────────────────────


def test_reconciliation_keeps_series_non_negative_and_zero_demand_at_zero(portfolio):
    train, _, result = portfolio
    branch = {uid: ("b1" if i % 2 else "b2") for i, uid in enumerate(sorted(train["unique_id"].unique()))}
    fc = result.forecasts.copy()
    dead = fc[fc["unique_id"] == "s0"].copy()
    dead["unique_id"] = "dead|w"
    dead[["p10", "p50", "p90"]] = 0.0
    dead["model"] = "NoDemand"
    fc = pd.concat([fc, dead], ignore_index=True)
    branch["dead|w"] = "b1"
    out, applied = reconcile.reconcile(train, fc, branch)
    assert applied
    assert (out[["p10", "p50", "p90"]] >= 0).all().all()
    assert (out.loc[out["unique_id"] == "dead|w", "p50"] == 0).all()
    assert len(out) == len(fc)


# ── Insights ─────────────────────────────────────────────────────────────────────


def _forecast(uid: str, daily: float, band: float, days: int = 90, start="2025-03-01") -> pd.DataFrame:
    ds = pd.date_range(start, periods=days)
    return pd.DataFrame({"unique_id": uid, "ds": ds, "p10": max(daily - band, 0), "p50": daily, "p90": daily + band, "model": "AutoETS"})


def test_inventory_insights_compute_a_textbook_reorder_policy():
    today = pd.Timestamp("2025-03-01")
    fc = pd.concat([_forecast("p1|w1", 10, 2.5632), _forecast("p2|w1", 1, 0.5), _forecast("p3|w1", 0, 0)])
    fc.loc[fc["unique_id"] == "p3|w1", "model"] = "NoDemand"
    accuracy = pd.DataFrame({"unique_id": ["p1|w1", "p2|w1", "p3|w1"], "model": ["AutoETS", "AutoETS", "NoDemand"], "wape": [0.2, 0.3, np.nan]})
    on_hand = pd.DataFrame({"product_id": ["p1", "p2", "p3"], "warehouse_id": ["w1"] * 3, "quantity_on_hand": [35.0, 400.0, 12.0]})
    lead = pd.DataFrame({"product_id": ["p1", "p1"], "lead_time_days": [4.0, 6.0]})
    on_order = pd.DataFrame({"product_id": ["p1"], "quantity": [20.0]})
    series = pd.DataFrame(columns=["unique_id", "ds", "y", "censored"])

    table = insights.compute(series, fc, accuracy, on_hand, lead, on_order, {"w1": "b1"}, today,
                             service_level=0.95, default_lead_time=7, overstock_cover_days=120).set_index("product_id")

    p1 = table.loc["p1"]
    # σ = 2.5632 / 1.2816 = 2; L = median(4, 6) = 5; SS = 1.6449 · 2 · √5 ≈ 7.36; ROP = 50 + 7.36.
    assert p1["lead_time_days"] == 5
    assert p1["safety_stock"] == pytest.approx(1.6449 * 2 * math.sqrt(5), rel=1e-3)
    assert p1["reorder_point"] == pytest.approx(50 + p1["safety_stock"], rel=1e-3)
    # 35 on hand at 10/day runs out on day 4 — inside the 5-day lead time.
    assert p1["status"] == "STOCKOUT_RISK"
    assert str(p1["stockout_date"]) == "2025-03-04"
    # Order up to D(5 + 14) + SS = 190 + 7.36, minus 35 held, minus 20 already ordered.
    assert p1["suggested_order_qty"] == pytest.approx(190 + p1["safety_stock"] - 35 - 20, abs=0.01)

    assert table.loc["p2", "status"] == "OVERSTOCK"
    assert table.loc["p2", "suggested_order_qty"] == 0
    assert table.loc["p3", "status"] == "DEAD_STOCK"
    assert table.loc["p1", "branch_rank"] == 1


def test_stock_nobody_bought_in_the_whole_window_is_reported_as_dead():
    on_hand = pd.DataFrame({"product_id": ["a", "b"], "warehouse_id": ["w", "w"], "quantity_on_hand": [5.0, 0.0]})
    rows = insights.dead_stock_rows(on_hand, set(), {"w": "b1"}, 0.95)
    assert rows["product_id"].tolist() == ["a"]
    assert rows["status"].tolist() == ["DEAD_STOCK"]
