"""One tenant's cash-flow run: load the open documents and payment habits, simulate, write the band.

Two kinds of run share this code. CASHFLOW is the tenant's projection, replaced on every run.
SCENARIO is a what-if (`params.scenario`) written beside it, kept for comparison and pruned to the
last few; it writes no per-document rows, because the documents are the projection's.
"""

from __future__ import annotations

import hashlib
import json
import logging

import numpy as np
import pandas as pd
import psycopg

from ..db import Database, frame
from . import model

log = logging.getLogger(__name__)

#: Scenarios kept per tenant; older ones (and their rows) are deleted.
KEEP_SCENARIOS = 20


def load(conn: psycopg.Connection, organization_id: str, params: model.Params, today: pd.Timestamp) -> dict:
    """The open documents and payment habits, from the `ai_src_*` views (which documents count is decided there)."""
    org = organization_id
    since = (today - pd.Timedelta(days=params.history_days)).date()
    recent = (today - pd.Timedelta(days=182)).date()
    receivables = frame(
        conn,
        """SELECT id::text AS document_id, customer_id::text AS party_id, customer_name AS party_name,
                  invoice_number AS number, due_date, balance_in_base_currency::float AS amount
             FROM ai_src_issued_invoices
            WHERE organization_id = %s AND type <> 'CREDIT_NOTE' AND balance > 0.005""",
        (org,),
    )
    payables = frame(
        conn,
        """SELECT id::text AS document_id, vendor_id::text AS party_id, vendor_name AS party_name,
                  ncf AS number, due_date, balance_in_base_currency::float AS amount
             FROM ai_src_posted_bills
            WHERE organization_id = %s AND balance > 0.005""",
        (org,),
    )
    receipt_history = frame(
        conn,
        """SELECT customer_id::text AS party_id, (payment_date - due_date)::float AS delay_days, amount::float AS weight
             FROM ai_src_customer_receipts
            WHERE organization_id = %s AND payment_date >= %s""",
        (org, since),
    )
    payment_history = frame(
        conn,
        """SELECT vendor_id::text AS party_id, (payment_date::date - bill_due_date::date)::float AS delay_days,
                  amount::float AS weight
             FROM ai_src_vendor_settlements
            WHERE organization_id = %s AND payment_date >= %s""",
        (org, since),
    )
    daily_sales = frame(
        conn,
        """SELECT issue_date AS day, SUM(total_in_base_currency)::float AS amount
             FROM ai_src_issued_invoices
            WHERE organization_id = %s AND type <> 'CREDIT_NOTE' AND issue_date >= %s
            GROUP BY issue_date""",
        (org, recent),
    )
    daily_bills = frame(
        conn,
        """SELECT date AS day, SUM(total_in_base_currency)::float AS amount
             FROM ai_src_posted_bills WHERE organization_id = %s AND date >= %s
            GROUP BY date""",
        (org, recent),
    )
    terms = frame(
        conn,
        """SELECT
             (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY due_date - issue_date)
                FROM ai_src_issued_invoices
               WHERE organization_id = %s AND type <> 'CREDIT_NOTE' AND issue_date >= %s)::float AS customer,
             (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY due_date::date - date::date)
                FROM ai_src_posted_bills WHERE organization_id = %s AND date >= %s)::float AS vendor""",
        (org, recent, org, recent),
    )
    payroll = frame(
        conn,
        """SELECT pay_date, amount::float FROM ai_src_payroll_outflows
            WHERE organization_id = %s ORDER BY pay_date DESC LIMIT 3""",
        (org,),
    )
    t = terms.iloc[0] if not terms.empty else {}
    return {
        "receivables": receivables,
        "payables": payables,
        "receipt_history": receipt_history,
        "payment_history": payment_history,
        "daily_sales": daily_sales,
        "daily_bills": daily_bills,
        "terms": {
            "customer": _number(t.get("customer") if len(terms) else None, 30.0),
            "vendor": _number(t.get("vendor") if len(terms) else None, 30.0),
        },
        "payroll": {
            "amount": float(payroll["amount"].mean()) if not payroll.empty else 0.0,
            "day": int(pd.Timestamp(payroll["pay_date"].iloc[0]).day) if not payroll.empty and payroll["pay_date"].iloc[0] else 0,
        },
    }


def _number(value, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return default if not np.isfinite(number) else max(0.0, number)


def run(db: Database, organization_id: str, run_id: str, raw_params: dict, *, kind: str = "CASHFLOW",
        today: pd.Timestamp | None = None) -> dict:
    params = model.Params.from_run(raw_params)
    today = (today or pd.Timestamp.utcnow().tz_localize(None)).normalize()
    with db.tenant_transaction(organization_id) as conn:
        data = load(conn, organization_id, params, today)

    sim = model.simulate(data, today, params)
    daily, metrics = model.summarise(sim, today, params)
    metrics["documents"] = {"receivables": int(len(data["receivables"])), "payables": int(len(data["payables"]))}
    metrics["history"] = {"receipts": int(len(data["receipt_history"])), "payments": int(len(data["payment_history"]))}
    metrics["terms"] = data["terms"]
    if params.scenario:
        metrics["scenario"] = raw_params.get("scenario")
    data_hash = hashlib.sha256(
        json.dumps([len(data["receivables"]), float(data["receivables"]["amount"].sum()) if len(data["receivables"]) else 0,
                    len(data["payables"]), params.opening_cash], default=str).encode()
    ).hexdigest()

    with db.tenant_transaction(organization_id) as conn:
        write(conn, organization_id, run_id, kind, daily, sim.items if kind == "CASHFLOW" else pd.DataFrame(), today)
    return {"metrics": metrics, "data_hash": data_hash}


def _insert(conn: psycopg.Connection, table: str, columns: list[str], types: list[str], rows: list[tuple]) -> None:
    if not rows:
        return
    select = ", ".join(f"u.c{i}" for i in range(len(columns)))
    unnest = ", ".join(f"%s::{t}[]" for t in types)
    aliases = ", ".join(f"c{i}" for i in range(len(columns)))
    conn.execute(
        f"INSERT INTO {table} ({', '.join(columns)}) SELECT {select} FROM unnest({unnest}) AS u({aliases})",
        [list(col) for col in zip(*rows)],
    )


def write(conn: psycopg.Connection, organization_id: str, run_id: str, kind: str, daily: pd.DataFrame,
          items: pd.DataFrame, today: pd.Timestamp) -> None:
    """Write this run's rows and drop what it replaces, in one transaction."""
    if kind == "CASHFLOW":
        # The projection is one: the previous run's rows go.
        for table in ("ai_cashflow_forecasts", "ai_cashflow_items"):
            conn.execute(
                f"""DELETE FROM {table} WHERE organization_id = %s AND run_id IN (
                        SELECT id FROM ai_model_runs WHERE organization_id = %s AND kind = 'CASHFLOW' AND id <> %s)""",
                (organization_id, organization_id, run_id),
            )
    else:
        conn.execute(
            """DELETE FROM ai_cashflow_forecasts WHERE organization_id = %s AND run_id IN (
                   SELECT id FROM ai_model_runs WHERE organization_id = %s AND kind = 'SCENARIO' AND id <> %s
                    ORDER BY created_at DESC OFFSET %s)""",
            (organization_id, organization_id, run_id, KEEP_SCENARIOS - 1),
        )
    conn.execute("DELETE FROM ai_cashflow_forecasts WHERE organization_id = %s AND run_id = %s", (organization_id, run_id))
    conn.execute("DELETE FROM ai_cashflow_items WHERE organization_id = %s AND run_id = %s", (organization_id, run_id))

    _insert(
        conn, "ai_cashflow_forecasts",
        ["organization_id", "run_id", "day", "p10", "p50", "p90", "inflow", "outflow", "components"],
        ["uuid", "uuid", "date", "numeric", "numeric", "numeric", "numeric", "numeric", "jsonb"],
        [(organization_id, run_id, r.day, round(float(r.p10), 2), round(float(r.p50), 2), round(float(r.p90), 2),
          round(float(r.inflow), 2), round(float(r.outflow), 2), json.dumps(r.components))
         for r in daily.itertuples(index=False)],
    )
    if items.empty:
        return
    rows = []
    for r in items.itertuples(index=False):
        expected = (today + pd.Timedelta(days=int(r.expected_day))).date() \
            if r.expected_day is not None and not pd.isna(r.expected_day) else None
        rows.append((organization_id, run_id, r.kind, r.document_id, r.party_id, (r.party_name or "")[:300],
                     (r.number or "")[:64] if isinstance(r.number, str) else None, pd.Timestamp(r.due_date).date(),
                     round(float(r.amount), 2), expected, round(float(r.p_by_7), 4), round(float(r.p_by_30), 4),
                     round(float(r.p_in_horizon), 4), bool(r.doubtful)))
    _insert(
        conn, "ai_cashflow_items",
        ["organization_id", "run_id", "kind", "document_id", "party_id", "party_name", "number", "due_date", "amount",
         "expected_date", "p_by_7", "p_by_30", "p_in_horizon", "doubtful"],
        ["uuid", "uuid", "text", "uuid", "uuid", "text", "text", "date", "numeric", "date", "numeric", "numeric",
         "numeric", "boolean"],
        rows,
    )
