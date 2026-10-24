"""End to end against a real, migrated Virtex database — skipped unless one is configured.

    AI_ENGINE_TEST_ADMIN_DSN   a superuser DSN, to seed two tenants (it bypasses row-level security)
    AI_ENGINE_TEST_ENGINE_DSN  the DSN of the `virtex_ai_engine` role, which the engine runs as

What it proves is the property the engine's design rests on: running as its own role, under the
tenant setting, a job for tenant A reads only A's ledger and writes only A's results — even though
the role can SELECT the tables, the row-level policies stand between it and tenant B.
"""

from __future__ import annotations

import os
import uuid

import numpy as np
import pandas as pd
import psycopg
import pytest

from virtex_ai_engine.anomalies import pipeline as anomaly_pipeline
from virtex_ai_engine.cashflow import model as cashflow_model
from virtex_ai_engine.cashflow import pipeline as cashflow_pipeline
from virtex_ai_engine.db import Database
from virtex_ai_engine.forecasting import pipeline as forecast_pipeline

ADMIN = os.environ.get("AI_ENGINE_TEST_ADMIN_DSN")
ENGINE = os.environ.get("AI_ENGINE_TEST_ENGINE_DSN")

pytestmark = pytest.mark.skipif(not (ADMIN and ENGINE), reason="no test database configured")

TODAY = pd.Timestamp("2026-06-01")


def _seed_tenant(conn: psycopg.Connection, label: str, products: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    org = str(uuid.uuid4())
    conn.execute("INSERT INTO organizations (id, legal_name, slug) VALUES (%s, %s, %s)", (org, f"AI test {label}", f"ai-test-{org[:8]}"))
    branch = str(uuid.uuid4())
    conn.execute("INSERT INTO branches (id, organization_id, code, name) VALUES (%s, %s, %s, %s)", (branch, org, "B1", f"Sucursal {label}"))
    warehouse = str(uuid.uuid4())
    conn.execute("INSERT INTO warehouses (id, organization_id, name, branch_id) VALUES (%s, %s, %s, %s)", (warehouse, org, f"Almacén {label}", branch))
    product_ids = []
    days = pd.date_range(TODAY - pd.Timedelta(days=200), TODAY - pd.Timedelta(days=1))
    weekly = np.array([0.6, 0.8, 1.0, 1.0, 1.2, 1.6, 1.3])
    for p in range(products):
        pid = str(uuid.uuid4())
        product_ids.append(pid)
        conn.execute("INSERT INTO products (id, organization_id, name, cost, price) VALUES (%s, %s, %s, 5, 9)", (pid, org, f"Producto {label}{p}"))
        stock = 5000.0
        rows = [(pid, org, warehouse, stock, 5.0, "OPENING", "open", days[0] - pd.Timedelta(days=1))]
        for day in days:
            qty = float(rng.poisson((3 + p) * weekly[day.dayofweek]))
            if qty > 0:
                stock -= qty
                rows.append((pid, org, warehouse, -qty, 5.0, "SALE_DISPATCH", "sale", day + pd.Timedelta(hours=12)))
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO stock_movements (product_id, organization_id, warehouse_id, quantity, cost, type, reference, date) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                rows,
            )
        conn.execute("INSERT INTO stock_levels (organization_id, product_id, warehouse_id, quantity_on_hand) VALUES (%s,%s,%s,%s)", (org, pid, warehouse, stock))
    run = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO ai_model_runs (id, organization_id, kind, status, trigger) VALUES (%s, %s, 'FORECAST', 'RUNNING', 'MANUAL')",
        (run, org),
    )
    anomaly_run = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO ai_model_runs (id, organization_id, kind, status, trigger) VALUES (%s, %s, 'ANOMALY', 'RUNNING', 'MANUAL')",
        (anomaly_run, org),
    )
    return {"org": org, "warehouse": warehouse, "products": product_ids, "run": run, "anomaly_run": anomaly_run}


@pytest.fixture(scope="module")
def tenants():
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        a = _seed_tenant(conn, "A", products=4, seed=1)
        b = _seed_tenant(conn, "B", products=2, seed=2)
    yield a, b
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        for t in (a, b):
            conn.execute("DELETE FROM organizations WHERE id = %s", (t["org"],))


def test_the_engine_role_cannot_bypass_isolation():
    with psycopg.connect(ENGINE) as conn:
        bypass, superuser = conn.execute(
            "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"
        ).fetchone()
    assert (bypass, superuser) == (False, False)


def test_without_a_tenant_the_engine_sees_nothing(tenants):
    with psycopg.connect(ENGINE) as conn:
        assert conn.execute("SELECT COUNT(*) FROM stock_movements").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM ai_src_daily_demand").fetchone()[0] == 0


def test_the_engine_cannot_write_outside_its_own_tables(tenants):
    a, _ = tenants
    db = Database(ENGINE, max_size=1)
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with db.tenant_transaction(a["org"]) as conn:
                conn.execute("UPDATE products SET price = 0 WHERE organization_id = %s", (a["org"],))
    finally:
        db.close()


def test_a_forecast_run_reads_and_writes_only_its_tenant(tenants):
    a, b = tenants
    db = Database(ENGINE, max_size=2)
    try:
        result = forecast_pipeline.run(db, a["org"], a["run"], {"horizonDays": 30}, today=TODAY)
    finally:
        db.close()

    assert result["metrics"]["series"] == 4
    assert result["metrics"]["insights"] == 4
    with psycopg.connect(ADMIN) as conn:
        rows = conn.execute(
            "SELECT organization_id::text, COUNT(*) FROM ai_forecasts WHERE organization_id IN (%s, %s) GROUP BY 1",
            (a["org"], b["org"]),
        ).fetchall()
        assert dict(rows) == {a["org"]: 4 * 30}
        insight = conn.execute(
            """SELECT status, forecast_30d::float, on_hand::float, branch_rank FROM ai_inventory_insights
                WHERE organization_id = %s ORDER BY forecast_30d DESC LIMIT 1""",
            (a["org"],),
        ).fetchone()
    status, forecast_30d, on_hand, rank = insight
    # The best seller sells ~6/day at a 1.0 weekly mean: about 180 in 30 days, ranked first.
    assert 120 < forecast_30d < 260
    assert rank == 1
    assert on_hand > 0
    assert status in ("OK", "OVERSTOCK")


def test_a_rerun_replaces_results_rather_than_adding_to_them(tenants):
    a, _ = tenants
    db = Database(ENGINE, max_size=2)
    try:
        forecast_pipeline.run(db, a["org"], a["run"], {"horizonDays": 30}, today=TODAY)
    finally:
        db.close()
    with psycopg.connect(ADMIN) as conn:
        assert conn.execute("SELECT COUNT(*) FROM ai_forecasts WHERE organization_id = %s", (a["org"],)).fetchone()[0] == 120
        assert conn.execute("SELECT COUNT(*) FROM ai_inventory_insights WHERE organization_id = %s", (a["org"],)).fetchone()[0] == 4


def test_an_anomaly_run_completes_on_a_quiet_tenant(tenants):
    _, b = tenants
    db = Database(ENGINE, max_size=2)
    try:
        result = anomaly_pipeline.run(db, b["org"], b["anomaly_run"], {"lookbackDays": 90}, today=TODAY)
    finally:
        db.close()
    assert "failed" not in result["metrics"]["byDetector"].values()


def test_every_read_view_answers_to_the_engine_role(tenants):
    """Each ai_src_* view the pipelines read exists, is granted, and runs under the tenant's policies."""
    a, _ = tenants
    db = Database(ENGINE, max_size=1)
    try:
        with db.tenant_transaction(a["org"]) as conn:
            views = [row[0] for row in conn.execute(
                "SELECT table_name FROM information_schema.views WHERE table_name LIKE 'ai\\_src\\_%%' ORDER BY 1"
            ).fetchall()]
            assert len(views) >= 19
            for view in views:
                conn.execute(f'SELECT * FROM "{view}" LIMIT 1').fetchall()
            # Both loaders run every query they have, against the views, as the engine.
            anomaly_pipeline.load(conn, a["org"], (TODAY - pd.Timedelta(days=90)).date())
            cashflow_pipeline.load(conn, a["org"], cashflow_model.Params.from_run({}), TODAY)
    finally:
        db.close()
