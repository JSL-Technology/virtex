"""One tenant's forecasting run, from the ledger to `ai_inventory_insights`."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
import psycopg

from ..db import Database, frame
from . import classify, exogenous, history, insights, models, reconcile

log = logging.getLogger(__name__)


@dataclass
class Params:
    horizon_days: int = 90
    service_level: float = 0.95
    history_days: int = 730
    default_lead_time_days: float = 7.0
    overstock_cover_days: float = 120.0

    @classmethod
    def from_run(cls, raw: dict) -> "Params":
        def num(key: str, default: float, low: float, high: float) -> float:
            try:
                value = float(raw.get(key, default))
            except (TypeError, ValueError):
                return default
            return min(max(value, low), high)

        return cls(
            horizon_days=int(num("horizonDays", 90, 14, 180)),
            service_level=num("serviceLevel", 0.95, 0.5, 0.995),
            history_days=int(num("historyDays", 730, 120, 1460)),
            default_lead_time_days=num("defaultLeadTimeDays", 7, 1, 180),
            overstock_cover_days=num("overstockCoverDays", 120, 30, 720),
        )


def load(conn: psycopg.Connection, organization_id: str, params: Params, today: pd.Timestamp) -> dict[str, pd.DataFrame]:
    since = (today - pd.Timedelta(days=params.history_days + 1)).date()
    org = (organization_id,)
    return {
        "demand": frame(
            conn,
            """SELECT product_id::text, warehouse_id::text, branch_id::text, day, qty_sold, qty_returned
                 FROM ai_src_daily_demand WHERE organization_id = %s AND day >= %s""",
            (organization_id, since),
        ),
        "net_moves": frame(
            conn,
            """SELECT product_id::text, warehouse_id::text, day, net_quantity
                 FROM ai_src_stock_daily_net WHERE organization_id = %s AND day >= %s""",
            (organization_id, since),
        ),
        "on_hand": frame(
            conn,
            """SELECT l.product_id::text, l.warehouse_id::text, l.quantity_on_hand
                 FROM stock_levels l JOIN products p ON p.id = l.product_id
                WHERE l.organization_id = %s AND p.kind = 'GOOD'""",
            org,
        ),
        "warehouses": frame(
            conn, "SELECT id::text AS warehouse_id, branch_id::text FROM warehouses WHERE organization_id = %s", org
        ),
        "lead_times": frame(
            conn,
            """SELECT product_id::text, lead_time_days::float FROM ai_src_lead_times
                WHERE organization_id = %s AND received_on >= %s""",
            (organization_id, since),
        ),
        "prices": frame(
            conn,
            """SELECT product_id::text, day, avg_price::float, discount_rate::float
                 FROM ai_src_daily_prices WHERE organization_id = %s AND day >= %s""",
            (organization_id, since),
        ),
        "products": frame(
            conn,
            "SELECT id::text AS product_id, price::float, category_id::text FROM products WHERE organization_id = %s",
            org,
        ),
        "organization": frame(conn, "SELECT country, timezone FROM organizations WHERE id = %s", org),
        "on_order": frame(
            conn,
            """SELECT l.product_id::text, SUM(GREATEST(l.quantity - l.received_quantity, 0))::float AS quantity
                 FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
                WHERE o.organization_id = %s AND l.product_id IS NOT NULL
                  -- Committed and not yet fully received: what is already on its way.
                  AND o.status::text IN ('APPROVED', 'SENT', 'PARTIALLY_RECEIVED')
                GROUP BY l.product_id""",
            org,
        ),
    }


def run(db: Database, organization_id: str, run_id: str, raw_params: dict, *, foundation: bool = False,
        max_series: int = 20_000, today: pd.Timestamp | None = None) -> dict:
    params = Params.from_run(raw_params)
    today = (today or pd.Timestamp.utcnow().tz_localize(None)).normalize()
    end = today - pd.Timedelta(days=1)

    with db.tenant_transaction(organization_id) as conn:
        data = load(conn, organization_id, params, today)

    branch_of_warehouse = {r.warehouse_id: r.branch_id for r in data["warehouses"].itertuples(index=False)}
    series = history.build_daily_series(data["demand"], data["net_moves"], data["on_hand"], end, params.history_days)

    # The slowest movers beyond the cap are summarised by their own average rather than modelled.
    if not series.empty and series["unique_id"].nunique() > max_series:
        keep = series.groupby("unique_id")["y"].sum().nlargest(max_series).index
        series = series[series["unique_id"].isin(keep)]

    train = history.training_frame(series)
    classes = classify.classify(train) if not train.empty else pd.DataFrame(columns=["unique_id", "demand_class"])
    if train.empty:
        result = models.ForecastResult(
            forecasts=pd.DataFrame(columns=["unique_id", "ds", "p10", "p50", "p90", "model"]),
            accuracy=pd.DataFrame(columns=["unique_id", "model", "wape", "demand_class"]),
            metrics={"series": 0},
        )
        reconciled = False
    else:
        branch_of_series = {
            uid: str(branch_of_warehouse.get(history.split_series_id(uid)[1]) or "none")
            for uid in train["unique_id"].unique()
        }
        country = data["organization"]["country"].iloc[0] if not data["organization"].empty else None
        exog = exogenous.build(train, data["prices"], data["products"], branch_of_series, country, params.horizon_days)
        result = models.forecast_all(train, classes, params.horizon_days, foundation=foundation, exog=exog)
        result.forecasts, reconciled = reconcile.reconcile(train, result.forecasts, branch_of_series)

    table = insights.compute(
        series, result.forecasts, result.accuracy, data["on_hand"], data["lead_times"], data["on_order"],
        branch_of_warehouse, today, service_level=params.service_level,
        default_lead_time=params.default_lead_time_days, overstock_cover_days=params.overstock_cover_days,
    )
    modelled = set(zip(table["product_id"], table["warehouse_id"])) if not table.empty else set()
    dead = insights.dead_stock_rows(data["on_hand"], modelled, branch_of_warehouse, params.service_level)
    table = pd.concat([t for t in (table, dead) if not t.empty], ignore_index=True) if not (table.empty and dead.empty) else table

    data_hash = hashlib.sha256(
        pd.util.hash_pandas_object(train, index=False).values.tobytes() if not train.empty else b""
    ).hexdigest()
    metrics = {
        **result.metrics,
        "reconciled": reconciled,
        "insights": int(len(table)),
        "byStatus": {k: int(v) for k, v in table["status"].value_counts().items()} if not table.empty else {},
        "censoredDays": int(series["censored"].sum()) if not series.empty else 0,
    }

    with db.tenant_transaction(organization_id) as conn:
        write(conn, organization_id, run_id, result.forecasts, table, branch_of_warehouse)
    return {"metrics": metrics, "data_hash": data_hash}


#: Rows per INSERT. COPY is refused under row-level security for a role without BYPASSRLS — which
#: is the point of the role — so rows go in as arrays unnested server-side, a batch at a time.
BATCH = 5_000


def _insert(conn: psycopg.Connection, table: str, columns: list[str], types: list[str], rows: list[tuple]) -> None:
    select = ", ".join(f"u.c{i}" for i in range(len(columns)))
    unnest = ", ".join(f"%s::{t}[]" for t in types)
    aliases = ", ".join(f"c{i}" for i in range(len(columns)))
    sql = f"INSERT INTO {table} ({', '.join(columns)}) SELECT {select} FROM unnest({unnest}) AS u({aliases})"
    for start in range(0, len(rows), BATCH):
        chunk = rows[start : start + BATCH]
        conn.execute(sql, [list(col) for col in zip(*chunk)])


def _clean(value):
    if value is None or value is pd.NaT:
        return None
    if isinstance(value, float) and not np.isfinite(value):
        return None
    if not isinstance(value, str) and pd.isna(value):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    return value


def write(conn: psycopg.Connection, organization_id: str, run_id: str, forecasts: pd.DataFrame,
          table: pd.DataFrame, branch_of_warehouse: dict[str, str | None]) -> None:
    """Replace the tenant's forecasts and insights in one transaction: readers see old or new, never neither."""
    conn.execute("DELETE FROM ai_forecasts WHERE organization_id = %s", (organization_id,))
    if not forecasts.empty:
        rows = []
        for r in forecasts.itertuples(index=False):
            product_id, warehouse_id = history.split_series_id(r.unique_id)
            rows.append((organization_id, run_id, product_id, warehouse_id, branch_of_warehouse.get(warehouse_id),
                         pd.Timestamp(r.ds).date(), round(float(r.p10), 6), round(float(r.p50), 6),
                         round(float(r.p90), 6), str(r.model)[:48]))
        _insert(conn, "ai_forecasts",
                ["organization_id", "run_id", "product_id", "warehouse_id", "branch_id", "forecast_date", "p10", "p50", "p90", "model"],
                ["uuid", "uuid", "uuid", "uuid", "uuid", "date", "numeric", "numeric", "numeric", "text"], rows)

    conn.execute("DELETE FROM ai_inventory_insights WHERE organization_id = %s", (organization_id,))
    if table.empty:
        return
    columns = ["product_id", "warehouse_id", "branch_id", "on_hand", "avg_daily_demand", "forecast_30d",
               "forecast_30d_p90", "days_of_cover", "stockout_date", "lead_time_days", "safety_stock",
               "reorder_point", "suggested_order_qty", "service_level", "status", "branch_rank", "model",
               "accuracy_wape", "censored_days"]
    types = ["uuid", "uuid", "uuid", "numeric", "numeric", "numeric", "numeric", "numeric", "date", "numeric",
             "numeric", "numeric", "numeric", "numeric", "text", "int", "text", "numeric", "int"]
    rows = [(organization_id, run_id, *(_clean(v) for v in row)) for row in table[columns].itertuples(index=False)]
    _insert(conn, "ai_inventory_insights", ["organization_id", "run_id", *columns], ["uuid", "uuid", *types], rows)
