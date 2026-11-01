# Tareas programadas, colas y caché (T14) — familia F2

> Auditoría 2026-10-31. Diagnóstico estático + inspección de BD; no se encolaron trabajos (riesgo sobre servicios compartidos). Redis local compartido no inspeccionado en profundidad.

**Sin hallazgo crítico de seguridad.** Hallazgo alto cruzado con analítica (COL-02).

## 1. Identificación
- `queues/queues.module.ts` (26 LOC): BullMQ global, `defaultJobOptions {removeOnComplete:true, removeOnFail:false}`; 6 colas registradas (`mail`, `inbound-mail`, `intercompany`, `account-jobs`, `ai-engine`, `ai-reports`) y 6 procesadores.
- `cache/` (3 archivos, 369 LOC, 0 specs): `AtomicCacheService` (`SET NX PX` para claims y contadores), `redis.config.ts` (URL/TLS compartida por caché, colas y throttler).
- `shared/scheduler/` (lock durable `scheduled_job_runs` con `INSERT … ON CONFLICT DO NOTHING`), `shared/jobs/` (panel de trabajos + catálogo de colas), `shared/tenancy/tenant-job.ts` (`runAsTenantJob`, `forEachTenant`, `withTenant`), `shared/after-commit/` (efectos tras commit en memoria), `shared/inbox/` (bandeja "Mi trabajo" — no es un inbox de mensajería), `shared/idempotency/` (claves por `(organization_id, key)` en BD, 35 rutas `@Idempotent()`).
- 20 `@Cron/@Interval` en 15 servicios.

## 2. Estándar de referencia
- (a) Básico: trabajos durables con reintentos+backoff, DLQ visible, idempotencia de consumidores, contexto de tenant explícito en cada job, crons ejecutados una sola vez en multi-réplica (lock distribuido), timeouts, métricas de cola, outbox transaccional para efectos externos. Avanzado: priorización/fairness por tenant, rate-limit por tenant en colas, re-ejecución manual desde panel.
- (c) Referencias: BullMQ docs (attempts/backoff, `removeOnFail`, jobId para deduplicación — confianza alta); patrón Transactional Outbox (microservices.io, confianza alta); AWS SaaS Lens — noisy neighbour en procesamiento asíncrono (confianza alta).
- (d) Construcción: outbox en BD → relay → cola; payload con `organizationId`; locks en Redis/BD; fairness con grupos por tenant.

## 3. Resultado
- **Madurez: 60 (52–66, confianza media)** · **Preparación: 60 — Piloto controlado.**
- Eje más débil: Robustez multi-réplica (crons sin lock, websocket, after-commit en memoria).
- Críticos: 0. Altos: 2.

## 4. Ejes
| Eje | Nota | Evidencia | Falta |
|---|---|---|---|
| 1 Completitud | 62 (55–68, media) | Colas reales con procesadores; panel de trabajos; lock durable | DLQ explícita con re-ejecución; outbox |
| 2 Corrección | 62 (55–68, media) | `SchedulerLockService.runOnce` usado en 13 servicios (depreciación, reversiones, recurrentes, tipos de cambio, SaaS, e-CF, IA…); idempotencia HTTP robusta con hash del cuerpo y 409 (`idempotency.interceptor.ts:57-76`) | Ver COL-01/03 |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 66 (58–72, media) | `runAsTenantJob` obligatorio para jobs de tenant (lanza si falta `organizationId`, `tenant-job.ts:24-30`); 4/6 procesadores lo usan (reports, account-jobs, recurring-entries, intercompany) | Outbox |
| 5 Higiene | 58 (50–65, media) | `shared/inbox` nombre engañoso; colas dispersas por módulo | Catálogo único ya existe (`queue-catalogue.ts`) |
| 6 Calidad | 62 (55–68, media) | Comentarios precisos sobre fallos pasados | — |
| 7 Robustez | 48 (40–55, media) | COL-01, COL-03; `AfterCommitService` en memoria: un crash entre commit y efecto pierde el efecto (lo admite `after-commit.service.ts:65`) | Outbox, adaptador Redis |
| 8 Seguridad | 66 (58–72, media) | Payload con tenant; claves de idempotencia por organización | — |
| 9 Pruebas | 55 (48–62, media) | specs de after-commit, queue-tenancy, idempotency; `cache/` 0 specs | Prueba multi-réplica |
| 10 Operabilidad | 50 (42–58, media) | Fallidos retenidos; `/health/queues` sólo 1 cola | Métricas/alertas de colas |
| 11 UX | 55 (45–62, baja) | Panel de trabajos (no recorrido) | — |
| 12 Competitividad | 55 (45–62, baja) | — | Fairness por tenant |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | Cumple | — |
| 2 | Cumple con reservas | lock durable e idempotencia; after-commit no durable |
| 3 | Cumple | payload con tenant |
| 4 | N/A | — |
| 5 | N/A | — |
| 6 | N/A | — |
| 7 | Parcial | sin prueba multi-réplica |
| 8 | N/A | — |
| 9 | Cumple | — |
| 10 | Parcial | — |
| 11 | N/A | — |
| 12 | Parcial | — |

## 6. Hallazgos
**COL-01** — Alta — robustez — crons sin lock distribuido (grep de `SchedulerLockService|runOnce` frente a `@Cron`): `analytical-reporting/analytical-reporting.cron.ts:13` (cada hora), `workflow-engine/workflow-timer.service.ts:27,43` (cada minuto / 5 min, sólo flag en memoria; mitigado por `SKIP LOCKED` en las filas, `workflow-engine.service.ts:95`), `auth/services/session.service.ts:824`, `auth/services/pending-registration-cleanup.service.ts:55`. Con N réplicas se ejecutan N veces; para limpiezas es inocuo, para el refresco de vista materializada no (COL-02). Esfuerzo: S.

**COL-02** — Alta — integridad/robustez (cruzado con `analytical-reporting`) — `analytical-reporting/analytical-reporting.service.ts:40-120`: cada hora, en cada réplica, hace `DROP MATERIALIZED VIEW` + `CREATE MATERIALIZED VIEW` dentro de una transacción, fuera de contexto de tenant, leyendo `dimensions` de TODAS las empresas para crear columnas. Consecuencias: (1) con el rol de producción `virtex_app` y RLS, la lectura sin `app.current_organization` devuelve 0 filas → la vista queda vacía o el DROP falla por no ser dueño (`pg_class.relacl` muestra dueño `postgres`) — no ejecutado con `virtex_app`, confianza media; (2) nombres de dimensiones de un tenant se convierten en columnas visibles en la estructura común; (3) el DROP toma lock exclusivo y bloquea consultas analíticas durante el rebuild. Las vistas materializadas no admiten RLS. Forma correcta: tabla agregada por tenant con RLS, refresco por tenant con `forEachTenant` + lock. Esfuerzo: M.

**COL-03** — Media — `AfterCommitService` y `EventEmitter` en memoria para efectos post-commit: sin outbox, un reinicio pierde correos/notificaciones/encolados. Esfuerzo: M.

**COL-04** — Media — `inbound-mail.service.ts:151` usa `jobId: inbound-${id}-${Date.now()}`: el `Date.now()` anula la deduplicación de BullMQ por jobId. Esfuerzo: S.

**COL-05** — Media — `mail.processor` e `inbound-mail.processor` sin contexto de tenant (0 usos de `runAsTenantJob`); correcto si no tocan tablas de tenant (inbound usa rol `virtex_inbound_lookup`), no verificado en ejecución.

**COL-06** — Media — sin fairness por tenant: un tenant que encola miles de trabajos (p. ej. importación) retrasa a todos. Esfuerzo: M.

**COL-07** — Baja — `cache/` sin specs; caché de lectura de dominio casi inexistente (sólo claims/contadores), aceptable.

## 7. Camino mínimo a producción
COL-01 lock en todos los crons (S); COL-02 rehacer refresco analítico por tenant (M); COL-04 (S).

## 8. Camino a 100
Outbox transaccional (+10, M); fairness por tenant (+6, M); métricas/alertas de colas (+6, S); DLQ con re-ejecución en panel (+5, S); prueba multi-réplica (+5, M).

## 9. Competitividad
Paridad razonable con Odoo (cron + queue_job); NetSuite ofrece colas por cuenta con concurrencia por licencia (SuiteCloud Plus) — confianza media.

## 10. Fortalezas
Lock durable que además da idempotencia por periodo; `runAsTenantJob` que falla ruidosamente sin tenant; idempotencia HTTP con hash del cuerpo; fallidos retenidos.

## 11. No verificado
Comportamiento real con 2 réplicas; contenido de Redis; ejecución de crons con `virtex_app`.
Cobertura: ~45 % de archivos en alcance; 0 ejecuciones de jobs.

<!-- RESUMEN: modulo=tareas-colas-cache; madurez=60; prep=60; veredicto=Piloto controlado; eje_debil=Robustez; criticos=0; altos=2; camino_min=M -->
