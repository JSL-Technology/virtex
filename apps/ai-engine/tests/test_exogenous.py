import numpy as np
import pandas as pd
import pytest

from virtex_ai_engine.forecasting import exogenous, global_model, models


def test_dominican_holidays_and_their_eves():
    flags = exogenous.holiday_flags("DO", pd.Timestamp("2026-02-25"), pd.Timestamp("2026-02-28")).set_index("ds")
    # 27 February: Independence Day.
    assert flags.loc["2026-02-27", "is_holiday"] == 1
    assert flags.loc["2026-02-26", "is_pre_holiday"] == 1
    assert flags.loc["2026-02-25", "is_holiday"] == 0


def test_an_unknown_country_means_no_holiday_feature_not_a_failure():
    flags = exogenous.holiday_flags("ZZ", pd.Timestamp("2026-01-01"), pd.Timestamp("2026-01-10"))
    assert flags["is_holiday"].sum() == 0
    assert exogenous.holiday_flags(None, pd.Timestamp("2026-01-01"), pd.Timestamp("2026-01-02"))["is_holiday"].sum() == 0


def test_price_is_forward_filled_indexed_and_held_over_the_horizon():
    days = pd.date_range("2026-01-01", periods=10)
    train = pd.DataFrame({"unique_id": "p1|w1", "ds": days, "y": 1.0})
    prices = pd.DataFrame({"product_id": ["p1", "p1"], "day": [days[2], days[6]], "avg_price": [10.0, 20.0], "discount_rate": [0.0, 0.3]})
    products = pd.DataFrame({"product_id": ["p1"], "price": [10.0], "category_id": ["c1"]})
    ex = exogenous.build(train, prices, products, {"p1|w1": "b1"}, "DO", horizon=5)

    h = ex.history.set_index("ds")
    # Before the first sale: the catalogue price; then carried forward until it changes.
    assert h.loc[days[0], "price_index"] == pytest.approx(h.loc[days[3], "price_index"])
    assert h.loc[days[7], "price_index"] > h.loc[days[3], "price_index"]
    # A 30 % discount day is a promotion day.
    assert h.loc[days[6], "promo"] == 1 and h.loc[days[5], "promo"] == 0
    # The horizon: last price, no discount.
    assert len(ex.future) == 5
    assert (ex.future["price_index"] == h["price_index"].iloc[-1]).all()
    assert (ex.future["discount_rate"] == 0).all()
    assert ex.static.iloc[0]["branch"] == "b1" and ex.static.iloc[0]["category"] == "c1"


def test_the_global_model_learns_promotions_and_holidays_when_it_is_told_about_them():
    rng = np.random.default_rng(3)
    days = pd.date_range("2024-09-01", "2026-05-31")
    cal = exogenous.holiday_flags("DO", days[0], days[-1] + pd.Timedelta(days=60)).set_index("ds")
    rows, prices, products = [], [], []
    for i in range(40):
        promo = np.zeros(len(days))
        for start in rng.choice(len(days) - 14, 8, replace=False):
            promo[start : start + 7] = 1
        lam = (3 + i % 10) * np.array([0.7, 0.9, 1, 1, 1.1, 1.5, 1.2])[days.dayofweek]
        lam = lam * (1 + 1.5 * promo) * np.where(cal.loc[days, "is_pre_holiday"].to_numpy() == 1, 1.8, 1)
        rows.append(pd.DataFrame({"unique_id": f"p{i}|w", "ds": days, "y": rng.poisson(lam).astype(float)}))
        prices.append(pd.DataFrame({"product_id": f"p{i}", "day": days, "avg_price": 10.0, "discount_rate": promo * 0.25}))
        products.append({"product_id": f"p{i}", "price": 10.0, "category_id": f"c{i % 3}"})
    full, prices, products = pd.concat(rows), pd.concat(prices), pd.DataFrame(products)
    cutoff = days[-29]
    train, test = full[full["ds"] <= cutoff], full[full["ds"] > cutoff]

    ex = exogenous.build(train, prices[prices["day"] <= cutoff], products, {u: "b1" for u in train["unique_id"].unique()}, "DO", 28)
    # Promotions already planned for the test month are known inputs, as they would be in practice.
    planned = prices.assign(ds=pd.to_datetime(prices["day"]), unique_id=prices["product_id"] + "|w")[["unique_id", "ds", "discount_rate"]]
    ex.future = ex.future.drop(columns=["discount_rate", "promo"]).merge(planned, on=["unique_id", "ds"], how="left")
    ex.future["discount_rate"] = ex.future["discount_rate"].fillna(0)
    ex.future["promo"] = (ex.future["discount_rate"] > exogenous.PROMO_THRESHOLD).astype(int)

    scores = {}
    for name, e in (("without", None), ("with", ex)):
        _, fc = global_model.cross_validate_and_forecast(train, 28, 28, 3, exog=e)
        merged = test.merge(fc, on=["unique_id", "ds"])
        scores[name] = models.wape(merged["y"].to_numpy(), merged[global_model.ALIAS].to_numpy())
    assert scores["with"] < scores["without"] * 0.9, scores
