import numpy as np
import pandas as pd

from virtex_ai_engine.anomalies import detectors


def test_finds_the_same_supplier_invoice_entered_twice():
    bills = pd.DataFrame(
        {
            "id": ["b1", "b2", "b3", "b4"],
            "vendor_id": ["v1", "v1", "v1", "v2"],
            "ncf": ["B0100000001", "b0100000001 ", "B0100000002", "B0100000001"],
            "total": [100.0, 100.0, 250.0, 100.0],
            "date": pd.to_datetime(["2025-01-01", "2025-01-05", "2025-01-06", "2025-01-01"]),
            "branch_id": [None] * 4,
        }
    )
    found = detectors.duplicate_vendor_bills(bills)
    assert len(found) == 1
    assert found[0].evidence["billIds"] == ["b1", "b2"]
    assert found[0].severity == "HIGH"
    # A different supplier with the same number is not a duplicate.
    assert "b4" not in found[0].evidence["billIds"]


def test_finds_sales_below_cost_and_ignores_healthy_margins():
    lines = pd.DataFrame(
        {
            "invoice_id": ["i1", "i1", "i2"],
            "invoice_number": ["F-1", "F-1", "F-2"],
            "issue_date": pd.to_datetime(["2025-02-01"] * 3),
            "branch_id": ["b"] * 3,
            "product_id": ["p1", "p2", "p1"],
            "quantity": [10.0, 1.0, 1.0],
            "net_amount": [50.0, 30.0, 12.0],
            "unit_cost": [8.0, 20.0, 8.0],
        }
    )
    found = detectors.sales_below_cost(lines)
    assert [f.entity_id for f in found] == ["i1"]
    assert found[0].evidence["loss"] == 30.0
    assert found[0].severity == "HIGH"


def test_finds_a_cashier_cancelling_far_more_than_anyone_else():
    rng = np.random.default_rng(3)
    rows = []
    for cashier in ["c1", "c2", "c3", "c4"]:
        for day in pd.date_range("2025-03-01", periods=10):
            for _ in range(30):
                rows.append({"cashier_id": cashier, "branch_id": "b", "day": day, "status": "CANCELLED" if rng.random() < 0.02 else "PAID", "total": 10.0})
    rows += [{"cashier_id": "c4", "branch_id": "b", "day": pd.Timestamp("2025-03-11"), "status": "CANCELLED", "total": 50.0} for _ in range(12)]
    rows += [{"cashier_id": "c4", "branch_id": "b", "day": pd.Timestamp("2025-03-11"), "status": "PAID", "total": 10.0} for _ in range(18)]
    found = detectors.excessive_pos_cancellations(pd.DataFrame(rows))
    assert [(f.entity_id, f.occurred_on) for f in found] == [("c4", "2025-03-11")]
    assert found[0].evidence["cancelled"] == 12


def test_finds_an_adjustment_far_larger_than_usual():
    rng = np.random.default_rng(1)
    adjustments = pd.DataFrame(
        {
            "id": [f"m{i}" for i in range(60)],
            "product_id": "p",
            "warehouse_id": "w",
            "day": pd.Timestamp("2025-03-01"),
            "quantity": -rng.integers(1, 4, 60).astype(float),
            "cost": 10.0,
        }
    )
    adjustments.loc[59, "quantity"] = -800.0
    found = detectors.large_inventory_adjustments(adjustments)
    assert [f.evidence["movementId"] for f in found] == ["m59"]
    assert found[0].evidence["direction"] == "loss"


def test_finds_a_branch_day_far_from_its_weekday_norm_and_nothing_on_normal_days():
    rng = np.random.default_rng(5)
    days = pd.date_range("2025-01-01", periods=90)
    amount = 1000 * np.array([0.7, 0.9, 1.0, 1.0, 1.1, 1.5, 1.2])[days.dayofweek] + rng.normal(0, 30, 90)
    daily = pd.DataFrame({"branch_id": "b1", "day": days, "amount": amount})
    assert detectors.branch_sales_deviations(daily) == []

    daily.loc[85, "amount"] = 50.0  # a recent day that collapsed
    found = detectors.branch_sales_deviations(daily)
    assert len(found) == 1
    assert found[0].occurred_on == days[85].date().isoformat()
    assert found[0].evidence["direction"] == "drop"


def test_isolation_forest_and_ecod_surface_an_invoice_unlike_the_rest():
    rng = np.random.default_rng(7)
    n = 600
    invoices = pd.DataFrame(
        {
            "id": [f"i{k}" for k in range(n)],
            "invoice_number": [f"F-{k}" for k in range(n)],
            "issue_date": pd.Timestamp("2025-04-01"),
            "branch_id": "b",
            "total": rng.lognormal(6, 0.4, n),
            "discount_total": 0.0,
            "created_hour": rng.integers(9, 18, n),
            "lines": rng.integers(1, 5, n),
            "customer_invoices": rng.integers(3, 20, n),
            "days_to_due": 30,
        }
    )
    invoices.loc[123, ["total", "discount_total", "created_hour", "lines", "customer_invoices", "days_to_due"]] = [80_000.0, 60_000.0, 3, 40, 1, 180]
    found = detectors.invoice_outliers(invoices)
    assert "i123" in [f.entity_id for f in found]
    assert len(found) <= 20


def test_benford_flags_invented_amounts_and_passes_real_looking_ones():
    rng = np.random.default_rng(11)
    real = pd.DataFrame({"vendor_id": "honest", "total": np.exp(rng.uniform(np.log(10), np.log(100_000), 400)), "date": pd.Timestamp("2025-05-01")})
    made_up = pd.DataFrame({"vendor_id": "suspect", "total": rng.uniform(5_000, 9_999, 200), "date": pd.Timestamp("2025-05-01")})
    found = detectors.benford_vendors(pd.concat([real, made_up]))
    assert [f.entity_id for f in found] == ["suspect"]


def test_feedback_quietens_a_detector_the_tenant_keeps_dismissing():
    findings = [
        detectors.Finding("outlier.invoice", "sales", "MEDIUM", 0.9, "invoice", "i1", "2025-01-01", "f1"),
        detectors.Finding("outlier.invoice", "sales", "LOW", 0.9, "invoice", "i2", "2025-01-01", "f2"),
        detectors.Finding("rule.sale_below_cost", "sales", "HIGH", 0.9, "invoice", "i3", "2025-01-01", "f3"),
    ]
    feedback = pd.DataFrame({
        "detector": ["outlier.invoice"] * 6,
        "verdict": ["FALSE_POSITIVE"] * 5 + ["USEFUL"],
        "user_id": ["u1", "u2", "u1", "u2", "u1", "u2"],
    })
    out = detectors.apply_feedback(findings, feedback)
    assert [(f.fingerprint, f.severity) for f in out] == [("f1", "LOW"), ("f3", "HIGH")]


def test_one_person_alone_cannot_quieten_a_detector():
    findings = [detectors.Finding("outlier.invoice", "sales", "MEDIUM", 0.9, "invoice", "i1", "2025-01-01", "f1")]
    feedback = pd.DataFrame({"detector": ["outlier.invoice"] * 8, "verdict": ["FALSE_POSITIVE"] * 8, "user_id": ["u1"] * 8})
    out = detectors.apply_feedback(findings, feedback)
    assert [(f.fingerprint, f.severity) for f in out] == [("f1", "MEDIUM")]


def test_money_leaving_twice_is_never_quietened():
    findings = [detectors.Finding("rule.duplicate_vendor_bill", "purchases", "LOW", 0.9, "bill", "b1", "2025-01-01", "d1")]
    feedback = pd.DataFrame({
        "detector": ["rule.duplicate_vendor_bill"] * 10,
        "verdict": ["FALSE_POSITIVE"] * 10,
        "user_id": [f"u{i}" for i in range(10)],
    })
    out = detectors.apply_feedback(findings, feedback)
    assert [(f.fingerprint, f.severity) for f in out] == [("d1", "LOW")]


def test_robust_z_is_not_fooled_by_a_single_extreme_value():
    values = np.array([10, 11, 9, 10, 12, 10, 9, 11, 10, 1000], dtype=float)
    z = detectors.robust_z(values)
    assert z[-1] > 50
    assert np.all(np.abs(z[:-1]) < 3)
