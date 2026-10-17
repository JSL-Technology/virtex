"""Database access, one tenant at a time.

Every unit of work runs inside `tenant_transaction`, which sets `app.current_organization` with
`set_config(..., true)` — local to the transaction, so it cannot leak to the next job that borrows
the connection. That is the same setting the row-level policies read for the API, and the engine's
role has no BYPASSRLS: a job for one tenant sees that tenant's rows and nothing else, even if a query
forgot its `WHERE organization_id = …`.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Iterator

import pandas as pd
import psycopg
from psycopg_pool import ConnectionPool


def _valid_uuid(value: str) -> str:
    return str(uuid.UUID(str(value)))


class Database:
    def __init__(self, dsn: str, max_size: int = 4) -> None:
        self._pool = ConnectionPool(dsn, min_size=1, max_size=max_size, open=True)

    def close(self) -> None:
        self._pool.close()

    @contextmanager
    def tenant_transaction(self, organization_id: str) -> Iterator[psycopg.Connection]:
        org = _valid_uuid(organization_id)
        with self._pool.connection() as conn:
            with conn.transaction():
                conn.execute("SELECT set_config('app.current_organization', %s, true)", (org,))
                yield conn


def frame(conn: psycopg.Connection, sql: str, params: tuple | dict = ()) -> pd.DataFrame:
    """Run a query and return a DataFrame with the column names the query chose."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        columns = [c.name for c in cur.description] if cur.description else []
        return pd.DataFrame(cur.fetchall(), columns=columns)
