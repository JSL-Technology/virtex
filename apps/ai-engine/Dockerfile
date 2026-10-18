# Virtex AI engine — the forecasting and anomaly-detection worker.
#
#   docker build -t virtex-ai-engine apps/ai-engine
#   docker run --env-file .env.engine virtex-ai-engine
#
# Dependencies come from requirements.lock (exact versions, regenerated with
# `uv pip compile pyproject.toml --python-version 3.12 --extra dev -o requirements.lock`), so two
# builds of the same commit run the same numerical code.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # statsforecast compiles its models with numba; caching the compiled code avoids paying the
    # compilation on every job.
    NIXTLA_NUMBA_CACHE=1 \
    NUMBA_CACHE_DIR=/tmp/numba-cache

# LightGBM needs the OpenMP runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.lock ./
RUN pip install -r requirements.lock

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-deps .

# Never as root: the worker needs nothing but the network and a scratch directory.
RUN useradd --system --uid 10001 --home /app engine && mkdir -p /tmp/numba-cache && chown engine /tmp/numba-cache
USER engine

CMD ["virtex-ai-engine"]
