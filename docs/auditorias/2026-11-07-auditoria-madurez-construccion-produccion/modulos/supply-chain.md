# supply-chain: almacenes, ubicaciones y "costos de importación" (familia CMP)

## 1. Identificación
- **Qué es**: el nombre engaña. No hay planificación, MRP ni logística. Es un CRUD de datos maestros publicado bajo `/wms`.
- **Backend**: `apps/backend/api/src/app/supply-chain/` (885 líneas).
  - Rutas: `wms/warehouses`, `wms/bin-locations` y `wms/landed-costs`, con CRUD completo.
  - Entidades propias: `Warehouse`, `BinLocation`, `LandedCost`.
  - Entidades de inventario declaradas aquí: `StockLevel`, `StockMovement`, `Location`.
- **Pantallas**:
  - Almacenes: sí, en `features/masters/warehouses/warehouses.page.ts` (vía `features/masters/data/warehouses.service.ts`).
  - Ubicaciones y costos de importación: sin pantalla. Busqué `wms/bin-locations|wms/landed-costs` en `apps/core/client-web/src` y no aparece fuera de specs.
- **Pruebas**: `warehouse-lifecycle.spec.ts` (verde).
- **¿Es núcleo?** Los almacenes sí. El landed cost es una capacidad básica de compras de importación.

## 2. Estándar de referencia
- **Capacidades básicas**:
  - almacenes con reglas: un almacén por defecto, no cerrar uno con stock;
  - ubicaciones;
  - costo de importación (flete, seguro, aranceles) prorrateado a la recepción por valor, peso, volumen o cantidad, que revalorice el kárdex y genere asiento.
- **Referencia**: SAP (planned delivery costs), D365 (landed cost module), Odoo (`stock_landed_costs`), NetSuite (landed cost per item). Confianza media, conocimiento general.
- **Invariante**: un costo de importación aplicado debe cambiar el costo unitario en el kárdex y cuadrar con el mayor.

## 3. Resultado
- **Madurez**: 28 (20–36, confianza media).
- **Preparación**: 28, **No listo** en cuanto a landed cost. Almacenes: utilizable.
- **Eje más débil**: 1 (fachada de landed cost).
- **Críticos**: 0. CMP-21 se clasifica como alta y no como crítica: no hay pantalla que lo presente como real.

## 4. Ejes
| # | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 Autenticidad | 25 (18–32, media) | `landed_costs` (name, allocationMethod VALUE/WEIGHT/VOLUME/QUANTITY, gl_account_id) solo aparece en este módulo y en migraciones (grep en `apps/backend/api/src/app`). Ninguna recepción, factura ni kárdex lo usa. El método de prorrateo nunca se aplica. | Aplicar el costo a las recepciones. |
| 2 Corrección | 50 (40–58, baja) | Almacenes: no se puede cerrar ni borrar el almacén por defecto, ni cerrar uno con stock (`supply-chain.service.ts:73-112`). No lo probé en vivo. | Pruebas en vivo. |
| 3 Multi-país | N/A | Sin reglas por país. | — |
| 4 Arquitectura | 40 (32–48, media) | El módulo declara `StockLevel`, `StockMovement` y `Location`, que son de inventario (una tabla, un dueño). La ruta `/wms` no coincide con el nombre del módulo. | Mover estas entidades a inventario/WMS. |
| 5 Higiene | 35 (28–42, media) | Nombre engañoso ("supply-chain") y mezcla con el dominio de inventario. | Renombrar o fusionar. |
| 6 Calidad | 60 (50–68, baja) | Servicio pequeño. | — |
| 7 Robustez | 50 (40–58, baja) | Listados sin paginar (bajo volumen). | — |
| 8 Seguridad | 64 (55–70, media) | Permisos `WMS_VIEW` y `WMS_MANAGE`. En vivo: qa-do-b sobre el almacén de qa-do-cmp → 404; qa-do-a-member → 403 en GET /wms/warehouses, GET /wms/landed-costs y POST /wms/landed-costs. `assertTenantOwns` sobre la cuenta contable. | — |
| 9 Pruebas | 30 (22–40, media) | Una sola spec, sobre el ciclo de vida del almacén. | — |
| 10 Operabilidad | 40 (30–50, baja) | Sin auditoría. | — |
| 11 UX | 30 (20–40, baja) | Ubicaciones y landed cost no tienen pantalla. | — |
| 12 Competitividad | 20 (12–30, media) | Odoo, D365 y SAP aplican landed cost de verdad. | — |

## 5. Compuertas
| 1 Sin fachadas | 2 Integridad | 3 Aislamiento | 5 Humo | 7 Pruebas | 8 Auditoría |
|---|---|---|---|---|---|
| **No cumple** (landed cost) | N/A | Cumple (probado en vivo) | No ejecutado | Parcial | No cumple |

Las demás compuertas: N/A o igual que en el resto de la familia.

## 6. Hallazgos
**CMP-21** · eje 1 · Funcionalidad falsa · **Alta**
- **Ubicación**: `supply-chain/entities/landed-cost.entity.ts` y `wms/landed-costs`.
- **Qué está mal**: el "costo de importación" se reduce a un catálogo con método de prorrateo que nunca se aplica. Ninguna recepción ni factura de flete o aduana revaloriza el inventario. Un importador no puede costear su mercancía.
- **Forma correcta**: un documento de costo de importación ligado a recepciones o facturas, que prorratee según el método, ajuste el kárdex y el asiento (Inventario contra GRNI o la cuenta configurada) y conste en verify:purchasing.
- **Esfuerzo**: L.

**CMP-22** · ejes 4 y 5 · Mezcla de contexto · Media
- **Qué está mal**: entidades de stock declaradas en supply-chain, y nombre de módulo distinto de su ruta.
- **Forma correcta**: consolidar almacenes y ubicaciones en inventario/WMS.
- **Esfuerzo**: M.

**CMP-23** · eje 11 · UX · Baja
- **Qué está mal**: las ubicaciones existen en el backend pero no tienen pantalla.
- **Esfuerzo**: S.

## 7. Camino mínimo
1. Ocultar o declarar como "no disponible" el landed cost (S).
2. Implementarlo de verdad (L).
3. Reubicar las entidades (M).

## 8. Camino a 100
| Mejora | Puntos estimados | Esfuerzo |
|---|---|---|
| Landed cost real | +35 | L |
| Pantallas de ubicaciones | +8 | S |
| Consolidar en WMS | +6 | M |
| Pruebas | +6 | S |

## 9. Competitividad
Sin landed cost no se puede vender a importadores. Es básico en Odoo, D365 y SAP. Confianza media.

## 10. Fortalezas
Las reglas del almacén por defecto y del cierre con stock.

## 11. No verificado
- CRUD de ubicaciones y landed costs: no ejecutado en vivo, solo leído en el código. El aislamiento y la authZ sí se probaron (eje 8).
- La UI de almacenes.
