"""The engine reads the ERP only through the `ai_src_*` views, and writes only its own `ai_*` tables.

Which invoices count as issued, which bills as posted, which payments as settled is decided once,
in the views (migration `AiEngineReadContract`). A query here that names a domain table directly
brings back a second copy of those rules, free to drift from the first — which is how the cash
projection and the anomaly run came to disagree about voided invoices.
"""

from __future__ import annotations

import pathlib
import re

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "src" / "virtex_ai_engine"

# A table after FROM / JOIN / INTO / UPDATE (not ON CONFLICT ... DO UPDATE), not a function call (`unnest(`) nor EXTRACT's `FROM`.
TABLE = re.compile(r"\b(?:FROM|JOIN|INTO|(?<!DO )UPDATE)\s+\"?([a-z_][a-z0-9_]*)\"?(?!\s*\()", re.IGNORECASE)
EXTRACT = re.compile(r"EXTRACT\s*\([^)]*\)", re.IGNORECASE)
NOT_TABLES = {"s", "i"}  # subquery aliases


def referenced_tables() -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for path in SOURCE.rglob("*.py"):
        text = EXTRACT.sub("", path.read_text(encoding="utf-8"))
        for literal in re.findall(r'"""(.*?)"""', text, re.DOTALL):
            if not re.search(r"\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b", literal):
                continue
            for name in TABLE.findall(literal):
                found.setdefault(name.lower(), set()).add(path.relative_to(SOURCE).as_posix())
    return found


def test_every_table_the_engine_names_is_its_own_or_a_read_view():
    tables = referenced_tables()
    assert tables, "the scan found no SQL at all; the pattern is broken"
    outside = {name: files for name, files in tables.items() if not name.startswith("ai_") and name not in NOT_TABLES}
    assert outside == {}, f"read these through an ai_src_* view instead: {outside}"


def test_the_pipelines_read_through_views():
    views = {name for name in referenced_tables() if name.startswith("ai_src_")}
    assert {"ai_src_issued_invoices", "ai_src_posted_bills", "ai_src_vendor_settlements", "ai_src_payroll_outflows"} <= views
