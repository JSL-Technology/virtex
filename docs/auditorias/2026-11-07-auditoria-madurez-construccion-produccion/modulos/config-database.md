# Ficha — config (env.validation, gating por entorno) + database (migraciones, seeds)
Familia PLTA · 2026-11-07 · Diagnóstico.

## 1. Identificación
- `config/` (4 archivos, 701 l.; 1 spec): `env.validation.ts` (511 l., Joi), `environment.ts` (`isDevLikeEnvironment`, allow-list development/test), `roles.config.ts`, `config.permissions.ts`.
- `database/` (180 archivos, 18.676 l.; 3 specs): **178 migraciones** (`migrationsTransactionMode: 'each'`, data-source.ts:78), `seeds/tenant-defaults.ts` (273 l.), `seed.ts` (DEV_SEED). Herramientas: `verify:upgrade-path`, `verify:migration-identities`, `check:schema-drift`, `migration:reconcile` (renombres).
- Núcleo: crítico (despliegue y actualización).

## 2. Estándar de referencia
(a) Validación de configuración al arranque, sin defaults inseguros en producción, secretos fuertes; migraciones reproducibles, versionadas, probadas sobre datos, reversibles o explícitamente irreversibles, sin bloqueos largos (índices CONCURRENTLY, `lock_timeout`), data migrations por lotes; seeds de demo imposibles en producción. (b) Invariantes: un entorno no-dev nunca usa secretos de desarrollo; una actualización no pierde datos. (c) Práctica de referencia: Rails/Django/Flyway + "expand/contract", GitLab "batched background migrations" (confianza media, conocimiento general). (d) Esquema + verificadores en CI.

## 3. Resultado
**Madurez 66 (60–72, confianza media-alta)**; preparación 65; **Piloto controlado** (cerca de "con reservas"). Eje más débil: 7 (migraciones bloqueantes en tablas grandes). Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 72 | Arranque validado; `DEV_SEED` rechazado fuera de dev (`env.validation.ts` DEV_SEED `valid(false)`); `PAYMENT_PROVIDER=simulated` prohibido en prod; `main.ts:348` siembra solo si dev-like y `DEV_SEED===true` | — |
| 2 | 68 (media) | `npm run verify:upgrade-path` (virteex_test, NODE_ENV=test) → "✓ Las 178 migraciones se aplican sobre una base que ya tiene un inquilino" (EXIT 0); coordinador: migración desde vacío OK 7,6 s, `check:schema-drift` OK, `verify:migration-identities` OK. 66 migraciones contienen `UPDATE`/`INSERT` (data migrations) dentro de la transacción de la migración, sin lotes | Data migrations por lotes |
| 3 | 60 | Seeds de tenant (`tenant-defaults.ts:138` marca consumidor final) dependen del país; no revisado por país | — |
| 4 | 68 | Allow-list de entornos y verificador `verify:env-gating` (EXIT 0: "every environment decision goes through the allow-list") | — |
| 5 | 65 | — | — |
| 6 | 65 | Migraciones extensas y comentadas | — |
| 7 | **45 (38–52, media)** | 291 sentencias `CREATE [UNIQUE] INDEX` sin `CONCURRENTLY` (solo 2 archivos usan CONCURRENTLY; ninguna con `transaction = false`); sin `lock_timeout` en migraciones; `statement_timeout` 120 s a nivel de app (app.module.ts:237). En un tenant con millones de líneas, un índice nuevo bloquea escrituras de la tabla durante la creación | CONCURRENTLY fuera de transacción para tablas grandes; `SET lock_timeout` |
| 8 | 70 | Secretos criptográficos ≥32 y patrones de placeholder rechazados en prod; DB_SSL por defecto `false` también en producción; `STORAGE_DRIVER` local por defecto en prod (ver PLT-STO-01); `ECF_CERT_ENCRYPTION_KEY` opcional en prod | Exigir DB_SSL/S3 fuera de dev |
| 9 | 70 | `env.validation.spec.ts`; verificadores en CI (verificar que CI corre upgrade-path) | — |
| 10 | 60 | Mensajes de error de configuración accionables | Runbook de migración/rollback |
| 11 | N/A | — | — |
| 12 | 60 | — | — |

Muestra de 15 `down()` (una de cada 12 migraciones): 14 revierten algo; `1789009500001-FiscalCalendarRealign.ts` deja `down()` vacío **documentado como irreversible**; `1789003300000-BanksJournalBackfill.ts` revierte solo lo no usado (correcto). `AuditLogAppendOnly` reversible.

## 5. Compuertas
1 Cumple · 2 Cumple con reservas · 3 N/A · 4 Cumple · 5 Cumple · 6 N/A · 7 Cumple (verificadores) · 8 N/A · **9 Cumple** (upgrade-path, drift, identities) · 10 Parcial · 11 N/A · 12 Parcial.

## 6. Hallazgos
- **PLT-DB-01** · database · eje 7 · robustez · **Alta** · `database/migrations/*` (291 CREATE INDEX sin CONCURRENTLY; `data-source.ts:78` modo `each`) · Migraciones futuras sobre tablas grandes de clientes (journal_entry_lines, audit_logs, bank_transactions) bloquearán escrituras; sin `lock_timeout` una migración puede colgar el despliegue detrás de una transacción larga. · Convención: índices en tablas de negocio con `CONCURRENTLY` + `transaction = false`; `SET lock_timeout='5s'`; verificador en CI. · Riesgo operativo. · M.
- **PLT-DB-02** · database · eje 2/7 · Media · 66 migraciones con UPDATE/INSERT masivos en una transacción. · Backfills por lotes fuera de la migración de esquema. · M.
- **PLT-CFG-01** · config · eje 8 · seguridad · Media · `env.validation.ts` (`DB_SSL` default false; `STORAGE_DRIVER` default local; `DB_SSL_REJECT_UNAUTHORIZED` true) · Producción puede arrancar sin TLS a BD y con almacenamiento local. · Exigir en no-dev. · S.
- **PLT-CFG-02** · config · eje 4 · Baja · `AI_MODEL_*` y URLs de proveedores con defaults en el esquema de entorno (acoplamiento de config de IA en el núcleo). · S.

## 7. Camino mínimo
Exigir DB_SSL y S3 fuera de dev (S); convención y verificador de CONCURRENTLY/lock_timeout (M); runbook de despliegue (S).
## 8. Camino a 100
Backfills por lotes (+6, M); expand/contract documentado (+4, S); prueba de `migration:revert` de las últimas N en CI (+4, S).
## 10. Fortalezas
Allow-list de entornos con verificador; rechazo de secretos placeholder; upgrade-path con tenant existente; detección de deriva; append-only y RLS en migraciones.
## 11. No verificado
`migration:revert` real; tiempos con volumen; seeds por país (LOC).
