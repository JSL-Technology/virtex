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
        "feedback": frame(
            conn,
            """SELECT a.detector, f.verdict FROM ai_anomaly_feedback f JOIN ai_anomalies a ON a.id = f.anomaly_id
                WHERE f.organization_id = %s AND f.created_at >= (%s::date - 275)""",
            p,
        ),
    }


def detect(data: dict[str, pd.DataFrame]) -> tuple[list[detectors.Finding], dict]:
    runs = {
        "duplicate_vendor_bills": lambda: detectors.duplicate_vendor_bills(data["bills"]),
        "sales_below_cost": lambda: detectors.sales_below_cost(data["below_cost"]),
        "pos_cancellations": lambda: detectors.excessive_pos_cancellations(data["pos"]),
        "inventory_adjustments": lambda: detectors.large_inventory_adjustments(data["adjustments"]),
        "branch_sales": lambda: detectors.branch_sales_deviations(data["branch_daily"]),
        "invoice_outliers": lambda: detectors.invoice_outliers(data["invoices"]),
        "benford": lambda: detectors.benford_vendors(data["bills_year"]),
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
