# Ficha — `units-of-measure`

Familia INV · 2026-11-07 · tenant `qa-do-inv`.

## 1. Identificación

- **Backend**: `apps/backend/api/src/app/units-of-measure/`, 228 líneas sin specs.
  - Archivos: `units-of-measure.service.ts` (85), `units-of-measure.controller.ts` (44), entidades `unit-of-measure.entity.ts` (16; catálogo global) y `tenant-unit-of-measure.entity.ts` (31).
- **Endpoints**:
  - `GET /units-of-measure` (`units_of_measure:view`);
  - `POST /units-of-measure/company` y `DELETE /units-of-measure/company/:id` (`units_of_measure:manage`);
  - `POST /units-of-measure` (`units_of_measure:manage` + permiso de plataforma `REFERENCE_DATA_MANAGE`).
- **Tablas**: `unit_of_measure` (global), `tenant_units_of_measure` (`UQ (organization_id, symbol)`).
- **Frontend**: ruta `inventory/units-of-measure` (`inventario.manifest.ts`).
- **Pruebas**: `units-of-measure.service.spec.ts` (58 líneas, OK).
- **¿Núcleo?** Sí, como dato maestro de productos.

## 2. Estándar de referencia (confianza media, sin verificación web)

- **Básicas**:
  - catálogo de unidades por categoría (unidad, peso, volumen, longitud);
  - **conversiones** dentro de la categoría y por producto (caja de 12 = 12 unidades);
  - unidad de compra ≠ unidad de venta ≠ unidad de inventario;
  - precisión decimal por unidad;
  - códigos oficiales cuando la factura electrónica los exige (en MX, la ClaveUnidad del SAT; en CO, códigos UN/ECE en la FE DIAN; verificar con contador local).
- **Líderes**: Odoo (categorías con factor y redondeo, UdM de compra y venta por producto; confianza alta); NetSuite (Unit Types con conversiones; confianza alta); SAP B1 (UoM groups; confianza alta).
- **Invariantes**:
  - toda cantidad se almacena en la unidad base;
  - una conversión no pierde precisión;
  - una unidad en uso no se borra.

## 3. Resultado

- **Madurez: 28 (20–35, confianza alta)**: es solo un catálogo de símbolos, sin conversiones.
- **Preparación comercial: 25. Veredicto: No listo** (incumple la compuerta 1: falta la capacidad básica de conversión).
- **Eje más débil**: 1 (completitud). Sin hallazgos críticos.

## 4. Ejes

| # | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 25 (20–32, alta) | Las entidades solo tienen `symbol`, `category`, `nameKey`/`name`; **no hay factor ni conversión** (grep `conversion\|factor\|purchaseUnit\|salesUnit` en `src/app` → 0). `products.unit_of_measure` es un string libre. En BOM, `unitOfMeasureId` es opcional y no se usa. `GET` devolvió UND, PAR, DOC, CJ, PAQ… sin factores. | Factores, UdM de compra y venta por producto, conversión en documentos. |
| 2 | 45 (35–55, media) | La unicidad de símbolo por tenant y contra el global es correcta. El borrado se bloquea si la unidad está en uso, pero por consulta SQL (`products.unit_of_measure = symbol`) y sin FK: puede quedar huérfano si se renombra. Las cantidades admiten 6 decimales en inventario y POS (`maxDecimalPlaces: 6`); la transferencia de 2,5 funcionó. | FK o id en lugar del símbolo; precisión por unidad. |
| 3 | 30 (20–40, media) | No hay mapeo a los códigos oficiales (SAT ClaveUnidad, DIAN/UN-ECE, SUNAT) que la facturación electrónica exige. | Tabla de equivalencias por país y vigencia. |
| 4 | 55 (45–62, media) | Servicio pequeño y claro. Catálogo global separado del de tenant. `POST /units-of-measure` tiene doble permiso (tenant + plataforma). El DTO del global no valida longitud ni formato (`create-unit-of-measure.dto.ts`: solo `IsString`/`IsNotEmpty`). | Validación del DTO global. |
| 5 | 70 (60–78, media) | Sin violaciones de frontera reportadas para uom. Usa SQL crudo parametrizado sobre `products` (lectura de una tabla ajena). | Contrato de lectura del catálogo de productos. |
| 6 | 75 (65–80, media) | 0 avisos de lint. | — |
| 7 | 65 (55–72, baja) | `findAll` sin paginación, aceptable por volumen. | — |
| 8 | 77 (68–84, media) | Member: POST /units-of-measure/company → 403 (ejecutado). `findAll` y `remove` filtran por `organizationId`. No ejecuté IDOR sobre `DELETE company/:id` ajeno (sin unidades propias de otros tenants); según el código, `findOne({id, organizationId})` → 404. | Prueba real cruzada. |
| 9 | 40 (30–50, alta) | Una sola spec de 58 líneas con mocks. | Pruebas de conversión y de borrado en uso. |
| 10 | 45 (35–55, baja) | Sin auditoría de negocio específica. | — |
| 11 | 55 (45–62, baja) | La pantalla existe en el menú; no la recorrí a fondo (no cargó dentro del área de inventario en la captura). | — |
| 12 | 20 (15–28, media) | Por debajo de Odoo, NetSuite, SAP B1, Alegra y Siigo, que tienen conversiones. | — |

## 5. Compuertas

| Compuerta | Estado |
|---|---|
| 1 | No cumple (no hay conversiones). |
| 2 | Parcial (sin FK). |
| 3 | Cumple (member → 403 al crear unidad; IDOR por código). |
| 4 | Parcial (DTO global débil). |
| 5 | Cumple (GET 200). |
| 6 | No cumple: no hay códigos oficiales para la FE de MX, CO y PE. |
| 7 | Mínimo. |
| 8 | No hay auditoría. |
| 9 | Cumple. |
| 10 | Cumple. |
| 11 | No verificado a fondo. |
| 12 | No hay documentación. |

## 6. Hallazgos

- **INV-14** — units-of-measure · eje 1 · **Categoría**: funcionalidad faltante · **Severidad: alta**
  - **Ubicación**: `units-of-measure/entities/*.ts`, `inventory/entities/product.entity.ts` (`unitOfMeasure` string).
  - **Qué está mal**: no existen conversiones ni unidades alternativas. No se puede comprar por caja y vender por unidad, y el BOM no puede consumir en gramos lo que se compra en kilos.
  - **Forma correcta**: categorías con unidad base y factor; UdM de compra y venta por producto; conversión en la línea de documento.
  - **Impacto**: bloquea la venta a distribución y manufactura.
  - **Esfuerzo**: M.
- **INV-15** — units-of-measure · eje 3 · **Severidad: media**
  - **Qué está mal**: no hay mapeo a los catálogos oficiales de unidad para la factura electrónica (MX ClaveUnidad, CO, PE). Verificar con la familia FAC cómo resuelve hoy la FE la unidad.
  - **Esfuerzo**: M.
- **INV-16** — units-of-measure · eje 2 · **Severidad: baja**
  - **Qué está mal**: el producto referencia la unidad por símbolo y sin FK.
  - **Esfuerzo**: S.

## 7. Camino mínimo

INV-14 (M) → INV-15 (M) → INV-16 (S). Rehacer el modelo es pequeño.

## 8. Camino a 100

- Conversiones: +35.
- Códigos oficiales: +15.
- UdM por producto y documento: +10.
- Pruebas: +5.

## 9. Competitividad

Brecha básica frente a todos los líderes. No tiene diferenciadores.

## 10. Fortalezas

- Separación entre catálogo global y catálogo por tenant.
- Bloqueo del borrado de unidades en uso.

## 11. No verificado

- UI a fondo.
- IDOR real.
- Uso de la unidad en la factura electrónica (familia FAC).
