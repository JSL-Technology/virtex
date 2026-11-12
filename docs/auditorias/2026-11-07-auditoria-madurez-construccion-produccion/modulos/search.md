# Ficha — search (búsqueda global) + frontend features/global-search
Familia PLTA · 2026-11-07 · Diagnóstico.

## 1. Identificación
`apps/backend/api/src/app/search/` (4 archivos, 159 l.; 1 spec). `GET /search?q=` (mín. 2 caracteres, límite 10 por grupo). Delegación a `InvoicesService.findAll`, `InventoryService.findAll`, `CustomersService.findAll` con permiso de vista de cada módulo. Sin índice de búsqueda propio. Frontend `features/global-search` (no probado en navegador). Núcleo: medio.

## 2. Estándar de referencia
(a) Búsqueda en todas las entidades principales (documentos de venta/compra, asientos, proveedores, empleados, productos), por número/nombre/NIF, tolerante a acentos y errores, con permisos y sucursales; atajos. (b) Invariante: nunca devolver lo que el usuario no podría abrir. (c) NetSuite Global Search (prefijos por tipo, todas las entidades), Dynamics 365 relevance search, Odoo command palette (confianza media). (d) Índice trigram/tsvector por tenant o motor dedicado; contrato de proveedor de búsqueda por módulo.

## 3. Resultado
**Madurez 50 (43–56, confianza media-alta)**; preparación 48; **Piloto controlado**. Eje más débil: 1/12 (solo 3 entidades). Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 40 | Solo facturas, productos y clientes (search.service.ts); sin proveedores, facturas de proveedor, asientos, empleados, órdenes | Registro de proveedores de búsqueda por módulo |
| 2 | 70 | Resultados correctos: `q=QA-PLTA-Imp4k-1` → cliente propio | — |
| 3 | N/A | — | — |
| 4 | 50 | `SearchService` importa servicios concretos de 3 módulos (acoplamiento; aparece en boundaries) | Puerto `SearchProvider` registrado por cada módulo |
| 5 | 50 | Dependencia directa de internos de invoices/inventory/customers | — |
| 6 | 70 | Pequeño | — |
| 7 | 50 | `ILIKE` sin índices trigram (`pg_extension`: sin pg_trgm; pg_indexes sin GIN en customers/products/invoices) → escaneo secuencial; ~150–180 ms con ~100 clientes | pg_trgm + GIN o tsvector |
| 8 | 78 (alta) | qa-do-b `q=QA-PLTA` → `[]`; member (invoices:view, products:view) → solo grupo Invoices; `q=%' OR 1=1--` → `[]` (comodines escapados por `likeTerm`); facturas filtradas por sucursal (`actorUserId`) | — |
| 9 | 50 | 1 spec | Prueba de permisos por grupo |
| 10 | 55 | — | — |
| 11 | 50 (baja) | Claves i18n en resultados | — |
| 12 | 40 | Muy por debajo de NetSuite Global Search | — |

## 5. Compuertas
1 Parcial · 2 Cumple · 3 Cumple · 4 Cumple (min 2) · 5 Cumple · 6 N/A · 7 Parcial · 8 N/A · 9 N/A · 10 Parcial · 11 No verificado · 12 Parcial.

## 6. Hallazgos
- **PLT-SRCH-01** · search · eje 1/12 · competitividad · Alta · `search/search.service.ts` · Búsqueda "global" cubre 3 entidades. · Contrato de proveedor por módulo. · Brecha competitiva. · M.
- **PLT-SRCH-02** · search · eje 7 · rendimiento · Media · sin pg_trgm/GIN · ILIKE secuencial en tablas grandes. · S/M.
- **PLT-SRCH-03** · search · eje 5 · arquitectura · Media · imports directos de servicios de 3 dominios. · Puerto. · S.

## 7–8. Caminos
Mínimo: proveedores de búsqueda en compras/contabilidad (M), índices trigram (S). A 100: relevancia, acentos, prefijos por tipo (+15, M/L).
## 10. Fortalezas
Permiso por grupo; escape de comodines; límite por grupo; sucursales.
## 11. No verificado
UI global-search; rendimiento con volumen real.
