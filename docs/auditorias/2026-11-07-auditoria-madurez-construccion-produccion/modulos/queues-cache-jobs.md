# Ficha — queues + cache + jobs programados (@Cron/@ExclusiveJob, SchedulerLock, panel de trabajos)
Familia PLTA · 2026-11-07 · Diagnóstico.

## 1. Identificación
- `queues/queues.module.ts` (BullMQ global, `defaultJobOptions {removeOnComplete:true, removeOnFail:false}`); colas: `mail`, `inbound-mail`, `account-jobs`, `recurring-entries-processor`, `intercompany-jobs`, `ai-reports`, `ai-engine`. 6 procesadores.
- `cache/` (3 archivos, 382 l.; 1 spec): Keyv/Redis con namespace `REDIS_NAMESPACE`, `AtomicCacheService.claimOnce` (`SET NX PX`).
- Programación: 22 `@Cron` y 22 `@ExclusiveJob` (`shared/scheduling/exclusive-job.ts`, advisory lock de sesión `pg_try_advisory_lock(7301, hashtext(name))`); `SchedulerLockService` (`shared/scheduler/`, tabla `scheduled_job_runs` PK (job_name, run_key)) usado por 14 servicios para "una vez por ranura".
- Panel `GET /me/jobs` (`shared/jobs/jobs-panel.service.ts`).
- Núcleo: alto (depreciación mensual, asientos recurrentes, reversiones, e-CF, conciliación de uso SaaS).

## 2. Estándar de referencia
(a) Cada job programado corre exactamente una vez por ranura en clúster, idempotente, con reintentos/backoff, DLQ visible, historial y alerta; panel por tenant; caché con claves por tenant e invalidación. (b) Invariante: un cierre de mes/depreciación nunca se contabiliza dos veces ni se omite en silencio. (c) NetSuite SuiteScript scheduled scripts con estado y reintentos; Dynamics batch jobs con historial y alertas (confianza media). (d) Lock + clave de ranura persistida (ya existe), outbox, métricas por cola.

## 3. Resultado
**Madurez 62 (55–68, confianza media)**; preparación 60; **Piloto controlado**. Eje más débil: 10 (sin alertas/DLQ operativa). Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 68 | `scheduled_job_runs` registra ejecuciones reales (`saas-reconcile-usage 2026-11-07`, `ecf-retry-contingency` cada 10 min) | — |
| 2 | 65 (media) | `npm run verify:cron-exclusive` → "✓ every scheduled job runs on one replica at a time" (EXIT 0). Ranuras con `run_key` (PK) dan "una vez por ranura"; jobIds deterministas en recurrentes (`recurring-${id}-${date}`, 3 intentos backoff 60 s). Pero `@ExclusiveJob` solo evita solapamiento: jobs sin `SchedulerLock` (p.ej. `session.service.ts:825`, `pending-registration-cleanup`, `analytical-reporting.cron`) pueden correr dos veces si las réplicas disparan desfasadas | Toda tarea programada con ranura persistida |
| 3 | N/A | — | — |
| 4 | 58 | Dos mecanismos superpuestos (advisory lock + tabla de ranuras) | Uno solo |
| 5 | 60 | `shared/jobs` conoce nombres de colas de 3 dominios (`jobs-panel.service.ts` constructor) | Registro de colas visibles por módulo |
| 6 | 68 | — | — |
| 7 | 55 | `removeOnFail:false` global → fallidos para siempre en Redis (hoy `bull:account-jobs:failed` = 1, razón "No se puede modificar la línea … de un asiento contabilizado"); panel lee los 60 jobs más recientes de cada cola **global** y filtra por tenant en memoria (`getJobs(…,0,limit*3)` + `.filter(organizationId)`) → con volumen multi-tenant un tenant no ve sus trabajos | Índice por tenant (jobId con prefijo org) o tabla de runs |
| 8 | 70 | Panel filtrado por organización; payload no expuesto (`describe`) | — |
| 9 | 60 | `atomic-cache` y `jobs-panel-coverage` specs; verificador estático de cron | Prueba multi-réplica |
| 10 | 45 | Sin métricas por cola ni alertas de jobs fallidos/atascados (grep `bullmq` en metrics/: 0); `failedReason` solo en Redis | Métricas + alerta |
| 11 | 50 (baja) | Panel `/me/jobs` → `[]` en tenant propio | — |
| 12 | 55 | — | — |

## 5. Compuertas
1 Cumple · 2 Parcial · 3 Cumple · 4 N/A · 5 Cumple · 6 N/A · 7 Parcial · 8 N/A · 9 N/A · 10 No cumple (sin alerta de jobs) · 11 N/A · 12 Parcial.

## 6. Hallazgos
- **PLT-JOB-01** · jobs · eje 10 · operabilidad · **Alta** · `queues/queues.module.ts`, `metrics/` · Un job de depreciación o de asientos recurrentes que falla sus 3 intentos queda en `failed` sin métrica ni alerta; nadie se entera hasta el cierre. · Métricas `bullmq_jobs_failed_total{queue}` y alerta; vista de DLQ para soporte. · Riesgo operativo. · S/M.
- **PLT-JOB-02** · jobs · eje 2 · integridad · Media · `shared/scheduling/exclusive-job.ts` · El advisory lock se libera al terminar: dos réplicas con relojes desfasados ejecutan el mismo job en serie. Mitigado donde se usa `SchedulerLockService.runOnce`; no en los demás. · Ranura persistida para todos. · S.
- **PLT-JOB-03** · shared/jobs · eje 7 · robustez · Media · `shared/jobs/jobs-panel.service.ts` `forTenant` · Muestra solo los trabajos del tenant dentro de los últimos 60 globales por cola. · S.
- **PLT-JOB-04** · queues · eje 7 · Baja · `removeOnFail:false` sin purga → crecimiento indefinido de Redis. · S.
- Observación al coordinador: `ecf-retry-contingency` corre cada 10 min en este entorno de desarrollo (`scheduled_job_runs` 13:50 UTC); si hubiera e-CF en contingencia intentaría transmitir a la DGII (ver aviso RUBRICA). No hay gating de crons con efecto externo por entorno (verificar con FAC).

## 7. Camino mínimo
Métricas/alertas de colas (S); ranura persistida en todos los crons (S); panel por tenant indexado (S).
## 8. Camino a 100
Unificar mecanismo (+5, M); DLQ con reintento manual desde soporte (+6, M); gating de jobs con efecto externo por entorno (+5, S).
## 10. Fortalezas
Verificador estático de exclusividad en CI; tabla de ranuras; jobIds deterministas; `withTenant` en procesadores; `claimOnce` atómico.
## 11. No verificado
Comportamiento multi-réplica real; cada uno de los 22 crons en ejecución.
