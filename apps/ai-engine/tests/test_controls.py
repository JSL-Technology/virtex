"""The control detectors, each on data built to contain exactly what it should find — and data that
looks similar but should not be flagged."""

import numpy as np
import pandas as pd

from virtex_ai_engine.anomalies import detectors as d
from virtex_ai_engine.anomalies import pipeline


def test_a_customer_receipt_entered_twice_is_found_once():
    payments = pd.DataFrame(
        {
            "id": ["a", "b", "c", "e"],
            "customer_id": ["c1", "c1", "c1", "c2"],
            "reference": ["TRF-77", " trf-77", "TRF-90", "TRF-77"],
            "total_amount": [500.0, 500.0, 120.0, 500.0],
            "payment_date": pd.to_datetime(["2026-03-01", "2026-03-01", "2026-03-02", "2026-03-01"]),
            "branch_id": [None] * 4,
        }
    )
    found = d.duplicate_customer_payments(payments)
    # Same reference AND same amount/date: the same pair, reported once, as the stronger reason.
    assert len(found) == 1
    assert found[0].evidence["paymentIds"] == ["a", "b"] and found[0].severity == "HIGH"


def test_a_bill_settled_above_its_total_and_one_paid_twice():
    rows = [
        # b1: 1000 billed, 600 + 600 settled.
        ("b1", 1000.0, "p1", "2026-03-01", 600.0),
        ("b1", 1000.0, "p2", "2026-03-05", 600.0),
        # b2: two identical payments the same day, within the total.
        ("b2", 1000.0, "p3", "2026-03-01", 300.0),
        ("b2", 1000.0, "p4", "2026-03-01", 300.0),
        # b3: settled in two honest parts.
        ("b3", 1000.0, "p5", "2026-03-01", 400.0),
        ("b3", 1000.0, "p6", "2026-03-09", 600.0),
        # b4: voided bill (total read as 0) still paid.
        ("b4", 0.0, "p7", "2026-03-03", 250.0),
    ]
    df = pd.DataFrame(rows, columns=["bill_id", "bill_total", "payment_id", "payment_date", "amount"])
    df["vendor_id"], df["branch_id"], df["bill_date"] = "v1", None, "2026-02-20"
    found = {f.entity_id: f for f in d.vendor_overpayments(df)}
    assert set(found) == {"b1", "b2", "b4"}
    assert found["b1"].evidence["excess"] == 200.0 and found["b1"].severity == "HIGH"
    assert found["b2"].evidence["reason"] == "identical_payments" and found["b2"].severity == "MEDIUM"
    assert found["b4"].evidence["excess"] == 250.0


def test_three_way_match_finds_goods_billed_but_not_received_and_bills_above_the_order():
    lines = pd.DataFrame(
        {
            "order_id": ["o1", "o1", "o2"],
            "order_number": ["OC-1", "OC-1", "OC-2"],
            "supplier_id": "s1",
            "branch_id": None,
            "order_date": pd.to_datetime("2026-03-01"),
            "line_id": ["l1", "l2", "l3"],
            "product_id": ["p1", "p2", "p3"],
            "quantity": [10, 5, 10],
            "received_quantity": [6, 5, 10],
            "billed_quantity": [10, 5, 10],
            "unit_price": [25.0, 10.0, 7.0],
        }
    )
    orders = pd.DataFrame(
        {
            "order_id": ["o2", "o3"],
            "order_number": ["OC-2", "OC-3"],
            "supplier_id": "s1",
            "branch_id": None,
            "order_date": pd.to_datetime("2026-03-01"),
            "order_total": [1000.0, 1000.0],
            "billed_total": [1015.0, 1300.0],  # o2 within 2 % (freight, rounding); o3 30 % over
            "bills": [1, 2],
        }
    )
    found = d.three_way_match(lines, orders)
    by = {f.fingerprint: f for f in found}
    assert set(by) == {"3way:lines:o1", "3way:amount:o3"}
    assert by["3way:lines:o1"].evidence["valueNotReceived"] == 100.0
    assert by["3way:lines:o1"].severity == "HIGH"
    assert by["3way:amount:o3"].evidence["excess"] == 300.0


def test_a_product_suddenly_returned_far_more_than_before_and_than_the_rest():
    rows = []
    for i in range(20):
        rows.append((f"p{i}", False, 400.0, 8.0))   # 2 % before
        rows.append((f"p{i}", True, 100.0, 2.0))    # 2 % now
    rows[-1] = ("p19", True, 100.0, 30.0)           # p19: 30 % now
    rows.append(("p20", False, 400.0, 120.0))       # p20: always 30 % — not news
    rows.append(("p20", True, 100.0, 30.0))
    df = pd.DataFrame(rows, columns=["product_id", "recent", "dispatched", "returned"]).assign(last_day="2026-03-30")
    found = d.returns_spike(df)
    assert [f.entity_id for f in found] == ["p19"]
    assert found[0].evidence["previousRate"] == 0.02


def test_price_cuts_below_cost_and_large_jumps_are_flagged_small_ones_are_not():
    df = pd.DataFrame(
        {
            "id": ["h1", "h2", "h3", "h4"],
            "product_id": ["p1", "p2", "p3", "p4"],
            "product_name": ["A", "B", "C", "D"],
            "old_price": [100.0, 100.0, 100.0, None],
            "new_price": [90.0, 30.0, 55.0, None],
            "old_cost": [None, None, None, 50.0],
            "new_cost": [None, None, None, 52.0],
            "current_cost": [95.0, 20.0, 20.0, 52.0],
            "changed_by_user_id": ["u1"] * 4,
            "changed_at": pd.to_datetime(["2026-03-01 15:00"] * 3 + ["2026-03-01 03:00"], utc=True),
            "local_hour": [11, 11, 11, 23],
            "off_hours": [False, False, False, True],
        }
    )
    found = {f.entity_id: f for f in d.unusual_price_changes(df)}
    # p3 (−45 %) and p4 (cost +4 %, even at night) are ordinary changes.
    assert set(found) == {"p1", "p2"}
    assert found["p1"].evidence["reasons"] == ["price_below_cost"] and found["p1"].severity == "HIGH"
    assert found["p2"].evidence["reasons"] == ["price_drop"] and found["p2"].severity == "MEDIUM"  # −70 %: large, in hours; HIGH from −80 %


def test_an_invoice_line_far_below_the_products_usual_price():
    rng = np.random.default_rng(0)
    prices = list(rng.normal(100, 3, 40)) + [35.0]
    lines = pd.DataFrame(
        {
            "invoice_id": [f"i{k}" for k in range(len(prices))],
            "invoice_number": [f"F-{k}" for k in range(len(prices))],
            "issue_date": pd.date_range("2026-01-01", periods=len(prices)),
            "branch_id": None,
            "product_id": "p1",
            "price": prices,
        }
    )
    found = d.invoiced_price_deviations(lines)
    assert [f.entity_id for f in found] == [f"i{len(prices) - 1}"]
    assert found[0].evidence["direction"] == "below" and found[0].severity == "HIGH"
    # Reported only inside the window.
    assert d.invoiced_price_deviations(lines, report_since="2026-03-01") == []


def test_discounts_are_judged_against_the_tenants_own_practice():
    rng = np.random.default_rng(1)
    ratios = list(rng.uniform(0.03, 0.08, 60)) + [0.6]
    totals = [100.0] * len(ratios)
    invoices = pd.DataFrame(
        {
            "id": [f"i{k}" for k in range(len(ratios))],
            "invoice_number": None,
            "issue_date": "2026-03-01",
            "branch_id": None,
            "total": [t * (1 - r) for t, r in zip(totals, ratios)],
            "discount_total": [t * r for t, r in zip(totals, ratios)],
        }
    )
    found = d.discount_outliers(invoices)
    assert [f.entity_id for f in found] == [f"i{len(ratios) - 1}"] and found[0].severity == "HIGH"
    # A business that always discounts 55–65 % is not flagged for 60 %.
    generous = invoices.assign(discount_total=invoices["total"] * 1.5)
    assert d.discount_outliers(generous) == []


def test_editing_an_issued_invoice_is_flagged_paying_it_is_not():
    changes = pd.DataFrame(
        [
            ("invoices", "i1", "UPDATE", "u1", "2026-03-01T10:00Z", "Pending", ["total", "version"]),
            ("invoices", "i2", "UPDATE", "u1", "2026-03-01T10:00Z", "Pending", ["balance", "status", "version"]),
            ("invoices", "i3", "UPDATE", "u1", "2026-03-01T10:00Z", "Draft", ["total"]),
            ("vendor_bills", "b1", "DELETE", "u2", "2026-03-01T10:00Z", "OPEN", []),
            ("products", "p1", "UPDATE", "u1", "2026-03-01T10:00Z", "Active", ["price"]),
        ],
        columns=["entity", "entity_id", "action", "user_id", "created_at", "status_before", "changed_fields"],
    )
    found = {f.entity_id: f for f in d.post_issue_changes(changes)}
    assert set(found) == {"i1", "b1"}
    assert found["i1"].evidence["fields"] == ["total"] and found["i1"].severity == "HIGH"
    assert found["b1"].severity == "CRITICAL"


def test_work_at_hours_the_company_never_works():
    # 300 actions between 08:00 and 18:00 Santo Domingo time, then one user at 03:00 local.
    day = pd.Timestamp("2026-03-02", tz="America/Santo_Domingo")
    normal = [day + pd.Timedelta(hours=8 + (k % 10), minutes=k % 60) for k in range(300)]
    night = [day + pd.Timedelta(hours=3, minutes=k) for k in range(5)]
    events = pd.DataFrame(
        {
            "user_id": ["u1"] * 300 + ["u9"] * 5,
            "created_at": [t.tz_convert("UTC") for t in normal + night],
        }
    )
    found = d.off_hours_activity(events, "America/Santo_Domingo")
    assert [f.entity_id for f in found] == ["u9"] and found[0].evidence["hours"] == [3]
    # Too little activity to know what is normal: nothing.
    assert d.off_hours_activity(events.head(50), "America/Santo_Domingo") == []


def test_every_detector_runs_on_an_empty_tenant():
    empty = pd.DataFrame()
    data = {
        key: empty
        for key in ["bills", "bills_year", "below_cost", "pos", "adjustments", "branch_daily", "invoices",
                    "customer_payments", "settlements", "po_lines", "po_bills", "returns", "price_changes",
                    "invoice_prices", "document_changes", "organization", "feedback"]
    }
    findings, counts = pipeline.detect(data)
    assert findings == [] and "failed" not in counts.values()
