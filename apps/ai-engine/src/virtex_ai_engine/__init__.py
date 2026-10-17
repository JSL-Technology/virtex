"""Virtex AI engine: demand forecasting and anomaly detection, one tenant at a time.

The API (apps/backend/api, module `ai/`) records a run in `ai_model_runs` and queues a job on the
`ai-engine` BullMQ queue. This engine takes the job, reads the tenant's data through the `ai_src_*`
views as the `virtex_ai_engine` role — under the same row-level policies as the API — and writes
`ai_forecasts`, `ai_inventory_insights` and `ai_anomalies`. See docs/IA_PLAN_MAESTRO.md.
"""

ENGINE_VERSION = "1.0.0"
