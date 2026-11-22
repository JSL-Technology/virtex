# Virtex AI engine

Forecasting and anomaly-detection worker for Virtex. See `docs/IA_PLAN_MAESTRO.md` and
`docs/DEPLOYMENT.md` (section "Motor de IA") for what it does and how to run it.

## Run kinds

The API queues one job per run on the `ai-engine` queue; the job's `kind` selects the pipeline and
its `params` are bounded again here, whatever the API sent.

| Kind       | Writes                                                  | Params (camelCase, all optional)                                                                                           |
| ---------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `FORECAST` | `ai_forecasts`, `ai_inventory_insights`                 | see `forecasting/pipeline.py` `Params.from_run`                                                                            |
| `ANOMALY`  | `ai_anomalies`                                          | see `anomalies/pipeline.py`                                                                                                |
| `CASHFLOW` | `ai_cashflow_forecasts`, `ai_cashflow_items`, run metrics | `openingCash` (from the ledger, sent by the API), `threshold`, `horizonDays` 14–180 (90), `paths` 200–10 000 (2 000), `historyDays` 90–1 825 (730), `seed` |
| `SCENARIO` | same as `CASHFLOW`, under its own run                   | the `CASHFLOW` params plus `scenario`: `salesChange` (−1…5), `collectionDelayDays` (−60…180), `extraMonthlyExpense`, `oneOffAmount`, `oneOffDay` (0…365) |

The cash-flow simulation (`cashflow/`) draws, per open invoice and bill, when it is paid — from an
empirical-Bayes blend of the party's own payment delays and the company's (shrinkage `k = 5`),
conditioned on how overdue it already is — and bootstraps not-yet-invoiced sales and spending by
weekday from the company's history; payroll repeats its last cycle. Each document's chance of
moving within 7 and 30 days is what collections ranks by (`p_by_30`).

## Tests

The tests run in the engine's own image — the interpreter (`ARG PYTHON_VERSION` in the
`Dockerfile`), the system libraries and the locked packages the worker ships with — against the
package as installed. That is how CI runs them, and the way to reproduce a CI result:

```sh
docker build --target test -t virtex-ai-engine:test apps/ai-engine
docker run --rm --network host \
  -e AI_ENGINE_TEST_ADMIN_DSN='host=localhost port=5432 dbname=<migrated db> user=postgres password=…' \
  -e AI_ENGINE_TEST_ENGINE_DSN='host=localhost port=5432 dbname=<migrated db> user=virtex_ai_engine password=…' \
  virtex-ai-engine:test
```

Without the two DSNs the integration tests (`tests/test_integration_db.py`) are skipped and only the
unit tests run. The engine's role gets its password from `AI_ENGINE_DB_PASSWORD` when the
migrations run. `npm run verify:ai-engine-image` checks that the image, the lock (`--python-version`)
and `requires-python` name the same Python, and that the deployed stage is the last one and runs as
a non-root user.
