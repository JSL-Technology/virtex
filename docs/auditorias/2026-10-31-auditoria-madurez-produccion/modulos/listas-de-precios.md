# M12 — Listas de precios (`price-lists`) — Familia F5

> **CRÍTICO DE SEGURIDAD ABIERTO — PL-01: fuga de datos entre tenants.** Una lista de precios puede referenciar el producto de otro tenant. Al leerla, la API devuelve ese producto completo (precio, costo, stock, SKU, organizationId). Probado.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/price-lists/` — 7 archivos, 263 LOC, **0 specs**.
- **Endpoints**: 5 (CRUD: `POST/GET/GET :id/PATCH/DELETE /price-lists`).
- **Tablas**: `price_lists`, `price_list_items`.
- **Frontend**: `features/masters/price-lists` (formulario y listado; con spec).
- **¿Núcleo?** Básico en distribución y retail.

## 2. Estándar de referencia
- Listas por cliente, grupo, canal y moneda, con vigencia, escalas por cantidad y reglas (porcentaje sobre la base o fórmula). Se aplican de forma automática en cotización, pedido, factura y POS, con prioridad entre listas.
- **Líderes**: Odoo pricelists con reglas y vigencias; NetSuite price levels por cliente (confianza alta).
- **Invariante**: los ítems solo referencian productos del propio tenant.

## 3. Resultado
- **Madurez: 15** (10–20, alta) · **Preparación: 10 → NO LISTO**.
- Eje más débil: **1 Autenticidad (15)** y **8 Seguridad (20)**.
- **1 crítico**, 1 alto.

## 4. Doce ejes
| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad | 15 (10–20, alta) | Ningún proceso las consume (PL-02) | Motor de precios |
| 2 | Corrección | 35 | Sin validar fechas `validFrom` ≤ `validTo`, ni pertenencia del producto, ni duplicados | — |
| 3 | Multi-país | N/A (moneda libre, sin reglas fiscales) | — | — |
| 4 | Arquitectura | 35 | CRUD anémico | — |
| 5 | Higiene | 50 | Aislado, aunque por estar muerto | — |
| 6 | Calidad | 45 | `price` decimal sin transformer: devuelve el string "5.00" | — |
| 7 | Robustez | 40 | `findAll` sin paginación; relaciones eager | — |
| 8 | Seguridad | 20 (15–25, alta) | PL-01 | — |
| 9 | Pruebas | 5 | 0 specs en backend | — |
| 10 | Operabilidad | 30 | — | — |
| 11 | UX | 45 (no verificado) | — | — |
| 12 | Competitividad | 15 | — | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | **No cumple** | Decorativo |
| 2 | Integridad | No cumple | — |
| 3 | Aislamiento | **No cumple** | PL-01 |
| 4 | Validación en servidor | Parcial | `price` ≥ 0 sí se valida |
| 5 | E2E sin 500 | Cumple | — |
| 6 | Cumplimiento por país | N/A | — |
| 7 | Pruebas en CI | No cumple | — |
| 8 | Auditoría | No cumple | — |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | — | — |
| 11 | UI | No verificado | — |
| 12 | Documentación | No cumple | — |

## 6. Hallazgos

**PL-01** · Eje 8 · Seguridad · **CRÍTICA**
- **Ubicación**: `price-lists.service.ts` (create/update: `items.map(itemDto => Object.assign(new PriceListItem(), itemDto))`), sin comprobar que `productId` pertenezca a la organización. `entities/price-list-item.entity.ts:24`: `@ManyToOne(() => Product, { eager: true, onDelete: 'CASCADE' })`.
- **Prueba**:
  1. Sesión qa-a: `POST /price-lists {"name":"QA-F5 Lista IDOR","currency":"DOP","validFrom":"2026-10-01","validTo":"2026-12-31","items":[{"productId":"99ab1bfc-2b1f-45a1-8b2f-3aad376871a4","price":5}]}` → 201.
  2. `GET /price-lists/589cba6f-6ed4-4e4e-a5d6-8898c083f286` → incluye `product` con name "QA-F2-Producto B", sku, price 100, cost, stock, taxRate y `organizationId` "8af5fff0…" (qa-b).
  3. También aparece en `GET /price-lists`.
- Crea una FK entre tenants: si qa-b borra su producto, se borra en cascada el ítem de qa-a.
- **Explotación**: requiere conocer el UUID del producto ajeno.
- **Forma correcta**:
  - Validar con `findBy({ id: In(ids), organizationId })`.
  - FK compuesta (organization_id, product_id).
  - Quitar `eager`.
  - Revisar el mismo patrón en otros `Object.assign` de DTOs con ids.
- **Esfuerzo**: S.

**PL-02** · Eje 1 · Funcionalidad decorativa · **ALTA**
- **Búsqueda**: `grep -rn "PriceList\|priceList" apps/backend/api/src/app --include=*.ts` fuera de `price-lists/` → solo `app.module.ts:57,334`.
- Factura (`invoices.service.ts` `resolveLine`), cotización y POS usan `product.price`. La pantalla permite crear listas que no tienen ningún efecto.
- Tampoco existe asignación a cliente o grupo, ni escalas por cantidad.
- **Esfuerzo**: L.

**PL-03** · Ejes 2, 6 · **MEDIA**
- Sin validar la vigencia; `update` reemplaza los ítems; sin paginación; precio devuelto como string.

## 7. Camino mínimo a producción
1. PL-01 (S, inmediato).
2. Decidir entre ocultar el módulo y construir el motor de precios aplicado en factura, cotización y POS (L).

## 8. Camino a 100
| Ítem | Puntos | Esfuerzo |
|---|---|---|
| PL-01 | +10 | S |
| Motor de precios con prioridad, vigencia y escalas, aplicado en todos los documentos | +40 | L |
| Asignación por cliente o grupo | +10 | M |
| Pruebas | +10 | M |
| Import/export | +5 | S |

## 9. Competitividad
- Muy por debajo de Odoo y NetSuite. Hoy no aporta nada vendible.
- **Nota: 15.**

## 10. Fortalezas a preservar
- Validación básica de precio ≥ 0.
- Filtro por organización en la lectura de la lista misma.

## 11. No verificado
- UI.

**Cobertura**: 100 % del backend leído; 3 de 5 endpoints ejecutados.

<!-- RESUMEN: modulo=listas-de-precios; madurez=15; prep=10; veredicto=No listo; eje_debil=autenticidad/seguridad; criticos=1; altos=1; camino_min=L -->
