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
