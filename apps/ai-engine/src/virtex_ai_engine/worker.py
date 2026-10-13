"""The queue consumer: takes `ai-engine` jobs the API queued and runs them, one tenant at a time.

A job names a run in `ai_model_runs`. The worker claims it with a conditional UPDATE — only a run
still QUEUED can be claimed — so a redelivered job, or two workers racing for the same one, run it
once. The work happens in a thread, keeping the event loop free to renew the job's lock however
long the forecast takes. A failure with attempts left puts the run back to QUEUED for BullMQ's retry;
the last failure marks it FAILED with the reason, which the API shows.
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
import sys
import traceback
import uuid

from bullmq import Worker

from . import ENGINE_VERSION
from . import config as config_module
from .anomalies import pipeline as anomaly_pipeline
from .db import Database
from .forecasting import pipeline as forecast_pipeline

log = logging.getLogger("virtex_ai_engine")


def claim(db: Database, organization_id: str, run_id: str) -> bool:
    with db.tenant_transaction(organization_id) as conn:
        row = conn.execute(
            """UPDATE ai_model_runs
                  SET status = 'RUNNING', started_at = now(), engine_version = %s, error = NULL
                WHERE id = %s AND organization_id = %s AND status = 'QUEUED'
            RETURNING id""",
            (ENGINE_VERSION, run_id, organization_id),
        ).fetchone()
    return row is not None


def finish(db: Database, organization_id: str, run_id: str, status: str, *, metrics: dict | None = None,
           data_hash: str | None = None, error: str | None = None) -> None:
    with db.tenant_transaction(organization_id) as conn:
        conn.execute(
            """UPDATE ai_model_runs
                  SET status = %s, metrics = COALESCE(%s::jsonb, metrics), data_hash = COALESCE(%s, data_hash),
                      error = %s, finished_at = CASE WHEN %s IN ('SUCCEEDED', 'FAILED') THEN now() ELSE NULL END
                WHERE id = %s AND organization_id = %s""",
            (status, json.dumps(metrics) if metrics is not None else None, data_hash, error, status,
             run_id, organization_id),
        )


def execute(db: Database, settings: config_module.Settings, data: dict, attempts_left: int) -> str:
    """Run one job. Returns the run's final status; raises to ask BullMQ for a retry."""
    organization_id = str(uuid.UUID(str(data["organizationId"])))
    run_id = str(uuid.UUID(str(data["runId"])))
    kind = data.get("kind")
    params = data.get("params") or {}

    if not claim(db, organization_id, run_id):
        log.info("run %s is no longer queued; skipping", run_id)
        return "SKIPPED"

    try:
        if kind == "FORECAST":
            result = forecast_pipeline.run(
                db, organization_id, run_id, params,
                foundation=settings.foundation_models, max_series=settings.max_series,
            )
        elif kind == "ANOMALY":
            result = anomaly_pipeline.run(db, organization_id, run_id, params)
        else:
            raise ValueError(f"unknown run kind {kind!r}")
    except Exception as error:  # noqa: BLE001
        log.error("run %s (%s) failed: %s\n%s", run_id, kind, error, traceback.format_exc())
        if attempts_left > 0:
            finish(db, organization_id, run_id, "QUEUED", error=f"retrying: {type(error).__name__}")
            raise
        # The reason is stored for the screen, not the traceback: it may quote tenant data.
        finish(db, organization_id, run_id, "FAILED", error=f"{type(error).__name__}: {str(error)[:300]}")
        return "FAILED"

    finish(db, organization_id, run_id, "SUCCEEDED", metrics=result["metrics"], data_hash=result["data_hash"])
    log.info("run %s (%s) succeeded: %s", run_id, kind, result["metrics"])
    return "SUCCEEDED"


async def serve(settings: config_module.Settings) -> None:
    db = Database(settings.dsn, max_size=max(2, settings.concurrency * 2))
    stop = asyncio.Event()

    async def process(job, _token):
        attempts = int((job.opts or {}).get("attempts", 1))
        attempts_left = attempts - (int(job.attemptsMade or 0) + 1)
        return await asyncio.to_thread(execute, db, settings, job.data, attempts_left)

    worker = Worker(
        settings.queue_name,
        process,
        {
            "connection": settings.redis_url,
            "concurrency": settings.concurrency,
            # A forecast for a large tenant takes minutes; the lock is renewed while it runs.
            "lockDuration": 120_000,
        },
    )
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    log.info("virtex-ai-engine %s listening on queue %s", ENGINE_VERSION, settings.queue_name)
    await stop.wait()
    log.info("shutting down: finishing the jobs in hand")
    await worker.close()
    db.close()


def main() -> None:
    logging.basicConfig(
        stream=sys.stdout,
        level=logging.INFO,
        format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":%(message)r}',
    )
    settings = config_module.load()
    if not settings.db_password:
        log.warning("AI_ENGINE_DB_PASSWORD is empty: the engine role is unreachable over TCP by design until it has one")
    asyncio.run(serve(settings))


if __name__ == "__main__":
    main()
