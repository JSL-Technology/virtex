"""Settings, from the environment only — nothing secret is ever written into the image."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw not in (None, "") else default


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str
    db_sslmode: str
    redis_host: str
    redis_port: int
    redis_password: str | None
    redis_tls: bool
    queue_name: str
    concurrency: int
    foundation_models: bool
    max_series: int

    @property
    def dsn(self) -> str:
        return (
            f"host={self.db_host} port={self.db_port} dbname={self.db_name} "
            f"user={self.db_user} password={self.db_password} sslmode={self.db_sslmode} "
            "application_name=virtex-ai-engine"
        )

    @property
    def redis_url(self) -> str:
        scheme = "rediss" if self.redis_tls else "redis"
        auth = f":{self.redis_password}@" if self.redis_password else ""
        return f"{scheme}://{auth}{self.redis_host}:{self.redis_port}"


def load() -> Settings:
    return Settings(
        db_host=os.environ.get("AI_ENGINE_DB_HOST", os.environ.get("DB_HOST", "localhost")),
        db_port=_int("AI_ENGINE_DB_PORT", _int("DB_PORT", 5432)),
        db_name=os.environ.get("AI_ENGINE_DB_NAME", os.environ.get("DB_NAME", "erp")),
        # The engine's own role: no BYPASSRLS, read-only on the source tables. Never the app's role,
        # and never the schema owner.
        db_user=os.environ.get("AI_ENGINE_DB_USER", "virtex_ai_engine"),
        db_password=os.environ.get("AI_ENGINE_DB_PASSWORD", ""),
        db_sslmode=os.environ.get("AI_ENGINE_DB_SSLMODE", "prefer"),
        redis_host=os.environ.get("REDIS_HOST", "localhost"),
        redis_port=_int("REDIS_PORT", 6379),
        redis_password=os.environ.get("REDIS_PASSWORD") or None,
        redis_tls=_bool("REDIS_TLS", False),
        queue_name=os.environ.get("AI_ENGINE_QUEUE", "ai-engine"),
        concurrency=_int("AI_ENGINE_CONCURRENCY", 1),
        foundation_models=_bool("AI_ENGINE_FOUNDATION_MODELS", False),
        # Series beyond this many (the slowest movers) are summarised rather than modelled one by
        # one, so one huge tenant cannot hold a worker for hours.
        max_series=_int("AI_ENGINE_MAX_SERIES", 20_000),
    )
