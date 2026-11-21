# Ficha — observabilidad (health, metrics, logger pino, correlación, filtros de excepción)
Familia PLTA · 2026-11-07 · Diagnóstico. Logs analizados: `scratchpad/logs/api.log` (194.840 líneas, run actual).

## 1. Identificación
`health/` (2 archivos, 104 l.: `GET /health/live`, `GET /health/ready`, `GET /health/queues`), `metrics/` (2 archivos, 42 l.: Prometheus `/metrics`, métricas por defecto + `saas_limit_hit_total{organization_id,resource}` + `saas_webhook_failure_total`), logger `nestjs-pino` (app.module.ts:140-196: `genReqId` desde `x-request-id`, redacción de cookies/tokens/credenciales/email/phone/taxId, `pino-pretty` fuera de producción), `common/` (filtro `I18nExceptionFilter`, interceptores), `shared/observability`. Sin specs en health/metrics.

## 2. Estándar de referencia
(a) liveness/readiness separados; métricas RED por ruta (tasa, errores, latencia p95/p99), por cola y por dependencia; logs JSON con request-id, tenant, usuario; trazas distribuidas (OpenTelemetry); errores al cliente sin detalles internos; alertas y runbooks. (b) Invariante: todo 5xx localizable por request-id y tenant; ningún secreto en logs. (c) Práctica de SaaS líderes (Google SRE "four golden signals"; OpenTelemetry) — confianza alta como práctica general. (d) pino + prom-client + OTel.

## 3. Resultado
**Madurez 50 (43–57, confianza alta)**; preparación 48; **Piloto controlado** (compuerta 10 cumple en logs, no en métricas). Eje más débil: 10 (métricas inutilizables). Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 45 | `/health/live` 200 `{"status":"ok"}`; `/health/ready` 200 `{"database":"up","redis":"up"}` (anónimos); **`GET /metrics` → 401 anónimo y 403 incluso con ADMINISTRATOR `*`** (qa-do-plt) → Prometheus no puede raspar; solo métricas por defecto + 2 contadores SaaS (grep `makeCounterProvider|makeHistogramProvider|Counter(`: 6 en todo src) | Endpoint de métricas con token de scraping; histograma HTTP por ruta |
| 2 | 70 | Respuestas 500 genéricas `{"code":"INTERNAL_ERROR","messageKey":"errors.internal"}` sin stack (probado en `/data-transfer/imports` y `/customers`); el stack queda en el log con req.id | — |
| 3 | N/A | | |
| 4 | 60 | Correlación vía pino-http + AsyncLocalStorage: logs de servicios dentro de la request llevan `req.id`; línea "request completed" lleva `organizationId` y `userId` (2.286 líneas con organizationId) | Propagar request-id a jobs BullMQ (los logs de procesadores no lo llevan) |
| 5 | 65 | — | — |
| 6 | 60 | `app.module.ts:146` compara `NODE_ENV !== 'production'` (pasa `verify:env-gating`, NODE_ENV restringido a 3 valores) | — |
| 7 | 55 | `statement_timeout` 120 s; readiness real a BD y Redis | — |
| 8 | 62 (media) | Redacción de cookie, x-xsrf-token, set-cookie, cuerpos con password/otp/email/taxId; `GET /health/queues` accesible a cualquier autenticado (member → 200, conteos globales de la cola, no de su tenant); `saas_limit_hit_total` con label `organization_id` (cardinalidad y dato de tenant en métricas) | — |
| 9 | 25 | health/metrics sin specs | Specs de readiness y redacción |
| 10 | 45 | Sin trazas (grep `opentelemetry` en src: no verificado como presente), sin alertas, sin métricas de colas, logs en desarrollo con pino-pretty multi-línea (en producción JSON — no verificado) | OTel + alertas + runbook |
| 11 | N/A | | |
| 12 | 45 | — | — |

## 5. Compuertas
1 No cumple (métricas inaccesibles) · 2 Cumple · 3 Parcial (`/health/queues` sin permiso) · 4 N/A · 5 Cumple · 6 N/A · 7 No cumple (sin specs) · 8 N/A · 9 N/A · **10 Cumple parcialmente** (errores con correlación request/tenant/user en logs; sin métricas/alertas) · 11 N/A · 12 No cumple (sin runbook de operación encontrado en esta revisión).

## 6. Hallazgos
- **PLT-OBS-01** · metrics · eje 1/10 · operabilidad · **Alta** · `metrics/metrics.module.ts` (`PrometheusModule.register({path:'/metrics'})` sin declaración de autorización) · `/metrics` responde 401/403 a todos (incluido administrador): la API es "deny by default" y la ruta de Prometheus no declara acceso → no hay forma de raspar métricas. Aun si se pudiera, no hay métricas HTTP (latencia/errores por ruta) ni de colas. · Ruta pública en red interna o token de scraping; `http_request_duration_seconds` por ruta/código; métricas BullMQ. · Riesgo operativo. · S/M.
- **PLT-OBS-02** · health · eje 8 · seguridad · Baja · `health/health.controller.ts:73-89` · `/health/queues` a cualquier autenticado (member 200) con conteos de cola de toda la plataforma. · Permiso de plataforma. · S.
- **PLT-OBS-03** · metrics · eje 8/7 · Media · `saas_limit_hit_total{organization_id}` · Cardinalidad ilimitada (una serie por tenant) y dato de tenant en sistema de métricas. · Quitar label o agregarlo. · S.
- **PLT-OBS-04** · logger · eje 10 · Media · procesadores BullMQ · Los logs de jobs no llevan request-id de origen ni tenant de forma uniforme (ej. `MailProcessor` loguea `template`, `recipientHash`, no organización). · Propagar contexto en `job.data`. · S.

## 7. Camino mínimo
Habilitar `/metrics` con token interno + histograma HTTP (S); alertas sobre 5xx y colas fallidas (M); runbook (S).
## 8. Camino a 100
OpenTelemetry trazas (+10, M); SLOs y paneles por tenant (+6, M); specs de redacción (+3, S).
## 10. Fortalezas
Request-id aceptado/generado y devuelto (`x-request-id`); tenant y usuario en la línea de cierre de cada request; redacción amplia; errores sin trazas al cliente; readiness real.
## 11. No verificado
Formato JSON en producción; integración con un backend de logs; alertas existentes fuera del repo.
