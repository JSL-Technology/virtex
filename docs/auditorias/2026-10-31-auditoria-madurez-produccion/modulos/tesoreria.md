# M23 — Tesorería (`treasury`)

> Familia F8 · Auditor F8 · 2026-10-31/11-01 · Tenant principal dev@virtex.local (Virtex Dev, DO); víctima qa-b.
> **Sin hallazgos CRÍTICOS de seguridad.** IDOR verificado sin fuga (404 en GET/PATCH/transfer cruzados).
> Hallazgo que afecta a M24: las cuentas con saldo inicial **no pueden conciliarse nunca** (ver `conciliacion-bancaria.md` REC-01; el asiento lo genera este módulo).

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/treasury/` — 28 archivos .ts, ~3.2 kLOC (incl. `treasury.spec.ts` 1050 y `payment-methods.service.spec.ts`). Controladores: `treasury.controller.ts` (12 rutas: banks CRUD, bank-accounts C/R/U, cash-position, bank-transfers C/L) y `payment-methods/payment-methods.controller.ts`. Entidades/tablas: `bank_accounts`, `banks`, `bank_transfers`, `payment_methods`.
- **Frontend**: `features/accounting/treasury/` (posición de caja + panel de transferencias, formulario de cuenta bancaria), `features/masters/banks`, `features/masters/payment-methods`; rutas en `core/modules/manifests/tesoreria.manifest.ts`. `treasury/cash-flow` apunta a la página de IA (`features/ai/cashflow`, permiso `ai_cashflow:view`), no a un flujo de caja de tesorería.
- **Países**: agnóstico; multimoneda por cuenta. Ningún formato bancario local (pagos ACH/NACHA, archivos de bancos DO/MX/CO).
- **Dependencias**: journal-entries (port de posting, `Journal`, `JournalEntry`), accounting (`Ledger`, period lock, calendario fiscal), chart-of-accounts (`Account`, `AccountBalancesService`), currencies, organizations (`OrganizationSettings`), auth (step-up).
- **¿Núcleo para vender?** Sí (cuentas bancarias y posición de caja son básicas en cualquier ERP).

## 2. Estándar de referencia (Paso 3, escrito antes del análisis profundo)
- **Básicas**: maestro de bancos/cuentas (moneda, cuenta contable propia, datos enmascarados), caja chica, transferencias entre cuentas (con comisión y diferencia cambiaria) **anulables por reversión**, posición de tesorería por cuenta y moneda, flujo de caja proyectado (CxC/CxP/pedidos), cheques/pagos, integración con conciliación.
- **Avanzadas**: feeds bancarios (Plaid / Belvo / Fintoc en LatAm), archivos de pago (NACHA, SEPA, formatos de bancos locales), aprobación dual de pagos, positive pay, cash pooling, previsión por escenarios.
- **Invariantes**: toda operación de dinero = asiento cuadrado e idempotente; inmutable y corregida por reversión; una cuenta bancaria ↔ una cuenta contable de control propia (si se comparte, la conciliación no es posible); datos bancarios tratados como sensibles (enmascarados y con rastro de cambios); período cerrado bloquea.
- **Líderes** (confianza media, conocimiento público de producto, sin verificación web en esta sesión): NetSuite y Dynamics 365 BC tienen "Bank Account Card" con cuenta de banco ↔ grupo de contabilización propio, transferencias de fondos con reverso y previsión de caja ("Cash Flow Forecast" en BC). Xero/QuickBooks: feeds bancarios nativos. Odoo: diarios de banco con cuenta propia, sincronización bancaria (Plaid/Salt Edge/Ponto). Alegra/Siigo: bancos con conciliación; Belvo/Fintoc como agregadores LatAm.
- **Construcción**: servicio de dominio con transacción, port de posting, cuenta de control dedicada, DTOs de lectura (no entidades), auditoría de cambios a datos bancarios.

## 3. Resultado
**Madurez 50 (44–56, confianza media)** · **Preparación comercial 42 — No listo** · Eje más débil: Competitividad (38) / Autenticidad (52) · Críticos abiertos en el módulo: 0 (pero origina el crítico REC-01 de M24) · Altos: 4.

## 4. Doce ejes
| # | Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|---|
|1|Autenticidad y completitud|52 (45–58, media)|Cuentas, apertura con asiento, posición de caja y transferencias son reales (ejecutado). Faltan: anular transferencia (no hay ruta; `DELETE /treasury/bank-transfers/:id` → 400 por inexistencia), **pantalla para crear transferencias** (el cliente `features/accounting/data/treasury.service.ts:199` tiene `createTransfer` pero ninguna página lo usa), flujo de caja proyectado de tesorería (solo la página IA), cheques/caja chica|Reverso de transferencias, UI de transferencia, previsión desde CxC/CxP, caja chica y cheques|
|2|Corrección e integridad|60 (52–66, media)|Transferencia en transacción con asiento cuadrado; idempotencia ejecutada (misma clave → 1 transferencia). Pero TES-01 (cuenta de control no monetaria aceptada), TES-04 (GL compartida), TES-09 (desactivar oculta saldo)|Ver hallazgos|
|3|Multi-país|50 (40–60, baja)|Multimoneda por cuenta con tasa histórica y `foreignCurrency*` por línea (`treasury.service.ts:568-616`). Sin formatos bancarios locales ni validación de cuentas locales (CLABE MX, CBU AR, CCI PE)|Validadores de nº de cuenta por país, archivos de pago locales|
|4|Arquitectura|64 (58–70, media)|Port de posting, transacciones, paginación de transferencias; textos de asiento en español fijo en transferencias (`:605-630`) frente a narrativa i18n en apertura|DTOs de respuesta, narrativa i18n homogénea|
|5|Higiene/fronteras|55 (48–62, media)|Lee entidades ajenas directamente: `Journal`, `Ledger`, `Account`, `OrganizationSettings` (`treasury.service.ts:12-15, 254-262, 517-530, 704`)|Consultas vía puertos de contabilidad/organización|
|6|Calidad de código|66 (60–72, media)|Código legible, comentarios extensos (a veces contradictorios: `:697` dice que la comisión no comparte la cuenta de cambio y `:706` hace fallback a ella)|Eliminar contradicciones|
|7|Robustez/rendimiento|64 (56–70, media)|Posición de caja con una consulta por moneda; listado de cuentas sin paginar (aceptable por volumen)|—|
|8|Seguridad/aislamiento|72 (66–78, media)|Permisos por ruta, step-up para alta/edición de cuentas y transferencias (ejecutado: 401 sin step-up; token de un solo uso), IDOR 404. **TES-02**: GET devuelve nº de cuenta completo|Enmascarar en API, rastro de cambios en datos bancarios|
|9|Pruebas|58 (50–65, baja)|`treasury.spec.ts` amplio (unitario con mocks); no detectó TES-01/TES-09 ni la interacción apertura↔conciliación. No verifiqué integración con BD para este módulo|Pruebas de integración de apertura→conciliación y GL compartida|
|10|Operabilidad|50 (42–58, baja)|Log de transferencia; sin métricas ni auditoría de negocio propia verificada (ver AUD-01 transversal)|Auditoría de cambios de datos bancarios|
|11|UX|52 (45–60, media)|Posición de caja y formulario de cuenta correctos; **no hay pantalla de transferencia** ni de anulación|UI de transferencias y movimientos|
|12|Competitividad|38 (30–45, media)|Sin feeds bancarios, archivos de pago, aprobación dual, previsión|Ver §9|

Promedio simple ≈ 57; madurez 50 por tope del eje 1 y por bloquear la conciliación de cualquier cuenta con saldo inicial (impacto cruzado).

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
|1|Sin fachadas y con capacidades básicas|**No cumple**|Sin reverso de transferencia, sin UI de transferencia, sin previsión de caja de tesorería|
|2|Integridad en escrituras críticas|Cumple con reservas|Transacción + idempotencia (ejecutado); TES-01/TES-09|
|3|Autorización y aislamiento|Cumple|IDOR GET/PATCH/transfer → 404 (ejecutado con qa-b)|
|4|Validación en servidor|Cumple con reservas|class-validator con IBAN/BIC; acepta GL no monetaria (TES-01)|
|5|E2E sin 500|Cumple (API)|Sin 500 en la prueba; UI no ejecutada|
|6|Cumplimiento por país|N/A|Sin reglas fiscales; sin formatos locales (competitividad)|
|7|Pruebas en CI|Cumple con reservas|Unitarias corren en CI; integración no verificada|
|8|Auditoría de negocio|No verificado|Ver AUD-01|
|9|Migraciones|Cumple|Global (sin deriva)|
|10|Observabilidad|Parcial|Logs pino globales|
|11|UI/traducciones|Parcial|Faltan pantallas|
|12|Documentación|Parcial|Comentarios en código; sin guía de operación|

## 6. Hallazgos
**TES-01** · M23/M24 · Eje 2 · *integridad de datos* · **Alta** · `treasury/treasury.service.ts:151-155`
Qué: la validación acepta cualquier cuenta `ASSET` con `systemRole` nulo. En el plan sembrado, Gastos pagados por anticipado (1160), PP&E (1210) e Intangibles (1230) tienen rol nulo. **Ejecutado**: `POST /treasury/bank-accounts` con `glAccountId` = 1160 → 201 y asiento de apertura BANCOS-2026-000001 contra 1160. El comentario dice que QA A-06 lo resolvió; no está resuelto.
Forma correcta: exigir rol `CASH`/`BANK` (o subtipo de efectivo) explícito. Impacto: balance mal clasificado, riesgo operativo. Esfuerzo S.

**TES-02** · Eje 8 · *seguridad* · **Media** · `treasury.service.ts:319-334`; `bank-account.entity.ts:41-43`
Qué: el comentario afirma que el número "se enmascara en el borde de la API", pero `GET /treasury/bank-accounts` y `/:id` devuelven `accountNumber` e `iban` completos (ejecutado: `"accountNumber":"000123456789"`). Solo `cash-position` enmascara. Cualquier usuario con `treasury:view` ve los datos completos.
Forma correcta: DTO de lectura enmascarado; ver el número completo con permiso específico y step-up. Esfuerzo S.

**TES-03** · Eje 1 · *funcionalidad faltante* · **Alta** · `treasury.controller.ts` (sin ruta de anulación)
Qué: una transferencia no se puede anular ni revertir; no hay estado en `bank_transfers`. El usuario tiene que revertir el asiento a mano, y entonces el registro de la transferencia sigue vigente y desalineado. Forma correcta: `POST /bank-transfers/:id/void` que revierta el asiento y marque el estado. Esfuerzo M.

**TES-04** · M23/M24 · Eje 2 · *integridad / diseño* · **Alta** · `bank-account.entity.ts:118-124`, `treasury.service.ts:437-481`, `reconciliation.service.ts:839-886`
Qué: está permitido, y se documenta como intencional, que varias cuentas bancarias compartan la misma cuenta contable de control (la UI incluso lo avisa). Consecuencias: (a) cada fila de la posición de caja muestra el saldo **de toda la cuenta contable**, no el de la cuenta bancaria (`balances.get(account.glAccountId)`). Ejecutado: "QA-F8-Caja-B" comparte 1110 con "Caja general", así que las dos filas muestran el mismo saldo; (b) en conciliación, `bookBalance` y las partidas pendientes se calculan por cuenta contable, así que la conciliación de una cuenta que comparte GL no puede cuadrar. Forma correcta: exigir una cuenta de control única por cuenta bancaria (Odoo y BC lo hacen), o subcuenta/dimensión por cuenta bancaria. Esfuerzo M.

**TES-05** · Eje 1 · *funcionalidad* · **Media** · `treasury.service.ts:153`, `dto/bank-account.dto.ts:84-87`
Qué: existe el tipo `CREDIT_CARD`, pero se exige cuenta contable `ASSET` y el saldo inicial tiene `@Min(0)`. Una tarjeta de crédito (pasivo) o una cuenta sobregirada no se pueden representar. Esfuerzo S.

**TES-06** · Eje 6 · *calidad* · **Baja** · `treasury.service.ts:697-710`
Qué: la comisión hace fallback a la cuenta de diferencia cambiaria, lo que contradice el comentario de las líneas 694-699. Esfuerzo S.

**TES-07** · Eje 4/11 · *i18n* · **Baja** · `treasury.service.ts:605-638`
Qué: las narrativas de las transferencias están fijas en español ("Transferencia recibida", "Comisión bancaria"), mientras que la apertura usa `LedgerNarrativeService`. Un tenant US recibe asientos en español. Esfuerzo S.

**TES-08** · Eje 2 · *integridad de reporte* · **Media** · `treasury.service.ts:359, 387-389`
Qué: se puede desactivar una cuenta con saldo (`isActive=false`) sin validar nada, y a partir de ahí desaparece de la posición de caja aunque el mayor siga teniendo el saldo: el total de caja queda subestimado. Forma correcta: impedir la desactivación con saldo, o mostrarla aparte. Esfuerzo S.

**TES-09** · Eje 11 · *UX* · **Media** · `features/accounting/treasury/treasury.page.html` (sin formulario), `features/accounting/data/treasury.service.ts:199`
Qué: no hay pantalla para crear transferencias; el método del cliente existe pero ningún componente lo llama (búsqueda `createTransfer|bank-transfers` en `apps/core/client-web/src`). Esfuerzo S/M.

**TES-10** · Eje 11 · *UX/seguridad* · **Baja**
Qué: el token de step-up se consume aunque la petición falle por validación. Observado: transferencia 400 por `toBankAccountId` vacío y, en el reintento, `auth.step_up_token_already_used`. Obliga a reautenticar tras cada error de formulario. Verificar con el equipo.

Transversales citados (no repetidos): redondeo `common/money.ts:77-84`; AUD-01 (auditoría de negocio).

## 7. Camino mínimo a producción
1. TES-01 restringir la cuenta de control a efectivo/banco (S).
2. Resolver REC-01 (apertura conciliable, en M24) junto con TES-04 (cuenta de control única) (M).
3. TES-03 anulación de transferencias por reversión (M).
4. TES-09 UI de transferencias (S/M).
5. TES-02 enmascarar en la API (S).
6. TES-08 bloquear la desactivación con saldo (S).
Todo es retoque; válido para todos los países (módulo agnóstico).

## 8. Camino a 100
TES-04+REC-01 (+8 pts, M) → TES-03 (+5, M) → UI de transferencias (+4, S/M) → previsión de caja desde CxC/CxP/OC (+8, L) → feeds bancarios vía agregador (Belvo/Fintoc/Plaid) (+10, XL) → archivos de pago y aprobación dual (+8, L) → cheques/caja chica (+4, M) → validadores de cuenta por país (+3, S).

## 9. Competitividad
Faltan funciones básicas: reverso de transferencias, UI de transferencia y previsión de caja real. Faltan funciones avanzadas: feeds bancarios (Xero, QBO y Odoo los tienen; Alegra y Siigo también ofrecen conexiones bancarias en algunos países, confianza media), pagos masivos/archivos bancarios y aprobación dual. Diferenciadores: multimoneda bien modelada por línea, con diferencia cambiaria en las transferencias, step-up en operaciones de dinero e idempotencia. **Nota 38 (30–45, confianza media).**

## 10. Fortalezas a preservar
Asiento de apertura obligatorio con contrapartida explícita; transferencias multimoneda con comisión y diferencia cambiaria (`treasury.service.ts:593-632`); step-up de un solo uso; `@Idempotent` funcional; fecha por calendario del tenant (`:384`).

## 11. No verificado
UI (no ejecutada con Playwright); payment-methods solo leído por encima; auditoría de negocio de cambios de nº de cuenta (ver AUD-01); suite de integración de BD de este módulo; transferencias multimoneda ejecutadas (solo leídas).

**Cobertura**: ~75 % del código backend leído; 8 de 12 rutas de tesorería ejecutadas; 0 de 4 pantallas ejecutadas (2 leídas).

Pasos ejecutados: scripts en `/tmp/claude-0/-home-user-virtex/1b81a5b7-a24a-5562-9029-0b328d33cee4/scratchpad/f8/run1.sh` y `run2.sh` (salidas `.out`). Datos creados: cuentas `QA-F8-Banco-A` (01d44f66…, GL 1160, apertura 100 000 DOP al 2026-09-01), `QA-F8-Caja-B` (cd0c5267…, GL 1110) y transferencia `QA-F8 transfer` de 5 000 (3b7c2f74…).

<!-- RESUMEN: modulo=tesoreria; madurez=50; prep=42; veredicto=No listo; eje_debil=competitividad/autenticidad; criticos=0; altos=4; camino_min=M -->
