# Búsqueda global (T16) — familia F2

> Auditoría 2026-10-31. Diagnóstico sin cambios en el repo. Tenant qa-a; víctima qa-b.

**Sin fuga entre tenants** (búsqueda del nombre de un producto de qa-b desde qa-a → `[]`). **Hallazgo alto de autorización intra-tenant**: el endpoint no aplica permisos de módulo (BUS-01).

## 1. Identificación
- Backend `search/` (3 archivos, 124 LOC, 0 specs): GET `/search?q=` → `SearchService.search` que llama a `InvoicesService.findAll`, `InventoryService.findAll`, `CustomersService.findAll` y filtra en memoria.
- Frontend `features/global-search` (componente de la barra superior).
- Países: N/A. Núcleo para vender: medio (comodidad, no bloqueante).

## 2. Estándar de referencia
- (a) Básico: búsqueda a través de entidades principales (clientes, proveedores, productos, facturas, pedidos, asientos, empleados), respetando permisos del usuario, paginada, con relevancia, tolerante a acentos, < 300 ms. Avanzado: índice full-text (Postgres `tsvector`/trigram) o motor dedicado, comandos/acciones, búsqueda reciente.
- (b) Invariantes: nunca muestra registros de otro tenant ni de módulos sin permiso; consultas parametrizadas; coste acotado.
- (c) Líderes: NetSuite Global Search con prefijos por tipo y permisos por rol (confianza alta, docs Oracle); Odoo búsqueda por modelo con record rules (confianza alta); D365 relevance search (confianza media).
- (d) Construcción: proveedor de búsqueda por módulo (puerto) que aplica sus propios permisos; consulta `ILIKE`/trigram con `LIMIT` en BD.

## 3. Resultado
- **Madurez: 35 (28–42, confianza media-alta)** · **Preparación: 35 — No listo** (compuerta 3 —autorización— no cumple).
- Eje más débil: Seguridad (permisos) y Rendimiento.
- Críticos: 0. Altos: 3.

## 4. Ejes
| Eje | Nota | Evidencia | Falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 40 (32–48, media) | Real pero solo 3 entidades (facturas, productos, clientes) | Proveedores, asientos, empleados, pedidos, documentos |
| 2 Corrección | 38 (30–45, media) | `q` ausente → 500 (BUS-03); `q=` vacío → devuelve facturas y TODOS los productos/clientes | Validación |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 35 (28–42, media) | Acoplado a 3 servicios concretos de otros módulos (`search/search.service.ts:1-12`) | Puerto `SearchProvider` por módulo |
| 5 Higiene | 45 (38–52, media) | import de `User` sin uso en el controlador | — |
| 6 Calidad | 45 (38–52, media) | Filtro en JS con `toLowerCase` | — |
| 7 Rendimiento | 25 (18–32, alta) | `inventoryService.findAll(organizationId)` y `customersService.findAll(organizationId)` SIN `search` ni `limit` (`search.service.ts:18-21`) → carga el catálogo completo en cada pulsación aunque ambos servicios soportan `search`/`limit` (`inventory/inventory.service.ts:149-170`) | Delegar filtro y LIMIT a la BD |
| 8 Seguridad | 35 (28–45, media-alta) | Aislamiento tenant OK; sin permisos (BUS-01); inyección SQL no aplica (`' OR 1=1--` → `[]`, consultas parametrizadas vía `likeTerm`) | Permisos por tipo |
| 9 Pruebas | 15 (10–25, alta) | 0 specs | — |
| 10 Operabilidad | 40 (30–50, baja) | — | Métrica de latencia |
| 11 UX | 50 (40–58, baja) | Resultados con claves i18n y enlaces | Paginación, "ver más" |
| 12 Competitividad | 30 (22–40, media) | Muy por debajo de NetSuite Global Search | — |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | Cumple con reservas | real, 3 entidades |
| 2 | N/A (lectura) | — |
| 3 | **No cumple** | BUS-01 |
| 4 | No cumple | BUS-03 (500 sin `q`) |
| 5 | No cumple | 500 reproducible |
| 6 | N/A | — |
| 7 | No cumple | 0 specs |
| 8 | N/A | lectura |
| 9 | Cumple | — |
| 10 | Parcial | — |
| 11 | No verificado | — |
| 12 | Parcial | — |

## 6. Hallazgos
Pruebas (qa-a): `GET /search?q=QA-F2` → 200 sólo producto propio; `q=QA-F2-Producto B` (de qa-b) → `[]`; `q=' OR 1=1--` → `[]`; `GET /search` sin `q` → **500 INTERNAL_ERROR**; `q=` → 200 con facturas de qa-a; `q=a&q=b` → `[]`.

**BUS-01** — Alta — seguridad (autorización) — `search/search.controller.ts:8-20`. El controlador es `@AuthenticatedOnly` y su justificación dice que los resultados pasan "por la misma autorización que cada módulo"; es falso: los permisos (`@HasPermission`) viven en los controladores de facturas/inventario/clientes y aquí se llama directamente a los servicios. Un usuario con un rol sin `invoices:view`/`customers:view` (p. ej. sólo inventario o RR. HH.) ve números de factura, clientes, importes, estado y RNC/NIT de clientes. No verificado con un usuario restringido (crear rol exige step-up); evidencia por código. Forma correcta: filtrar grupos por permisos del principal o delegar en proveedores que los apliquen. Impacto: bloquea venta a clientes con segregación de funciones. Esfuerzo: S.

**BUS-02** — Alta — rendimiento — carga completa de productos y clientes por búsqueda (arriba). Con 50k productos, cada pulsación descarga 50k filas + categorías. Esfuerzo: S.

**BUS-03** — Alta — robustez — `query.toLowerCase()` con `q` ausente → 500 (`search.service.ts:15`); sin DTO de validación ni longitud mínima. Esfuerzo: S.

**BUS-04** — Media — arquitectura — acoplamiento directo a servicios internos de 3 módulos; ninguna otra entidad buscable. Esfuerzo: M.

## 7. Camino mínimo a producción
BUS-01, BUS-02, BUS-03 (S cada uno), con specs.

## 8. Camino a 100
Permisos (+15, S); filtro/LIMIT en BD + índice trigram (+12, M); más entidades vía puerto por módulo (+15, M); relevancia/acentos (`unaccent`) (+8, M); pruebas (+8, S); acciones rápidas (+5, M).

## 9. Competitividad
Brecha básica frente a NetSuite/Odoo: cobertura de entidades y permisos. Sin diferenciadores.

## 10. Fortalezas
Aislamiento por tenant; consultas parametrizadas; resultados localizables por clave.

## 11. No verificado
UI del buscador; comportamiento con usuario de permisos restringidos.
Cobertura: 100 % backend (3 archivos), 6 llamadas API, 0 pantallas.

<!-- RESUMEN: modulo=busqueda-global; madurez=35; prep=35; veredicto=No listo; eje_debil=Rendimiento; criticos=0; altos=3; camino_min=S -->
