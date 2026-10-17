"""What the global model knows beyond each series' own past: the calendar, the price, the branch.

Demand in retail is driven as much by what is happening around a product as by its history:

- **Public holidays** of the tenant's country — shops close, or sell twice as much the day before.
  From the `holidays` package (Dominican Republic, Mexico, Colombia, Peru, Chile, Argentina, Brazil,
  Spain, the United States and ~150 more), keyed by the ISO country on the organisation.
- **Price and discount** actually charged that day, from invoice and point-of-sale lines. A price
  rise lowers demand; a discount is a promotion, and a promotion moves volume.
- **Branch and category**, as categorical features, so the model shares what it learns across a
  branch's products and across a category's branches.

Exogenous values must also be known for the forecast horizon. Holidays are; the price is held at its
last observed value and discounts at zero — the forecast is "if nothing is changed", which is the
baseline a buyer wants. A planned promotion is a future input the API can pass later.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

DYNAMIC = ["is_holiday", "is_pre_holiday", "price_index", "discount_rate", "promo"]
STATIC = ["branch", "category"]

#: A discount above this share of the gross line counts as a promotion day.
PROMO_THRESHOLD = 0.05


@dataclass
class Exogenous:
    #: unique_id, ds plus DYNAMIC columns, for the training window.
    history: pd.DataFrame
    #: unique_id, ds plus DYNAMIC columns, for the forecast horizon.
    future: pd.DataFrame
    #: unique_id → branch, category (categorical).
    static: pd.DataFrame


def holiday_flags(country: str | None, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    """ds, is_holiday, is_pre_holiday for every day from start to end."""
    days = pd.date_range(start, end, freq="D")
    flags = pd.DataFrame({"ds": days, "is_holiday": 0, "is_pre_holiday": 0})
    if not country:
        return flags
    try:
        import holidays

        calendar = holidays.country_holidays(country.upper(), years=range(start.year, end.year + 2))
    except Exception:  # noqa: BLE001 — an unknown country means no holiday feature, not a failed run
        log.info("no holiday calendar for country %r", country)
        return flags
    holiday_days = {pd.Timestamp(day) for day in calendar.keys()}
    flags["is_holiday"] = flags["ds"].isin(holiday_days).astype(int)
    flags["is_pre_holiday"] = (flags["ds"] + pd.Timedelta(days=1)).isin(holiday_days).astype(int)
    return flags


def build(
    train: pd.DataFrame,
    prices: pd.DataFrame,
    products: pd.DataFrame,
    branch_of_series: dict[str, str],
    country: str | None,
    horizon: int,
) -> Exogenous:
    """
    Args:
        train: unique_id, ds, y
        prices: product_id, day, avg_price, discount_rate (one row per product and selling day)
        products: product_id, price (list price), category_id
        branch_of_series: unique_id → branch id (or "none")
        country: ISO 3166-1 alpha-2 of the tenant
        horizon: days to forecast
    """
    last = train["ds"].max()
    first = train["ds"].min()
    future_days = pd.date_range(last + pd.Timedelta(days=1), periods=horizon, freq="D")
    calendar = holiday_flags(country, first, future_days[-1])

    ids = train[["unique_id"]].drop_duplicates()
    ids["product_id"] = ids["unique_id"].str.split("|", n=1).str[0]

    meta = products.copy()
    meta["list_price"] = meta["price"].astype(float)
    meta = meta[["product_id", "list_price", "category_id"]]

    # Daily selling price per product, forward-filled across days without sales; before the first
    # sale, the catalogue price. Expressed as an index to the product's own median so that one model
    # can compare a 10-peso and a 10 000-peso product.
    p = prices.copy()
    if not p.empty:
        p["ds"] = pd.to_datetime(p["day"])
        p = p.groupby(["product_id", "ds"], as_index=False).agg(
            avg_price=("avg_price", "mean"), discount_rate=("discount_rate", "mean")
        )

    hist = train[["unique_id", "ds"]].merge(ids, on="unique_id", how="left")
    hist = hist.merge(p, on=["product_id", "ds"], how="left") if not p.empty else hist.assign(avg_price=np.nan, discount_rate=np.nan)
    hist = hist.merge(meta, on="product_id", how="left").sort_values(["unique_id", "ds"])
    hist["avg_price"] = hist.groupby("unique_id")["avg_price"].ffill()
    hist["avg_price"] = hist["avg_price"].fillna(hist["list_price"]).astype(float)
    reference = hist.groupby("unique_id")["avg_price"].transform("median").replace(0, np.nan)
    hist["price_index"] = (hist["avg_price"] / reference).fillna(1.0).clip(0.1, 10.0)
    hist["discount_rate"] = hist["discount_rate"].fillna(0.0).clip(0, 1)
    hist["promo"] = (hist["discount_rate"] > PROMO_THRESHOLD).astype(int)
    hist = hist.merge(calendar, on="ds", how="left")

    # The horizon: prices held at the last observed index, no discounts, holidays as scheduled.
    last_index = hist.groupby("unique_id")["price_index"].last()
    future = pd.DataFrame(
        {
            "unique_id": np.repeat(last_index.index.to_numpy(), horizon),
            "ds": np.tile(future_days.to_numpy(), len(last_index)),
            "price_index": np.repeat(last_index.to_numpy(), horizon),
            "discount_rate": 0.0,
            "promo": 0,
        }
    ).merge(calendar, on="ds", how="left")

    static = ids.merge(meta[["product_id", "category_id"]], on="product_id", how="left")
    static["branch"] = static["unique_id"].map(branch_of_series).fillna("none").astype(str)
    static["category"] = static["category_id"].fillna("none").astype(str)
    static = static[["unique_id", "branch", "category"]]
    for column in STATIC:
        static[column] = static[column].astype("category")

    columns = ["unique_id", "ds", *DYNAMIC]
    for frame in (hist, future):
        frame[["is_holiday", "is_pre_holiday", "promo"]] = frame[["is_holiday", "is_pre_holiday", "promo"]].fillna(0).astype(int)
    return Exogenous(history=hist[columns].reset_index(drop=True), future=future[columns].reset_index(drop=True), static=static)
