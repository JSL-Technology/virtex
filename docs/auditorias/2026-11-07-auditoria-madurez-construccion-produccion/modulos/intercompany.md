# Ficha — `intercompany` (transacciones intercompañía) — Familia FIN-B

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/intercompany/` (6 archivos, 825 líneas): `intercompany.controller.ts` (`POST /intercompany/transactions`, `GET /transactions`, `GET /transactions/pending`, `POST /transactions/:id/retry`), `intercompany.service.ts` (459), `intercompany.processor.ts` (BullMQ, 5 intentos, backoff exponencial). Tabla `intercompany_transactions` (sin `organization_id`: pertenece a dos empresas). Grupo: `organizations/contracts/corporate-group.contract.ts`.
- **Frontend**: ninguna pantalla (`grep -rln "intercompany/transactions" apps/core/client-web/src` → vacío); solo cuentas por defecto en `settings/finance/default-accounts`.
- **Pruebas**: no hay spec en la carpeta (`find intercompany -name "*.spec.ts"` → 0).
- Núcleo: sí para grupos.

## 2. Estándar de referencia
(a) Básicas: facturas/ventas intercompañía que generan la compra espejo, préstamos/transferencias, liquidación y compensación, conciliación automática de saldos CxC/CxP intragrupo, monedas distintas con diferencial, aprobación en destino, anulación espejo. (b) Invariantes: ambos lados en la misma fecha y monto convertido trazable; ninguna empresa escribe en libros ajenos sin vínculo de grupo; espejo o nada (o pendiente visible). (c) NetSuite (Intercompany Journal / Auto Intercompany), D365 (intercompany trade), Odoo (Inter-company rules: SO↔PO) — confianza media.

## 3. Resultado
- **Madurez: 30 (22–40, confianza baja-media** — no ejecutable: crear subsidiarias exige plan con cuota `SUBSIDIARIES` > 0; todos los tenants QA están en Starter).
- **Preparación comercial: 25 — Veredicto: No listo**. Eje más débil: 1/11. Críticos: 0 (altos: 3).

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 Completitud | 25 (18–32, media) | Solo modelo "transferencia de fondos" (origen D CxC-IC / C efectivo; destino D efectivo / C CxP-IC); sin facturas IC, liquidación, anulación, conciliación; cuentas IC por defecto vacías en tenant nuevo (`default_intercompany_receivable_id` NULL en qa-do-finb) → `create` rechaza | Ver §7 |
| 2 Corrección | 45 (35–55, baja) | Monto destino fijado a la fecha (`intercompany.service.ts:148-156`), asiento destino idempotente (`:258-263`), jobId determinista. Pero diario elegido al azar (FINB-40) | — |
| 3 Multi-país | 40 (30–50, baja) | Conversión a moneda base destino; usa tasas del tenant de ORIGEN (contexto de la request) | Tasa por tenant destino |
| 4 Arquitectura | 55 (45–62, media) | Asiento destino asíncrono con reintentos y estado PENDING/FAILED/COMPLETED, `retry` | — |
| 5 Higiene | 50 (42–58, media) | Lee `Organization`, `OrganizationSettings`, `Ledger`, `Account`, `Journal` ajenos | Puertos |
| 6 Calidad | 62 (55–70, media) | Legible | — |
| 7 Robustez | 50 (40–58, media) | `findAll` `take: 500` sin paginación; fallo definitivo si período destino cerrado (PeriodLockGuard solo valida origen) | Paginación, validación destino |
| 8 Seguridad | 55 (45–65, baja) | `requireSameGroup` + re-lectura de cuentas por tenant (`:131-132`); member → 403 en GET. Tabla sin `organization_id` → fuera de RLS; aislamiento depende del filtro `from/to` (no probado con dos tenants reales) | Prueba real entre grupos distintos |
| 9 Pruebas | 15 (5–25, alta) | Sin specs | Unitarias + integración |
| 10 Operabilidad | 45 (35–55, media) | Logs y `failureReason`; destino con `actorUserId: null` | Auditoría por empresa |
| 11 UX | 5 (0–15, alta) | Sin pantalla | — |
| 12 Competitividad | 20 (12–28, media) | Odoo/NetSuite generan documentos espejo | — |

## 5. Compuertas
1 **No cumple** · 2 No cumple (FINB-40) · 3 No verificado en ejecución · 4 Cumple (DTO) · 5 No verificado · 6 N/A · 7 **No cumple** (sin pruebas) · 8 Parcial · 9 Cumple · 10 Parcial · 11 No cumple · 12 No cumple.

## 6. Hallazgos
**FINB-40** · eje 2 · Bug · **Alta** · `intercompany.service.ts:447-458`: `findOneBy(Journal, { organizationId, type: 'GENERAL' })`; un tenant DO nace con 4 diarios GENERAL (NOMINA, GENERAL, DEPREC, CIERRE — consulta a `journals` de qa-do-finb) → los asientos IC caen en un diario arbitrario (incluida la secuencia de nómina o cierre). Buscar por código/rol. S.

**FINB-41** · eje 1/12 · Capacidad básica ausente · **Alta** · servicio completo: solo transferencias de efectivo; sin venta/compra IC espejo, liquidación, compensación, anulación espejo ni conciliación de saldos; y FINB-31 (consolidación elimina las cuentas de efectivo, no las IC). L.

**FINB-42** · eje 1 · Configuración · Media · cuentas IC por defecto no aprovisionadas (`organization_settings.default_intercompany_*` NULL) → `400 intercompany.default_intercompany_accounts_not_configured_one` en todo tenant nuevo (por código, `:118-125`). S.

**FINB-43** · eje 7/2 · Media · `intercompany.controller.ts:35-37` `PeriodLockGuard` solo para el origen; el destino con período cerrado agota 5 reintentos y queda FAILED con asiento de origen ya contabilizado (espejo roto, visible solo en `/pending`); `retry` solo desde origen (`:395`). M.

**FINB-44** · eje 9 · Pruebas · Alta · cero specs en el módulo. M.

**FINB-45** · eje 11 · Alta · sin pantalla ni menú. M.

## 7. Camino mínimo
FINB-40 (S) → FINB-42 (S) → pruebas (M) → validar período destino antes de contabilizar origen (S) → UI (M) → documentos IC espejo y conciliación (L). Retocar base, ampliar dominio.

## 8. Camino a 100
Documentos IC espejo (+20, L); conciliación/compensación (+10, M); UI (+10, M); pruebas (+8, M); RLS por empresa participante (+5, M); anulación espejo (+5, S).

## 9. Competitividad
Odoo Inter-Company Rules y NetSuite Auto Intercompany Management generan el documento contrario automáticamente; aquí solo un asiento de fondos sin UI. Confianza media.

## 10. Fortalezas
Monto destino congelado con su tasa; asíncrono idempotente con reintentos; validación de grupo y de pertenencia de cuentas.

## 11. No verificado
Ejecución real (sin plan con subsidiarias); aislamiento con dos grupos reales; conversión multimoneda.
