# Virtex AI engine — the forecasting and anomaly-detection worker.
#
#   docker build -t virtex-ai-engine apps/ai-engine                     the worker (the last stage)
#   docker run --env-file .env.engine virtex-ai-engine
#
#   docker build --target test -t virtex-ai-engine:test apps/ai-engine  the same image, with its tests
#   docker run --rm --network host -e AI_ENGINE_TEST_ADMIN_DSN -e AI_ENGINE_TEST_ENGINE_DSN virtex-ai-engine:test
#
# Dependencies come from requirements.lock (exact versions, regenerated with
# `uv pip compile pyproject.toml --python-version 3.12 --extra dev -o requirements.lock`), so two
# builds of the same commit run the same numerical code. The interpreter is the one below and only
# that one: the lock is compiled for it and the tests run in it (`verify:ai-engine-image` checks
# that the three agree).
ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # The image is the environment: installing as root into it is the point, not a mistake.
    PIP_ROOT_USER_ACTION=ignore \
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

# The tests run in THIS image — the interpreter, the system libraries and the locked packages the
# worker ships with — and against the package as installed, not the source tree. They used to run in
# whatever `python3` the CI runner had, which stopped being the production one when GitHub moved
# `ubuntu-latest` to Ubuntu 26.04 (November 2026) and the install failed there. pytest's cache is off:
# the image is read-only for its user and a test run leaves nothing behind.
FROM base AS test
COPY tests ./tests
USER engine
CMD ["python", "-m", "pytest", "-p", "no:cacheprovider", "-W", "ignore"]

# The worker. Last, so that a build without `--target` is always this one and never the tests.
FROM base AS runtime
USER engine
CMD ["virtex-ai-engine"]
