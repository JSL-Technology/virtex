"""Anomaly detectors. Each is a pure function from DataFrames to findings, so each can be tested on
data built to contain exactly the anomaly it is meant to find.

Four layers, from the most precise to the most general:

1. **Rules** — things that are wrong by definition: the same supplier invoice entered twice, a sale
   below cost, a cashier cancelling far more tickets than anyone else, a stock adjustment far larger
   than the tenant's usual ones.
2. **Time series** — a branch's daily sales far from what that weekday normally brings, measured
   with a robust z-score (median and MAD), so one past outlier does not hide the next.
3. **Multivariate outliers** — Isolation Forest and ECOD, combined, over each invoice's features.
   Unsupervised: useful from the first day, with no labelled fraud to learn from.
4. **Forensics** — Benford's law on a supplier's invoice amounts: invented numbers do not follow
   the first-digit distribution that real amounts do.
5. **Controls** — the checks an auditor runs: receipts recorded twice, suppliers paid more than
   they billed, purchase order / receipt / bill disagreeing, returns, prices and discounts far
   from the norm, issued documents edited or deleted, work at hours the company never works.

A finding carries structured evidence; whether it is a problem is for a person to decide.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.stats import chisquare

#: Robust z-score: (x − median) / (1.4826 · MAD). 1.4826 makes MAD estimate σ for normal data.
MAD_SCALE = 1.4826


@dataclass
class Finding:
    detector: str
    category: str
    severity: str
    score: float
    entity_type: str
    entity_id: str | None
    occurred_on: str
    fingerprint: str
    evidence: dict = field(default_factory=dict)
    branch_id: str | None = None


def robust_z(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    median = np.median(values)
    mad = np.median(np.abs(values - median))
    if mad == 0:
        spread = np.mean(np.abs(values - median))
        if spread == 0:
            return np.zeros_like(values)
        return (values - median) / (1.2533 * spread)  # mean absolute deviation → σ for normal data
    return (values - median) / (MAD_SCALE * mad)


def _score_from_z(z: float, cap: float = 10.0) -> float:
    return float(min(abs(z), cap) / cap)


def _severity_from_z(z: float) -> str:
    z = abs(z)
    if z >= 8:
        return "CRITICAL"
    if z >= 6:
        return "HIGH"
    if z >= 4.5:
        return "MEDIUM"
    return "LOW"


def _iso(day) -> str:
    return pd.Timestamp(day).date().isoformat()


# ── 1. Rules ──────────────────────────────────────────────────────────────────────


def duplicate_vendor_bills(bills: pd.DataFrame) -> list[Finding]:
    """The same supplier document recorded more than once: same supplier and fiscal number, or the
    same supplier, amount and date. Paying it twice is the commonest avoidable loss in payables.

    bills: id, vendor_id, ncf, total, date, branch_id
    """
    findings: list[Finding] = []
    if bills.empty:
        return findings
    seen: set[frozenset] = set()

    by_ncf = bills[bills["ncf"].notna() & (bills["ncf"].astype(str).str.strip() != "")]
    groups = [("same_fiscal_number", g) for _, g in by_ncf.groupby(["vendor_id", by_ncf["ncf"].str.strip().str.upper()]) if len(g) > 1]
    groups += [("same_amount_and_date", g) for _, g in bills.groupby(["vendor_id", "total", "date"]) if len(g) > 1]

    for reason, group in groups:
        ids = frozenset(group["id"].astype(str))
        if ids in seen:
            continue
        seen.add(ids)
        first = group.sort_values("date").iloc[0]
        findings.append(
            Finding(
                detector="rule.duplicate_vendor_bill",
                category="purchases",
                severity="HIGH" if reason == "same_fiscal_number" else "MEDIUM",
                score=1.0 if reason == "same_fiscal_number" else 0.7,
                entity_type="vendor_bill",
                entity_id=str(first["id"]),
                occurred_on=_iso(first["date"]),
                fingerprint=f"dupbill:{':'.join(sorted(ids))}"[:128],
                branch_id=first.get("branch_id"),
                evidence={
                    "reason": reason,
                    "billIds": sorted(ids),
                    "vendorId": str(first["vendor_id"]),
                    "fiscalNumber": first.get("ncf"),
                    "total": float(first["total"]),
                    "count": int(len(group)),
                },
            )
        )
    return findings


def sales_below_cost(lines: pd.DataFrame, min_loss: float = 1.0) -> list[Finding]:
    """Invoices whose lines were sold for less than they cost.

    lines: invoice_id, invoice_number, issue_date, branch_id, product_id, quantity, net_amount, unit_cost
    """
    if lines.empty:
        return []
    df = lines.copy()
    df["cost_total"] = df["quantity"].astype(float) * df["unit_cost"].astype(float)
    df["loss"] = df["cost_total"] - df["net_amount"].astype(float)
    df = df[(df["unit_cost"].astype(float) > 0) & (df["loss"] > 0)]
    findings = []
    for invoice_id, group in df.groupby("invoice_id"):
        loss = float(group["loss"].sum())
        if loss < min_loss:
            continue
        revenue = float(group["net_amount"].sum())
        cost = float(group["cost_total"].sum())
        margin = (revenue - cost) / cost if cost else 0.0
        first = group.iloc[0]
        findings.append(
            Finding(
                detector="rule.sale_below_cost",
                category="sales",
                severity="HIGH" if margin <= -0.3 else "MEDIUM" if margin <= -0.1 else "LOW",
                score=float(min(1.0, -margin)),
                entity_type="invoice",
                entity_id=str(invoice_id),
                occurred_on=_iso(first["issue_date"]),
                fingerprint=f"belowcost:{invoice_id}",
                branch_id=first.get("branch_id"),
                evidence={
                    "invoiceNumber": first.get("invoice_number"),
                    "lines": int(len(group)),
                    "revenue": round(revenue, 2),
                    "cost": round(cost, 2),
                    "loss": round(loss, 2),
                    "margin": round(margin, 4),
                    "productIds": sorted(group["product_id"].dropna().astype(str).unique().tolist())[:20],
                },
            )
        )
    return findings


def excessive_pos_cancellations(sales: pd.DataFrame, min_cancelled: int = 3, z_threshold: float = 3.5) -> list[Finding]:
    """A cashier's day with far more cancelled tickets than is normal across the tenant's tills.

    sales: cashier_id, branch_id, day, status ('PAID' | 'CANCELLED'), total
    """
    if sales.empty:
        return []
    df = sales.copy()
    df["cancelled"] = (df["status"] == "CANCELLED").astype(int)
    df["cancelled_total"] = np.where(df["cancelled"] == 1, df["total"].astype(float), 0.0)
    daily = df.groupby(["cashier_id", "branch_id", "day"], dropna=False).agg(
        tickets=("cancelled", "size"), cancelled=("cancelled", "sum"), cancelled_total=("cancelled_total", "sum")
    ).reset_index()
    if len(daily) < 10:
        return []
    daily["rate"] = daily["cancelled"] / daily["tickets"]
    daily["z"] = robust_z(daily["rate"].to_numpy())
    flagged = daily[(daily["cancelled"] >= min_cancelled) & (daily["z"] >= z_threshold)]
    return [
        Finding(
            detector="rule.pos_cancellations",
            category="cash",
            severity=_severity_from_z(row.z),
            score=_score_from_z(row.z),
            entity_type="user",
            entity_id=str(row.cashier_id) if row.cashier_id is not None else None,
            occurred_on=_iso(row.day),
            fingerprint=f"poscancel:{row.cashier_id}:{_iso(row.day)}",
            branch_id=row.branch_id,
            evidence={
                "cashierId": str(row.cashier_id),
                "tickets": int(row.tickets),
                "cancelled": int(row.cancelled),
                "cancelledTotal": round(float(row.cancelled_total), 2),
                "rate": round(float(row.rate), 4),
                "typicalRate": round(float(daily["rate"].median()), 4),
                "robustZ": round(float(row.z), 2),
            },
        )
        for row in flagged.itertuples(index=False)
    ]


def large_inventory_adjustments(adjustments: pd.DataFrame, z_threshold: float = 4.0, min_value: float = 1.0) -> list[Finding]:
    """A stock adjustment worth far more than the tenant's usual ones — shrinkage, or a keying error.

    adjustments: id, product_id, warehouse_id, day, quantity, cost
    """
    if len(adjustments) < 10:
        return []
    df = adjustments.copy()
    df["value"] = (df["quantity"].astype(float) * df["cost"].astype(float)).abs()
    df["z"] = robust_z(np.log1p(df["value"].to_numpy()))
    flagged = df[(df["z"] >= z_threshold) & (df["value"] >= min_value)]
    return [
        Finding(
            detector="rule.large_inventory_adjustment",
            category="inventory",
            severity=_severity_from_z(row.z),
            score=_score_from_z(row.z),
            entity_type="product",
            entity_id=str(row.product_id),
            occurred_on=_iso(row.day),
            fingerprint=f"adjust:{row.id}",
            evidence={
                "movementId": str(row.id),
                "warehouseId": str(row.warehouse_id),
                "quantity": float(row.quantity),
                "unitCost": float(row.cost),
                "value": round(float(row.value), 2),
                "typicalValue": round(float(df["value"].median()), 2),
                "robustZ": round(float(row.z), 2),
                "direction": "loss" if float(row.quantity) < 0 else "gain",
            },
        )
        for row in flagged.itertuples(index=False)
    ]


# ── 2. Time series ────────────────────────────────────────────────────────────────


def branch_sales_deviations(daily: pd.DataFrame, recent_days: int = 14, z_threshold: float = 4.0,
                            weeks: int = 8, min_relative_change: float = 0.25) -> list[Finding]:
    """A branch's day far from what that weekday normally brings.

    Compared with the same weekday over the previous `weeks` weeks, by robust z-score — a Monday is
    measured against Mondays. Eight reference days estimate the spread loosely, so a day must also
    differ materially (`min_relative_change` of the expected amount): a 10 % dip on a very steady
    branch is statistically unusual and of no interest to anyone. Only recent days are reported: a
    finding from last quarter is history.

    daily: branch_id, day, amount
    """
    if daily.empty:
        return []
    findings = []
    df = daily.copy()
    df["day"] = pd.to_datetime(df["day"])
    last = df["day"].max()
    for branch_id, group in df.groupby("branch_id", dropna=False):
        full = group.set_index("day")["amount"].astype(float).asfreq("D", fill_value=0.0)
        for day in full.index[full.index > last - pd.Timedelta(days=recent_days)]:
            same_weekday = full[(full.index < day) & (full.index.dayofweek == day.dayofweek)].tail(weeks)
            if len(same_weekday) < 6:
                continue
            reference = same_weekday.to_numpy()
            median = float(np.median(reference))
            mad = float(np.median(np.abs(reference - median)))
            scale = MAD_SCALE * mad if mad > 0 else max(np.mean(np.abs(reference - median)) * 1.2533, 1e-9)
            value = float(full[day])
            z = (value - median) / scale
            if abs(z) < z_threshold or median <= 0 or abs(value - median) < min_relative_change * median:
                continue
            findings.append(
                Finding(
                    detector="timeseries.branch_sales",
                    category="sales",
                    severity=_severity_from_z(z),
                    score=_score_from_z(z),
                    entity_type="branch",
                    entity_id=str(branch_id) if branch_id is not None else None,
                    occurred_on=_iso(day),
                    fingerprint=f"branchsales:{branch_id}:{_iso(day)}",
                    branch_id=str(branch_id) if branch_id is not None else None,
                    evidence={
                        "amount": round(value, 2),
                        "expected": round(median, 2),
                        "robustZ": round(float(z), 2),
                        "direction": "drop" if z < 0 else "spike",
                        "weekday": int(day.dayofweek),
                        "comparedWith": int(len(reference)),
                    },
                )
            )
    return findings


# ── 3. Multivariate outliers ──────────────────────────────────────────────────────

INVOICE_FEATURES = ["log_total", "discount_ratio", "hour", "lines", "customer_invoices", "days_to_due"]


def invoice_outliers(invoices: pd.DataFrame, max_findings: int = 20, top_fraction: float = 0.01,
                     min_rows: int = 200) -> list[Finding]:
    """Invoices unlike the rest, by Isolation Forest and ECOD together.

    Two different detectors, rank-averaged: Isolation Forest isolates points that random splits
    separate quickly; ECOD scores each feature's tail probability. A point both find extreme is
    worth a look; one only a single method flags is more often noise.

    invoices: id, invoice_number, issue_date, branch_id, total, discount_total, created_hour, lines,
              customer_invoices, days_to_due
    """
    if len(invoices) < min_rows:
        return []
    from pyod.models.ecod import ECOD
    from sklearn.ensemble import IsolationForest

    df = invoices.copy()
    df["log_total"] = np.log1p(df["total"].astype(float).clip(lower=0))
    gross = (df["total"].astype(float) + df["discount_total"].astype(float)).replace(0, np.nan)
    df["discount_ratio"] = (df["discount_total"].astype(float) / gross).fillna(0.0).clip(0, 1)
    df["hour"] = df["created_hour"].astype(float).fillna(12)
    df["lines"] = df["lines"].astype(float).fillna(1)
    df["customer_invoices"] = np.log1p(df["customer_invoices"].astype(float).fillna(0))
    df["days_to_due"] = df["days_to_due"].astype(float).fillna(0).clip(-30, 365)

    x = df[INVOICE_FEATURES].to_numpy(dtype=float)
    mean, std = x.mean(axis=0), x.std(axis=0)
    std[std == 0] = 1.0
    xs = (x - mean) / std

    iforest = IsolationForest(n_estimators=300, contamination="auto", random_state=0).fit(xs)
    s1 = -iforest.score_samples(xs)
    ecod = ECOD().fit(xs)
    s2 = ecod.decision_scores_
    rank = (pd.Series(s1).rank(pct=True) + pd.Series(s2).rank(pct=True)).to_numpy() / 2

    count = min(max_findings, max(1, int(len(df) * top_fraction)))
    top = np.argsort(-rank)[:count]
    findings = []
    for i in top:
        if rank[i] < 0.99:
            continue
        row = df.iloc[i]
        drivers = sorted(zip(INVOICE_FEATURES, xs[i]), key=lambda kv: -abs(kv[1]))[:3]
        findings.append(
            Finding(
                detector="outlier.invoice",
                category="sales",
                severity="MEDIUM" if rank[i] >= 0.998 else "LOW",
                score=float(rank[i]),
                entity_type="invoice",
                entity_id=str(row["id"]),
                occurred_on=_iso(row["issue_date"]),
                fingerprint=f"outlierinv:{row['id']}",
                branch_id=row.get("branch_id"),
                evidence={
                    "invoiceNumber": row.get("invoice_number"),
                    "total": round(float(row["total"]), 2),
                    "discountRatio": round(float(row["discount_ratio"]), 4),
                    "hour": int(row["hour"]),
                    "lines": int(row["lines"]),
                    "drivers": [{"feature": name, "z": round(float(z), 2)} for name, z in drivers],
                    "percentile": round(float(rank[i]), 4),
                },
            )
        )
    return findings


# ── 4. Forensics ──────────────────────────────────────────────────────────────────

BENFORD = np.log10(1 + 1 / np.arange(1, 10))

#: Nigrini's first-digit mean absolute deviation thresholds.
BENFORD_NONCONFORMITY = 0.015
BENFORD_MARGINAL = 0.012


def first_digit(values: np.ndarray) -> np.ndarray:
    values = np.abs(np.asarray(values, dtype=float))
    values = values[values >= 1]
    return (values / 10 ** np.floor(np.log10(values))).astype(int)


def benford_vendors(bills: pd.DataFrame, min_bills: int = 50) -> list[Finding]:
    """Suppliers whose invoice amounts do not follow Benford's first-digit law.

    Real-world amounts that span orders of magnitude start with 1 about 30 % of the time and with 9
    under 5 %. Amounts made up by a person rarely do. Nonconformity is not proof of anything —
    a supplier selling one product at one price fails the test honestly — so it is reported as a
    low-severity prompt to look, never more.

    bills: vendor_id, total, date
    """
    findings = []
    if bills.empty:
        return findings
    last = pd.to_datetime(bills["date"]).max()
    for vendor_id, group in bills.groupby("vendor_id"):
        digits = first_digit(group["total"].to_numpy())
        if len(digits) < min_bills:
            continue
        counts = np.bincount(digits, minlength=10)[1:10]
        observed = counts / len(digits)
        mad = float(np.mean(np.abs(observed - BENFORD)))
        # Nigrini's MAD thresholds assume large samples; on a few hundred amounts chance alone can
        # cross them. A chi-square test against the Benford proportions must also reject — at 0.1 %,
        # because this runs over every supplier and a lax level would flag some by luck.
        statistic, p_value = chisquare(counts, f_exp=BENFORD * len(digits))
        if mad < BENFORD_NONCONFORMITY or p_value >= 0.001:
            continue
        findings.append(
            Finding(
                detector="forensic.benford",
                category="purchases",
                severity="LOW" if mad < 0.025 else "MEDIUM",
                score=float(min(1.0, mad / 0.05)),
                entity_type="supplier",
                entity_id=str(vendor_id),
                occurred_on=_iso(last),
                fingerprint=f"benford:{vendor_id}:{pd.Timestamp(last):%Y-%m}",
                evidence={
                    "vendorId": str(vendor_id),
                    "bills": int(len(digits)),
                    "mad": round(mad, 4),
                    "chiSquare": round(float(statistic), 2),
                    "pValue": float(p_value),
                    "threshold": BENFORD_NONCONFORMITY,
                    "observed": [round(float(v), 4) for v in observed],
                    "expected": [round(float(v), 4) for v in BENFORD],
                },
            )
        )
    return findings


# ── 5. Controls over money and documents ──────────────────────────────────────────


def duplicate_customer_payments(payments: pd.DataFrame) -> list[Finding]:
    """The same customer receipt recorded twice: same customer and bank reference, or same customer,
    amount and date. Either overstates cash and, once applied, clears invoices nobody paid.

    payments: id, customer_id, reference, total_amount, payment_date, branch_id
    """
    if payments.empty:
        return []
    findings: list[Finding] = []
    seen: set[frozenset] = set()
    ref = payments["reference"].fillna("").astype(str).str.strip().str.upper()
    with_ref = payments[ref != ""]
    groups = [("same_reference", g) for _, g in with_ref.groupby(["customer_id", ref[ref != ""]]) if len(g) > 1]
    groups += [("same_amount_and_date", g) for _, g in payments.groupby(["customer_id", "total_amount", "payment_date"]) if len(g) > 1]
    for reason, group in groups:
        ids = frozenset(group["id"].astype(str))
        if ids in seen:
            continue
        seen.add(ids)
        first = group.sort_values("payment_date").iloc[0]
        findings.append(
            Finding(
                detector="rule.duplicate_customer_payment",
                category="cash",
                severity="HIGH" if reason == "same_reference" else "MEDIUM",
                score=1.0 if reason == "same_reference" else 0.7,
                entity_type="customer_payment",
                entity_id=str(first["id"]),
                occurred_on=_iso(first["payment_date"]),
                fingerprint=f"duppay:{':'.join(sorted(ids))}"[:128],
                branch_id=first.get("branch_id"),
                evidence={
                    "reason": reason,
                    "paymentIds": sorted(ids),
                    "customerId": str(first["customer_id"]),
                    "reference": first.get("reference"),
                    "amount": round(float(first["total_amount"]), 2),
                    "count": int(len(group)),
                },
            )
        )
    return findings


def vendor_overpayments(settlements: pd.DataFrame, tolerance: float = 0.01) -> list[Finding]:
    """Supplier bills settled for more than they were worth, or settled twice by identical payments.

    The payables screens stop a payment above the balance; this catches what got past them — two
    payment runs racing, a voided bill paid anyway, a balance edited by hand.

    settlements: bill_id, vendor_id, bill_total, bill_date, branch_id, payment_id, payment_date, amount
    """
    if settlements.empty:
        return []
    findings = []
    for bill_id, group in settlements.groupby("bill_id"):
        first = group.iloc[0]
        total = float(first["bill_total"])
        settled = float(group["amount"].sum())
        repeated = group.groupby(["amount", "payment_date"]).size()
        repeated = repeated[repeated > 1]
        over = settled - total
        if over <= max(tolerance, total * 1e-4) and repeated.empty:
            continue
        reason = "settled_above_total" if over > max(tolerance, total * 1e-4) else "identical_payments"
        ratio = over / total if total else 1.0
        findings.append(
            Finding(
                detector="rule.vendor_overpayment",
                category="purchases",
                severity="HIGH" if reason == "settled_above_total" else "MEDIUM",
                score=float(min(1.0, 0.6 + max(ratio, 0))),
                entity_type="vendor_bill",
                entity_id=str(bill_id),
                occurred_on=_iso(group["payment_date"].max()),
                fingerprint=f"overpay:{bill_id}",
                branch_id=first.get("branch_id"),
                evidence={
                    "reason": reason,
                    "vendorId": str(first["vendor_id"]),
                    "billTotal": round(total, 2),
                    "settled": round(settled, 2),
                    "excess": round(max(over, 0.0), 2),
                    "payments": int(len(group)),
                    "paymentIds": sorted(group["payment_id"].astype(str).tolist())[:20],
                },
            )
        )
    return findings


def three_way_match(lines: pd.DataFrame, orders: pd.DataFrame, qty_tolerance: float = 0.0001,
                    amount_tolerance: float = 0.02) -> list[Finding]:
    """Purchase order, goods receipt and supplier bill must agree.

    Two breaks matter: a line billed for more than was received (paying for goods that never
    arrived), or for more than was ordered; and an order whose bills add up to more than the order
    itself, beyond a small tolerance for freight and rounding.

    lines:  order_id, order_number, supplier_id, branch_id, order_date, line_id, product_id,
            quantity, received_quantity, billed_quantity, unit_price
    orders: order_id, order_number, supplier_id, branch_id, order_date, order_total, billed_total, bills
    """
    findings = []
    if not lines.empty:
        df = lines.copy()
        for column in ("quantity", "received_quantity", "billed_quantity", "unit_price"):
            df[column] = df[column].astype(float).fillna(0.0)
        df["unreceived"] = df["billed_quantity"] - df["received_quantity"]
        df["over_ordered"] = df["billed_quantity"] - df["quantity"]
        df = df[(df["unreceived"] > qty_tolerance) | (df["over_ordered"] > qty_tolerance)]
        for order_id, group in df.groupby("order_id"):
            first = group.iloc[0]
            value = float((group["unreceived"].clip(lower=0) * group["unit_price"]).sum())
            not_received = bool((group["unreceived"] > qty_tolerance).any())
            findings.append(
                Finding(
                    detector="rule.three_way_match",
                    category="purchases",
                    severity="HIGH" if not_received else "MEDIUM",
                    score=0.9 if not_received else 0.6,
                    entity_type="purchase_order",
                    entity_id=str(order_id),
                    occurred_on=_iso(first["order_date"]),
                    fingerprint=f"3way:lines:{order_id}",
                    branch_id=first.get("branch_id"),
                    evidence={
                        "reason": "billed_not_received" if not_received else "billed_above_ordered",
                        "orderNumber": first.get("order_number"),
                        "supplierId": str(first["supplier_id"]),
                        "lines": int(len(group)),
                        "valueNotReceived": round(value, 2),
                        "productIds": sorted(group["product_id"].dropna().astype(str).unique().tolist())[:20],
                    },
                )
            )
    if not orders.empty:
        df = orders.copy()
        df["order_total"] = df["order_total"].astype(float)
        df["billed_total"] = df["billed_total"].astype(float)
        df = df[(df["order_total"] > 0) & (df["billed_total"] > df["order_total"] * (1 + amount_tolerance))]
        for row in df.itertuples(index=False):
            excess = row.billed_total - row.order_total
            ratio = excess / row.order_total
            findings.append(
                Finding(
                    detector="rule.three_way_match",
                    category="purchases",
                    severity="HIGH" if ratio >= 0.1 else "MEDIUM",
                    score=float(min(1.0, 0.5 + ratio)),
                    entity_type="purchase_order",
                    entity_id=str(row.order_id),
                    occurred_on=_iso(row.order_date),
                    fingerprint=f"3way:amount:{row.order_id}",
                    branch_id=row.branch_id,
                    evidence={
                        "reason": "billed_above_order_total",
                        "orderNumber": row.order_number,
                        "supplierId": str(row.supplier_id),
                        "orderTotal": round(float(row.order_total), 2),
                        "billedTotal": round(float(row.billed_total), 2),
                        "excess": round(float(excess), 2),
                        "bills": int(row.bills),
                    },
                )
            )
    return findings


def returns_spike(movements: pd.DataFrame, min_dispatched: float = 10, min_returned: float = 3,
                  z_threshold: float = 3.5) -> list[Finding]:
    """Products coming back far more often than they used to, and than the tenant's other products.

    A product whose return rate jumps is a quality problem, a mis-sold product — or refunds being
    recorded against goods that never left. Compared with the product's own earlier rate AND with
    the tenant's spread of rates, so a product that has always been returned a lot is not news.

    movements: product_id, recent (bool: inside the reporting window), dispatched, returned, last_day
    """
    if movements.empty:
        return []
    df = movements.copy()
    df["dispatched"] = df["dispatched"].astype(float).fillna(0.0)
    df["returned"] = df["returned"].astype(float).fillna(0.0)
    recent = df[df["recent"]].set_index("product_id")
    before = df[~df["recent"]].set_index("product_id")
    recent = recent[recent["dispatched"] >= min_dispatched]
    if len(recent) < 5:
        return []
    rate = (recent["returned"] / recent["dispatched"]).clip(0, 1)
    z = pd.Series(robust_z(rate.to_numpy()), index=rate.index)
    prior_rate = (before["returned"] / before["dispatched"].replace(0, np.nan)).reindex(rate.index)
    tenant_rate = float(recent["returned"].sum() / recent["dispatched"].sum())
    findings = []
    for product_id in rate.index:
        r, zz = float(rate[product_id]), float(z[product_id])
        baseline = prior_rate.get(product_id)
        baseline = float(baseline) if baseline is not None and np.isfinite(baseline) else tenant_rate
        if recent.loc[product_id, "returned"] < min_returned or zz < z_threshold or r < max(3 * baseline, baseline + 0.1):
            continue
        findings.append(
            Finding(
                detector="rule.returns_spike",
                category="sales",
                severity=_severity_from_z(zz),
                score=_score_from_z(zz),
                entity_type="product",
                entity_id=str(product_id),
                occurred_on=_iso(recent.loc[product_id, "last_day"]),
                fingerprint=f"returns:{product_id}:{pd.Timestamp(recent.loc[product_id, 'last_day']):%Y-%m}",
                evidence={
                    "dispatched": round(float(recent.loc[product_id, "dispatched"]), 2),
                    "returned": round(float(recent.loc[product_id, "returned"]), 2),
                    "returnRate": round(r, 4),
                    "previousRate": round(baseline, 4),
                    "tenantRate": round(tenant_rate, 4),
                    "robustZ": round(zz, 2),
                },
            )
        )
    return findings


def unusual_price_changes(changes: pd.DataFrame, min_relative: float = 0.5) -> list[Finding]:
    """A product's price or cost changed by a large fraction at once, or its price set below cost.

    changes: id, product_id, product_name, old_price, new_price, old_cost, new_cost, current_cost,
             changed_by_user_id, changed_at, local_hour, off_hours (bool)
    """
    if changes.empty:
        return []
    findings = []
    for row in changes.itertuples(index=False):
        reasons, worst = [], 0.0
        for kind, old, new in (("price", row.old_price, row.new_price), ("cost", row.old_cost, row.new_cost)):
            if old is None or new is None or pd.isna(old) or pd.isna(new) or float(old) <= 0:
                continue
            relative = (float(new) - float(old)) / float(old)
            if abs(relative) >= min_relative:
                reasons.append(f"{kind}_{'drop' if relative < 0 else 'rise'}")
                worst = max(worst, abs(relative))
        cost = row.new_cost if row.new_cost is not None and not pd.isna(row.new_cost) else row.current_cost
        below_cost = (row.new_price is not None and not pd.isna(row.new_price) and cost is not None
                      and not pd.isna(cost) and float(cost) > 0 and float(row.new_price) < float(cost))
        if below_cost:
            reasons.append("price_below_cost")
        if not reasons:
            continue
        off_hours = bool(row.off_hours)
        severity = "HIGH" if below_cost or worst >= 0.8 or (off_hours and worst >= min_relative) else "MEDIUM"
        findings.append(
            Finding(
                detector="rule.price_change",
                category="inventory",
                severity=severity,
                score=float(min(1.0, max(worst, 0.8 if below_cost else 0) + (0.1 if off_hours else 0))),
                entity_type="product",
                entity_id=str(row.product_id),
                occurred_on=_iso(row.changed_at),
                fingerprint=f"pricechg:{row.id}",
                evidence={
                    "reasons": reasons,
                    "productName": row.product_name,
                    "oldPrice": None if pd.isna(row.old_price) else round(float(row.old_price), 4),
                    "newPrice": None if pd.isna(row.new_price) else round(float(row.new_price), 4),
                    "oldCost": None if pd.isna(row.old_cost) else round(float(row.old_cost), 4),
                    "newCost": None if pd.isna(row.new_cost) else round(float(row.new_cost), 4),
                    "changedByUserId": None if row.changed_by_user_id is None else str(row.changed_by_user_id),
                    "localHour": int(row.local_hour),
                    "offHours": off_hours,
                },
            )
        )
    return findings


def invoiced_price_deviations(lines: pd.DataFrame, min_history: int = 8, z_threshold: float = 4.0,
                              min_relative: float = 0.4, max_findings: int = 50,
                              report_since=None) -> list[Finding]:
    """A product invoiced at a unit price far from what it is normally invoiced at.

    Measured on the log of the price, against that product's own median and MAD, so a product sold
    at many price points is judged by its own spread. Both a statistical and a material threshold
    must be crossed.

    The history can reach further back than `report_since`; only lines from then on are reported.

    lines: invoice_id, invoice_number, issue_date, branch_id, product_id, price
    """
    if lines.empty:
        return []
    df = lines[lines["price"].astype(float) > 0].copy()
    df["log_price"] = np.log(df["price"].astype(float))
    findings = []
    for product_id, group in df.groupby("product_id"):
        if len(group) < min_history:
            continue
        median = float(np.exp(np.median(group["log_price"])))
        z = robust_z(group["log_price"].to_numpy())
        flagged = group.assign(z=z)
        flagged = flagged[(flagged["z"].abs() >= z_threshold)
                          & ((flagged["price"].astype(float) - median).abs() >= min_relative * median)]
        if report_since is not None:
            flagged = flagged[pd.to_datetime(flagged["issue_date"]) >= pd.Timestamp(report_since)]
        for row in flagged.itertuples(index=False):
            findings.append(
                Finding(
                    detector="rule.invoiced_price",
                    category="sales",
                    severity="HIGH" if row.z <= -6 else "MEDIUM" if abs(row.z) >= 5 else "LOW",
                    score=_score_from_z(row.z),
                    entity_type="invoice",
                    entity_id=str(row.invoice_id),
                    occurred_on=_iso(row.issue_date),
                    fingerprint=f"invprice:{row.invoice_id}:{product_id}",
                    branch_id=row.branch_id,
                    evidence={
                        "invoiceNumber": row.invoice_number,
                        "productId": str(product_id),
                        "price": round(float(row.price), 4),
                        "typicalPrice": round(median, 4),
                        "direction": "below" if row.z < 0 else "above",
                        "robustZ": round(float(row.z), 2),
                        "comparedWith": int(len(group)),
                    },
                )
            )
    findings.sort(key=lambda f: -f.score)
    return findings[:max_findings]


def discount_outliers(invoices: pd.DataFrame, min_ratio: float = 0.25, z_threshold: float = 4.0,
                      min_discounted: int = 20) -> list[Finding]:
    """Invoices discounted far beyond the tenant's own practice.

    The norm is the tenant's: among its discounted invoices, a ratio this far above the median, and
    at least `min_ratio` of the gross. A business that routinely gives 30 % is not flagged for 30 %.

    invoices: id, invoice_number, issue_date, branch_id, total, discount_total
    """
    if invoices.empty:
        return []
    df = invoices.copy()
    gross = df["total"].astype(float) + df["discount_total"].astype(float)
    df["ratio"] = (df["discount_total"].astype(float) / gross.replace(0, np.nan)).fillna(0).clip(0, 1)
    discounted = df[df["ratio"] > 0]
    if len(discounted) < min_discounted:
        return []
    discounted = discounted.assign(z=robust_z(discounted["ratio"].to_numpy()))
    typical = float(discounted["ratio"].median())
    flagged = discounted[(discounted["z"] >= z_threshold) & (discounted["ratio"] >= max(min_ratio, 2 * typical))]
    return [
        Finding(
            detector="rule.discount",
            category="sales",
            severity="HIGH" if row.ratio >= 0.5 else "MEDIUM",
            score=float(min(1.0, row.ratio + 0.3)),
            entity_type="invoice",
            entity_id=str(row.id),
            occurred_on=_iso(row.issue_date),
            fingerprint=f"discount:{row.id}",
            branch_id=row.branch_id,
            evidence={
                "invoiceNumber": row.invoice_number,
                "discount": round(float(row.discount_total), 2),
                "discountRatio": round(float(row.ratio), 4),
                "typicalRatio": round(typical, 4),
                "robustZ": round(float(row.z), 2),
            },
        )
        for row in flagged.itertuples(index=False)
    ]


#: Fields whose change on an issued document alters what it says it is worth, or who it binds.
SENSITIVE_FIELDS = {
    "invoices": {"total", "subtotal", "tax", "discountTotal", "customerId", "issueDate", "fiscalNumber",
                 "invoiceNumber", "totalInBaseCurrency", "exchangeRate", "currencyCode"},
    "vendor_bills": {"total", "ncf", "vendorId", "date", "taxAmount", "totalInBaseCurrency", "exchangeRate",
                     "currencyCode"},
    "customer_payments": {"totalAmount", "customerId", "paymentDate", "reference", "exchangeRate", "currencyCode"},
}
#: Statuses in which a document has not yet been issued and may be edited freely.
UNISSUED = {"Draft", "DRAFT", "PENDING_APPROVAL", "REJECTED"}


def post_issue_changes(changes: pd.DataFrame) -> list[Finding]:
    """An issued document deleted, or its amounts, dates or counterparty edited after issue.

    An issued invoice is voided or credited, never edited or removed: the edit erases what the
    customer and the tax authority were told. Read from the audit trail's metadata only — the names
    of the fields that changed, not their values.

    changes: entity, entity_id, action, user_id, created_at, status_before, changed_fields (list)
    """
    if changes.empty:
        return []
    df = changes[changes["entity"].isin(SENSITIVE_FIELDS)
                 & changes["action"].isin(["UPDATE", "DELETE"])
                 & changes["status_before"].notna()
                 & ~changes["status_before"].isin(UNISSUED)].copy()
    findings = []
    for row in df.itertuples(index=False):
        fields = sorted(set(row.changed_fields or []) & SENSITIVE_FIELDS[row.entity])
        if row.action == "UPDATE" and not fields:
            continue
        deleted = row.action == "DELETE"
        findings.append(
            Finding(
                detector="rule.post_issue_change",
                category="sales" if row.entity == "invoices" else "purchases" if row.entity == "vendor_bills" else "cash",
                severity="CRITICAL" if deleted else "HIGH",
                score=1.0 if deleted else 0.85,
                entity_type={"invoices": "invoice", "vendor_bills": "vendor_bill"}.get(row.entity, "customer_payment"),
                entity_id=str(row.entity_id),
                occurred_on=_iso(row.created_at),
                fingerprint=f"postissue:{row.entity}:{row.entity_id}:{pd.Timestamp(row.created_at).isoformat()}"[:128],
                evidence={
                    "action": row.action,
                    "statusBefore": row.status_before,
                    "fields": fields,
                    "userId": None if row.user_id is None or pd.isna(row.user_id) else str(row.user_id),
                    "changedAt": pd.Timestamp(row.created_at).isoformat(),
                },
            )
        )
    return findings


def local_hours(stamps: pd.Series, timezone: str | None) -> pd.Series:
    """UTC timestamps as wall-clock hours in the tenant's zone; an unknown zone falls back to UTC."""
    stamps = pd.to_datetime(stamps, utc=True)
    try:
        return stamps.dt.tz_convert(timezone or "UTC")
    except Exception:  # noqa: BLE001
        return stamps.dt.tz_convert("UTC")


def learn_rare_hours(hours: pd.Series, rare_share: float = 0.02, min_events: int = 200) -> set[int]:
    """The hours of the day that together account for under `rare_share` of the tenant's activity.

    Learnt, not configured: a bakery's 5 a.m. is normal; an accounting firm's is not. Empty when
    there is too little activity to say what is normal.
    """
    if len(hours) < min_events:
        return set()
    share = hours.value_counts(normalize=True).reindex(range(24), fill_value=0.0).sort_values()
    return {int(h) for h in share[share.cumsum() <= rare_share].index}


def off_hours_activity(events: pd.DataFrame, timezone: str | None, min_events: int = 200,
                       rare_share: float = 0.02, min_rare_actions: int = 3) -> list[Finding]:
    """A user working on documents at hours this company almost never works (see `learn_rare_hours`),
    in the tenant's own time zone.

    events: user_id, created_at (UTC)
    """
    if len(events) < min_events:
        return []
    df = events.dropna(subset=["user_id"]).copy()
    if len(df) < min_events:
        return []
    stamps = local_hours(df["created_at"], timezone)
    df["hour"] = stamps.dt.hour
    df["day"] = stamps.dt.date
    rare_hours = learn_rare_hours(df["hour"], rare_share, min_events)
    if not rare_hours:
        return []
    share = float(df["hour"].isin(rare_hours).mean())
    findings = []
    for (user_id, day), group in df[df["hour"].isin(rare_hours)].groupby(["user_id", "day"]):
        if len(group) < min_rare_actions:
            continue
        findings.append(
            Finding(
                detector="rule.off_hours",
                category="security",
                severity="MEDIUM" if len(group) >= 10 else "LOW",
                score=float(min(1.0, len(group) / 20)),
                entity_type="user",
                entity_id=str(user_id),
                occurred_on=_iso(day),
                fingerprint=f"offhours:{user_id}:{_iso(day)}",
                evidence={
                    "userId": str(user_id),
                    "actions": int(len(group)),
                    "hours": sorted(int(h) for h in group["hour"].unique()),
                    "shareOfActivityAtThoseHours": round(share, 4),
                    "timezone": timezone or "UTC",
                },
            )
        )
    return findings


# ── Feedback ──────────────────────────────────────────────────────────────────────

SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]


# Detectors whose findings are money leaving twice or for nothing. No amount of dismissals quietens
# them: the person who could dismiss them may be the one who benefits from the payment.
NEVER_QUIETENED = frozenset({
    "rule.duplicate_vendor_bill",
    "rule.duplicate_customer_payment",
    "rule.vendor_overpayment",
    "rule.three_way_match",
})


def apply_feedback(findings: list[Finding], feedback: pd.DataFrame, min_votes: int = 5,
                   dismiss_rate: float = 0.7, min_people: int = 2) -> list[Finding]:
    """Quieten a detector this tenant keeps dismissing: one severity lower, and LOW findings dropped.

    feedback: detector, verdict ('USEFUL' | 'FALSE_POSITIVE'), user_id

    The dismissals must come from at least ``min_people`` different people — one person cannot
    teach the engine to stop looking — and the detectors in ``NEVER_QUIETENED`` are never quietened.
    """
    if feedback.empty:
        return findings
    if "user_id" not in feedback.columns:
        feedback = feedback.assign(user_id=None)
    stats = feedback.groupby("detector").agg(
        votes=("verdict", "size"),
        dismissed=("verdict", lambda v: float((v == "FALSE_POSITIVE").mean())),
        people=("user_id", lambda u: int(u.dropna().nunique())),
    )
    noisy = set(stats[
        (stats["votes"] >= min_votes) & (stats["dismissed"] >= dismiss_rate) & (stats["people"] >= min_people)
    ].index) - NEVER_QUIETENED
    out = []
    for finding in findings:
        if finding.detector in noisy:
            level = SEVERITY_ORDER.index(finding.severity)
            if level == 0:
                continue
            finding.severity = SEVERITY_ORDER[level - 1]
            finding.evidence = {**finding.evidence, "quietenedByFeedback": True}
        out.append(finding)
    return out


def finite(value: float) -> float:
    return value if math.isfinite(value) else 0.0
