# syntax=docker/dockerfile:1.7
#
# Virteex production images, from one build:
#
#   docker build -f deploy/Dockerfile --target api \
#     --build-arg API_URL=https://app.example.do/api/v1 \
#     --build-arg RECAPTCHA_V3_SITE_KEY=6Lc... -t virteex-api .
#   docker build -f deploy/Dockerfile --target web  (same build args) -t virteex-web .
#
# `api` runs the NestJS API (and, with `npm run migration:run`, the migrations — the same image, so
# the schema it migrates to is the one it was built against). `web` is Caddy serving the ERP and the
# point of sale and proxying /api to the API: ONE ORIGIN, which the session and CSRF cookies require
# (see docs/DEPLOYMENT.md §4).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
# Chromium comes from the distribution in the runtime image; Puppeteer must not download its own.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

FROM deps AS build
COPY . .
ARG API_URL
ARG RECAPTCHA_V3_SITE_KEY
ARG VAPID_PUBLIC_KEY=""
ARG POS_URL=""
ENV API_URL=${API_URL} RECAPTCHA_V3_SITE_KEY=${RECAPTCHA_V3_SITE_KEY} VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY} POS_URL=${POS_URL}
ENV NX_DAEMON=false NX_NO_CLOUD=true
RUN npx nx build api --configuration=production \
 && npm run build:client-web \
 && npm run build:pos

# ── API ──────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS api
# Chromium renders the invoice PDFs; tini reaps it; fonts so a PDF never prints tofu.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation ca-certificates tini postgresql-client \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/backend/api ./dist/apps/backend/api
# What `npm run migration:run` needs: the data source, the migrations and the entities they import.
COPY --from=build /app/package.json /app/tsconfig.base.json /app/tsconfig.json ./
COPY --from=build /app/apps/backend/api ./apps/backend/api
COPY --from=build /app/libs ./libs
COPY --from=build /app/tools/db ./tools/db
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/'+(process.env.API_PREFIX||'api/v1')+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/apps/backend/api/main.js"]

# ── Web: the ERP, the POS and the proxy to the API, on one origin ────────────
FROM caddy:2-alpine AS web
COPY --from=build /app/dist/apps/core/client-web/browser /srv/app
COPY --from=build /app/dist/apps/pos/browser /srv/pos
COPY deploy/Caddyfile /etc/caddy/Caddyfile
