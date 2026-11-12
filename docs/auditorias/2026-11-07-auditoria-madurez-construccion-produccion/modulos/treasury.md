# Ficha de módulo — `treasury` (cuentas bancarias, bancos, formas de pago, posición de efectivo, transferencias)

Familia TES · tenant `qa-do-tes` · 2026-11-07 · scripts `…/scratchpad/agents/tes/s1-s3, s10, s17`, notas `NOTES.md`.
Sin hallazgo crítico propio; afectado por TES-02 (cobros en divisa sin importe en divisa, ver ficha customers).

## 1. Identificación
- Backend `apps/backend/api/src/app/treasury/` — 22 archivos, 4.191 l. (`treasury.service.ts` 737, `banks.service.ts` 280, `reference/do-banks.ts` 453 = catálogo de 43 bancos DO, `payment-methods/*`).
- Endpoints: `GET/POST/PATCH/DELETE /treasury/banks`, `GET /treasury/banks/reference`, `POST /treasury/banks/reference-import`, `POST/GET/PATCH /treasury/bank-accounts` (POST/PATCH con step-up `manage_bank_accounts`), `GET /treasury/cash-position`, `POST /treasury/bank-transfers` (@Idempotent, PeriodLockGuard, step-up `move_funds`), `GET /treasury/bank-transfers` (paginado), `/treasury/payment-methods` (GET `@AuthenticatedOnly`).
- Tablas: bank_accounts, banks, bank_transfers, payment_methods.
- Frontend: `/e/<slug>/accounting/treasury` (posición), `accounting/treasury/bank-accounts/new|:id/edit`, `accounting/treasury/cash-flow` (IA), `masters/banks`, `masters/payment-methods` (`features/accounting/treasury`, `features/masters/banks`).
- Pruebas: `treasury.spec.ts` 33 tests (BD real), `payment-methods.service.spec.ts`, `do-banks.spec.ts`.
- Núcleo para vender: sí.

## 2. Estándar de referencia
(a) Básicas: cuentas bancarias/caja por moneda vinculadas a cuenta contable propia, saldo inicial contabilizado, transferencias entre cuentas (incl. multimoneda y comisión) reversibles, posición de efectivo por moneda, catálogo de bancos por país, control de sobregiro. Avanzadas: flujo de caja proyectado, pagos masivos/archivos bancarios, conexión bancaria (open banking), revaluación de saldos en divisa.
(b) Invariantes: saldo en moneda de la cuenta = Σ movimientos en esa moneda; una cuenta contable de banco = una moneda; transferencias balanceadas con diferencia cambiaria; fechas dentro de períodos válidos.
(c) Líderes: NetSuite/D365/Sage Intacct manejan cuenta bancaria con moneda fija y GL dedicada, reversa de transferencias, alertas de saldo negativo (confianza media, no verificado web); Xero/QBO: bank feeds y transferencias editables/anulables (alta). DO: catálogo SIB de entidades — verificar con contador.
(d) Construcción: servicio transaccional con puerto contable; validación ISO 4217; restricción GL↔moneda.

## 3. Resultado
- **Madurez: 55 (48–62, confianza media)** · **Preparación: 56 (50–63)** · **Veredicto: Piloto controlado** solo en moneda base; **No listo** para cuentas en divisa (TES-02).
- Eje más débil: 2 · Críticos: 0 propios.

## 4. Ejes
| # | Eje | Nota | Evidencia | Falta para 100 |
|---|---|---|---|---|
| 1 | Completitud | 55 (48–62, alta) | Real: alta de cuenta con saldo inicial contabilizado (DOP 100.000; USD 1.000 @60 = 60.000), catálogo DO 43 bancos importado, transferencias DOP→DOP con comisión 25 y DOP→USD 6.200→100 USD. **No existe anular/revertir transferencia** (sin ruta en `treasury.controller.ts`), ni revaluación desde aquí, flujo de caja proyectado es IA (`/ai/cashflow` 403 en plan starter). Catálogo de bancos solo DO (MX/US: `available:0`). | Reversa de transferencias; catálogos por país; flujo de caja no-IA básico. |
| 2 | Integridad | 48 (40–55, alta) | Caja enviada a −99.999.014 sin aviso (transferencia de 99.999.999 aceptada); transferencia fechada 2020-01-01 aceptada (empresa creada 2026); `fee > amount` → error contable genérico `debit_cannot_negative`; cuenta en moneda "XYZ" creada (201); cuenta USD sobre GL 1122 de DOP aceptada (mezcla monedas en una GL); TES-02 (posición USD 1.000 vs 1.200 real). Correcto: saldo inicial requiere contrapartida y fecha; transferencias multimoneda guardan divisa. | ISO 4217, GL única por moneda, política de sobregiro, rango de fechas válido. |
| 3 | Multi-país | 45 (35–55, media) | Formas de pago US propias (ACH, WIRE, ZELLE…); bancos solo DO; descripciones de asiento de transferencia en español fijo (`treasury.service.ts` "Transferencia recibida — …", "Comisión bancaria") mientras cobros usan `LedgerNarrativeService`. | Narrativas i18n; catálogos de bancos por país. |
| 4 | Arquitectura | 62 (55–68, media) | Servicio con transacción y puerto contable; DTO de actualización no permite cambiar moneda/GL (bien); cash-position deduplica GL compartidas. | Restricciones de dominio en BD (CHECK moneda). |
| 5 | Higiene | 62 (55–70, media) | Importa journal-entries/accounting/chart-of-accounts internos; sin escrituras a tablas ajenas detectadas. | Contratos públicos. |
| 6 | Calidad | 62 (55–68, media) | Código legible; comentarios históricos extensos. | — |
| 7 | Robustez | 62 (55–70, media) | Transferencias paginadas; cuentas sin paginar (volumen bajo, aceptable). | — |
| 8 | Seguridad | 80 (72–86, alta) | Step-up de un solo uso en alta/edición de cuenta y transferencias (sin step-up → 401); qa-do-b sobre cuenta de qa-do-a → 404; transferencia hacia cuenta ajena 404; member 403 en cuentas/posición/bancos/transferencias. Cuenta enmascarada en posición. | — |
| 9 | Pruebas | 55 (48–62, media) | 33 tests de integración; no cubren sobregiro, moneda inválida, fechas fuera de rango, cobro en divisa. | Casos negativos. |
| 10 | Operabilidad | 60 (52–66, media) | audit_logs: bank_accounts CREATE, bank_transfers CREATE/UPDATE. | Motivo/aprobación en movimientos. |
| 11 | UX | 58 (50–65, media) | Pantallas cargan; flujo de caja proyectado muestra página que falla con 403 (`/ai/cashflow`, `/ai/cashflow/plan`) en plan sin IA; claves `charts.*` sin traducir. | Ocultar/explicar features no contratadas. |
| 12 | Competitividad | 42 (35–50, media) | Sin bank feeds, sin pagos masivos, sin reversa; catálogo DO es diferenciador local. | Open banking/archivos bancarios. |

## 5. Compuertas
1 Cumple con reservas (sin reversa de transferencia) · 2 **No cumple** para divisa (TES-02, sobregiro, XYZ) · 3 Cumple · 4 Reservas (moneda/fechas) · 5 Cumple (sin 500) · 6 Reservas (solo DO catálogo; narrativa fija ES) · 7 No cumple (CI rojo global) · 8 Cumple con reservas · 9 Cumple · 10 Reservas · 11 Reservas (cash-flow 403) · 12 No cumple.

## 6. Hallazgos
**TES-02** (ver customers) · Alta · posición de efectivo en divisa errónea tras cobros.
**TES-08** · treasury (eje 1) · Funcionalidad ausente · Alta · `treasury.controller.ts:190-219` solo POST/GET de transferencias · No se puede anular/revertir una transferencia errónea (p.ej. la de 99.999.999). · Ruta `POST bank-transfers/:id/void` con reversa del asiento y step-up. · Riesgo operativo · S.
**TES-09** · treasury (eje 2) · Integridad · Media · `createBankTransfer` · Sobregiro de caja sin aviso; fecha 2020-01-01 aceptada y contabilizada. · Política de saldo negativo por tipo de cuenta (CASH nunca); fecha ≥ inicio de operaciones. · Riesgo operativo · S.
**TES-10** · treasury (eje 2) · Validación · Media · `dto/bank-account.dto.ts:60-62` (`currencyCode` solo IsString) y `createBankAccount` · Moneda "XYZ" creada; cuenta USD sobre GL de DOP. · `@IsISO4217CurrencyCode` + existencia en `currencies`; GL con moneda única. · Deuda · S.
**TES-19** · treasury (eje 3) · Multi-país · Baja · `treasury.service.ts` (push de transferencia) narrativas en español fijo. · Usar `LedgerNarrativeService`. · S.

## 7. Camino mínimo
TES-02 (S) → TES-08 reversa (S) → TES-10 validaciones (S) → TES-09 política de sobregiro/fechas (S) → pruebas negativas (M).

## 8. Camino a 100
Reversa (+5) · divisa correcta en todos los movimientos (+8) · revaluación integrada (+4, M) · catálogos de bancos por país (+4, M) · archivos de pago/bank feeds (+10, XL) · flujo de caja básico no-IA (+4, M).

## 9. Competitividad
Básicas faltantes: reversa de transferencias, control de sobregiro. Avanzadas: feeds bancarios, pagos masivos. Diferenciador: catálogo SIB DO con SWIFT/RNC. Confianza media.

## 10. Fortalezas
Step-up de un solo uso; saldo inicial contabilizado con contrapartida; transferencias multimoneda con divisa; enmascarado de cuentas; idempotencia.

## 11. No verificado
Edición/borrado de bancos con cuentas asociadas; revaluación de divisa (otro módulo); flujo de caja IA (plan sin feature).
