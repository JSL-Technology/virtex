# Importación / exportación (T15) — data-transfer, importadores por módulo, data-imports/exports, core/export

> Sin hallazgos CRÍTICOS de seguridad abiertos.

## 1. Identificación
- Backend: `data-transfer/` (6 archivos, 999 LOC, 2 specs; 6 endpoints: `GET datasets`, `GET runs`, `GET datasets/:dataset/template`, `POST exports`, `POST imports`, `POST datasets/:dataset/column-mapping`), tabla `data_transfer_runs`. 10 datasets registrados por proveedores de dominio (`*-data-transfer.provider.ts`: chart_of_accounts, customers, invoices, journal_entry_lines, opening_balances, pos_sales, products, sales_lines, suppliers, vendor_bills).
- Frontend: `features/data-imports` (414 LOC), `features/data-exports` (235 LOC), `core/export/` (csv-export, dataset-export, statement-export). Rutas `workspace.manifest.ts:288,299`.
- Países: N/A (formato), aunque las plantillas traen ejemplos DO. Núcleo: sí (migración de clientes desde otro ERP).

## 2. Estándar de referencia
(a) Plantillas por entidad, mapeo de columnas, validación previa con informe por fila/columna, modo simulación, importación todo-o-nada o por lotes con reintento, límites de tamaño, historial; exportación CSV/XLSX con permisos y neutralización de fórmulas. Avanzado: upsert por clave externa, importaciones programadas, API masiva, plantillas de migración desde QuickBooks/Siigo/Alegra.
(b) Invariantes: no importar a medias sin decirlo; mismo validador que la creación manual; aislamiento por tenant; formula injection neutralizada.
(c) Odoo (import con test/dry-run y mapeo), NetSuite CSV Import Assistant (mapeo guardado, modos add/update), Zoho. Confianza media.

## 3. Resultado
Madurez **57** (50–63, media) · Preparación **52 — No listo** (compuerta crítica 2 incumplida para datasets contables) · Eje más débil: Integridad (8 de 9 importadores confirman fila a fila) · Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 Autenticidad | 62 (55–68, media) | 10 datasets reales; plantilla servida (200, CSV con BOM). | Upsert/actualización; datasets de inventario de existencias, empleados, proveedores con saldos (no verificado). |
| 2 Corrección | 52 (45–60, media) | Validación previa de todo el archivo: probado con CSV de 2 filas → `FAILED`, `importedRows 0`, problemas por fila/columna incl. `duplicate_in_file` (ver §11). | Sólo `opening-balances` implementa `createAll` (todo-o-nada, `data-transfer.service.ts:397-418`); los otros 8 proveedores (grep `createAll` en `*data-transfer.provider.ts`) usan `create` por fila: un rechazo de dominio en la fila N tras validar deja N-1 filas importadas. Las propias filas de ejemplo de la plantilla de clientes fueron rechazadas (`tipo_contribuyente` is_enum, `dias_credito` is_int) — ver IMP-02. |
| 3 Multi-país | N/A | — | Ejemplos de plantilla con RNC DO también en tenant CO (observado). |
| 4 Arquitectura | 68 | Registro de datasets: cada dominio aporta su importador/exportador; el servicio central no conoce dominios. | — |
| 5 Higiene | 65 | Fronteras limpias vía registro. | — |
| 6 Calidad | 65 | Código claro; límites como constantes. | — |
| 7 Robustez | 58 | Límites: 5 MB (`data-transfer.controller.ts`), 5 000 filas import, 100 000 export (`data-transfer.service.ts:46-48`), throttle 20/min. | Proceso síncrono en la request (100k filas en memoria); sin cola. |
| 8 Seguridad | 70 (60–75, media) | `@AuthenticatedOnly` con permiso por dataset comprobado en servicio (vista para exportar, creación para importar); neutralización `= + - @ \t \r` con apóstrofo (`data-transfer.service.ts:71,607`). | No se pudo verificar la neutralización en salida (el import de prueba fue rechazado). Permiso en servicio en vez de guard: frágil ante olvidos. |
| 9 Pruebas | 58 | `data-transfer.spec.ts` 301 LOC, `column-mapping.spec.ts`. | Prueba de fallo a mitad de importación por fila. |
| 10 Operabilidad | 62 | `data_transfer_runs` con historial y problemas (≤200). | — |
| 11 UX | 50 (baja) | Pantallas existen; no ejecutadas. | — |
| 12 Competitividad | 52 | Paridad básica con Odoo/Zoho. | Upsert, mapeo guardado, programadas, migradores desde ERPs locales. |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | Cumple | Datasets reales. |
| 2 | **No cumple (parcial)** | Importación por fila en 8/9 datasets (IMP-01). |
| 3 | Cumple (estático) | Permiso por dataset; organizationId del usuario. IDOR no aplica (sin ids de terceros salvo runs). |
| 4 | Cumple | Validación previa por DTO de dominio (probado). |
| 5 | No verificado | — |
| 6 | N/A | — |
| 7 | Parcial | — |
| 8 | Cumple | Runs registrados. |
| 9-10 | Cumple / parcial | — |
| 11 | No verificado | — |
| 12 | Parcial | — |

## 6. Hallazgos
- **IMP-01** · data-transfer + 8 proveedores · Eje 2 · Integridad · **Alta** · `data-transfer.service.ts:397-420` (rama `createAll` vs `create`) · Sólo saldos de apertura importan en una transacción; clientes, productos, facturas, asientos, proveedores, facturas de proveedor, POS confirman fila a fila: un fallo de dominio posterior a la validación (unicidad concurrente, regla fiscal) deja una importación parcial (estado reportado por el run, pero sin rollback). En asientos/facturas esto puede dejar libros a medias. · `createAll` transaccional obligatorio para datasets contables; opción explícita "parcial" sólo para maestros. · Riesgo operativo · M.
- **IMP-02** · customers provider · Eje 2/11 · Bug · **Media** (confianza baja) · `GET /data-transfer/datasets/customers/template` · La plantilla de ejemplo usa `LEGAL_ENTITY` y `30`; un CSV con esos mismos valores fue rechazado por `is_enum`/`is_int`. Posible falta de transformación de tipos o valor enum distinto. Verificar con el equipo. · Coherencia plantilla ↔ DTO + prueba que importe la plantilla tal cual. · Fricción de migración · S.
- **IMP-03** · data-transfer · Eje 7 · Robustez · **Media** · `data-transfer.service.ts:123` · Export de hasta 100 000 filas e import de 5 000 síncronos en la request. · Job en cola con descarga diferida. · M.
- **IMP-04** · data-transfer · Eje 8 · Seguridad · **Baja** · `data-transfer.controller.ts:41-110` · Endpoints `@AuthenticatedOnly`; la autorización real vive en el servicio. Correcto hoy, frágil. · Guard por dataset. · S.

## 7. Camino mínimo
IMP-01 (M) → IMP-02 (S) → prueba E2E import/export con verificación de neutralización (S).
## 8. Camino a 100
Transaccionalidad (+8, M) · upsert por clave externa (+6, M) · jobs asíncronos (+5, M) · mapeos guardados y migradores desde QuickBooks/Alegra/Siigo (+6, L) · API masiva (+4, M).
## 9. Competitividad
Básico cubierto (plantillas, validación previa, historial). Faltan upsert, dry-run explícito, programadas. Nota 52 (45–60, media).
## 10. Fortalezas
Validación previa de todo el archivo con informe por fila/columna y duplicados; registro desacoplado; neutralización de fórmulas en servidor; límites explícitos.
## 11. No verificado
Pasos: `POST /data-transfer/imports?dataset=customers` (multipart, archivo `QA-F10.csv`, 2 filas con mismo NIT) → 200 `{"status":"FAILED","totalRows":2,"importedRows":0,"failedRows":2, problems:[is_enum, is_int, duplicate_in_file]}`. No se logró una importación exitosa para verificar neutralización en exportación ni el caso de fallo a mitad. Frontend no ejecutado. Cobertura ~40 % backend, 3 endpoints.

<!-- RESUMEN: modulo=importacion-exportacion; madurez=57; prep=52; veredicto=No listo; eje_debil=Corrección e integridad; criticos=0; altos=1; camino_min=M -->
