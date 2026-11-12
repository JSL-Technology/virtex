# Ficha — `currencies` (monedas, tasas por tenant, revaluación cambiaria) — Familia FIN-B

> ⚠️ CRÍTICO: FINB-01 — la revaluación cambiaria (diferencial no realizado de cierre) nunca puede ejecutarse sobre datos reales: ninguna cuenta puede tener moneda asignada por API, y el cierre la reporta como "realizada".

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/currencies/` (18 archivos, 2.481 líneas): `currencies.controller.ts` (5 endpoints, catálogo global), `exchange-rates.controller.ts` (7 endpoints), `exchange-rates.service.ts` (489), `exchange-rate-resolver.service.ts` (413), `xe-rates.provider.ts` (234). Tablas `currency`, `exchange_rate` (compartida), `tenant_exchange_rates` (por tenant). Revaluación: `accounting/services/currency-revaluation.service.ts` (221), invocada solo desde `accounting/closing-automation.service.ts:89`.
- **Frontend**: masters `features/masters/exchange-rates/exchange-rates.page.ts`, `data/exchange-rates.service.ts`; manifest `contabilidad.manifest.ts:573` (currencies).
- **Pruebas**: `exchange-rates.spec.ts` (422), `xe-rates.provider.spec.ts` (182) — pasaron en suite global (no re-ejecutadas).
- Países: los 19 (tipo de tasa OFFICIAL/MARKET/BUY/SELL, fuente libre). Núcleo para vender: sí (LatAm opera en USD).

## 2. Estándar de referencia
(a) Básicas: catálogo ISO 4217, tasas diarias por tipo (oficial/compra/venta), carga automática de tasa oficial (DO: BCRD; MX: DOF FIX; CO: TRM; AR: BNA/BCRA; PE: SBS/SUNAT; CL: dólar observado), tasa histórica por fecha de documento, diferencial realizado en cobro/pago, **revaluación no realizada al cierre con reversa o reexpresión**, auditoría de tasas. Avanzadas: triangulación, tolerancias, tasas por banco, NIC 21/ASC 830.
(b) Invariantes: documento usa la tasa de su fecha; una tasa por (par, día, tipo); la revaluación sólo afecta cuentas monetarias en ME; asiento cuadra.
(c) Líderes: SAP (tipos de tasa M/B/G, programa FAGL_FCV), NetSuite (Currency Revaluation, tasas automáticas), D365 (Foreign currency revaluation), Odoo (proveedores de tasas por país, incl. BCRD vía módulos de localización), Alegra/Siigo (TRM automática en CO) — confianza media (conocimiento general).
(d) Construcción: resolver único con trazabilidad (fuente, método, fecha cotizada); tabla compartida + override por tenant.

## 3. Resultado
- **Madurez: 45 (38–52, confianza media-alta)** — tope por crítico abierto (≤59); el resolver es de buena construcción, pero la revaluación es inoperable.
- **Preparación comercial: 40 — Veredicto: No listo**.
- Eje más débil: 1 Completitud (revaluación) / 3 Multi-país (sin feeds oficiales).
- Críticos abiertos: 1 (FINB-01).

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 Completitud | 35 (28–45, alta) | Tasas manual/import funcionan; revaluación muerta (FINB-01); proveedor XE solo plataforma (`POST /exchange-rates/update` → 403 a admin de tenant, correcto); sin feeds oficiales (FINB-03) | Moneda en cuentas, feeds oficiales por país, reporte de revaluación |
| 2 Corrección | 70 (62–76, alta) | Lookup histórico: USD/DOP 15-02 → 60,5 (cotizado 10-02) aunque existe 61,2 del 10-03; EUR/DOP triangulado 1,1×62 = 68,2; inverso DOP/USD = 1/61,2. Asientos USD: 1.000,01×59,8 = 59.800,60 y ×63,123456 = 63.124,09 ✓, con `exchange_rate_source/quoted_on` guardados. Antigüedad > 10 días rechaza | Revaluación operativa y verificada |
| 3 Multi-país | 35 (25–45, media) | Tipos de tasa y fuente como datos, sin país por defecto; pero ningún feed oficial (comentario `exchange-rates.service.ts:88-95` lo admite) | Feeds BCRD/DOF/TRM/BNA/SBS con contrato |
| 4 Arquitectura | 72 (65–78, media) | Resolver con `ResolvedRate` auditable, upsert por clave natural, índices únicos y de búsqueda (`exchange-rate.entity.ts:293-297`), historial paginado (máx 500) | `GET /exchange-rates` usa contexto implícito de tenant (AsyncLocalStorage) en vez de parámetro explícito |
| 5 Higiene | 60 (50–68, media) | Revaluación vive en accounting (bien); `forwardRef` por ciclo con ChartOfAccounts (`currencies.module.ts:430`) | Romper ciclo |
| 6 Calidad | 70 (62–76, media) | Código claro; SQL con parámetros (LIMIT/OFFSET interpolados pero enteros validados) | — |
| 7 Robustez | 68 (60–74, media) | Cron con `SchedulerLock`, backfill acotado a 370 días y throttled; rechaza tasas simuladas del plan de prueba XE | Reintentos/alerta de tasa faltante |
| 8 Seguridad | 80 (72–86, alta) | qa-do-b: lookup de par registrado por finb → 400 sin tasa (no se filtra); DELETE de tasa ajena → 404; history TENANT vacío; member → 403 en POST e history; catálogo y refresh exigen permiso de plataforma (403 a admin tenant) | Auditar escrituras |
| 9 Pruebas | 55 (45–62, media) | specs de tasas y proveedor; revaluación con spec propio no localizado como integración real | Prueba E2E de revaluación con cuenta en ME |
| 10 Operabilidad | 45 (38–52, alta) | `audit_logs` sin filas `tenant_exchange_rates` tras alta/import/borrado (consulta por entity) — solo `recordedByUserId` | Auditoría antes/después |
| 11 UX | 45 (30–55, baja) | Pantalla de tasas existe; import responde `"Se importaron {{imported}} tasas."` sin interpolar (FINB-04); UI no ejercida | — |
| 12 Competitividad | 35 (28–42, media) | Odoo/Alegra/Siigo traen tasa oficial automática | Feeds y revaluación |

## 5. Compuertas
1 **No cumple** (FINB-01) · 2 Cumple en tasas/conversión, no aplica revaluación · 3 Cumple · 4 Cumple · 5 Cumple (sin 500 en pruebas) · 6 **No cumple** (sin tasa oficial automática en ningún país; manual posible) · 7 Parcial · 8 No cumple (FINB-05) · 9 Cumple · 10 Parcial · 11 No verificado · 12 No cumple.

## 6. Hallazgos
**FINB-01** · currencies/accounting · eje 1/2 · Funcionalidad falsa · **Crítica** · `accounting/services/currency-revaluation.service.ts:112-133`, `chart-of-accounts/dto/create-account.dto.ts:43-80`, `closing-automation.service.ts:89-90`. La revaluación sólo procesa cuentas con `isMultiCurrency` **y** `currency` distinto a la del libro; `currency` no existe en `CreateAccountDto` ni en update. Pasos: `POST /chart-of-accounts {..., "isMultiCurrency":true, "currency":"USD"}` → 400 whitelist `currency`; `PATCH /chart-of-accounts/{id} {"currency":"USD"}` → 400 whitelist. En toda la BD: 1.240 cuentas, 0 con `currency`, 0 multimoneda. El cierre registra `{task:'currency-revaluation', performed:true}` aunque no haga nada. Resultado: saldos en USD (p.ej. 1125 con 2.000,02 USD) nunca se reexpresan; estados financieros con diferencial cambiario no registrado (NIC 21.23). Forma correcta: moneda en la cuenta (o derivarla de cuentas bancarias), endpoint de revaluación con previsualización y reporte, reversa automática el día 1 opcional, prueba E2E. Impacto: bloquea la venta en LatAm. Esfuerzo M.

**FINB-02** · eje 2 · Configuración · Media · `organization_settings.fx_rate_tolerance = 0.000000` en tenant nuevo (consulta SQL): cualquier tasa bancaria declarada distinta a la oficial se rechaza (`exchange-rate-resolver.service.ts:278-288`). Default razonable 1–2 % documentado (el código usa 0,02 solo si no hay settings). S.

**FINB-03** · eje 3/12 · Multi-país · Alta · `exchange-rates.service.ts:88-95, 420-468`. Única fuente automática: XE (mercado, cuenta de plataforma); tasas oficiales DGII/BCRD, DOF, TRM, BNA, SBS solo manuales. Alta de documentos en ME depende de que alguien teclee la tasa cada día (antigüedad máx. 10 días). L.

**FINB-04** · eje 11 · i18n · Baja · `exchange-rates.service.ts:298`: `messageKey` sin `messageParams` → respuesta literal `{{imported}}`. S.

**FINB-05** · eje 10 · Auditoría · Media · `exchange-rates.service.ts:246, 287-297, 369` (upsert/delete por criterio no disparan el subscriber). Alta, import y borrado de tasas no dejan rastro en `audit_logs`. S.

**FINB-06** · eje 2 · Semántica · Baja · `exchange-rate-resolver.service.ts:195-203`: sin tasa OFFICIAL cae a MARKET con solo `logger.warn` (queda `rateType` en el asiento, lo cual mitiga). Exponer advertencia al usuario. S.

## 7. Camino mínimo
1. FINB-01 (M) — moneda de cuenta + endpoint/reporte de revaluación + E2E. 2. FINB-03 feed oficial al menos para DO, MX, CO (L). 3. FINB-02/05/04 (S). Retocar.

## 8. Camino a 100
Revaluación completa con reversa y por libro (+15, M); feeds oficiales por país con fallback y alerta (+12, L); auditoría (+4, S); diferencial realizado verificado end-to-end en cobros/pagos (+6, M, con FIN-A/TES); UI de "qué tasa usó este asiento" (+3, S).

## 9. Competitividad
Básicas faltantes: revaluación de cierre operativa, tasa oficial automática. Diferenciador: trazabilidad de tasa por asiento (fuente, método, fecha cotizada) y override por tenant — superior a QuickBooks/Alegra. Fuentes: conocimiento general (confianza media).

## 10. Fortalezas
Resolver único (directo/inverso/triangulado) con proveniencia; separación tabla compartida vs tenant; tolerancia y antigüedad máximas; rechazo de tasas simuladas; upsert por clave natural.

## 11. No verificado
Diferencial realizado en cobros/pagos (familias TES/FAC); cron diario XE (sin credenciales; no se llamó a proveedores externos); UI de tasas.
