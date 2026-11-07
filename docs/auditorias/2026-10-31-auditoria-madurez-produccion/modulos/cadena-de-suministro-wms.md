# M21 — Cadena de suministro / WMS (`supply-chain`) · Familia F7

> Sin críticos de seguridad. Hay un hallazgo **alto**: un esquema de landed cost acepta una cuenta contable de otro tenant (SCM-02, reproducido).

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/supply-chain/`: 16 archivos, ~822 LOC, 1 spec (`warehouse-lifecycle.spec.ts`).
  - Endpoints: `/wms/warehouses`, `/wms/bin-locations` y `/wms/landed-costs` (CRUD, `supply-chain.controller.ts:34-138`).
  - Tablas: `warehouses`, `bin_locations`, `landed_costs`, `locations`. Además alberga las entidades `stock_movements` y `stock_levels` que escribe inventario.
- **Frontend:** el maestro de almacenes está enrutado (`inventario.manifest.ts:176`). `features/wms` es un tablero "coming soon" (`features/wms/pages/dashboard.component.ts:8`) sin ruta.
- **Quién lo usa:**
  - **almacenes:** sí; todo el libro de existencias, las ventas y las compras resuelven almacén (`inventory/stock-ledger.service.ts:189-254`);
  - **bins y landed costs:** nadie. La búsqueda de `BinLocation|LandedCost|bin_locations|landed_costs` fuera de `supply-chain/` da 0 resultados (sin contar migraciones).
- **Países:** N/A.

## 2. Estándar de referencia
- **Capacidades básicas:**
  - almacenes con sucursal y almacén por defecto;
  - ubicaciones o bins con existencias por bin;
  - putaway y picking por ubicación;
  - landed cost: prorrateo de flete, aranceles y seguros sobre las recepciones (por valor, cantidad o peso) que capitaliza el costo y genera asiento.
- **Capacidades avanzadas:** olas de picking, RF y escáner, cross-docking, slotting, conteo cíclico por bin.
- **Invariantes:**
  - Σ existencias por bin = existencias del almacén;
  - un landed cost aplicado sube el costo de las capas recibidas y el saldo de inventario por el mismo importe.
- **Líderes** (confianza media): Odoo (ubicaciones jerárquicas, rutas, landed costs que revalorizan capas), Dynamics BC (bins, directed put-away, item charges), NetSuite WMS, SAP B1 (bin locations, Landed Costs document), Cin7 y Fishbowl.

## 3. Resultado
**Madurez: 30** (24–38, confianza alta).
**Preparación: 28 → NO LISTO.**
- Los almacenes son reales y funcionan (cerca de 65 si se miran solos). Bins y landed costs son esqueleto: tablas con CRUD y sin ningún efecto.
- **Eje más débil:** 1. **Críticos:** 0. **Altos:** 3.

## 4. Doce ejes
| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad | **25** (18–32, alta) | Almacenes: CRUD real con almacén por defecto único (índice y savepoint en `stock-ledger.service.ts:215-253`), sucursal e inactivación. Bins: solo datos maestros; `stock_levels` no tiene bin. Landed cost: "esquema" con `allocationMethod` y `glAccountId`, sin documento de aplicación, prorrateo ni asiento (`supply-chain.service.ts:185-224`). | Existencias por bin y aplicación real del landed cost. |
| 2 | Integridad | **45** (38–55, media) | Almacenes: borrado protegido (`:128-137`) y validación de propiedad del bin (`:160,171`). Landed cost acepta una cuenta de otro tenant (SCM-02). | Validar las FKs. |
| 3 | Multi-país | N/A | — | — |
| 4 | Arquitectura | **40** | Las entidades del libro de existencias viven aquí, pero el dueño es inventario (un dueño por dato, invertido). | Mover `StockMovement` y `StockLevel` a inventory. |
| 5 | Higiene y fronteras | **40** (32–48, media) | Inventario importa `supply-chain/entities/*` (`stock-ledger.service.ts:4-6`). | — |
| 6 | Calidad | **60** | Código simple y claro. | — |
| 7 | Robustez | **55** | No revisé la paginación de bins. | — |
| 8 | Seguridad | **55** (45–62, media) | Lectura de almacén ajeno → 404 (probado con qa-b). Una cuenta de mayor ajena se acepta en landed cost (SCM-02). | Validar las FKs. |
| 9 | Pruebas | **35** | 1 spec del ciclo de vida del almacén. | — |
| 10 | Operabilidad | **35** | — | — |
| 11 | UX | **40** (baja) | Almacenes con UI; WMS es "coming soon" sin ruta. | — |
| 12 | Competitividad | **15** | Sin WMS real. | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | **No cumple** | Landed cost y bins sin efecto. |
| 2 | Integridad | Parcial | — |
| 3 | Aislamiento | **No cumple** | SCM-02. |
| 4 | Validación en servidor | Parcial | — |
| 5 | Flujos E2E | Cumple para almacenes | — |
| 6 | Cumplimiento por país | N/A | — |
| 7 | Pruebas en CI | No cumple | — |
| 8 | Auditoría | No cumple | — |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | — |
| 11 | UI | Parcial | — |
| 12 | Documentación | No cumple | — |

## 6. Hallazgos
- **SCM-01 · Eje 1 · Funcionalidad sin efecto · ALTA**
  - **Qué está mal:** landed costs. Se pueden crear "esquemas" (`POST /wms/landed-costs`), pero nada los aplica a recepciones ni a facturas de proveedor y no ajustan el costo promedio ni la cuenta Inventarios (búsqueda de uso fuera del módulo = 0). Un importador de LatAm (aranceles y flete) no puede capitalizar costos, así que el margen sale inflado. Hoy no se muestra en la UI (WMS "coming soon").
  - **Forma correcta:** un documento de landed cost vinculado a recepciones, prorrateado según `allocationMethod`, aplicado con `InventoryPostingService` como revaluación (`ledger.recordRevaluation`) y con asiento contra `glAccountId`.
  - **Esfuerzo:** L.
- **SCM-02 · Eje 8 · Seguridad / integridad · ALTA**
  - **Ubicación:** `supply-chain.service.ts:204-207`.
  - **Qué está mal:** `createLandedCost` guarda `glAccountId` sin validar el tenant. **Reproducido:** desde qa-us, con un id de cuenta de qa-b → 201 y la cuenta ajena queda guardada.
  - **Forma correcta:** validar contra el plan de cuentas del tenant.
  - **Esfuerzo:** S.
- **SCM-03 · Eje 1 · ALTA** — Bins sin existencias: `bin_locations` (zone/aisle/rack/shelf) no se vincula con `stock_levels` ni con `stock_movements`. Son datos maestros decorativos. **Esfuerzo:** L.
- **SCM-04 · Eje 5 · Media** — Las entidades `StockMovement` y `StockLevel` pertenecen a inventario pero están en `supply-chain/entities`. **Esfuerzo:** S-M.
- **SCM-05 · Eje 11 · Baja** — `features/wms` "coming soon" sin ruta. Es honesto, pero no aporta nada.

## 7. Camino mínimo a producción
1. SCM-02 (S).
2. Ocultar o declarar bins y landed costs como "no disponibles" (S).
3. Landed cost real (L).
4. Existencias por bin (L).

Se retoca: los almacenes están bien.

## 8. Camino a 100
| Ítem | Puntos que sube | Esfuerzo |
|---|---|---|
| Landed cost aplicado | eje 1 +25, eje 12 +15 | L |
| Existencias, putaway y picking por bin | eje 1 +25 | XL |
| Validación de FKs | eje 8 +25 | S |
| Mover las entidades | eje 5 +20 | S |
| UI WMS | eje 11 +40 | L |

## 9. Competitividad
- Odoo, BC, SAP B1 y Cin7 aplican landed cost y gestionan bins. Bsale y Alegra tampoco tienen WMS de bins, así que el mercado local está menos lejos.
- **Nota: 15** (10–22, media).

## 10. Fortalezas a preservar
- Almacén por defecto creado o designado sin carreras.
- Almacén por sucursal.
- Inactivación en vez de borrado.

## 11. No verificado
- UI de almacenes.
- Tabla `locations` (sin uso aparente; no revisada).
- Paginación de bins.

**Cobertura:** ~70 % del backend leído; 3 de 13 endpoints ejecutados.

<!-- RESUMEN: modulo=cadena-de-suministro-wms; madurez=30; prep=28; veredicto=No listo; eje_debil=1-Autenticidad; criticos=1; altos=2; camino_min=L -->


## Ajuste de calibración del coordinador (Paso 9)

**SCM-02 se eleva a crítica** (escritura entre tenants: `glAccountId` de otro tenant aceptado), patrón sistémico MT-03. Notas sin cambio.
