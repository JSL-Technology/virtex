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


# ── Feedback ──────────────────────────────────────────────────────────────────────

SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]


def apply_feedback(findings: list[Finding], feedback: pd.DataFrame, min_votes: int = 5,
                   dismiss_rate: float = 0.7) -> list[Finding]:
    """Quieten a detector this tenant keeps dismissing: one severity lower, and LOW findings dropped.

    feedback: detector, verdict ('USEFUL' | 'FALSE_POSITIVE')
    """
    if feedback.empty:
        return findings
    stats = feedback.groupby("detector")["verdict"].agg(
        votes="size", dismissed=lambda v: float((v == "FALSE_POSITIVE").mean())
    )
    noisy = set(stats[(stats["votes"] >= min_votes) & (stats["dismissed"] >= dismiss_rate)].index)
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
