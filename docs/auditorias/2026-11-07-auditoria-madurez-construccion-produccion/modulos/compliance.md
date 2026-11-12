# Ficha: `compliance` (formatos DGII 606/607/608/609, secuencias NCF, filings, contabilidad electrónica MX) — familia FAC

⚠️ CRÍTICO: FAC-CMP-01 — los formatos **607 (ventas) y 608 (anulados) responden HTTP 500 en todo tenant dominicano**: la consulta de tickets de POS usa una columna que no existe.

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/compliance/` (3.129 líneas): `compliance.controller.ts` (290), `compliance.service.ts` (524), `reports/dr-reports.ts` (529), `reports/mx-electronic-accounting.ts` (391), `fiscal-report-filings.service.ts` (206), entidades `ncf_sequences`, `fiscal_report_filings`.
- **Endpoints:** `POST/GET/PATCH ncf-sequences` (`settings:edit_company`), `GET reports/:kind?year&month` (`reports:view_financial`, `@AuditAccess` EXPORT), `GET mx/electronic-accounting/:document`, `GET filings`, `GET filings/active-since`, `POST filings/:kind/:y/:m/check`, `POST/DELETE filings/:kind/:y/:m/submission` (`accounting:close_period`).
- **Frontend:** `features/accounting/fiscal-returns/fiscal-returns.page.ts` (367).
- **Pruebas:** `reports/dr-reports.spec.ts` (30 casos, con dobles), `mx-electronic-accounting.spec.ts` (BD), `fiscal-report-filings.service.spec.ts`.
- **Países:** DO (606–609, NCF), MX (catálogo/balanza XML SAT). **Núcleo:** sí en DO (envío mensual obligatorio).

## 2. Estándar de referencia
- (a) Básicas: generación de 606/607/608/609 en el formato TXT de la DGII (cabecera `NNN|RNC|AAAAMM|cantidad`, 23 casillas en 607 según Norma General 07-2018), validación previa (RNC/cédula, NCF modificado), registro de presentación y bloqueo del período, IT-1/IR-17 resumidos; MX: catálogo de cuentas, balanza y pólizas XML (Anexo 24). Avanzadas: conciliación 607 vs e-CF enviados, presentación vía oficina virtual, alertas de vencimiento.
- (b) Invariantes: el 607 incluye todo comprobante de venta del mes (facturas + tickets B02 del POS) y excluye anulados (van al 608); importes cuadran con el libro de ventas.
- (c) Referencias: DGII "Formato de envío 607" (Norma 07-2018, 23 campos — confianza media, conocimiento previo; el código reproduce los mismos nombres de casilla en `FORMAT_607_BOXES`, `dr-reports.ts:71-95`); Alegra RD y otros generan los TXT 606/607 (media). **Verificar con contador local.**

## 3. Resultado
- **Madurez: 38 (30–45, confianza media-alta)** (tope 59 por crítico; el formato principal no funciona).
- **Preparación comercial: 30. Veredicto: No listo.**
- Eje más débil: 2 (corrección) — 607/608 caen.
- Críticos abiertos: **FAC-CMP-01**.

### Pruebas ejecutadas
- `GET /compliance/reports/607?year=2026&month=11` (qa-do-fac, con 10 facturas emitidas) → **500**; stack (`logs/api.log` 08:48:14 y 08:50:10): `QueryFailedError: column "created_at" does not exist ← ComplianceService.tillFiscalSales ← generate607Report`. Repetido tras el 2.º reinicio → 500. `608` → 500 (misma consulta). La tabla `pos_sales` tiene `"createdAt"` (camelCase), `compliance.service.ts:432-437` usa `created_at`.
- `606` → 200 `606|130456781|202611|0`; `609` → 200 `609|130456781|202611|0`.
- UY (`qa-uy-a`) `GET reports/607` → 400 `compliance.report_format_dgii_dominican_republic_filing` (**correcto**: DO no se filtra a otro país).
- `POST /compliance/ncf-sequences` B01/B02/B04 1–500 → 201; prefijo distinto del tipo rechazado en código (`compliance.service.ts:216`), solape con cualquier rango previo rechazado, comprueba números ya emitidos.
- La ejecución del 607 por otros agentes en `api-run1` muestra el mismo 500 (08:48:14).

## 4. Ejes
| # | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 45 (38–52, media) | Generadores reales con datos de BD; registro de presentaciones (filings). Sin IT-1, IR-17, IR-2; sin envío (correcto: manual). | IT-1/IR-17; conciliación con e-CF. |
| 2 Corrección | 25 (18–32, alta) | 607/608 → 500 siempre. 606 cabecera conforme; 607 limita a 23 casillas (`record607` rechaza otro número). Activar un rango nuevo **desactiva el activo aunque le queden números** (`compliance.service.ts:283`) — decisión defendible, verificar con el equipo. | Arreglar SQL; prueba con BD real del 607 incluyendo POS. |
| 3 Multi-país | 45 (35–55, media) | Solo DO y MX; otros países reciben 400 explícito (bien). No hay libros/formatos de CO (exógena), PE (PLE), CL (libro de compras/ventas), AR (Libro IVA Digital), EC (ATS). | Formatos por país o declaración de no soportado en UI. |
| 4 Arquitectura | 45 (38–52, media) | Reportes como clases estáticas con SQL crudo mezclado con repos; `compliance` escribe/lee `invoices`, `pos_sales`, `customer_payments` de otros módulos. | Proyecciones de lectura por puerto. |
| 5 Higiene | 35 (28–42, media) | 52 violaciones de frontera listadas (`bnd.log`), entidades de `organizations` importadas; dueño de `ncf_sequences` mientras `invoices` las consume. | — |
| 6 Calidad | 50 (42–58, media) | 3 archivos con avisos de lint; SQL crudo con nombres de columna a mano (origen del crítico). | Query builder / pruebas de esquema. |
| 7 Robustez | 50 (40–58, baja) | Generación síncrona en la request, sin límite de filas (mes de un cliente grande en memoria). | Streaming/archivo diferido. |
| 8 Seguridad | 65 (55–72, media) | Permisos por operación; exportación auditada (`@AuditAccess`); parámetros SQL posicionales (sin interpolación). Aislamiento por `organization_id` en las consultas leídas. B→A no probado (los informes no toman id). | — |
| 9 Pruebas | 30 (22–38, alta) | `dr-reports.spec.ts` usa dobles y **no detectó** la columna inexistente; no hay prueba de integración del 607. | Integración contra `virteex_test`. |
| 10 Operabilidad | 50 (40–58, baja) | Filings con estado; auditoría de exportación. | — |
| 11 UX | 40 (30–50, baja) | Pantalla `fiscal-returns` no probada; con el 500 el usuario no obtiene el archivo. | — |
| 12 Competitividad | 30 (22–38, media) | Frente a Alegra RD: equivalente en 606/609 cuando funciona; sin IT-1. | — |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | Parcial | generadores reales. |
| 2 | **No cumple** | 607/608 500. |
| 3 | Cumple parcial | permisos; B→A N/A por diseño. |
| 4 | Cumple | `ParseIntPipe`, `assertPeriod`. |
| 5 | **No cumple** | 500 en el flujo principal. |
| 6 | **No cumple** | 607 inutilizable; demás países sin formatos (pero declarados con 400). |
| 7 | No cumple | spec con dobles. |
| 8 | Cumple | `@AuditAccess`. |
| 9–12 | Global/Parcial | — |

## 6. Hallazgos
- **⚠️ FAC-CMP-01** — compliance / eje 2 — bug — **Crítica** — `compliance/compliance.service.ts:432-437` (`tillFiscalSales`): `SELECT … to_char(created_at …) FROM pos_sales … ORDER BY created_at` sobre una tabla cuya columna es `"createdAt"`. Toda llamada a 607 y 608 de un tenant DO termina en 500. El 607 es la declaración mensual obligatoria de ventas. **Forma correcta:** `"createdAt"` (o renombrar columna con migración) + prueba de integración contra BD real. **Impacto:** bloquea la venta en DO. **Esfuerzo:** S.
- **FAC-CMP-02** — eje 9 — pruebas — **Alta** — `reports/dr-reports.spec.ts` prueba el formato con dobles; ninguna prueba ejecuta el SQL. M.
- **FAC-CMP-03** — eje 3 — multi-país — **Alta** — sin formatos fiscales de CO, PE, CL, AR, EC, etc.; correcto que respondan 400, pero la UI de "declaraciones" debe declararlo. M por país.
- **FAC-CMP-04** — eje 7 — robustez — **Media** — informes síncronos sin paginación/streaming. M.
- **FAC-CMP-05** — eje 2 — integridad — **Media** — registrar un rango nuevo desactiva el activo con números restantes (`compliance.service.ts:283`); sin confirmación ni rastro en API. Verificar con el equipo. S.

## 7. Camino mínimo a producción (DO)
1. FAC-CMP-01 (S). 2. Prueba de integración 606/607/608/609 con facturas + POS + NC + anulados (M). 3. Conciliación 607 ↔ e-CF aceptados (M). 4. IT-1 (L). Retocar.

## 8. Camino a 100
Crítico (+15, S) → integración (+8, M) → IT-1/IR-17 (+10, L) → formatos por país declarados (+15, XL) → streaming (+4, M).

## 9. Competitividad
Fuentes: DGII Norma 07-2018 (media, conocimiento previo); Alegra RD (media). Brecha básica: 607 inoperante; IT-1 ausente.

## 10. Fortalezas
Formato 607 alineado casilla a casilla con la norma; validación de RNC/NCF modificado antes de escribir; rechazo explícito fuera de DO; auditoría de exportación; validaciones fuertes de rangos NCF (solape, números ya emitidos, vencimiento en la zona del tenant).

## 11. No verificado
Contenido de un 607 con datos (por el 500); contabilidad electrónica MX con datos; UI.
