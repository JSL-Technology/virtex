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
    p = (organization_id, since)
    return {
        "bills": frame(
            conn,
            """SELECT id::text, vendor_id::text, ncf, total::float, date, branch_id::text
                 FROM vendor_bills
                WHERE organization_id = %s AND date >= %s AND voided_at IS NULL
                  AND status::text NOT IN ('VOID', 'REJECTED', 'DRAFT')""",
            p,
        ),
        "bills_year": frame(
            conn,
            """SELECT vendor_id::text, total::float, date FROM vendor_bills
                WHERE organization_id = %s AND date >= (%s::date - 275) AND voided_at IS NULL
                  AND status::text NOT IN ('VOID', 'REJECTED', 'DRAFT')""",
            p,
        ),
        "below_cost": frame(
            conn,
            """SELECT i.id::text AS invoice_id, i."invoiceNumber" AS invoice_number, i."issueDate" AS issue_date,
                      i.branch_id::text, l."productId"::text AS product_id, l.quantity::float,
                      COALESCE(l.taxable_base, l.line_subtotal)::float AS net_amount, l.unit_cost::float
                 FROM invoice_line_item l JOIN invoices i ON i.id = l."invoiceId"
                WHERE i.organization_id = %s AND i."issueDate" >= %s
                  AND i.status::text NOT IN ('Draft', 'Void') AND i.type::text <> 'CREDIT_NOTE'
                  AND l.unit_cost > 0 AND l.quantity > 0 AND l.is_service = false""",
            p,
        ),
        "pos": frame(
            conn,
            """SELECT "cashierId"::text AS cashier_id, branch_id::text, ("createdAt")::date AS day,
                      status::text AS status, total::float
                 FROM pos_sales WHERE organization_id = %s AND "createdAt" >= %s""",
            p,
        ),
        "adjustments": frame(
            conn,
            """SELECT id::text, product_id::text, warehouse_id::text, (date)::date AS day,
                      quantity::float, cost::float
                 FROM stock_movements
                WHERE organization_id = %s AND date >= %s AND type = 'ADJUSTMENT'""",
            p,
        ),
        "branch_daily": frame(
            conn,
            """SELECT branch_id::text, day, SUM(amount)::float AS amount FROM (
                   SELECT branch_id, "issueDate" AS day, total_in_base_currency AS amount FROM invoices
                    WHERE organization_id = %s AND "issueDate" >= (%s::date - 70)
                      AND status::text NOT IN ('Draft', 'Void') AND type::text <> 'CREDIT_NOTE'
                      AND "invoiceNumber" IS NOT NULL
               ) s GROUP BY branch_id, day""",
            p,
        ),
        "invoices": frame(
            conn,
            """SELECT i.id::text, i."invoiceNumber" AS invoice_number, i."issueDate" AS issue_date,
                      i.branch_id::text, i.total_in_base_currency::float AS total,
                      COALESCE(i.discount_total, 0)::float AS discount_total,
                      EXTRACT(HOUR FROM i.created_at)::int AS created_hour,
                      (SELECT COUNT(*) FROM invoice_line_item l WHERE l."invoiceId" = i.id) AS lines,
                      COUNT(*) OVER (PARTITION BY i.customer_id) AS customer_invoices,
                      (i."dueDate" - i."issueDate") AS days_to_due
                 FROM invoices i
                WHERE i.organization_id = %s AND i."issueDate" >= %s
                  AND i.status::text NOT IN ('Draft', 'Void') AND i.type::text <> 'CREDIT_NOTE'""",
            p,
        ),
        "customer_payments": frame(
            conn,
            """SELECT id::text, customer_id::text, reference, total_amount::float, payment_date, branch_id::text
                 FROM customer_payments
                WHERE organization_id = %s AND payment_date >= %s
                  AND status::text = 'POSTED' AND voided_at IS NULL""",
            p,
        ),
        # Every settlement of every bill that received a payment in the window, from payment runs that
        # were not voided. A voided bill is worth nothing: anything settled against it is excess.
        "settlements": frame(
            conn,
            """SELECT b.id::text AS bill_id, b.vendor_id::text, b.branch_id::text, b.date AS bill_date,
                      CASE WHEN b.voided_at IS NOT NULL OR b.status::text = 'VOID' THEN 0 ELSE b.total END::float AS bill_total,
                      vp.id::text AS payment_id, vp.date AS payment_date, vp.amount::float
                 FROM vendor_payment vp
                 JOIN vendor_bills b ON b.id = vp.vendor_bill_id
                 JOIN payment_batches pb ON pb.id = vp.payment_batch_id
                WHERE b.organization_id = %s AND pb.status::text <> 'VOID' AND pb.voided_at IS NULL
                  AND b.id IN (SELECT vendor_bill_id FROM vendor_payment WHERE date >= %s)""",
            p,
        ),
        "po_lines": frame(
            conn,
            """SELECT o.id::text AS order_id, o.number AS order_number, o.supplier_id::text, o.branch_id::text,
                      o.order_date, l.id::text AS line_id, l.product_id::text, l.quantity::float,
                      l.received_quantity::float, l.billed_quantity::float, l.unit_price::float
                 FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
                WHERE o.organization_id = %s AND o.cancelled_at IS NULL
                  AND (o.order_date >= %s OR o.updated_at >= %s::date)
                  AND l.billed_quantity > 0""",
            (organization_id, since, since),
        ),
        "po_bills": frame(
            conn,
            """SELECT o.id::text AS order_id, o.number AS order_number, o.supplier_id::text, o.branch_id::text,
                      o.order_date, o.total::float AS order_total, SUM(b.total)::float AS billed_total,
                      COUNT(b.id) AS bills
                 FROM purchase_orders o JOIN vendor_bills b ON b.purchase_order_id = o.id
                WHERE o.organization_id = %s AND o.cancelled_at IS NULL AND b.voided_at IS NULL
                  AND b.status::text NOT IN ('VOID', 'REJECTED', 'DRAFT')
                  AND (o.order_date >= %s OR b.date >= %s)
                GROUP BY o.id""",
            (organization_id, since, since),
        ),
        # Sales and returns per product: the last 30 days against the 150 before them.
        "returns": frame(
            conn,
            """SELECT product_id::text, (date >= now() - interval '30 days') AS recent,
                      SUM(ABS(quantity)) FILTER (WHERE type = 'SALE_DISPATCH')::float AS dispatched,
                      SUM(ABS(quantity)) FILTER (WHERE type = 'SALE_RETURN')::float AS returned,
                      MAX(date)::date AS last_day
                 FROM stock_movements
                WHERE organization_id = %s AND date >= now() - interval '180 days'
                  AND type IN ('SALE_DISPATCH', 'SALE_RETURN')
                GROUP BY product_id, (date >= now() - interval '30 days')""",
            (organization_id,),
        ),
        "price_changes": frame(
            conn,
            """SELECT h.id::text, h.product_id::text, p.name AS product_name, h.old_price::float, h.new_price::float,
                      h.old_cost::float, h.new_cost::float, p.cost::float AS current_cost,
                      h.changed_by_user_id::text, h.changed_at
                 FROM product_price_history h JOIN products p ON p.id = h.product_id
                WHERE h.organization_id = %s AND h.changed_at >= %s""",
            p,
        ),
        # Half a year of prices, so each product's normal price is known; only the window is reported.
        "invoice_prices": frame(
            conn,
            """SELECT i.id::text AS invoice_id, i."invoiceNumber" AS invoice_number, i."issueDate" AS issue_date,
                      i.branch_id::text, l."productId"::text AS product_id, l.price::float
                 FROM invoice_line_item l JOIN invoices i ON i.id = l."invoiceId"
                WHERE i.organization_id = %s AND i."issueDate" >= (%s::date - 180)
                  AND i.status::text NOT IN ('Draft', 'Void') AND i.type::text = 'INVOICE'
                  AND l."productId" IS NOT NULL AND l.quantity > 0 AND l.price > 0""",
            p,
        ),
        "document_changes": frame(
            conn,
            """SELECT entity, entity_id, action, user_id::text, created_at, status_before, changed_fields
                 FROM ai_src_document_changes
                WHERE organization_id = %s AND created_at >= %s""",
            p,
        ),
        "organization": frame(conn, "SELECT timezone FROM organizations WHERE id = %s", (organization_id,)),
        "feedback": frame(
            conn,
            """SELECT a.detector, f.verdict FROM ai_anomaly_feedback f JOIN ai_anomalies a ON a.id = f.anomaly_id
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
