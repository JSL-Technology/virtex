"""From a forecast to a decision: cover, stock-out date, safety stock, reorder point, order quantity.

The textbook (s, S) policy with a review period, computed per product and warehouse:

    σ_d          daily forecast error, from the conformal band (P90 − P50 = 1.2816 σ)
    D(L)         median demand over the lead time L
    safety stock z(service level) · σ_d · √L
    reorder pt   D(L) + safety stock
    order up to  D(L + R) + safety stock          (R = review period)
    suggested    max(0, order-up-to − on hand − on order)

Every input is measured — the lead time from this product's own receipts, the error from the
backtest — and every output is a number a buyer can check against the screen.
"""

from __future__ import annotations

import math
from statistics import NormalDist

import numpy as np
import pandas as pd

Z_P90 = NormalDist().inv_cdf(0.90)

#: Days between purchase reviews: what an order must cover beyond the lead time.
REVIEW_PERIOD_DAYS = 14


def compute(
    series: pd.DataFrame,
    forecasts: pd.DataFrame,
    accuracy: pd.DataFrame,
    on_hand: pd.DataFrame,
    lead_times: pd.DataFrame,
    on_order: pd.DataFrame,
    branch_of_warehouse: dict[str, str | None],
    today: pd.Timestamp,
    *,
    service_level: float,
    default_lead_time: float,
    overstock_cover_days: float,
) -> pd.DataFrame:
    """One row per (product, warehouse): everything `ai_inventory_insights` holds."""
    z = NormalDist().inv_cdf(service_level)
    tenant_lead = float(lead_times["lead_time_days"].median()) if not lead_times.empty else default_lead_time
    lead_by_product = (
        lead_times.groupby("product_id")["lead_time_days"].median().to_dict() if not lead_times.empty else {}
    )
    stock = {(r.product_id, r.warehouse_id): float(r.quantity_on_hand) for r in on_hand.itertuples(index=False)}
    pending = on_order.set_index("product_id")["quantity"].astype(float).to_dict() if not on_order.empty else {}
    acc = accuracy.set_index("unique_id")
    censored = series.groupby("unique_id")["censored"].sum().to_dict() if not series.empty else {}
    recent = (
        series[series["ds"] > series["ds"].max() - pd.Timedelta(days=28)]
        .loc[lambda d: ~d["censored"]]
        .groupby("unique_id")["y"]
        .mean()
        .to_dict()
        if not series.empty
        else {}
    )

    rows = []
    for uid, fc in forecasts.sort_values("ds").groupby("unique_id", sort=False):
        product_id, warehouse_id = uid.split("|", 1)
        p50 = fc["p50"].to_numpy(dtype=float)
        p90 = fc["p90"].to_numpy(dtype=float)
        dates = pd.to_datetime(fc["ds"]).to_numpy()
        sigma = max(float(np.mean(p90 - p50)) / Z_P90, 0.0) if len(p50) else 0.0
        lead = float(lead_by_product.get(product_id, tenant_lead) or default_lead_time)
        lead = max(lead, 1.0)
        held = stock.get((product_id, warehouse_id), 0.0)

        demand_lead = float(p50[: math.ceil(lead)].sum())
        safety = z * sigma * math.sqrt(lead)
        reorder_point = demand_lead + safety
        order_up_to = float(p50[: math.ceil(lead + REVIEW_PERIOD_DAYS)].sum()) + safety
        forecast_30 = float(p50[:30].sum())
        forecast_30_p90 = forecast_30 + Z_P90 * sigma * math.sqrt(30)
        daily = forecast_30 / 30.0

        cumulative = np.cumsum(p50)
        if held <= 0 and daily > 0:
            stockout = today
        else:
            beyond = np.nonzero(cumulative > held)[0]
            stockout = pd.Timestamp(dates[beyond[0]]) if len(beyond) and daily > 0 else None
        cover = held / daily if daily > 0 else None

        model = str(acc.loc[uid, "model"]) if uid in acc.index else "unknown"
        no_demand = model == "NoDemand" or daily <= 0
        if no_demand and held > 0:
            status = "DEAD_STOCK"
        elif daily > 0 and stockout is not None and (stockout - today).days <= lead:
            status = "STOCKOUT_RISK"
        elif daily > 0 and held <= reorder_point:
            status = "REORDER"
        elif cover is not None and cover > overstock_cover_days:
            status = "OVERSTOCK"
        else:
            status = "OK"

        wape = acc.loc[uid, "wape"] if uid in acc.index else np.nan
        rows.append(
            {
                "product_id": product_id,
                "warehouse_id": warehouse_id,
                "branch_id": branch_of_warehouse.get(warehouse_id),
                "on_hand": held,
                "avg_daily_demand": float(recent.get(uid, daily)),
                "forecast_30d": forecast_30,
                "forecast_30d_p90": forecast_30_p90,
                "days_of_cover": cover,
                "stockout_date": stockout.date() if stockout is not None else None,
                "lead_time_days": lead,
                "safety_stock": safety,
                "reorder_point": reorder_point,
                "order_up_to": order_up_to,
                "service_level": service_level,
                "status": status,
                "model": model[:48],
                "accuracy_wape": float(wape) if wape is not None and np.isfinite(wape) else None,
                "censored_days": int(censored.get(uid, 0)),
            }
        )

    out = pd.DataFrame(rows)
    if out.empty:
        return out

    # Goods already ordered reduce what to order — shared across a product's warehouses in proportion
    # to what each is expected to need, since a purchase order names the product, not the shelf.
    out["gap"] = (out["order_up_to"] - out["on_hand"]).clip(lower=0)
    share = out["gap"] / out.groupby("product_id")["gap"].transform("sum").replace(0, np.nan)
    out["on_order"] = out["product_id"].map(pending).fillna(0.0) * share.fillna(0.0)
    out["suggested_order_qty"] = np.ceil((out["gap"] - out["on_order"]).clip(lower=0) * 1000) / 1000
    out.loc[out["status"].isin(["OK", "OVERSTOCK", "DEAD_STOCK"]), "suggested_order_qty"] = 0.0

    out["branch_rank"] = (
        out.assign(_branch=out["branch_id"].fillna("none"))
        .groupby("_branch")["forecast_30d"]
        .rank(method="first", ascending=False)
        .astype(int)
    )
    out.loc[out["forecast_30d"] <= 0, "branch_rank"] = None
    return out.drop(columns=["gap", "on_order", "order_up_to"])


def dead_stock_rows(on_hand: pd.DataFrame, modelled: set[tuple[str, str]], branch_of_warehouse: dict[str, str | None],
                    service_level: float) -> pd.DataFrame:
    """Stock that sold nothing in the whole history window: the forecast never sees it, so add it."""
    rows = []
    for r in on_hand.itertuples(index=False):
        if float(r.quantity_on_hand) <= 0 or (r.product_id, r.warehouse_id) in modelled:
            continue
        rows.append(
            {
                "product_id": r.product_id, "warehouse_id": r.warehouse_id,
                "branch_id": branch_of_warehouse.get(r.warehouse_id), "on_hand": float(r.quantity_on_hand),
                "avg_daily_demand": 0.0, "forecast_30d": 0.0, "forecast_30d_p90": 0.0, "days_of_cover": None,
                "stockout_date": None, "lead_time_days": None, "safety_stock": 0.0, "reorder_point": 0.0,
                "service_level": service_level, "status": "DEAD_STOCK", "model": "NoDemand",
                "accuracy_wape": None, "censored_days": 0, "suggested_order_qty": 0.0, "branch_rank": None,
            }
        )
    return pd.DataFrame(rows)
