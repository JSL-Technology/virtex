"""The cash-flow simulation, as pure functions over DataFrames — no database here.

What it answers: given today's cash, the open invoices on both sides, and how this company's
customers and the company itself have actually paid, how likely is each day's balance over the
horizon, and how likely is it to fall below a threshold?

How:

* **When an invoice will be paid** is sampled from the delays (payment date minus due date) the
  same customer showed before, shrunk towards the company's delays when the customer has few —
  an empirical-Bayes mixture: with n past payments the customer's own history is used with
  probability n / (n + K). An invoice already overdue is sampled only from delays longer than its
  current lateness (the conditional survival distribution), so a long-overdue invoice is not
  assumed to be paid tomorrow. One later than anything in the history is treated as doubtful.
* **Bills the company owes** are paid on the company's own habit, measured the same way.
* **What has not been invoiced yet**: each future day's new sales and new bills are bootstrapped
  from the same weekday in the recent history, and collected or paid after the usual terms plus a
  sampled delay. Payroll recurs monthly at its usual size and day.
* **Monte Carlo**: every quantity above is drawn per path; the balance is the running sum. P10,
  P50 and P90 are read off the paths, as is the probability that the balance falls below the
  threshold at any point.

Why not a gradient-boosted survival model: it needs thousands of paid invoices to beat the
customer's own empirical distribution, and most tenants have tens or hundreds per customer. The
mixture is exact for the data there is and degrades to the company's behaviour, not to nonsense.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

#: Pseudo-count of the empirical-Bayes shrinkage: a customer with this many payments is trusted half.
SHRINK_K = 5
#: Delays when the company has no payment history at all: a little late, widely spread.
DEFAULT_DELAY_MEAN = 10.0
DEFAULT_DELAY_SD = 12.0
#: Chance a doubtful invoice (later than any in the history) is collected within the horizon.
DOUBTFUL_COLLECTION_PROBABILITY = 0.25


@dataclass
class Scenario:
    """A what-if, applied deterministically to the simulation's inputs."""

    sales_change: float = 0.0          # e.g. -0.2 → new sales 20 % lower
    collection_delay_days: float = 0.0  # added to every customer delay
    extra_monthly_expense: float = 0.0  # a new recurring outflow, monthly
    one_off_amount: float = 0.0         # a single outflow (positive) or inflow (negative)
    one_off_day: int = 0                # days from today

    @staticmethod
    def from_params(raw: dict | None) -> "Scenario | None":
        if not raw:
            return None
        num = lambda key, default=0.0: float(raw.get(key) or default)  # noqa: E731
        return Scenario(
            sales_change=max(-1.0, min(num("salesChange"), 5.0)),
            collection_delay_days=max(-60.0, min(num("collectionDelayDays"), 180.0)),
            extra_monthly_expense=max(0.0, num("extraMonthlyExpense")),
            one_off_amount=num("oneOffAmount"),
            one_off_day=int(max(0, min(num("oneOffDay"), 365))),
        )


@dataclass
class Params:
    horizon_days: int = 90
    paths: int = 2000
    opening_cash: float = 0.0
    threshold: float = 0.0
    history_days: int = 730
    seed: int = 7
    scenario: Scenario | None = None

    @staticmethod
    def from_run(raw: dict) -> "Params":
        return Params(
            horizon_days=int(min(max(int(raw.get("horizonDays", 90)), 14), 180)),
            paths=int(min(max(int(raw.get("paths", 2000)), 200), 10_000)),
            opening_cash=float(raw.get("openingCash") or 0.0),
            threshold=float(raw.get("threshold") or 0.0),
            history_days=int(min(max(int(raw.get("historyDays", 730)), 90), 1825)),
            seed=int(raw.get("seed", 7)),
            scenario=Scenario.from_params(raw.get("scenario")),
        )


@dataclass
class DelayModel:
    """Delays (days after due) by party, plus the pooled company delays."""

    by_party: dict[str, np.ndarray] = field(default_factory=dict)
    pooled: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))

    @staticmethod
    def fit(history: pd.DataFrame) -> "DelayModel":
        """`history`: party_id, delay_days, weight (the amount paid). Weighted by resampling."""
        if history.empty:
            return DelayModel()
        h = history.dropna(subset=["delay_days"])
        h = h[h["weight"] > 0]
        if h.empty:
            return DelayModel()
        by_party = {str(k): g["delay_days"].to_numpy(dtype=float) for k, g in h.groupby("party_id")}
        # Pooled delays weighted by amount: a big customer's habit is most of the company's cash.
        w = h["weight"].to_numpy(dtype=float)
        rng = np.random.default_rng(0)
        idx = rng.choice(len(h), size=min(5000, max(len(h), 500)), p=w / w.sum())
        return DelayModel(by_party=by_party, pooled=h["delay_days"].to_numpy(dtype=float)[idx])

    def sample(self, rng: np.random.Generator, party: str | None, overdue: float, n: int) -> tuple[np.ndarray, bool]:
        """`n` delays for one invoice already `overdue` days late (negative: not yet due).

        Returns the delays and whether the invoice is doubtful (later than all the history)."""
        own = self.by_party.get(party or "", np.array([], dtype=float))
        pooled = self.pooled
        if not len(pooled) and not len(own):
            delays = rng.normal(DEFAULT_DELAY_MEAN, DEFAULT_DELAY_SD, n)
            return np.maximum(delays, overdue), False
        own_c = own[own > overdue] if overdue > 0 else own
        pooled_c = pooled[pooled > overdue] if overdue > 0 else pooled
        if not len(own_c) and not len(pooled_c):
            return np.full(n, np.nan), True
        trust = len(own_c) / (len(own_c) + SHRINK_K)
        use_own = rng.random(n) < trust if len(own_c) else np.zeros(n, dtype=bool)
        out = np.empty(n)
        if use_own.any():
            out[use_own] = rng.choice(own_c, size=int(use_own.sum()))
        if (~use_own).any():
            source = pooled_c if len(pooled_c) else own_c
            out[~use_own] = rng.choice(source, size=int((~use_own).sum()))
        return out, False


def _place(matrix: np.ndarray, days: np.ndarray, amounts: np.ndarray) -> None:
    """Add amounts[i] at matrix[path, days[path, i]] for every day inside the horizon."""
    paths, horizon = matrix.shape
    rows = np.broadcast_to(np.arange(paths)[:, None], days.shape)
    amt = np.broadcast_to(amounts, days.shape) if amounts.ndim == 1 else amounts
    inside = (days >= 0) & (days < horizon)
    np.add.at(matrix, (rows[inside], days[inside]), amt[inside])


@dataclass
class Simulation:
    balance: np.ndarray            # paths × horizon
    components: dict[str, np.ndarray]  # name → paths × horizon (signed: inflows +, outflows −)
    items: pd.DataFrame            # one row per open document, with its timing probabilities


def simulate_documents(
    rng: np.random.Generator, docs: pd.DataFrame, model: DelayModel, today: pd.Timestamp, params: Params,
    shift_days: float = 0.0,
) -> tuple[np.ndarray, pd.DataFrame]:
    """Pay-day indices (paths × docs) for open documents; NaN-free, beyond-horizon = horizon."""
    P, H = params.paths, params.horizon_days
    if docs.empty:
        return np.zeros((P, 0), dtype=np.int32), docs.assign(p_by_7=[], p_by_30=[], p_in_horizon=[], expected_day=[], doubtful=[])
    days = np.empty((P, len(docs)), dtype=np.int32)
    stats = []
    for j, doc in enumerate(docs.itertuples(index=False)):
        due_in = (pd.Timestamp(doc.due_date) - today).days  # negative when overdue
        delays, doubtful = model.sample(rng, doc.party_id, float(-due_in), P)
        if doubtful:
            collected = rng.random(P) < DOUBTFUL_COLLECTION_PROBABILITY
            day = np.where(collected, rng.integers(0, H, P), H)
        else:
            day = np.ceil(due_in + delays + shift_days).astype(np.int64)
            day = np.clip(day, 0, None)
        day = np.minimum(day, H).astype(np.int32)
        days[:, j] = day
        inside = day < H
        stats.append({
            "p_by_7": float(np.mean(day < 7)),
            "p_by_30": float(np.mean(day < 30)),
            "p_in_horizon": float(np.mean(inside)),
            "expected_day": int(np.median(day[inside])) if inside.any() else None,
            "doubtful": bool(doubtful),
        })
    return days, pd.concat([docs.reset_index(drop=True), pd.DataFrame(stats)], axis=1)


def _weekday_bootstrap(rng: np.random.Generator, daily: pd.DataFrame, today: pd.Timestamp, P: int, H: int) -> np.ndarray:
    """New amounts per future day (paths × horizon), drawn from the same weekday in the history."""
    out = np.zeros((P, H))
    if daily.empty:
        return out
    d = daily.copy()
    d["dow"] = pd.to_datetime(d["day"]).dt.dayofweek
    # Days with nothing are part of the pattern (a closed Sunday): fill them in.
    full = pd.DataFrame({"day": pd.date_range(pd.to_datetime(d["day"]).min(), today - pd.Timedelta(days=1), freq="D")})
    full["dow"] = full["day"].dt.dayofweek
    d["day"] = pd.to_datetime(d["day"])
    merged = full.merge(d[["day", "amount"]], on="day", how="left").fillna({"amount": 0.0})
    pools = {dow: g["amount"].to_numpy(dtype=float) for dow, g in merged.groupby("dow")}
    for h, date in enumerate(pd.date_range(today, periods=H)):
        pool = pools.get(date.dayofweek)
        if pool is not None and len(pool):
            out[:, h] = rng.choice(pool, size=P)
    return out


def _lagged(rng: np.random.Generator, amounts: np.ndarray, terms: float, model: DelayModel, shift: float) -> np.ndarray:
    """Amounts arising on day h, moved to h + terms + a sampled delay."""
    P, H = amounts.shape
    out = np.zeros_like(amounts)
    pooled = model.pooled if len(model.pooled) else rng.normal(DEFAULT_DELAY_MEAN, DEFAULT_DELAY_SD, 1000)
    delays = rng.choice(pooled, size=(P, H))
    days = np.arange(H)[None, :] + np.ceil(terms + np.maximum(delays + shift, -terms)).astype(np.int64)
    _place(out, days, amounts)
    return out


def simulate(data: dict[str, pd.DataFrame], today: pd.Timestamp, params: Params) -> Simulation:
    rng = np.random.default_rng(params.seed)
    P, H = params.paths, params.horizon_days
    scenario = params.scenario or Scenario()

    customer_model = DelayModel.fit(data["receipt_history"])
    vendor_model = DelayModel.fit(data["payment_history"])

    components: dict[str, np.ndarray] = {}

    receivable_days, receivables = simulate_documents(
        rng, data["receivables"], customer_model, today, params, shift_days=scenario.collection_delay_days)
    inflow = np.zeros((P, H))
    if len(receivables):
        _place(inflow, receivable_days, receivables["amount"].to_numpy(dtype=float))
    components["receivables"] = inflow

    payable_days, payables = simulate_documents(rng, data["payables"], vendor_model, today, params)
    outflow = np.zeros((P, H))
    if len(payables):
        _place(outflow, payable_days, payables["amount"].to_numpy(dtype=float))
    components["payables"] = -outflow

    sales = _weekday_bootstrap(rng, data["daily_sales"], today, P, H) * (1.0 + scenario.sales_change)
    components["new_sales"] = _lagged(rng, sales, float(data["terms"].get("customer", 30)), customer_model,
                                      scenario.collection_delay_days)
    spending = _weekday_bootstrap(rng, data["daily_bills"], today, P, H)
    components["new_spending"] = -_lagged(rng, spending, float(data["terms"].get("vendor", 30)), vendor_model, 0.0)

    calendar = pd.date_range(today, periods=H)
    payroll = np.zeros((P, H))
    run = data["payroll"]
    if run.get("amount", 0) > 0:
        payroll[:, np.asarray(calendar.day == run["day"])] = run["amount"]
    components["payroll"] = -payroll

    other = np.zeros((P, H))
    if scenario.extra_monthly_expense > 0:
        other[:, np.asarray(calendar.day == 1)] -= scenario.extra_monthly_expense
    if scenario.one_off_amount and scenario.one_off_day < H:
        other[:, scenario.one_off_day] -= scenario.one_off_amount
    if other.any():
        components["scenario"] = other

    net = sum(components.values())
    balance = params.opening_cash + np.cumsum(net, axis=1)

    parts = [frame.assign(kind=kind) for frame, kind in ((receivables, "RECEIVABLE"), (payables, "PAYABLE")) if len(frame)]
    items = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
    return Simulation(balance=balance, components=components, items=items)


def summarise(sim: Simulation, today: pd.Timestamp, params: Params) -> tuple[pd.DataFrame, dict]:
    """The daily band and the headline figures."""
    H = params.horizon_days
    q = np.percentile(sim.balance, [10, 50, 90], axis=0)
    days = list(pd.date_range(today, periods=H))
    inflow = sum(np.clip(c, 0, None) for c in sim.components.values()).mean(axis=0)
    outflow = -sum(np.clip(c, None, 0) for c in sim.components.values()).mean(axis=0)
    daily = pd.DataFrame({
        "day": [d.date() for d in days],
        "p10": q[0], "p50": q[1], "p90": q[2],
        "inflow": inflow, "outflow": outflow,
        "components": [
            {name: round(float(c[:, h].mean()), 2) for name, c in sim.components.items()} for h in range(H)
        ],
    })
    minimum = sim.balance.min(axis=1)
    low_day = int(np.argmin(q[1]))
    shortfall = float(np.mean(minimum < params.threshold))
    first_breach = None
    if shortfall > 0:
        breached = (sim.balance < params.threshold)
        p_by_day = breached.mean(axis=0)
        over = np.nonzero(p_by_day >= 0.1)[0]
        first_breach = (today + pd.Timedelta(days=int(over[0]))).date().isoformat() if len(over) else None

    drivers = []
    if not sim.items.empty:
        before = sim.items[sim.items["expected_day"].fillna(H + 1) <= low_day + 7]
        late_receivables = sim.items[(sim.items["kind"] == "RECEIVABLE") & (sim.items["p_by_30"] < 0.5)]
        for row in pd.concat([before, late_receivables]).drop_duplicates(subset=["document_id"]).nlargest(8, "amount").itertuples(index=False):
            drivers.append({
                "kind": row.kind, "documentId": row.document_id, "partyName": row.party_name,
                "amount": round(float(row.amount), 2), "dueDate": pd.Timestamp(row.due_date).date().isoformat(),
                "pBy30": round(float(row.p_by_30), 3), "doubtful": bool(row.doubtful),
            })
    metrics = {
        "openingCash": round(params.opening_cash, 2),
        "threshold": round(params.threshold, 2),
        "horizonDays": H,
        "paths": params.paths,
        "endP50": round(float(q[1][-1]), 2),
        "endP10": round(float(q[0][-1]), 2),
        "endP90": round(float(q[2][-1]), 2),
        "lowestP50": round(float(q[1][low_day]), 2),
        "lowestP50Date": days[low_day].date().isoformat(),
        "lowestP10": round(float(q[0].min()), 2),
        "shortfallProbability": round(shortfall, 4),
        "firstLikelyShortfallDate": first_breach,
        "expectedInflow": round(float(inflow.sum()), 2),
        "expectedOutflow": round(float(outflow.sum()), 2),
        "byComponent": {name: round(float(c.sum(axis=1).mean()), 2) for name, c in sim.components.items()},
        "drivers": drivers,
    }
    return daily, metrics
