# Observabilidad (T19) — familia F2

> Auditoría 2026-10-31. Diagnóstico sin cambios en el repo. Logs analizados: `scratchpad/logs/api.log`, `api2.log`, `api3.log` (API reiniciada dos veces durante la auditoría por el coordinador).

**Sin hallazgo crítico de seguridad**: cabeceras sensibles (cookie, set-cookie, x-xsrf-token, authorization, x-reauth-password, x-otp-code, x-api-key, stripe-signature) y cuerpos de contraseña se redactan (`app.module.ts:159-175`); 196 cabeceras `cookie` en `api2.log`, todas `"[REDACTED]"`; 0 coincidencias de `access_token=ey`.

## 1. Identificación
- `health/` (2 archivos, 50 LOC): sólo GET `/health/queues` (autenticado, cuenta jobs de UNA cola `account-jobs`). `metrics/` (2 archivos, 42 LOC): `@willsoto/nestjs-prometheus` en `/metrics` con métricas por defecto de proceso + 2 contadores de negocio (`saas_limit_hit_total{organization_id,resource}`, `saas_webhook_failure_total`). `common/loggers/json.logger.ts` (no usado por la app: grep `JsonLogger` → sólo su definición). Logging real: `nestjs-pino` (`app.module.ts:134-180`), `pino-pretty` fuera de producción, nivel `debug` fuera de producción. Filtro global de excepciones `i18n/i18n-exception.filter.ts`.
- Países: N/A. Núcleo para vender: sí para operar SaaS (SLA).

## 2. Estándar de referencia
- (a) Básico: liveness y readiness públicos (sin datos) para el orquestador; logs estructurados JSON con request id propagado y devuelto en cabecera, `organizationId`/`userId` en cada línea; métricas RED por ruta (tasa, errores, latencia), pool de BD, colas, Redis; trazas distribuidas; alertas con runbooks; errores sin filtrar internals al cliente; redacción de secretos/PII. Avanzado: SLO por tenant, dashboards por tenant, auditoría de rendimiento.
- (c) Referencias: AWS Well-Architected SaaS Lens — "tenant-aware operations/metrics" (confianza alta); Google SRE book — four golden signals (confianza alta); OpenTelemetry como estándar de trazas (confianza alta).
- (d) Construcción: middleware de correlación (genera/acepta `x-request-id`, lo devuelve), contexto ambiente con tenant/usuario inyectado en el logger, `prom-client` con histogramas HTTP, OTel SDK.

## 3. Resultado
- **Madurez: 30 (25–38, confianza media)** (tope = eje 1) · **Preparación: 35 — No listo** (compuerta 10 —observabilidad mínima con correlación— no cumple).
- Eje más débil: Operabilidad (sin health público, sin métricas HTTP, sin trazas, sin alertas).
- Críticos: 0. Altos: 4 (incluye OBS-07, throttler global confirmado por el coordinador).

## 4. Ejes
| Eje | Nota | Evidencia | Falta |
|---|---|---|---|
| 1 Completitud | 30 (22–38, media) | Sin liveness/readiness (GET `/api/v1/health` → 404; `/health/queues` → 401 sin sesión); métricas casi vacías; sin trazas (no hay `@opentelemetry`, `@sentry`, `dd-trace` en `package.json`) | Todo lo de §2(a) |
| 2 Corrección | 45 (38–52, media) | Filtro de excepciones: 500 → mensaje genérico, stack sólo al log (`i18n-exception.filter.ts:37-38,84-88`); probado: GET `/search` sin `q` → `{"code":"INTERNAL_ERROR","messageKey":"errors.internal"}` sin stack | Correlación en la respuesta de error |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 45 (38–52, media) | pino + redacción centralizada | Logger con contexto de tenant |
| 5 Higiene | 45 (38–52, media) | `JsonLogger` muerto; `genReqId` configurado pero inoperante (OBS-01) | — |
| 6 Calidad | 50 (42–58, media) | Mensajes de log mezclan español/inglés | — |
| 7 Robustez | 40 (32–48, media) | `/health/queues` sólo mira 1 de las colas | — |
| 8 Seguridad | 70 (62–76, media) | Redacción correcta verificada en logs; `/metrics` exige permiso de plataforma (qa-a ADMIN → 403) | — |
| 9 Pruebas | 30 (22–40, media) | Sin specs en health/metrics | — |
| 10 Operabilidad | 25 (18–32, media-alta) | OBS-01..04 | — |
| 11 UX | N/A | — | — |
| 12 Competitividad | 35 (28–42, baja) | Página de estado/SLA inexistente (no verificado) | — |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | No cumple | health/metrics mínimos |
| 2 | N/A | — |
| 3 | Cumple | `/metrics` y `/health/queues` protegidos |
| 4 | N/A | — |
| 5 | N/A | — |
| 6 | N/A | — |
| 7 | No cumple | sin pruebas |
| 8 | N/A | — |
| 9 | N/A | — |
| 10 | **No cumple** | OBS-01, OBS-02 |
| 11 | N/A | — |
| 12 | No cumple | sin runbooks de alertas (no encontrados) |

## 6. Hallazgos
Pruebas: `curl -H 'x-correlation-id: QA-F2-CORR-123' /api/v1/legal/terms` → sin cabecera de correlación en la respuesta; en `api3.log` la línea de request lleva `"id": "req-1c"` (contador de Fastify por proceso), no el valor enviado ni un UUID. `GET /api/v1/metrics` sin sesión → 401; como ADMIN de tenant → 403; `GET /metrics` → 404.

**OBS-01** — Alta — operabilidad — `app.module.ts:147` configura `genReqId: (req) => req.headers['x-correlation-id'] || crypto.randomUUID()` en `pinoHttp`, pero bajo Fastify el id lo genera Fastify (`req-N`), que se reinicia en cada proceso y colisiona entre réplicas; no se devuelve al cliente ni se propaga a jobs/colas. Además, si llegara a funcionar, aceptaría el valor del cliente sin validar (inyección en logs). Forma correcta: `genReqId` en `FastifyAdapter` (main.ts:118) con UUID validado, devolver `x-request-id`, incluirlo en errores 5xx y en payload de jobs. Esfuerzo: S.

**OBS-02** — Alta — operabilidad — las líneas de request no incluyen `organizationId` ni `userId` (grep de `"organizationId"` en líneas `request completed` → 0); no se puede investigar "qué le pasó al cliente X". Forma correcta: `customProps` de pino-http leyendo `currentTenantStore()`/principal. Esfuerzo: S.

**OBS-03** — Alta — operabilidad — no hay endpoint de liveness/readiness sin autenticación; un orquestador (K8s/Render/ECS) no puede comprobar salud sin credenciales. `/health/queues` requiere sesión y sólo reporta `account-jobs`. Forma correcta: `/health/live` (proceso) y `/health/ready` (BD, Redis, colas) públicos, sin datos de tenant. Esfuerzo: S.

**OBS-04** — Media — métricas: sin histogramas HTTP, sin métricas de pool de BD/colas/Redis; `/metrics` detrás del guard de sesión de usuario dificulta el scrape de Prometheus (requiere un usuario de plataforma con cookie). La etiqueta `organization_id` en `saas_limit_hit_total` crece con el nº de tenants (cardinalidad). Esfuerzo: M.

**OBS-05** — Media — sin trazas distribuidas ni agregador de errores (Sentry/OTel ausentes en dependencias). Esfuerzo: M.

**OBS-06** — Baja — `pino-pretty` y nivel `debug` cuando `NODE_ENV !== 'production'`: un entorno `staging` mal etiquetado registra a nivel debug con formato no JSON (`app.module.ts:142-146`).

**OBS-07** — Alta (cruzado con plataforma) — el throttler global es `20 req/60 s` por IP (`app.module.ts:269`, `ThrottlerGuard` global en `app.module.ts:392`, tracker por defecto = IP). Durante esta auditoría las llamadas de lectura consecutivas devolvieron 429 a la 20.ª. Una oficina detrás de NAT comparte 20 req/min para todos sus usuarios; el SPA hace varias llamadas por pantalla. No hay métrica de 429 para detectarlo. Ver ficha shell/núcleo. Matiz: en el recorrido por UI de 77 rutas (2026-10-31 18:36–18:41, ver ficha shell) no se observó ningún 429, mientras que en ráfaga por curl sí; `@nestjs/throttler` compone la clave con clase+manejador, por lo que el cupo efectivo parece ser 20/min por IP **y por ruta** — sigue siendo insuficiente para oficinas tras NAT que consultan la misma lista o hacen polling (confirmado como hallazgo por el coordinador; clave exacta no verificada). Esfuerzo: S.

## 7. Camino mínimo a producción
OBS-03 health público (S); OBS-01 request id real y devuelto (S); OBS-02 tenant/usuario en logs (S); OBS-04 métricas HTTP + scrape con token de servicio (M); alertas básicas 5xx/latencia/colas fallidas (M).

## 8. Camino a 100
Health (+10); correlación (+10); contexto tenant (+8); métricas RED + pool/colas (+12); OTel + Sentry (+10); alertas y runbooks (+10); SLO por tenant (+5).

## 9. Competitividad
Los ERPs SaaS líderes publican estado y SLA (status.netsuite.com, trust.salesforce.com — confianza alta). Brecha básica para clientes medianos.

## 10. Fortalezas
Redacción de secretos verificada; filtro de excepciones que no filtra internals y da códigos estables; logs estructurados con pino.

## 11. No verificado
Formato de log en producción (JSON) en ejecución; despliegue real de Prometheus.
Cobertura: 100 % de `health/` y `metrics/`; config de logger; muestreo de 3 logs.

<!-- RESUMEN: modulo=observabilidad; madurez=30; prep=35; veredicto=No listo; eje_debil=Operabilidad; criticos=0; altos=4; camino_min=M -->
