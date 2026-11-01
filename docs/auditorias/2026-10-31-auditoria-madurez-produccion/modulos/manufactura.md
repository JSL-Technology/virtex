# M22 — Manufactura (`manufacturing`) · Familia F7

> Sin hallazgos críticos de seguridad. Hay un hallazgo **alto** de aislamiento: el módulo acepta referencias a registros de otro tenant (MFG-02, reproducido).

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/manufacturing/`: 15 archivos, ~720 LOC, 2 specs (`manufacturing.service.spec.ts`, `production-order-lifecycle.spec.ts`).
  - Endpoints: CRUD de `orders`, `bills-of-materials` y `work-centers` (`manufacturing.controller.ts:38-177`).
  - Tablas: `production_orders`, `bill_of_materials`, `bill_of_material_items`, `work_centers`.
- **Frontend:** `features/manufacturing` tiene 2 archivos, un tablero "coming soon" (`features/manufacturing/pages/dashboard.component.ts:8`). No está enrutado en `inventario.manifest.ts`.
- **Países:** N/A.
- **Dependencias:** ninguna real. No importa inventario ni contabilidad.
- **¿Núcleo para vender?** No para el ICP comercial y de servicios; sí para PYME manufacturera.

## 2. Estándar de referencia
- **Capacidades básicas:**
  - lista de materiales (BOM) multinivel con versiones y UdM;
  - orden de producción con su ciclo: liberar → consumir componentes (descarga de inventario) → declarar producto terminado (entrada valorizada) → cerrar con varianzas;
  - costo = materiales + mano de obra + carga fabril (centros de trabajo × tarifa);
  - asientos de WIP y de producto terminado.
- **Capacidades avanzadas:** MRP (explosión de necesidades), rutas y operaciones, capacidad finita, subcontratación, mermas y subproductos, trazabilidad de lote.
- **Invariantes:**
  - una orden completada genera la salida de componentes y la entrada de terminado en el kardex;
  - Σ valor consumido + conversión = valor del terminado ± varianza contabilizada;
  - nada referencia registros de otra empresa.
- **Líderes** (confianza media, documentación pública): Odoo MRP (BOM, órdenes, centros de trabajo, consumo automático y valoración), Dynamics BC Manufacturing (production BOM, routings, consumo y salida en el journal), SAP B1 Production (issue for production / receipt from production) y Fishbowl Manufacturing.

## 3. Resultado
**Madurez: 15** (10–22, confianza alta).
**Preparación: 12 → NO LISTO.**
- **Eje más débil:** 1, Autenticidad.
- **Críticos:** 0, porque no hay UI enrutada que lo presente como real. Si se expusiera sin cambios, MFG-01 sería crítico.
- **Altos:** 3.

## 4. Doce ejes
| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad y completitud | **12** (8–18, alta) | CRUD aislado. **Reproducido:** `PATCH /manufacturing/orders/:id {"status":"COMPLETED","quantityProduced":5}` → 200, y el producto sigue con el mismo stock y 8 movimientos (sin consumo ni entrada). No hay MRP, rutas ni costeo. | Todo el ciclo de producción. |
| 2 | Corrección e integridad | **20** (12–28, alta) | Se puede saltar a cualquier estado sin máquina de estados (`manufacturing.service.ts:80-89`, `merge(order, dto)`). Solo el borrado está protegido (`:99-105`). Referencias entre tenants aceptadas (MFG-02). | Máquina de estados y validación de referencias. |
| 3 | Multi-país | N/A | — | — |
| 4 | Arquitectura | **25** (18–32, media) | Servicio CRUD genérico sobre repositorios, sin dominio y sin puertos hacia inventario. | Integrarlo vía `StockLedgerService` y `AccountingPostingPort`. |
| 5 | Higiene y fronteras | **60** (50–68, media) | Está aislado, pero porque no hace nada. Fácil de extraer. | — |
| 6 | Calidad de código | **55** (45–62, media) | Código limpio y poco. | — |
| 7 | Robustez | **40** (30–50, baja) | No revisé si los listados están paginados. | — |
| 8 | Seguridad y aislamiento | **45** (38–55, alta) | Lectura y escritura filtradas por `organizationId`, pero acepta `productId`, `componentProductId` y `billOfMaterialId` de otro tenant (MFG-02). | Validar cada FK contra el tenant. |
| 9 | Pruebas | **30** (20–40, media) | 2 specs unitarias de ciclo de vida y borrado; nada de inventario porque no existe. | — |
| 10 | Operabilidad | **25** | Sin logs de negocio. | — |
| 11 | UX | **10** (N/A parcial) | Tablero "coming soon" sin ruta. | — |
| 12 | Competitividad | **8** | Muy lejos de Odoo MRP o BC. | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, con capacidades básicas | **No cumple** | MFG-01. |
| 2 | Integridad | **No cumple** | Sin máquina de estados; completar no mueve nada. |
| 3 | Aislamiento | **No cumple** | MFG-02. |
| 4 | Validación en servidor | Parcial | DTOs, pero sin validar FKs del tenant. |
| 5 | Flujos E2E | N/A | Sin UI. |
| 6 | Cumplimiento por país | N/A | — |
| 7 | Pruebas en CI | No cumple | — |
| 8 | Auditoría de negocio | No cumple | — |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | No cumple | — |
| 11 | UI | N/A | — |
| 12 | Documentación | No cumple | — |

## 6. Hallazgos
- **MFG-01 · Eje 1 · Funcionalidad sin efecto · ALTA** (sería CRÍTICA si se expusiera en la UI)
  - **Ubicación:** `manufacturing.service.ts:72-89`.
  - **Qué está mal:** crear o completar una orden no consume componentes, no da entrada al terminado y no genera asiento. Búsqueda de `ledger|StockLedger|journal|posting|consume` en `manufacturing/` = 0. Reproducido: una orden COMPLETED con 5 producidas deja el kardex intacto.
  - **Forma correcta:** acciones de dominio `release`, `issueMaterials`, `reportOutput` y `close`, apoyadas en `StockLedgerService.move` (tipos de movimiento de producción) y `InventoryPostingService` (WIP y terminado), con varianzas.
  - **Esfuerzo:** XL.
- **MFG-02 · Eje 8 · Seguridad / integridad · ALTA**
  - **Ubicación:** `manufacturing.service.ts:72-77` (`createOrder`) y `:136-147` (`createBom`).
  - **Qué está mal:** se guardan IDs de producto y BOM de otro tenant sin comprobar que pertenecen al tenant. **Reproducido** con la sesión de qa-us: una BOM con `componentProductId` de un producto de qa-b → 201, y una orden con `productId` de qa-b → 201. No lee datos de la víctima, pero crea vínculos entre tenants. Las RLS no protegen porque la API se conecta como superusuario (ENTORNO).
  - **Forma correcta:** validar cada FK con `organizationId`, o usar FKs compuestas `(organization_id, id)`.
  - **Esfuerzo:** S.
- **MFG-03 · Eje 2 · Integridad · ALTA**
  - **Ubicación:** `updateOrder`, `manufacturing.service.ts:80-89`.
  - **Qué está mal:** el DTO permite fijar cualquier `status` y `quantityProduced` (`dto/create-production-order.dto.ts:43-45`). No hay transiciones ni coherencia (por ejemplo, producido > planificado o COMPLETED sin producción).
  - **Esfuerzo:** M.
- **MFG-04 · Eje 1 · Media** — `work_centers` tiene `hourlyRate` y `capacityPerHour`, pero nada los usa: no hay rutas ni costo de conversión.
- **MFG-05 · Eje 1 · Media** — Los ítems de la BOM tienen `unitOfMeasureId`, pero la UdM no tiene conversiones (ver UOM-01).

## 7. Camino mínimo a producción
1. MFG-02 (S).
2. Máquina de estados (M).
3. Consumo y entrada vía el libro de existencias, con asiento de WIP y terminado (XL).
4. UI enrutada (L).

Hay que rehacer el dominio; las tablas se pueden conservar. Mientras tanto, mantenerlo oculto y declararlo "no disponible" comercialmente.

## 8. Camino a 100
| Ítem | Puntos que sube | Esfuerzo |
|---|---|---|
| Ciclo de producción con kardex y asientos | eje 1 +40, eje 2 +40 | XL |
| Validación de FKs | eje 8 +35 | S |
| Costeo con varianzas | +15 | L |
| MRP | eje 12 +20 | XL |
| Rutas y capacidad | +10 | L |
| UI | eje 11 +50 | L |

## 9. Competitividad
- Odoo MRP, BC, SAP B1 y Fishbowl cubren todo el ciclo; aquí solo existen los datos maestros.
- No hay diferenciadores. **Nota: 8** (5–12, alta).

## 10. Fortalezas a preservar
- Una orden ya iniciada no se borra (`manufacturing.service.ts:99-105`).
- Los ítems de la BOM llevan `organizationId`.

## 11. No verificado
- Paginación de los listados.
- Actualización de BOM con ítems ajenos.
- Specs ejecutadas: no las corrí por separado; la suite global pasó (`logs/api-test-db.log`).

**Cobertura:** ~70 % del backend leído; 5 de 15 endpoints ejecutados.

<!-- RESUMEN: modulo=manufactura; madurez=15; prep=12; veredicto=No listo; eje_debil=1-Autenticidad; criticos=1; altos=2; camino_min=XL -->


## Ajuste de calibración del coordinador (Paso 9)

**MFG-02 se eleva a crítica** (escritura entre tenants: BOM y órdenes aceptan productos de otro tenant), por la regla de severidad de la rúbrica y por ser el patrón sistémico MT-03 (ver `multitenencia-y-organizaciones.md`). Notas sin cambio (ya ≤59/≤69).
