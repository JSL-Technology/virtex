# Ficha — journal-entries (asientos, diarios, plantillas, recurrentes, importación, secuencias, valuaciones)

Familia FIN-A · Auditor: FIN · Fecha: 2026-11-07 · Tenant propio: qa-do-fin@virtex.test (org 456feb61-…)

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/journal-entries` — 7.182 líneas sin specs (11 specs). Archivo dominante `journal-entries.service.ts` (1.519 líneas), `services/journal-query.service.ts` (647), `journal-entry-import.service.ts` (432), `adjustments.service.ts` (353), `recurring-journal-entries.service.ts` (259), `journal-entry-numbering.service.ts`, `recurring-entries.processor.ts`.
- **Endpoints**: `/journal-entries` (POST, GET, GET :id, PATCH :id = modificación por reversión+reemplazo, POST :id/reverse, POST :id/create-reversal, import/headers|preview|confirm, adjuntos), `/journals` (CRUD), `/journal-entry-templates` (CRUD + create-entry), `/recurring-journal-entries` (CRUD + entries), `/journal-entries/adjustments` (reclassify, period-end). Todos con `@HasPermission` (verificado por grep en los 5 controladores).
- **Tablas**: `journal_entries`, `journal_entry_lines`, `journal_entry_line_valuations`, `journal_entry_sequences`, `journals`, `journal_entry_templates`, `recurring_journal_entries`, adjuntos. Disparadores BD: `trg_journal_entries_immutable`, `trg_journal_entries_no_delete`, `trg_journal_entry_lines_immutable|no_delete|no_insert_posted`, `trg_journal_entry_valuations_balance|immutable`, `tg_same_tenant_*` (5 en journal_entries).
- **Frontend**: `features/accounting/journal-entries`, `journal-entry-form`, `journal-list`, `journal-form`, `recurring`, `entry-templates`, `daily-journal`; menú en `contabilidad.manifest.ts` (rutas journal-entries, /new, /import, /:id/edit, daily-journal, recurring-entries, entry-templates, journals).
- **Países**: todos (genérico). **Dependencias**: accounting (períodos, period-lock), chart-of-accounts, dimensions, currencies (tasas), audit. **Núcleo para vender**: sí, es el corazón del libro mayor.

## 2. Estándar de referencia (resumen)
(a) Básicas: partida doble validada en servidor, inmutabilidad del asiento contabilizado (corrección solo por reversión), numeración correlativa sin huecos por diario/ejercicio, bloqueo de períodos cerrados, multimoneda con tasa histórica, plantillas, recurrentes, importación masiva con vista previa, adjuntos, auditoría. Avanzadas: aprobación por montos, reversión automática, asientos inter-compañía, multi-libro (valuaciones), reglas de dimensión obligatoria.
(b) Invariantes: Σdebe=Σhaber por asiento y por libro; importes ≥0 con 2 decimales en moneda base; no debe y haber en la misma línea; sin cuentas de grupo/inactivas/de otro tenant; fecha en período abierto; numeración única y gapless; idempotencia de automáticos.
(c) Líderes (confianza media, conocimiento general no reverificado en esta sesión): SAP S/4 y Dynamics 365 bloquean edición tras contabilizar y corrigen por reversión; NetSuite permite editar asientos en períodos abiertos con traza; Odoo/QuickBooks/Xero permiten editar/borrar en abierto (más laxos). CONTPAQi/Alegra/Siigo usan consecutivos por tipo de póliza/comprobante.
(d) Construcción: servicio de dominio con transacción única que valida, numera (contador transaccional) y audita; inmutabilidad reforzada en BD; DTO de respuesta separado de la entidad.

## 3. Resultado
- **Madurez: 66 (60–72, confianza media** — aislamiento verificado con IDs ajenos desde mi tenant; miembro sin permisos → 403).
- **Preparación comercial: 64 → Veredicto: Piloto controlado.**
- Eje más débil: 3/7 (multimoneda a nivel de línea sin control; respuesta con entidades anidadas).
- Hallazgos críticos abiertos: ninguno.

## 4. Ejes
| # | Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|---|
|1|Autenticidad/completitud (crítico)|72 (65–78, media)|Crear/modificar/revertir/plantillas/recurrentes ejecutados contra API real; UI `/accounting/journal-entries/new` carga sin errores (Playwright). Importación no ejecutada (multipart).|Ejecutar y probar importación; aprobación por montos visible en UI; reversión automática programada (create-reversal exige marca).|
|2|Corrección/integridad (crítico)|70 (62–76, alta)|Rechaza descuadre, ceros, negativos, 3 decimales, debe+haber en línea, 1 línea, cuenta grupo, cuenta y diario de otro tenant, 1e16. PATCH = reversión+reemplazo; DELETE→404; triggers BD. 20 POST paralelos → 20×201, `GENERAL-2026-000007…26` sin huecos ni duplicados. Idempotency-Key: replay mismo cuerpo → mismo asiento; cuerpo distinto → 409. FX histórico correcto (58,5 vs 60,25; 100,01×58,5=5.850,59). **Pero** FX por línea sin validar (FIN-JE-01) y FX a cuenta no multimoneda (FIN-AC-03).|Validar `debit = foreign×rate` y tasa resuelta en modo línea; exigir cuenta multimoneda; advertir fechas futuras.|
|3|Multi-país|60 (50–68, media)|Genérico; tasas por tenant con tolerancia 0 y fuente registrada; `IsNumber({maxDecimalPlaces:2})` fijo (CLP/PYG 0 decimales no se fuerza).|Decimales por moneda (ISO 4217) y formatos por país.|
|4|Arquitectura|60 (52–66, media)|Lógica en servicio, transacciones correctas; pero servicio de 1.519 líneas; respuesta de POST expone entidad con `lines[].journalEntry` anidado (sin DTO); validaciones de negocio devuelven 403 (`account_code_not_valid_until_effective`, período cerrado).|DTO de respuesta; 422 para reglas de negocio; partir el servicio (preparación/numeración/FX).|
|5|Higiene/separación|62 (55–70, media)|11 violaciones de frontera de este directorio en `boundaries-report.log`; contabilidad participa en 3 ciclos (plataforma, identidad, finanzas).|Romper ciclos vía puertos; dejar de importar entidades de identidad/configuración.|
|6|Calidad de código|66 (60–72, media)|10 warnings lint en el directorio; comentarios extensos y coherentes con el código (verificados en update/markPosted/FX).|Limpiar warnings; reducir comentario-histórico.|
|7|Robustez/rendimiento|70 (62–76, media)|20 creaciones concurrentes en 1,05 s; listado paginado; secuencia `INSERT … ON CONFLICT … RETURNING` transaccional; recurrentes con lock pesimista + clave `recurring:<id>:<fecha>` + `schedulerLock`.|Prueba de carga de importación grande; límites de líneas por asiento.|
|8|Seguridad/aislamiento (crítico)|72 (62–80, media)|Desde qa-do-fin con IDs ajenos: GET/PATCH/reverse/attachments de asiento ajeno → 404; cuenta/diario ajenos en body → 400; `organizationId`/`status`/`entryNumber` en body → 400 whitelist. Todos los endpoints con `@HasPermission` + PermissionsGuard global. qa-do-a-member → 403 en todas las rutas probadas (ejecutado).|Ejecutar prueba de miembro sin permisos; RLS efectiva (API corre como superusuario).|
|9|Pruebas|62 (55–70, media)|11 specs (ledger-invariants, audit-adjustment, etc.) pasan en suite global contra BD real.|Pruebas de concurrencia de numeración y de FX por línea.|
|10|Operabilidad|66 (58–72, media)|Auditoría en la misma transacción (`recordAudit`); logs con request-id; `systemReason` en asiento.|Métrica de huecos/rechazos; alerta de recurrentes fallidos.|
|11|UX/idiomas|60 (50–68, baja)|Formulario carga; UI renderizó en inglés para tenant DO y fecha MM/DD/AAAA (posible por idioma del navegador headless — verificar). Errores devueltos como claves i18n.|Verificar locale por tenant; mensajes de error traducidos en pantalla.|
|12|Competitividad|62 (55–70, baja)|Inmutabilidad + reversión al nivel SAP/D365; multi-libro con valuaciones; faltan aprobación visible y reversión automática programada.|Workflow de aprobación, reversión automática, adjuntos OCR.|

## 5. Compuertas
|#|Compuerta|Estado|Evidencia|
|---|---|---|---|
|1|Sin fachadas, básicas presentes|Cumple|Flujos ejecutados contra BD real.|
|2|Integridad escrituras críticas|Cumple con reservas|Ver FIN-JE-01 (FX por línea).|
|3|AuthZ y aislamiento|Cumple|IDOR negativo y miembro 403 verificados.|
|4|Validación servidor|Cumple|Batería de 15 casos.|
|5|E2E sin 500/consola|Cumple|Playwright sin errores de consola en la pantalla.|
|6|Cumplimiento por país|N/A (genérico)|—|
|7|Pruebas en CI|No cumple|CI global en rojo (typecheck/test de otros módulos).|
|8|Auditoría de negocio|Cumple|`recordAudit` transaccional.|
|9|Migraciones|Cumple|Global OK.|
|10|Observabilidad|Cumple|request-id en logs.|
|11|UI/traducciones|No verificado plenamente|Inglés en tenant DO.|
|12|Documentación|Parcial|Comentarios en código; sin guía operativa.|

## 6. Hallazgos
**FIN-JE-01** · journal-entries · Eje 2 · Integridad de datos · **Alta**
- Ubicación: `journal-entries.service.ts:555-565` (rama `else if (lineDto.currencyCode)`).
- Qué: en modo "moneda por línea" el servidor guarda `foreignCurrencyDebit/Credit` y `exchangeRate` tal como llegan, sin resolver la tasa ni comprobar `debit ≈ foreign×rate`. Ejecutado: POST con línea `{debit:100, currencyCode:"USD", foreignCurrencyDebit:1, exchangeRate:999}` → 201 (`GENERAL-2026-000031`), BD: `100.00 | 1.00 | 999.000000`. Esto evita el control de tolerancia que sí aplica a nivel de asiento (POST con `exchangeRate:70` vs 58,5 → 400 `stated_rate_requested_deviates_too_far`) y alimenta la revaluación con saldos en divisa falsos.
- Forma correcta: resolver tasa en `rates.resolveForPosting` también por línea y exigir coherencia ± tolerancia; o calcular `debit` desde la divisa.
- Impacto: riesgo operativo (diferencias cambiarias manipulables). Esfuerzo: S.

**FIN-JE-02** · journal-entries/accounting · Eje 2 · Bug · **Media**
- Ubicación: `markPosted` → `resolvePostingPeriod(... createIfMissing: true)` (`journal-entries.service.ts:686-693`).
- Qué: POST con fecha `2027-03-01` (hoy 2026-11-07) → 201 y crea silenciosamente el ejercicio 2027 y sus 12 períodos (`fiscal_years` 2027 OPEN). Sin límite ni advertencia de fecha futura; un error de tipeo de año abre un ejercicio.
- Forma correcta: límite configurable de días futuros; creación de ejercicio explícita o con confirmación.
- Impacto: riesgo operativo. Esfuerzo: S.

**FIN-JE-03** · journal-entries · Eje 4 · Arquitectura · **Baja**
- Respuesta de POST /journal-entries devuelve la entidad TypeORM con `lines[].journalEntry` anidado (estado intermedio `Draft`, `entryNumber:null`) — contradictorio con el asiento ya `Posted`. El replay idempotente devuelve otra forma. Forma correcta: DTO de respuesta estable. Esfuerzo: S.

**FIN-JE-04** · journal-entries · Eje 4 · Contrato API · **Baja**
- Reglas de negocio (período cerrado, cuenta no vigente) responden **403** (`accounting.transaction_date_falls_accounting_period_name`), que el cliente confunde con falta de permiso. Forma correcta: 409/422. Esfuerzo: S.

**FIN-JE-05** · journal-entries · Eje 2 · Validación · **Baja**
- Importes como texto (`"debit":"100"`) se aceptan (201, `GENERAL-2026-000002`) pese a `@IsNumber`: hay coerción implícita. No es incorrecto contablemente, pero el contrato no es estricto. Esfuerzo: S.

## 7. Camino mínimo a producción (DO y genérico)
1. FIN-JE-01 validar FX por línea (S). 2. FIN-AC-03 bloquear divisa en cuentas no multimoneda (S, ver accounting). 3. FIN-COA-01 vigencia de cuentas al aprovisionar (S, ver chart-of-accounts) — sin esto no se pueden registrar operaciones anteriores a la fecha de alta. 4. Límite de fechas futuras (S). 5. Prueba automatizada de autorización por rol y de concurrencia de numeración (M). Retocar, no rehacer.

## 8. Camino a 100
1. FX por línea + multimoneda estricta (+5, S). 2. DTOs de respuesta y códigos 4xx correctos (+3, S). 3. Aprobación por montos y reversión automática programada visibles en UI (+5, M). 4. Partir el servicio de 1.519 líneas (+3, M). 5. Decimales por moneda (+2, S). 6. Importación probada con 10k líneas y reanudación (+4, M). 7. RLS efectiva con rol no superusuario (+3, M, plataforma).

## 9. Competitividad
Básicas presentes (partida doble, inmutabilidad, numeración, plantillas, recurrentes, importación). Faltan para competir: aprobación configurable por umbral en UI, reversión automática al día 1, asientos inter-compañía. Diferenciador: inmutabilidad reforzada por triggers BD + valuaciones multi-libro (comparable a SAP ledgers paralelos; confianza media).

## 10. Fortalezas a preservar
Triggers de inmutabilidad y no-borrado; modificación = reversión + reemplazo con `modifiedFromEntryId`; secuencia transaccional sin huecos bajo 20 concurrentes; idempotencia por clave con 409 si cambia el cuerpo; re-chequeo de período en `markPosted`; tasas resueltas por servidor con fuente registrada; redondeo de plantillas con resto a la última línea (100,01 → 33,33/33,33/33,35).

## 11. No verificado
Prueba con qa-do-a-member y desde qa-do-b (login 429 por límite compartido de 5/min por IP); importación de archivos; ejecución real del cron de recurrentes (01:00); aprobación (submit/postApproved). Reduce confianza en ejes 1 y 8.

> Actualización 13:47 UTC: Miembro sin permisos (qa-do-a-member) verificado: 403 en GET/POST de journal-entries, chart-of-accounts, periods, journals, ledgers, recurrentes, plantillas, dimensions, balanza, balance, close-period, year-end-close y analytical query. Pendiente solo el ataque iniciado desde qa-do-b (se hizo en sentido inverso: desde qa-do-fin con IDs de qa-do-b y de otros tenants → 404/400).
