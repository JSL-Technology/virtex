# Ficha — chart-of-accounts (plan de cuentas, segmentos, jerarquía, fusión, aprovisionamiento por país)

Familia FIN-A · Auditor: FIN · Fecha: 2026-11-07

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/chart-of-accounts` — 2.865 líneas, 5 specs. `chart-of-accounts.service.ts` (668), `account-balances.service.ts` (496), `import/coa-import.service.ts` (272), `account-jobs.processor.ts` (160, fusión asíncrona), `account-segments.service.ts`. Plantilla por país: `localization/fiscal/coa-builder.ts` (490).
- **Endpoints**: `/chart-of-accounts` POST, GET, tree/roots, tree/children/:parentId, :id, PATCH :id, deactivate, block, unblock, batch/deactivate, merge/preview, merge — todos con `@HasPermission` (13 decoradores / 12 rutas + segmentos).
- **Tablas**: `accounts` (closure-table `accounts_closure`), `account_segment_definitions`, historial de cuentas.
- **Frontend**: `features/accounting/chart-of-accounts`, `account-form`, `merge-accounts`; rutas `chart-of-accounts`, `/segments-configuration`, `/merge`, `/new`, `/:id/edit`.
- **Países**: los 19 declarados (plantilla común). **Núcleo**: sí.

## 2. Estándar de referencia
(a) Básicas: plan aprovisionado por país conforme a uso local, jerarquía grupo/imputable, tipos y naturalezas coherentes, código agrupador SAT (MX, Anexo 24 — verificar con contador), PUC (CO, Decreto 2650), PCGE (PE), importación del plan oficial, bloqueo/inactivación, fusión de cuentas. Avanzadas: segmentos, vigencias, mapeo a estados.
(b) Invariantes: código único por tenant; hijo del mismo tipo que el padre; una cuenta con movimientos no se convierte en grupo; vigencia no impide registrar el pasado legítimo; fusión conserva trazabilidad.
(c) Líderes (confianza media): CONTPAQi y Aspel exigen código agrupador SAT para contabilidad electrónica; Siigo/Alegra traen PUC precargado en CO; QuickBooks/Xero US traen plan por tipo de negocio. No reverificado en línea en esta sesión.
(d) Construcción: plantilla como datos versionados por país, jerarquía con closure-table mantenida, fusión transaccional por reclasificación (no reescritura de historia).

## 3. Resultado
- **Madurez: 45 (38–52, confianza media-alta)**. Preparación comercial: 42. **Veredicto: No listo** (compuerta 6 incumplida en MX/CO/PE; fusión inoperante). DO: Piloto controlado con reservas.
- Eje más débil: 3 (multi-país).
- Críticos: ninguno marcado como crítico; 4 altos.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
|1|Autenticidad (crítico)|50 (42–58, alta)|CRUD real; fusión responde 200 "Se inició la fusión" y falla en segundo plano si la cuenta tiene movimientos (FIN-COA-02); `tree/children` roto (FIN-COA-04).|Arreglar fusión y árbol.|
|2|Corrección (crítico)|48 (40–56, alta)|Acepta cuenta REVENUE bajo grupo ASSET 1100; acepta hijo 1111 bajo 1110 (imputable con movimientos) y 1110 sigue imputable; `effective_from` = fecha de alta bloquea registrar el año en curso (FIN-COA-01). Bien: duplicado → 400, categoría incoherente → 400, cambio de tipo con movimientos → 400, desactivar con hijos → 400, padre de otro tenant → 404, rol de sistema duplicado → 409.|Validar tipo vs padre; impedir hijos en imputables con saldo; vigencia desde inicio de ejercicio.|
|3|Multi-país|30 (22–40, alta)|Mismo plan de 56 cuentas (47 imputables) para DO, MX, US, UY, BR, CO, PE, AR, CL, GT; MX/UY/AR… heredan nombres de nómina DO (FIN-COA-03); MX sin `fiscal_grouping_code`; CO/PE solo aviso `STATUTORY_PLAN_REQUIRED`.|Plantillas por país como datos; agrupador SAT; PUC/PCGE importables oficiales.|
|4|Arquitectura|55 (48–62, media)|Closure-table declarada pero sin mantenimiento; fusión reescribe `journal_entry_lines` (contradice inmutabilidad).|Fusión por reclasificación; mantener closure o usar `parent_id` recursivo.|
|5|Higiene|60 (52–66, media)|6 violaciones de frontera en el directorio; nombres de nómina DO dentro de `coa-builder.ts` (contexto de payroll/DO en plantilla genérica).|Mover roles de nómina a paquete de país.|
|6|Calidad|62 (55–68, media)|13 warnings lint.|—|
|7|Robustez|58 (50–65, media)|Fusión por lotes asíncrona con progreso por websocket; falla sin compensación visible para el usuario más allá del log.|Notificación de fallo; transacción completa.|
|8|Seguridad (crítico)|70 (60–78, media)|GET/PATCH/block/merge/batch con IDs de otro tenant → 404/400; búsqueda acotada por tenant. qa-do-a-member → 403 (ejecutado). Fusión: `manager.update(Account, {parentId: sourceAccountId}, …)` y lectura de líneas por `accountId` sin `organizationId` (`account-jobs.processor.ts:79,87`) — mitigado porque los IDs se validan antes por tenant.|Añadir `organizationId` en esas consultas.|
|9|Pruebas|50 (42–58, media)|5 specs; ninguna detecta closure vacía, fusión con movimientos ni nombres DO en MX.|Pruebas por país de la plantilla.|
|10|Operabilidad|58 (50–65, media)|`reasonForChange` obligatorio e historial de cambios.|Alertas de job fallido al usuario.|
|11|UX|58 (48–66, baja)|Pantalla carga sin errores (Playwright). Nombres de cuentas US guardados bajo clave `"es"` (`{"es":"Assets"}`).|Nombres i18n por clave correcta.|
|12|Competitividad|40 (32–48, media)|Frente a CONTPAQi (MX) y Siigo/Alegra (CO) el plan local es inferior.|Planes oficiales por país.|

## 5. Compuertas
|#|Estado|Evidencia|
|---|---|---|
|1|No cumple|fusión falla siempre que hay movimientos|
|2|Cumple con reservas|validación tipo/padre ausente|
|3|Parcial|IDOR negativo; miembro no verificado|
|4|Parcial|—|
|5|Cumple (pantalla)|Playwright|
|6|**No cumple** MX/CO/PE/BR…; DO parcial|FIN-COA-03|
|7|No cumple (CI global)|—|
|8|Cumple|`reasonForChange` + historial|
|9|Cumple|—|
|10|Cumple|—|
|11|Parcial|nombres EN bajo `es`|
|12|Parcial|—|

### Por país
- **DO**: plan genérico IFRS con ITBIS y TSS — Piloto controlado (nota 55).
- **MX**: IVA genérico, sin código agrupador SAT (requisito de contabilidad electrónica; `compliance/reports/mx-electronic-accounting.ts:87` falla si falta) y cuentas "AFP/SFS (TSS)", "INFOTEP", "Propina Legal" ajenas a MX — No listo (35).
- **CO, PE** (plan estatutario obligatorio declarado no provisto), **EC, BO**: No listo (30).
- **US**: plan en inglés coherente; nombres guardados como `"es"` — Piloto (50).
- **BR**: etiquetas PT; sin plano referencial SPED (verificar) — No listo (35).
- **UY, AR, CL, PY, VE, PA, CR, GT, SV, HN, NI**: plan genérico con nómina DO filtrada — Piloto limitado / contabilidad genérica (40).

## 6. Hallazgos
**FIN-COA-01** · chart-of-accounts · Eje 2 · Bug · **Alta**
- Las 56 cuentas aprovisionadas tienen `effective_from` = fecha de alta (2026-11-07). POST /journal-entries con fecha 2026-11-02 → 403 `financial_reporting.account_code_not_valid_until_effective` (1110). Un cliente que se da de alta en noviembre no puede registrar saldos iniciales ni operaciones del año en curso sin editar cuenta por cuenta (PATCH con `reasonForChange` lo permite). Forma correcta: vigencia desde el inicio del ejercicio abierto más antiguo (o nula). Esfuerzo: S.

**FIN-COA-02** · chart-of-accounts · Eje 1/2 · Funcionalidad rota · **Alta**
- `account-jobs.processor.ts:85-95` reescribe `journal_entry_lines.account_id`; los triggers de inmutabilidad lo impiden. Ejecutado: cuenta 6200 con asiento `GENERAL-2027-000002`, POST /chart-of-accounts/merge → 200 "Se inició la fusión…", log: "Fallo en el trabajo de fusión de cuentas (Job ID: 2). Razón: No se puede modificar la línea … de un asiento contabilizado"; 6200 sigue activa con su línea. Solo funciona con cuentas sin movimientos (6100 → 6000 sí). `merge/preview` no anticipa el fallo.
- Forma correcta: fusión = asiento de reclasificación + inactivación + alias de código, o mapeo en reportes; nunca reescribir historia. Esfuerzo: M.

**FIN-COA-03** · chart-of-accounts/localization · Eje 3 · Multi-país · **Alta**
- `localization/fiscal/coa-builder.ts:370-393`: para todo país no US/BR se usan "AFP por Pagar (TSS)", "SFS por Pagar (TSS)", "SRL e INFOTEP por Pagar", "Aportes Patronales (TSS/INFOTEP)", y `serviceCharge: 'Propina Legal por Pagar'` (línea 152). Verificado en BD: tenants MX y UY tienen esas cuentas (diff contra DO solo cambia ITBIS→IVA). Es la regla DO filtrada a otros países. Además `fiscal_grouping_code` nulo en las 56 cuentas MX.
- Forma correcta: plantillas como datos por país con revisión de contador local; código agrupador SAT en MX. Esfuerzo: L.

**FIN-COA-04** · chart-of-accounts · Eje 1/4 · Bug · **Media**
- `accounts_closure` tiene 1.126 filas y **0** relaciones ancestro≠descendiente aunque 1.025 cuentas tienen `parent_id`. `GET /chart-of-accounts/tree/children/<1110>` devuelve la propia 1110 en lugar de su hijo 1111. El front no usa estos endpoints (grep sin coincidencias), así que es API rota/código muerto. Forma correcta: mantener la closure o eliminarla y usar CTE recursiva. Esfuerzo: S.

**FIN-COA-05** · chart-of-accounts · Eje 2 · Integridad · **Media**
- Se acepta cuenta `REVENUE` (1171) bajo el grupo `ASSET` 1100 y una hija (1111) bajo la imputable 1110 con saldo; 1110 sigue `isPostable=true`. Los totales por jerarquía quedan mezclados. Forma correcta: tipo de hijo = tipo de padre; prohibir hijos de imputables con saldo o convertir con reclasificación. Esfuerzo: S.

**FIN-COA-06** · chart-of-accounts · Eje 11/3 · i18n · **Baja**
- Tenant US: `name = {"es":"Assets"}` — texto inglés en la clave `es`. Esfuerzo: S.

## 7. Camino mínimo a producción
DO: FIN-COA-01 (S), FIN-COA-02 (M), FIN-COA-05 (S). MX: + agrupador SAT y limpieza de nómina DO (L). CO/PE: plan oficial importable probado (L). Rehacer la plantilla como datos por país (no retocar condicionales `isEnglish/isPortuguese`).

## 8. Camino a 100
1. Plantillas por país como datos versionados (+15, L). 2. Fusión por reclasificación (+6, M). 3. Vigencias correctas (+5, S). 4. Validaciones de jerarquía (+4, S). 5. Árbol funcional (+2, S). 6. Pruebas por país (+4, M).

## 9. Competitividad
Brecha básica en MX (agrupador SAT), CO (PUC), PE (PCGE) frente a CONTPAQi, Siigo, Alegra, Contasis (confianza media). Diferenciador: segmentos de código por país y aviso explícito de plan estatutario faltante.

## 10. Fortalezas
Unicidad y coherencia tipo/categoría; prohibición de cambio de tipo con movimientos; `reasonForChange` + historial; preview de fusión con cifras reales y bloqueos; aislamiento verificado.

## 11. No verificado
Importación de plan (`coa-import.service.ts`); segmentos multi-nivel en países con estructura distinta; miembro sin permisos.

> Actualización 13:47 UTC: Miembro sin permisos (qa-do-a-member) verificado: 403 en GET/POST de journal-entries, chart-of-accounts, periods, journals, ledgers, recurrentes, plantillas, dimensions, balanza, balance, close-period, year-end-close y analytical query. Pendiente solo el ataque iniciado desde qa-do-b (se hizo en sentido inverso: desde qa-do-fin con IDs de qa-do-b y de otros tenants → 404/400).
