# Ficha de módulo — `reconciliation` (importación de extractos, conciliación bancaria, reglas)

Familia TES · tenant `qa-do-tes` · 2026-11-07 · scripts `…/scratchpad/agents/tes/s11-s15`, archivos QA en `…/agents/tes/files/` (CSV ok/malformado/5k/7k/20k, OFX).

## 1. Identificación
- Backend `apps/backend/api/src/app/reconciliation/` — 32 archivos, 6.043 l. (`reconciliation.service.ts` 2.011 l. — god class; `reconciliation.controller.ts` 400; parsers CSV/OFX/camt.053; autopilot; clasificador).
- Endpoints (26): settings (empresa/cuenta), column-mapping, statements (POST import multipart 5 MB, GET, GET :id, summary, suggestions, matches, apply-rules, apply-safe, undo-automatic, categories, categorize, resolve, close, reopen), matches (POST, DELETE), transactions/:id/exclude, rules CRUD.
- Tablas: bank_statements, bank_transactions, reconciliation_matches, reconciliation_match_lines (UNIQUE journal_entry_line_id), reconciliation_rules, reconciliation_settings, reconciliation_account_settings, reconciliation_auto_outcomes.
- Frontend `features/accounting/reconciliation` (statement-import, account-reconciliation; 2.279 l.), ruta `/e/<slug>/accounting/reconciliation[/import]`.
- Pruebas: `reconciliation.spec.ts` 30 tests BD real + parsers/autopilot/clasificador.
- Núcleo para vender: sí.

## 2. Estándar de referencia
(a) Básicas: importar CSV/OFX/camt.053 del banco local con mapeo guardado, detección de duplicados, emparejamiento automático (monto+fecha+referencia) con confirmación, manual 1:N y N:1, crear asiento desde línea (comisiones), excluir, deshacer, cierre con cuadre saldo libro vs banco, reapertura auditada. Avanzadas: reglas aprendidas, feeds bancarios, conciliación de tarjetas, volúmenes de decenas de miles de líneas en segundo plano.
(b) Invariantes: una línea contable se concilia una sola vez; Σ banco = Σ libro por match; el saldo inicial + movimientos = saldo final del extracto; nada se confirma sin consentimiento si el usuario lo desactivó.
(c) Líderes: Xero/QBO (bank rules, match sugerido con confirmación, alta confianza); NetSuite/D365 (reconciliation rules, importación asíncrona de archivos grandes, media). Fuentes: conocimiento de producto, no verificado web.
(d) Construcción: importación asíncrona por lotes (job), inserciones por bloques, motor de matching con candidatos precargados.

## 3. Resultado
- **Madurez: 52 (45–58, confianza media-alta)** · **Preparación: 52 (45–58)** · **Veredicto: Piloto controlado** (críticas cumplen con reservas; no apto para bancos con extractos > ~7.000 líneas).
- Eje más débil: 7 (robustez/rendimiento) · Críticos: 0.

## 4. Ejes
| # | Eje | Nota | Evidencia | Falta |
|---|---|---|---|---|
| 1 | Completitud | 65 (58–72, alta) | Real y probado: CSV (6 filas, 102 ms), OFX (2 líneas), duplicado rechazado, malformado rechazado con detalle, auto-match, sugerencias con score 100 (amount, same_day, reference), match manual, exclusión, regla CREATE_ENTRY (creó asiento de comisión 150), undo-automatic (2 deshechos), cierre bloqueado si no cuadra (`statement_does_not_add_up_opening`). **Reabrir desde UI no funciona** (TES-06). | Reapertura funcional en UI; feeds. |
| 2 | Integridad | 55 (48–62, alta) | UNIQUE por línea contable (reusar línea → 400 `ledger_line_id_already_reconciled`); match con montos distintos → 400; **auto-match en la importación aunque `autoConfirm=false`** (TES-04); regla que contabiliza contra la cuenta control CxC aceptada (TES-07); importación no transaccional (statement IMPORTING→FAILED quedan filas FAILED). | Respetar consentimiento; lista de cuentas prohibidas en reglas; importación atómica. |
| 3 | Multi-país | 55 (45–62, baja) | Formatos genéricos (CSV/OFX/camt.053); sin plantillas de bancos locales (Popular, BHD, Bancolombia…); error de formato de fecha expone mensaje de date-fns en inglés con URL (TES-15). | Plantillas por banco/país. |
| 4 | Arquitectura | 48 (40–55, media) | `reconciliation.service.ts` 2.011 l. mezcla importación, matching, reglas, categorías, cierre y contabilización; `findStatement` devuelve todas las transacciones (7.000) sin paginar. | Dividir en importador, motor, cierre; paginación. |
| 5 | Higiene | 60 (52–66, media) | Importa treasury BankAccount, journal-entries; contabiliza vía puerto (bien). | — |
| 6 | Calidad | 58 (50–65, media) | God class; comentarios-historia (“audit 2026-10-31, REC-05”). | — |
| 7 | Robustez/rendimiento | 30 (22–38, alta) | Síncrono: 5.000 filas 11,1 s; 7.000 filas 13,9 s; **20.000 filas → 400 “bind message has 28928 parameter formats but 0 parameters”** (excede límite de parámetros de Postgres en un solo INSERT; mensaje interno al usuario) (TES-03). `applyRules` consulta `availableLedgerLines` por cada transacción (N+1, `reconciliation.service.ts` ~1318). audit_logs genera una fila por transacción (12.016 filas para nuestras importaciones). UI de conciliación renderiza 7.000 filas sin paginar (Playwright: networkidle >30 s). | Job asíncrono, inserción por lotes, candidatos precargados, paginación. |
| 8 | Seguridad | 80 (72–86, alta) | qa-do-b: GET statement 404, DELETE match 404; member 403 en listar/unmatch; bankAccountId ajeno → 400; límite 5 MB y validador de tipo; regla con cuenta inexistente 400. | Rate limit de import (solo column-mapping lo tiene). |
| 9 | Pruebas | 55 (48–62, media) | 30 tests integración; sin volumen, sin contrato front-back (reopen), sin autoConfirm=false. | Casos de volumen y contrato. |
| 10 | Operabilidad | 58 (50–65, media) | Log de importación fallida con causa; `importError` persistido; outcomes automáticos calibran umbral. | Correlación; métricas de import. |
| 11 | UX | 55 (48–62, media) | Pantalla clara (cuadre, partidas en tránsito, umbral) — captura `agents/tes/ui/accounting_reconciliation.png`; TES-06; error de date-fns crudo. | Corregir reapertura, mensajes. |
| 12 | Competitividad | 50 (42–58, media) | Reglas, calibración del auto-match y cuadre explícito están a nivel de mercado medio; sin feeds ni plantillas locales. | Feeds/plantillas. |

## 5. Compuertas
1 Cumple con reservas (reabrir roto en UI) · 2 Cumple con reservas (TES-04/07) · 3 Cumple · 4 Cumple · 5 **No cumple** (20k → 400 con error interno; UI se cuelga con 7k) · 6 N/A parcial (sin reglas por país) · 7 No cumple (CI rojo global) · 8 Cumple con reservas · 9 Cumple · 10 Reservas · 11 Reservas · 12 No cumple.

## 6. Hallazgos
**TES-03** · reconciliation (eje 7) · Robustez · **Alta** · `reconciliation.service.ts` importStatement `this.transactions.save(parsed.map(...))` · Extracto de 20.000 líneas (≈970 KB, bajo el límite de 5 MB) falla con error de Postgres; 5k tarda 11 s en la request. · Inserción por lotes (≤1.000) dentro de transacción y job asíncrono con estado. · Bloquea clientes con volumen · M.
**TES-04** · reconciliation (eje 2) · Integridad/control · **Alta** · `applyRules` (exact único → `writeMatch` AUTOMATIC) llamado siempre desde importStatement · Con `autoConfirm:false` (empresa y cuenta), la importación confirmó 6 matches solos. · Si autoConfirm está apagado, solo sugerir. · Riesgo operativo/control interno · S.
**TES-05** · reconciliation (eje 7) · Rendimiento · Alta · N+1 de `availableLedgerLines` por transacción + 1 fila de auditoría por línea. · Precargar candidatos una vez; auditoría a nivel de extracto. · M.
**TES-06** · reconciliation (eje 1/11) · Bug front↔back · Media · `client-web/.../data/reconciliation.service.ts:303-304` envía `{}`; backend `ReopenStatementDto.reason` obligatorio (MinLength 5) · El botón Reabrir siempre recibe 400. · Pedir motivo en UI. · S.
**TES-07** · reconciliation (eje 2) · Integridad contable · Media · `validateRule` · Regla CREATE_ENTRY con `targetAccountId` = 1130 CxC (cuenta control) → 201; contabilizaría sin subledger y descuadra antigüedad vs mayor. · Prohibir cuentas control/roles de sistema. · S.
**TES-15** · reconciliation (eje 11) · UX · Baja · `dateFormat: "DD/MM/YYYY"` → mensaje de date-fns con URL; reimportar archivo tras un intento FAILED → 409 `UNIQUE_VIOLATION` genérico en vez de `file_has_already_imported`. · Validar tokens y mensaje propio. · S.

## 7. Camino mínimo
TES-03+05 (M, rehacer importación como job por lotes) → TES-04 (S) → TES-06 (S) → TES-07 (S) → paginación de transacciones API/UI (S).

## 8. Camino a 100
Importación asíncrona (+10) · motor de matching con 1:N automático y tolerancias (+6, M) · plantillas de bancos por país (+5, M) · feeds bancarios (+8, XL) · dividir god class (+4, M).

## 9. Competitividad
Básicas faltantes: volumen; reapertura en UI. Diferenciador: calibración automática del umbral por cuenta y pausa del autopiloto. Confianza media.

## 10. Fortalezas
UNIQUE por línea contable; match balanceado; cuadre explícito con consistencia interna del extracto; undo de automáticos; reglas con idempotencia por línea.

## 11. No verificado
camt.053; cierre exitoso y reapertura vía API con motivo (el extracto de prueba no cuadraba por movimientos de otras pruebas); categorías IA (`categorize`/`resolve`).
