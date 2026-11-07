# M24 — Conciliación bancaria (`reconciliation`)

> Familia F8 · Auditor F8 · 2026-10-31/11-01 · Tenant principal dev@virtex.local (DO); víctima qa-b.
> **Sin hallazgos críticos de seguridad**: GET de extracto y de resumen de otro tenant → 404; las líneas contables se acotan por tenant (`journal-query.service.ts:441-460`).
> **CRÍTICOS funcionales abiertos**:
> - **REC-01**: una cuenta creada con saldo inicial no puede cerrar nunca su conciliación (ejecutado).
> - **FLOW-04** (ya confirmado por el flujo cruzado; reconfirmado aquí): la importación CSV/OFX responde siempre 400, `reconciliation.controller.ts:244-251`.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/reconciliation/` — ~35 archivos, ~5.9 kLOC (servicio 1922 LOC; `reconciliation.spec.ts` 1111). 25 rutas (`reconciliation.controller.ts`): ajustes por empresa y por cuenta, mapeo de columnas, importación, extractos, resumen, sugerencias, match/unmatch, exclusión, reglas CRUD, aplicar reglas, aplicar seguros, deshacer automáticos, categorizar (crea asiento), resolver con IA, cierre y reapertura. Tablas: `bank_statements`, `bank_transactions`, `reconciliation_matches`, `reconciliation_match_lines`, `reconciliation_rules`, `reconciliation_settings`, `reconciliation_account_settings`, `reconciliation_auto_outcomes`.
- **Frontend**: `features/accounting/reconciliation/` (`statement-import`, `account-reconciliation`), rutas en `tesoreria.manifest.ts:59-70`.
- **Formatos**: CSV (con mapeo), OFX y camt.053 (`parsers/bank-file-parsers.ts`). **MT940 no soportado**: `detectFormat` solo distingue csv/ofx/camt (`reconciliation.service.ts:262-266`).
- **Feeds bancarios**: no existen. Buscado `plaid|belvo|fintoc|open.?banking|bank.?feed` en el módulo y en `treasury`, sin resultados en el módulo (búsqueda no exhaustiva en todo el repo).
- **¿Núcleo para vender?** Sí. Xero y QBO venden precisamente la conciliación.

## 2. Estándar de referencia
- **Básicas**: importación de extractos (CSV con plantilla por banco, OFX/QFX, camt.053, MT940); emparejamiento 1-1, 1-N y N-1; reglas; tratamiento de partidas no registradas (comisiones o intereses → asiento); **conciliación inicial / corte** que reconozca saldos y partidas anteriores; cuadre saldo bancario ajustado = saldo contable ajustado; cierre con bloqueo de lo conciliado; deshacer con rastro; informe de conciliación congelado al cierre.
- **Avanzadas**: feeds automáticos (Plaid/Yodlee; en LatAm Belvo y Fintoc), aprendizaje de reglas, auto-match con umbral, conciliación multimoneda.
- **Invariantes**: una línea bancaria y una línea contable se concilian una sola vez; lo conciliado no se edita ni se revierte sin deshacer; el cierre exige diferencia cero y queda congelado; un extracto no se importa dos veces (por hash y por solapamiento de movimientos); deshacer devuelve el estado exacto anterior.
- **Líderes** (confianza media, conocimiento de producto): Xero "Bank Reconciliation" con feeds, reglas y "Reconciliation report"; QBO "Reconcile" con saldo inicial e informes históricos congelados; BC "Bank Acc. Reconciliation" con "Match automatically" y el saldo del último extracto en la ficha; NetSuite "Match Bank Data"; Odoo "bank reconciliation widget" con modelos de conciliación.
- **Construcción**: estado y saldo de cierre por cuenta (último saldo conciliado), snapshot del cierre, operaciones de match con bloqueo por fila, importación idempotente y atómica.

## 3. Resultado
**Madurez 32 (26–38, confianza media-alta)** · **Preparación comercial 28 — No listo** · Eje más débil: Corrección e integridad (32) · Críticos abiertos: 2 (REC-01 y FLOW-04) · Altos: 4.

## 4. Doce ejes
| # | Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|---|
|1|Autenticidad y completitud|35 (28–42, alta)|Flujo real de punta a punta con camt.053 (ejecutado). El formato más común (CSV, y también OFX) da 400 (FLOW-04; reconfirmado: CSV → 400 `errors.http_400`). Sin MT940 ni feeds. Una cuenta con apertura no puede cerrarse (REC-01)|Corregir importación, conciliación inicial, MT940, feeds|
|2|Corrección e integridad|32 (25–40, alta)|REC-01; GL compartida (TES-04/REC-02); auto-match sin opt-in (REC-03); cierre sin bloqueo ni snapshot (REC-04); deshacer deja asientos huérfanos (REC-05)|Ver hallazgos|
|3|Multi-país|42 (35–50, baja)|camt.053 (ISO) y OFX; en LatAm la mayoría de bancos entregan CSV/Excel propietarios, justo lo que falla. Sin plantillas por banco (Popular/BHD/Banreservas DO, BBVA/Banorte MX, Bancolombia CO)|Plantillas de CSV por banco y país, MT940|
|4|Arquitectura|60 (54–66, media)|Matching en el servicio con port de journal-query; servicio de 1922 LOC que mezcla importación, matching, ML, reglas y posting|Dividir en servicios internos|
|5|Higiene/fronteras|55 (48–62, media)|Usa `JournalQueryService` (bien), pero SQL crudo sobre `journal_entry_lines` y `journal_entries` (`reconciliation.service.ts:690-701, 791-803, 816-824`) y entidades ajenas (`Ledger`, `Journal`, `Account`, `BankAccount`)|Puerto de lectura del mayor|
|6|Calidad de código|62 (56–68, media)|Tipado y comentarios cuidados; métodos largos|—|
|7|Robustez/rendimiento|48 (40–55, media)|`applyRules` llama a `availableLedgerLines` dentro del bucle, una vez por línea bancaria (N+1, `:1243-1250`); `listStatements` sin paginar (`:383-388`); importación síncrona en la request; extractos solapados no detectados (solo por hash, `:280-289`)|Precarga, paginación, detección de solapes|
|8|Seguridad/aislamiento|75 (68–80, media)|Permisos por ruta; IDOR 404 (ejecutado); match valida tenant, cuenta y estado POSTED. Sin step-up en categorizar (que crea asientos)|Revisar step-up y permisos en categorizar|
|9|Pruebas|45 (38–52, media)|Spec extenso, pero no detectó REC-01, FLOW-04 (validador de Nest 11) ni REC-03|Integración con BD de flujo completo: apertura → importación → cierre|
|10|Operabilidad|48 (40–55, baja)|`importError` guardado en el extracto (bien); deshacer manual sin rastro|Historial de matches y reaperturas|
|11|UX|48 (40–55, baja)|Pantallas de importación y conciliación existen (leídas, no ejecutadas); la importación CSV desde la UI falla por FLOW-04|—|
|12|Competitividad|40 (32–48, media)|Sugerencias con puntuación, grupos N-1, aprendizaje, IA para desempatar y auto-match con autopausa son diferenciadores; sin feeds|Feeds y plantillas por banco|

Promedio ≈ 49; la madurez se queda en 32 por el tope de los ejes 1 y 2 y por 2 críticos abiertos.

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
|1|Sin fachadas y con capacidades básicas|**No cumple**|CSV/OFX 400 (FLOW-04); cierre imposible con apertura (REC-01)|
|2|Integridad en escrituras críticas|**No cumple**|REC-01, REC-03, REC-04, REC-05|
|3|Autorización/aislamiento|Cumple|404 cruzado (ejecutado); scoping por tenant en el match|
|4|Validación servidor|Cumple con reservas|Cuadre de importes en `writeMatch` (`:1435-1445`); estado POSTED exigido|
|5|E2E sin 500|Cumple con reservas|Sin 500; varios 400 genéricos (`errors.http_400`) sin causa legible para el usuario|
|6|Cumplimiento por país|N/A (fiscal) / no cumple (formatos locales)|—|
|7|Pruebas CI|No cumple (flujo crítico)|Los dos críticos pasan la suite|
|8|Auditoría de negocio|Parcial|Cierre y reapertura con autor y motivo (solo el último); `unmatch` borra físicamente|
|9|Migraciones|Cumple|Global|
|10|Observabilidad|Parcial|—|
|11|UI|Parcial|Importación CSV inutilizable|
|12|Documentación|Parcial|—|

## 6. Hallazgos
**REC-01** · M24/M23 · Eje 2 · *integridad / flujo inutilizable* · **CRÍTICA** · `reconciliation.service.ts:839-905` (summary) y `:1531-1544` (`availableLedgerLines` con `onlyUpToEndDate`, `from = null`); origen: `treasury.service.ts:188-198`
Qué: las partidas pendientes del resumen son **todas** las líneas no conciliadas de la cuenta contable desde el inicio de los tiempos. El asiento de apertura que crea Tesorería no tiene contrapartida bancaria y no se puede excluir (la exclusión solo aplica a líneas bancarias). Tampoco existe un concepto de conciliación inicial o de saldo conciliado de partida. Resultado: la diferencia nunca llega a cero.
**Ejecutado**:
- Cuenta `QA-F8-Banco-A` con apertura de 100 000 al 01-09-2026 y transferencia de 5 000 el 10-09.
- Importado camt.053 con OPBD 100 000, DBIT 5 000 (10-09), DBIT 25 de comisión (15-09) y CLBD 94 975. Se concilió la transferencia (match automático) y se categorizó la comisión.
- Resumen: `bookBalance 94975`, `outstandingLedgerAmount 100000` (1 línea, BANCOS-2026-000001, la apertura), `adjustedBank 194975`, `adjustedBook 94975`, **difference −100 000**.
- `POST /close` → 400 `reconciliation_does_not_balance_difference_remains {difference:-100000}`.

**Recálculo a mano**:

| Concepto | Importe |
|---|---|
| Saldo banco al 30-09 | 94 975 |
| Depósitos en tránsito / cheques pendientes reales | 0 |
| **Saldo banco ajustado** | **94 975** |
| Saldo libros (100 000 − 5 000) | 95 000 |
| Comisión no registrada | −25 |
| **Saldo libros ajustado** | **94 975** |
| **Diferencia correcta** | **0** |

El sistema exige además 100 000 que no existen como partida en tránsito. Ocurre igual con cualquier movimiento contable anterior al primer extracto (clientes que migran con historia).
Forma correcta: (a) marcar el asiento de apertura como conciliado contra el saldo inicial del primer extracto, o (b) tener un "saldo conciliado inicial" y una fecha de corte por cuenta (QBO pide el saldo inicial; BC usa el "saldo del último extracto"), y limitar las pendientes a lo posterior al corte más lo no conciliado del último cierre.
Impacto: **bloquea la venta**, porque toda cuenta bancaria real se abre con saldo. Esfuerzo M.

**FLOW-04 (referencia)** · **CRÍTICA** · `reconciliation.controller.ts:244-251`
Ya confirmado por el flujo cruzado: el `FileTypeValidator` de Nest 11 rechaza CSV/OFX. Reconfirmado aquí: CSV `text/csv` → 400 `errors.http_400`. camt.053 sí funciona.

**REC-02** · Eje 2 · **Alta** · `reconciliation.service.ts:851-886`
Qué: el saldo en libros y las pendientes se calculan por **cuenta contable**, no por cuenta bancaria. Como Tesorería permite compartir la cuenta de control (TES-04), cualquier cuenta bancaria que la comparta no puede conciliar: se arrastran los movimientos de las otras cuentas. Forma correcta: cuenta de control única obligatoria, o filtro por dimensión de cuenta bancaria. Esfuerzo M (junto con TES-04).

**REC-03** · Eje 2 · *integridad / control* · **Alta** · `reconciliation.service.ts:1253-1269` frente a `:369-374`
Qué: `applyRules`, que se ejecuta **siempre** al importar, confirma como `AUTOMATIC` cualquier línea con un único importe exacto dentro de una ventana de ±45 días. Ignora el ajuste `autoConfirm`, que el código presenta como opt-in, y el `minScore`. **Ejecutado**: con `GET /reconciliation/settings` → `{"autoConfirm":false,"minScore":95}`, la importación creó el match `origin:"AUTOMATIC"`. Con importes repetidos (cuotas iguales) basta que en la ventana haya una sola línea abierta para que se empareje con la equivocada. Forma correcta: respetar `autoConfirm`/`minScore` y exigir cercanía de fecha. Esfuerzo S.

**REC-04** · Eje 2/7 · *concurrencia / control* · **Alta** · `reconciliation.service.ts:1065-1104` (`closeStatement`), `:981-990` (`unmatch`), `:1118-1144` (`reopen`)
Qué:
- El cierre calcula el resumen y luego guarda el estado fuera de cualquier transacción y sin bloquear el extracto. `unmatch`, `confirmMatch`, `exclude` y `categorize` leen el estado sin `FOR UPDATE`. Un deshacer concurrente con el cierre puede dejar un extracto RECONCILED con líneas sin conciliar. Esto se dedujo del código; no se reprodujo, porque la ventana es estrecha y el extracto de prueba no puede cerrar por REC-01.
- El cierre no guarda snapshot (saldo, pendientes, diferencia): el resumen de un extracto cerrado se recalcula en vivo con el `is_reconciled` actual, así que el informe de un mes cerrado cambia cuando se concilia el mes siguiente.
- La reapertura sobrescribe la reapertura anterior porque solo hay un campo `reopen*`.

Forma correcta: transacción con `SELECT … FOR UPDATE` sobre el extracto en todas las mutaciones, snapshot del cierre e historial de eventos. Esfuerzo M.

**REC-05** · Eje 2/10 · *integridad / auditoría* · **Media-Alta** · `reconciliation.service.ts:981-1000`, `:734-788`
Qué:
- `unmatch` borra físicamente el match y sus líneas. De un match manual deshecho no queda quién ni cuándo; solo los automáticos tienen `reconciliation_auto_outcomes`.
- Deshacer una línea categorizada o creada por regla **deja el asiento generado contabilizado**. Ejecutado: tras `DELETE /matches/:id` de la comisión, el asiento CONCIL-2026-000001 sigue `Posted` y sin conciliar. Si luego se excluye la línea bancaria (ejecutado: quedó `EXCLUDED`) o el usuario registra el cargo a mano, el gasto queda duplicado o huérfano.

Forma correcta: al deshacer, ofrecer o forzar el reverso del asiento generado y registrar un evento de auditoría. Esfuerzo S/M.

**REC-06** · Eje 2 · **Media** · `reconciliation.service.ts:280-289, 293-361`
Qué: el duplicado solo se detecta por hash exacto. Dos extractos con períodos solapados (el semanal y el mensual) cargan los mismos movimientos dos veces. La importación tampoco es atómica (cabecera, líneas y estado en escrituras separadas; si falla queda en FAILED, lo cual es aceptable). Forma correcta: detección por solape de período y por huella de movimiento (fecha + importe + referencia). Esfuerzo S.

**REC-07** · Eje 7 · *rendimiento* · **Media** · `:1243-1250` (N+1), `:383-388` (sin paginación), `:409-447` (cada sugerencia recarga candidatos, reglas, aprendizaje con LIMIT 5000), `categorize` recalcula todas las sugerencias (`reconciliation.controller.ts:142`)
Qué: con extractos de cientos de líneas, `applyRules` lanza una consulta por línea dentro de la transacción de importación. Esfuerzo M.

**REC-08** · Eje 3/12 · *multi-país* · **Media**
Qué: no hay MT940, ni plantillas CSV por banco y país, ni feeds bancarios (Belvo/Fintoc/Plaid). Esfuerzo L/XL.

**REC-09** · Eje 11 · *UX* · **Baja**
Qué: los errores de cuerpo vacío o de tipo de archivo devuelven `errors.http_400` genérico, sin `messageKey` útil (observado en `close`/`DELETE` enviados con `content-type: json` y sin cuerpo, y en CSV). Esfuerzo S.

**Concurrencia y deshacer, verificado como correcto (ejecutado)**:
- 3 `POST /matches` simultáneos con el mismo par → 201 / 409 / 400, y una sola fila en `reconciliation_match_lines` gracias a la restricción única `UQ_reconciliation_match_lines_line`.
- 2 `DELETE /matches/:id` simultáneos → 204/204 con estado final consistente (línea bancaria UNMATCHED, línea contable `is_reconciled=false`).
- `categorize` y `exclude` simultáneos sobre la misma línea → uno gana (EXCLUDED) y el otro devuelve 400, sin asiento duplicado (idempotencia `bank-category:<id>`).
- `writeMatch` rechaza importes que no cuadran y líneas ya conciliadas.
- El reverso o anulación de asientos con líneas conciliadas está bloqueado (`journal-entries.service.ts:1107, 1256`).

Transversales citados: FLOW-02 y FLOW-05 (cobros) alimentan el mayor que se concilia; redondeo `common/money.ts:77-84`; AUD-01.

## 7. Camino mínimo a producción
1. FLOW-04: corregir el validador de tipo de archivo (S).
2. REC-01: conciliación inicial / saldo de corte por cuenta y apertura conciliada automáticamente (M).
3. REC-02 + TES-04: cuenta de control única (M).
4. REC-03: respetar el opt-in del auto-match (S).
5. REC-04: bloqueo transaccional y snapshot del cierre (M).
6. REC-05: deshacer con reverso del asiento generado y rastro (S/M).
7. Prueba de integración con BD del flujo apertura → importación CSV/camt → match → cierre → reapertura (M).

Retoque, no rehacer; aplica a todos los países.

## 8. Camino a 100
Ítems 1–7 (+30 pts) → detección de solapes (+3, S) → MT940 y plantillas CSV por banco DO/MX/CO/US (+6, M) → feeds vía agregador (Belvo/Fintoc/Plaid) (+10, XL) → informe de conciliación congelado e imprimible (+4, S) → paginación y rendimiento (+3, M).

## 9. Competitividad
- **Brecha básica**: importar el CSV del banco (lo esencial en LatAm) y conciliar una cuenta con saldo: hoy no se puede ninguna de las dos cosas.
- **Brecha avanzada**: feeds bancarios (Xero, QBO, Odoo; en LatAm, Alegra y Siigo ofrecen conexiones en algunos países, confianza media) y MT940 (BC, SAP, Odoo).
- **Diferenciadores reales**: puntuación de candidatos con razones, grupos N-1 (depósito con varios cheques), aprendizaje por empresa, desempate por IA, auto-match que se pausa solo si la gente lo deshace, y categorización asistida.

**Nota 40 (32–48, confianza media).**

## 10. Fortalezas a preservar
Restricción única por línea contable; scoping por tenant en el match; cuadre en la moneda de la cuenta para cuentas en moneda extranjera; cierre con motivo de reapertura; idempotencia de los asientos de regla y de categoría; resumen con prueba interna del extracto (apertura + movimientos = cierre).

## 11. No verificado
- UI (no ejecutada).
- OFX y `column-mapping` (cubiertos por FLOW-04).
- Endpoint de IA `resolve` (no ejecutado por coste y limitador).
- Reglas CREATE_ENTRY ejecutadas.
- Conciliación multimoneda ejecutada.
- Carrera cierre/deshacer (solo deducida del código).
- Contenido de `audit_logs` para estas operaciones (AUD-01).

**Cobertura**: ~55 % del servicio leído en detalle; 11 de 25 rutas ejecutadas; 0 de 2 pantallas ejecutadas.

Scripts: `/tmp/claude-0/-home-user-virtex/1b81a5b7-a24a-5562-9029-0b328d33cee4/scratchpad/f8/run2.sh`, `run3.sh`, `run4.sh`, `stmt.xml` (salidas `.out`). Datos creados: extracto 8e24f47d… (`stmt.xml`, cuenta `QA-F8-Banco-A`) y asiento CONCIL-2026-000001 de 25 DOP.

<!-- RESUMEN: modulo=conciliacion-bancaria; madurez=32; prep=28; veredicto=No listo; eje_debil=correccion-integridad; criticos=2; altos=4; camino_min=M -->
