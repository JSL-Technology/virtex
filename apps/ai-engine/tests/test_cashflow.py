"""The cash-flow model against synthetic histories whose answer is known."""

from __future__ import annotations

import numpy as np
import pandas as pd

from virtex_ai_engine.cashflow import model

TODAY = pd.Timestamp("2026-10-01")


def empty(columns):
    return pd.DataFrame(columns=columns)


def base_data(**overrides):
    data = {
        "receivables": empty(["document_id", "party_id", "party_name", "number", "due_date", "amount"]),
        "payables": empty(["document_id", "party_id", "party_name", "number", "due_date", "amount"]),
        "receipt_history": empty(["party_id", "delay_days", "weight"]),
        "payment_history": empty(["party_id", "delay_days", "weight"]),
        "daily_sales": empty(["day", "amount"]),
        "daily_bills": empty(["day", "amount"]),
        "terms": {"customer": 30.0, "vendor": 30.0},
        "payroll": {"amount": 0.0, "day": 0},
    }
    data.update(overrides)
    return data


def doc(i, party, due_in, amount):
    return {"document_id": f"00000000-0000-0000-0000-{i:012d}", "party_id": party, "party_name": party,
            "number": f"F{i}", "due_date": TODAY + pd.Timedelta(days=due_in), "amount": amount}


def test_a_customer_who_always_pays_twenty_days_late_is_expected_twenty_days_after_due():
    history = pd.DataFrame({"party_id": ["late"] * 40, "delay_days": [20.0] * 40, "weight": [100.0] * 40})
    receivables = pd.DataFrame([doc(1, "late", 5, 1000.0)])
    params = model.Params(paths=500, opening_cash=0.0)
    sim = model.simulate(base_data(receivables=receivables, receipt_history=history), TODAY, params)
    item = sim.items.iloc[0]
    # 40 own payments → trusted 40/45; the pooled history is the same customer, so: day 25.
    assert item["expected_day"] == 25
    assert item["p_by_7"] == 0.0
    assert item["p_by_30"] == 1.0


def test_an_overdue_invoice_is_not_assumed_paid_before_its_current_lateness():
    history = pd.DataFrame({"party_id": ["c"] * 50, "delay_days": np.linspace(0, 60, 50), "weight": [1.0] * 50})
    receivables = pd.DataFrame([doc(1, "c", -40, 500.0)])  # already 40 days late
    sim = model.simulate(base_data(receivables=receivables, receipt_history=history), TODAY,
                         model.Params(paths=400))
    # Only delays beyond 40 remain possible: paid within the next 20 days, never "yesterday".
    assert sim.items.iloc[0]["p_in_horizon"] == 1.0
    assert sim.items.iloc[0]["expected_day"] <= 20


def test_an_invoice_later_than_any_history_is_doubtful():
    history = pd.DataFrame({"party_id": ["c"] * 10, "delay_days": [5.0] * 10, "weight": [1.0] * 10})
    receivables = pd.DataFrame([doc(1, "c", -200, 500.0)])
    sim = model.simulate(base_data(receivables=receivables, receipt_history=history), TODAY, model.Params(paths=2000))
    item = sim.items.iloc[0]
    assert bool(item["doubtful"]) is True
    assert abs(item["p_in_horizon"] - model.DOUBTFUL_COLLECTION_PROBABILITY) < 0.05


def test_the_balance_falls_by_a_bill_on_the_day_it_is_paid_and_the_shortfall_is_reported():
    history = pd.DataFrame({"party_id": ["v"] * 20, "delay_days": [0.0] * 20, "weight": [1.0] * 20})
    payables = pd.DataFrame([doc(1, "v", 10, 800.0)])
    params = model.Params(paths=300, opening_cash=500.0, threshold=0.0)
    sim = model.simulate(base_data(payables=payables, payment_history=history), TODAY, params)
    daily, metrics = model.summarise(sim, TODAY, params)
    assert daily["p50"].iloc[9] == 500.0
    assert daily["p50"].iloc[10] == -300.0
    assert metrics["shortfallProbability"] == 1.0
    assert metrics["firstLikelyShortfallDate"] == (TODAY + pd.Timedelta(days=10)).date().isoformat()
    assert metrics["drivers"][0]["kind"] == "PAYABLE"


def test_new_sales_follow_the_weekday_pattern_and_scale_with_a_scenario():
    days = pd.date_range(TODAY - pd.Timedelta(days=84), TODAY - pd.Timedelta(days=1))
    sales = pd.DataFrame({"day": days, "amount": [1000.0 if d.dayofweek < 5 else 0.0 for d in days]})
    history = pd.DataFrame({"party_id": ["c"] * 30, "delay_days": [0.0] * 30, "weight": [1.0] * 30})
    params = model.Params(paths=200, horizon_days=90)
    base = model.simulate(base_data(daily_sales=sales, receipt_history=history, terms={"customer": 0.0, "vendor": 0.0}),
                          TODAY, params)
    _, m_base = model.summarise(base, TODAY, params)
    # Twelve or thirteen weeks of five 1,000 days, collected on the day: ~ 64,000.
    assert 60_000 <= m_base["byComponent"]["new_sales"] <= 66_000

    params_cut = model.Params(paths=200, horizon_days=90, scenario=model.Scenario(sales_change=-0.5))
    cut = model.simulate(base_data(daily_sales=sales, receipt_history=history, terms={"customer": 0.0, "vendor": 0.0}),
                         TODAY, params_cut)
    _, m_cut = model.summarise(cut, TODAY, params_cut)
    assert abs(m_cut["byComponent"]["new_sales"] - m_base["byComponent"]["new_sales"] / 2) < 1_500


def test_payroll_recurs_on_its_day_and_a_new_expense_on_the_first():
    params = model.Params(paths=50, horizon_days=60, scenario=model.Scenario(extra_monthly_expense=100.0))
    sim = model.simulate(base_data(payroll={"amount": 2000.0, "day": 15}), TODAY, params)
    _, metrics = model.summarise(sim, TODAY, params)
    assert metrics["byComponent"]["payroll"] == -4000.0  # Oct 15 and Nov 15
    assert metrics["byComponent"]["scenario"] == -200.0  # Oct 1 and Nov 1


def test_a_customer_with_little_history_leans_on_the_company():
    company = pd.DataFrame({"party_id": ["big"] * 100, "delay_days": [0.0] * 100, "weight": [1.0] * 100})
    newcomer = pd.DataFrame({"party_id": ["new"], "delay_days": [60.0], "weight": [1.0]})
    m = model.DelayModel.fit(pd.concat([company, newcomer]))
    rng = np.random.default_rng(1)
    delays, _ = m.sample(rng, "new", -10.0, 10_000)
    # One payment of their own: trusted 1/6 of the time.
    assert 0.12 < float(np.mean(delays == 60.0)) < 0.22
