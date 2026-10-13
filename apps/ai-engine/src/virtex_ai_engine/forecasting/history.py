"""Turning the stock ledger into daily demand series, with stock-outs marked.

## Why stock-outs matter

A day with zero sales and an empty shelf is not a day nobody wanted the product: demand was
*censored*. A model trained on those zeros learns that the product sells less than it does, under-
forecasts, recommends ordering less, and so causes the next stock-out — the commonest way an ERP's
"prediction" makes things worse. So the on-hand quantity of every past day is rebuilt from the
ledger (today's balance minus each day's net movement, walking backwards), and a day that started
with nothing on the shelf and sold nothing is excluded from training rather than counted as zero.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

SERIES_SEP = "|"


def series_id(product_id: str, warehouse_id: str) -> str:
    return f"{product_id}{SERIES_SEP}{warehouse_id}"


def split_series_id(unique_id: str) -> tuple[str, str]:
    product_id, warehouse_id = unique_id.split(SERIES_SEP, 1)
    return product_id, warehouse_id


def build_daily_series(
    demand: pd.DataFrame,
    net_moves: pd.DataFrame,
    on_hand: pd.DataFrame,
    end: pd.Timestamp,
    history_days: int,
) -> pd.DataFrame:
    """Dense daily series per (product, warehouse).

    Args:
        demand: product_id, warehouse_id, branch_id, day, qty_sold, qty_returned
        net_moves: product_id, warehouse_id, day, net_quantity (every movement type)
        on_hand: product_id, warehouse_id, quantity_on_hand (today)
        end: the last complete day of history (yesterday)
        history_days: how far back to look

    Returns:
        unique_id, product_id, warehouse_id, branch_id, ds, y, stock_start, censored
    """
    columns = ["unique_id", "product_id", "warehouse_id", "branch_id", "ds", "y", "stock_start", "censored"]
    if demand.empty:
        return pd.DataFrame(columns=columns)

    start = end - pd.Timedelta(days=history_days - 1)
    demand = demand.copy()
    demand["ds"] = pd.to_datetime(demand["day"])
    demand = demand[(demand["ds"] >= start) & (demand["ds"] <= end)]
    if demand.empty:
        return pd.DataFrame(columns=columns)
    demand["y"] = (demand["qty_sold"].astype(float) - demand["qty_returned"].astype(float)).clip(lower=0)

    keys = demand.groupby(["product_id", "warehouse_id"], as_index=False).agg(
        branch_id=("branch_id", "first"), first_sale=("ds", "min")
    )

    days = pd.date_range(start, end, freq="D")
    grid = keys.loc[keys.index.repeat(len(days))].reset_index(drop=True)
    grid["ds"] = np.tile(days.values, len(keys))
    # A series begins at its first sale: the years before a product existed are not zeros.
    grid = grid[grid["ds"] >= grid["first_sale"]].drop(columns="first_sale")

    daily = demand.groupby(["product_id", "warehouse_id", "ds"], as_index=False)["y"].sum()
    out = grid.merge(daily, on=["product_id", "warehouse_id", "ds"], how="left")
    out["y"] = out["y"].fillna(0.0)

    out = _with_stock(out, net_moves, on_hand, end)
    out["censored"] = (out["stock_start"] <= 0) & (out["y"] <= 0)
    out["unique_id"] = out["product_id"].astype(str) + SERIES_SEP + out["warehouse_id"].astype(str)
    return out[columns].sort_values(["unique_id", "ds"]).reset_index(drop=True)


def _with_stock(out: pd.DataFrame, net_moves: pd.DataFrame, on_hand: pd.DataFrame, end: pd.Timestamp) -> pd.DataFrame:
    """Stock at the start of each day, rebuilt backwards from today's balance."""
    moves = net_moves.copy()
    if moves.empty:
        out["stock_start"] = np.inf
        return out
    moves["ds"] = pd.to_datetime(moves["day"])
    moves = moves.groupby(["product_id", "warehouse_id", "ds"], as_index=False)["net_quantity"].sum()
    moves["net_quantity"] = moves["net_quantity"].astype(float)

    balance = on_hand.copy()
    balance["quantity_on_hand"] = balance["quantity_on_hand"].astype(float)

    out = out.merge(moves, on=["product_id", "warehouse_id", "ds"], how="left")
    out["net_quantity"] = out["net_quantity"].fillna(0.0)
    out = out.merge(balance, on=["product_id", "warehouse_id"], how="left")
    out["quantity_on_hand"] = out["quantity_on_hand"].fillna(0.0)

    # Movements after `end` (today's, so far) also separate the current balance from yesterday's.
    later = moves[moves["ds"] > end].groupby(["product_id", "warehouse_id"], as_index=False)["net_quantity"].sum()
    later = later.rename(columns={"net_quantity": "after_end"})
    out = out.merge(later, on=["product_id", "warehouse_id"], how="left")
    out["after_end"] = out["after_end"].fillna(0.0)

    out = out.sort_values(["product_id", "warehouse_id", "ds"])
    # Movements on this day and every later day within the window, per series.
    out["moves_from_here"] = (
        out.iloc[::-1].groupby(["product_id", "warehouse_id"])["net_quantity"].cumsum().iloc[::-1]
    )
    out["stock_start"] = out["quantity_on_hand"] - out["after_end"] - out["moves_from_here"]
    return out.drop(columns=["net_quantity", "quantity_on_hand", "after_end", "moves_from_here"])


def training_frame(series: pd.DataFrame) -> pd.DataFrame:
    """What the models train on: censored days dropped and the gaps they leave re-filled.

    Statistical models need a regular calendar, so a censored day is replaced by the series' median
    of uncensored days around it rather than left as zero.
    """
    df = series[["unique_id", "ds", "y", "censored"]].copy()
    if df.empty:
        return df[["unique_id", "ds", "y"]]
    rolling = (
        df.assign(y_ok=df["y"].where(~df["censored"]))
        .groupby("unique_id")["y_ok"]
        .transform(lambda s: s.rolling(28, min_periods=1, center=True).median())
    )
    df["y"] = np.where(df["censored"], rolling.fillna(0.0), df["y"])
    return df[["unique_id", "ds", "y"]]
