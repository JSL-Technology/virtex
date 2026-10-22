"""One tenant's anomaly run: load, detect, and merge into `ai_anomalies` without losing decisions."""

from __future__ import annotations

import json
import logging

import pandas as pd
import psycopg

from ..db import Database, frame
from . import detectors

log = logging.getLogger(__name__)


def load(conn: psycopg.Connection, organization_id: str, since) -> dict[str, pd.DataFrame]:
    """Everything the detectors read, from the `ai_src_*` views (which documents count is decided there)."""
    p = (organization_id, since)
    return {
        "bills": frame(
            conn,
            """SELECT id::text, vendor_id::text, ncf, total::float, date, branch_id::text
                 FROM ai_src_posted_bills
                WHERE organization_id = %s AND date >= %s""",
            p,
        ),
        "bills_year": frame(
            conn,
            """SELECT vendor_id::text, total::float, date FROM ai_src_posted_bills
                WHERE organization_id = %s AND date >= (%s::date - 275)""",
            p,
        ),
        "below_cost": frame(
            conn,
            """SELECT invoice_id::text, invoice_number, issue_date, branch_id::text, product_id::text,
                      quantity::float, net_amount::float, unit_cost::float
                 FROM ai_src_invoice_lines
                WHERE organization_id = %s AND issue_date >= %s AND invoice_type <> 'CREDIT_NOTE'
                  AND unit_cost > 0 AND quantity > 0 AND is_service = false""",
            p,
        ),
        "pos": frame(
            conn,
            """SELECT cashier_id::text, branch_id::text, (created_at)::date AS day, status, total::float
                 FROM ai_src_pos_sales WHERE organization_id = %s AND created_at >= %s""",
            p,
        ),
        "adjustments": frame(
            conn,
            """SELECT id::text, product_id::text, warehouse_id::text, (date)::date AS day,
                      quantity::float, cost::float
                 FROM ai_src_stock_movements
                WHERE organization_id = %s AND date >= %s AND type = 'ADJUSTMENT'""",
            p,
        ),
        "branch_daily": frame(
            conn,
            """SELECT branch_id::text, issue_date AS day, SUM(total_in_base_currency)::float AS amount
                 FROM ai_src_issued_invoices
                WHERE organization_id = %s AND issue_date >= (%s::date - 70)
                  AND type <> 'CREDIT_NOTE' AND invoice_number IS NOT NULL
                GROUP BY branch_id, issue_date""",
            p,
        ),
        "invoices": frame(
            conn,
            """SELECT id::text, invoice_number, issue_date, branch_id::text, total_in_base_currency::float AS total,
                      discount_total::float, EXTRACT(HOUR FROM created_at)::int AS created_hour,
                      line_count AS lines,
                      COUNT(*) OVER (PARTITION BY customer_id) AS customer_invoices,
                      (due_date - issue_date) AS days_to_due
                 FROM ai_src_issued_invoices
                WHERE organization_id = %s AND issue_date >= %s AND type <> 'CREDIT_NOTE'""",
            p,
        ),
        "customer_payments": frame(
            conn,
            """SELECT id::text, customer_id::text, reference, total_amount::float, payment_date, branch_id::text
                 FROM ai_src_customer_payments
                WHERE organization_id = %s AND payment_date >= %s""",
            p,
        ),
        # Every settlement of every bill that received a payment in the window. A voided bill is
        # worth nothing (the view gives it a total of 0): anything settled against it is excess.
        "settlements": frame(
            conn,
            """SELECT bill_id::text, vendor_id::text, branch_id::text, bill_date, bill_total::float,
                      payment_id::text, payment_date, amount::float
                 FROM ai_src_vendor_settlements
                WHERE organization_id = %s
                  AND bill_id IN (SELECT bill_id FROM ai_src_vendor_settlements
                                   WHERE organization_id = %s AND payment_date >= %s)""",
            (organization_id, organization_id, since),
        ),
        "po_lines": frame(
            conn,
            """SELECT order_id::text, order_number, supplier_id::text, branch_id::text, order_date, line_id::text,
                      product_id::text, quantity::float, received_quantity::float, billed_quantity::float,
                      unit_price::float
                 FROM ai_src_purchase_order_lines
                WHERE organization_id = %s AND (order_date >= %s OR order_updated_at >= %s::date)
                  AND billed_quantity > 0""",
            (organization_id, since, since),
        ),
        "po_bills": frame(
            conn,
            """SELECT o.id::text AS order_id, o.number AS order_number, o.supplier_id::text, o.branch_id::text,
                      o.order_date, o.total::float AS order_total, SUM(b.total)::float AS billed_total,
                      COUNT(b.id) AS bills
                 FROM ai_src_purchase_orders o JOIN ai_src_posted_bills b ON b.purchase_order_id = o.id
                WHERE o.organization_id = %s AND (o.order_date >= %s OR b.date >= %s)
                GROUP BY o.id, o.number, o.supplier_id, o.branch_id, o.order_date, o.total""",
            (organization_id, since, since),
        ),
        # Sales and returns per product: the last 30 days against the 150 before them.
        "returns": frame(
            conn,
            """SELECT product_id::text, (date >= now() - interval '30 days') AS recent,
                      SUM(ABS(quantity)) FILTER (WHERE type = 'SALE_DISPATCH')::float AS dispatched,
                      SUM(ABS(quantity)) FILTER (WHERE type = 'SALE_RETURN')::float AS returned,
                      MAX(date)::date AS last_day
                 FROM ai_src_stock_movements
                WHERE organization_id = %s AND date >= now() - interval '180 days'
                  AND type IN ('SALE_DISPATCH', 'SALE_RETURN')
                GROUP BY product_id, (date >= now() - interval '30 days')""",
            (organization_id,),
        ),
        "price_changes": frame(
            conn,
            """SELECT id::text, product_id::text, product_name, old_price::float, new_price::float,
                      old_cost::float, new_cost::float, current_cost::float, changed_by_user_id::text, changed_at
                 FROM ai_src_price_changes
                WHERE organization_id = %s AND changed_at >= %s""",
            p,
        ),
        # Half a year of prices, so each product's normal price is known; only the window is reported.
        "invoice_prices": frame(
            conn,
            """SELECT invoice_id::text, invoice_number, issue_date, branch_id::text, product_id::text, price::float
                 FROM ai_src_invoice_lines
                WHERE organization_id = %s AND issue_date >= (%s::date - 180) AND invoice_type = 'INVOICE'
                  AND product_id IS NOT NULL AND quantity > 0 AND price > 0""",
            p,
        ),
        "document_changes": frame(
            conn,
            """SELECT entity, entity_id, action, user_id::text, created_at, status_before, changed_fields
                 FROM ai_src_document_changes
                WHERE organization_id = %s AND created_at >= %s""",
            p,
        ),
        "organization": frame(conn, "SELECT timezone FROM ai_src_organizations WHERE organization_id = %s", (organization_id,)),
        # Watching when people work is the company's choice, off until it opts in (H-M9).
        "settings": frame(
            conn,
            "SELECT activity_monitoring FROM ai_organization_settings WHERE organization_id = %s",
            (organization_id,),
        ),
        "feedback": frame(
            conn,
            """SELECT a.detector, f.verdict, f.user_id::text AS user_id FROM ai_anomaly_feedback f JOIN ai_anomalies a ON a.id = f.anomaly_id
                WHERE f.organization_id = %s AND f.created_at >= (%s::date - 275)""",
            p,
        ),
    }


def _timezone(data: dict) -> str | None:
    org = data.get("organization")
    return None if org is None or org.empty else org["timezone"].iloc[0]


def _with_local_hours(data: dict, key: str, column: str) -> pd.DataFrame:
    """Add the tenant's wall-clock hour, and whether it is one of the hours the tenant rarely works."""
    df = data[key].copy()
    if df.empty:
        return df.assign(local_hour=pd.Series(dtype=int), off_hours=pd.Series(dtype=bool))
    tz = _timezone(data)
    changes = data.get("document_changes", pd.DataFrame())
    rare = detectors.learn_rare_hours(detectors.local_hours(changes["created_at"], tz).dt.hour) if not changes.empty else set()
    df["local_hour"] = detectors.local_hours(df[column], tz).dt.hour
    df["off_hours"] = df["local_hour"].isin(rare)
    return df


def _activity_monitoring(data: dict) -> bool:
    settings = data.get("settings")
    return settings is not None and not settings.empty and bool(settings["activity_monitoring"].iloc[0])


def detect(data: dict[str, pd.DataFrame]) -> tuple[list[detectors.Finding], dict]:
    runs = {
        "duplicate_vendor_bills": lambda: detectors.duplicate_vendor_bills(data["bills"]),
        "sales_below_cost": lambda: detectors.sales_below_cost(data["below_cost"]),
        "pos_cancellations": lambda: detectors.excessive_pos_cancellations(data["pos"]),
        "inventory_adjustments": lambda: detectors.large_inventory_adjustments(data["adjustments"]),
        "branch_sales": lambda: detectors.branch_sales_deviations(data["branch_daily"]),
        "invoice_outliers": lambda: detectors.invoice_outliers(data["invoices"]),
        "benford": lambda: detectors.benford_vendors(data["bills_year"]),
        "duplicate_customer_payments": lambda: detectors.duplicate_customer_payments(data["customer_payments"]),
        "vendor_overpayments": lambda: detectors.vendor_overpayments(data["settlements"]),
        "three_way_match": lambda: detectors.three_way_match(data["po_lines"], data["po_bills"]),
        "returns_spike": lambda: detectors.returns_spike(data["returns"]),
        "price_changes": lambda: detectors.unusual_price_changes(_with_local_hours(data, "price_changes", "changed_at")),
        "invoiced_prices": lambda: detectors.invoiced_price_deviations(data["invoice_prices"], report_since=data.get("since")),
        "discounts": lambda: detectors.discount_outliers(data["invoices"]),
        "post_issue_changes": lambda: detectors.post_issue_changes(data["document_changes"]),
        "off_hours": lambda: detectors.off_hours_activity(data["document_changes"], _timezone(data)),
    }
    if not _activity_monitoring(data):
        # A finding about one person's working hours is processing of employee behaviour: only for a
        # company that turned it on, having told its people.
        del runs["off_hours"]
    findings: list[detectors.Finding] = []
    counts: dict[str, int | str] = {}
    for name, fn in runs.items():
        try:
            found = fn()
            counts[name] = len(found)
            findings.extend(found)
        except Exception:  # noqa: BLE001 — one detector failing must not silence the others
            log.exception("detector %s failed", name)
            counts[name] = "failed"
    findings = detectors.apply_feedback(findings, data["feedback"])
    return findings, counts


def run(db: Database, organization_id: str, run_id: str, raw_params: dict, today: pd.Timestamp | None = None) -> dict:
    lookback = int(min(max(float(raw_params.get("lookbackDays", 90) or 90), 14), 365))
    today = (today or pd.Timestamp.utcnow().tz_localize(None)).normalize()
    since = (today - pd.Timedelta(days=lookback)).date()

    with db.tenant_transaction(organization_id) as conn:
        data = load(conn, organization_id, since)
    data["since"] = since
    findings, counts = detect(data)

    with db.tenant_transaction(organization_id) as conn:
        upsert(conn, organization_id, run_id, findings)
    return {"metrics": {"findings": len(findings), "byDetector": counts, "lookbackDays": lookback}, "data_hash": None}


def upsert(conn: psycopg.Connection, organization_id: str, run_id: str, findings: list[detectors.Finding]) -> None:
    """Insert new findings; refresh known ones. A finding someone confirmed or dismissed keeps that
    decision — the status is never overwritten by a run."""
    with conn.cursor() as cur:
        for f in findings:
            cur.execute(
                """INSERT INTO ai_anomalies (organization_id, run_id, detector, category, severity, score,
                                             entity_type, entity_id, branch_id, occurred_on, fingerprint, evidence)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                   ON CONFLICT (organization_id, fingerprint) DO UPDATE
                      SET run_id = EXCLUDED.run_id, severity = EXCLUDED.severity, score = EXCLUDED.score,
                          evidence = EXCLUDED.evidence, updated_at = now()""",
                (
                    organization_id, run_id, f.detector[:48], f.category[:32], f.severity,
                    round(detectors.finite(float(f.score)), 6), f.entity_type[:48], f.entity_id, f.branch_id,
                    f.occurred_on, f.fingerprint[:128], json.dumps(f.evidence, default=str),
                ),
            )
