# Ficha: `price-lists` (listas de precios) — familia FAC

## 1. Identificación
- **Alcance backend:** `apps/backend/api/src/app/price-lists/` (7 archivos, 318 líneas): `price-lists.controller.ts` (5 endpoints CRUD: `POST/GET/GET :id/PATCH :id/DELETE :id /price-lists`), `price-lists.service.ts` (116), entidades `price_lists`, `price_list_items`, DTOs. **0 pruebas** (`find price-lists -name '*.spec.ts'` → nada).
- **Frontend:** `features/masters/price-lists/` (listado 81 líneas + formulario 226), menú `ventas.manifest.ts:140-164` (`masters/price-lists`, permisos `price_lists:*`).
- **Países:** todos (sin lógica por país). **Dependencias:** productos (`assertTenantOwns`).
- **¿Núcleo para vender?** Sí en distribución/mayoreo (precio por cliente/canal es capacidad básica de cualquier ERP de ventas).

## 2. Estándar de referencia
- (a) Básicas: listas por cliente/grupo/canal, moneda, vigencia, precio por producto y por cantidad (escalas), regla de selección en factura/cotización/POS, precio con/sin impuesto. Avanzadas: reglas por fórmula (% sobre costo, sobre otra lista), redondeo comercial, prioridades, promociones, aprobación de precios bajo margen.
- (b) Invariantes: un documento de venta usa el precio de la lista vigente aplicable a su cliente/fecha/moneda; trazabilidad de qué lista se aplicó; precisión de precio unitario ≥ la del documento.
- (c) Odoo "Pricelists" (reglas por fórmula, cantidad mínima, vigencia, asignación a cliente) — confianza alta (documentación pública de Odoo, conocida); NetSuite "Price Levels/Quantity Pricing" — confianza media; Alegra "Listas de precio" asignables al cliente — confianza media. No verificado en esta sesión con WebFetch.
- (d) Construcción: entidad lista + ítems + asignación (cliente/grupo) + servicio `PriceResolver` consultado por facturas/cotizaciones/POS.

## 3. Resultado
- **Madurez: 18 (12–25, confianza alta)**. **Preparación comercial: 15. Veredicto: No listo.**
- Eje más débil: 1 (autenticidad funcional) — la lista **no se aplica en ningún documento**.
- Hallazgos críticos abiertos: FAC-PL-01 (funcionalidad sin efecto presentada en menú).

## 4. Ejes
| # | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 12 (8–20, alta) | `grep -rln "price_list\|priceList" apps/backend/api/src/app --include=*.ts` fuera de `price-lists/` → solo migraciones, clasificación de tenancy y `audit/financial-audit.subscriber.ts`; facturas (`invoices.service.ts:948 resolveLine` usa `dto.unitPrice ?? product.price`), cotizaciones y POS nunca la leen. El cliente no tiene `priceListId`. | Resolver de precio (cliente/grupo/fecha/moneda/cantidad) usado por invoices, quotes y POS; asignación a cliente/grupo. |
| 2 Corrección | 30 (20–40, media) | `toItems` redondea a 2 decimales (`roundAmount`): `price 900.123456` → `900.12` (POST probado) mientras la factura admite 6 decimales en precio. Vigencia validada (`validFrom<=validTo`). Moneda sin validar: `currency:"no-currency!!"` → 201 guardado `NO-CURRENCY!!`. `PATCH {"status":"Active"}` → 200 sin efecto observable; sin transición de estado. | Validar ISO 4217 contra catálogo; precisión de precio configurable (≥4); estados con transición; solapes de vigencia por cliente. |
| 3 Multi-país | N/A (sin reglas fiscales) — impuesto incluido/excluido no modelado | — | Bandera "precio incluye impuesto" por lista (común en LatAm retail). |
| 4 Arquitectura | 45 (35–55, media) | Servicio simple, transacción en create/update; reemplazo total de ítems (delete + insert). DTO separado de entidad. `findAll` sin paginación. | Paginación/filtros; versión de ítems en vez de borrado. |
| 5 Higiene | 60 (50–70, media) | 1 violación de frontera (`bnd.log`). Sin lógica de otros dominios. | — |
| 6 Calidad | 55 (45–65, media) | 1 aviso de lint; `as never` en `manager.create(... as never)` (`price-lists.service.ts:27`). | Eliminar casts. |
| 7 Robustez | 40 (30–50, media) | Listado sin límite; ítems ilimitados en el body. | Límite de ítems/paginación. |
| 8 Seguridad | 70 (60–78, media) | Permisos por operación (`price_lists:*`) en el controlador; `assertTenantOwns` rechaza producto de otro tenant: `POST /price-lists` con `productId` de otra organización → **404 price_lists.product_not_found** (probado). `findOne` filtra por `organizationId`. Prueba B→A no ejecutada (throttle de login). | Prueba automática de aislamiento. |
| 9 Pruebas | 5 (0–10, alta) | Cero specs. | Unitarias + integración BD + aplicación en documento. |
| 10 Operabilidad | 35 (25–45, baja) | `financial-audit.subscriber.ts` referencia la tabla (auditoría genérica); sin eventos de negocio. | Auditoría de cambios de precio (antes/después). |
| 11 UX | 40 (30–50, baja) | Pantallas CRUD con claves i18n `masters.price_lists_form.*`; no verificado en navegador. La UI promete una función que no tiene efecto. | Mostrar dónde se aplica; asignación a clientes. |
| 12 Competitividad | 10 (5–20, media) | Frente a Odoo/NetSuite/Alegra: falta todo lo que hace útil una lista (aplicación, reglas, escalas). | Ver §8. |

Madurez 18 < promedio simple (~38): tope por eje 1 (12) y hallazgo crítico.

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | **No cumple** | La lista no afecta precios (FAC-PL-01). |
| 2 Integridad | No cumple | Redondeo a 2 decimales, moneda libre. |
| 3 AuthZ/aislamiento | Cumple parcial | Producto ajeno rechazado; B→A no probado. |
| 4 Validación servidor | Parcial | Moneda sin validar. |
| 5 Humo E2E | No verificado UI | API sin 500. |
| 6 Cumplimiento país | N/A | — |
| 7 Pruebas CI | No cumple | 0 specs. |
| 8 Auditoría | Parcial | Suscriptor genérico. |
| 9 Migraciones | Cumple (global) | `check:schema-drift` OK. |
| 10 Observabilidad | Parcial (global) | — |
| 11 UI/i18n | No verificado | — |
| 12 Documentación | No cumple | Sin doc de uso. |

## 6. Hallazgos
- **FAC-PL-01** — price-lists / eje 1 — **Categoría:** funcionalidad falsa o mock — **Severidad: crítica** (funcionalidad presentada como real en el menú de Ventas sin efecto). **Ubicación:** `price-lists/*`; consumidores inexistentes (`invoices.service.ts:948-1008`, `sales/services/quotes.service.ts`, POS). **Qué está mal:** se crean listas con precios y vigencia, pero ningún documento de venta las consulta; el precio de la factura es `dto.unitPrice ?? product.price`. Un usuario que configura "Mayorista" seguirá facturando a precio de catálogo. **Forma correcta:** `PriceResolver` en el dominio de ventas (cliente→lista, grupo→lista, vigencia, moneda, cantidad) invocado por preview/creación de factura, cotización y POS; guardar en la línea qué lista/regla se aplicó. **Impacto:** bloquea la venta (distribución). **Esfuerzo:** L.
- **FAC-PL-02** — eje 2 — bug/integridad — **media** — `price-lists.service.ts:96-99` — `roundAmount(item.price)` trunca a 2 decimales; probado `900.123456→900.12`. Forma correcta: precisión de precio unitario igual a la del documento (6). Riesgo operativo. S.
- **FAC-PL-03** — eje 2/4 — validación — **media** — `dto/create-price-list.dto.ts` (`currency: @IsString @IsNotEmpty`) — `"no-currency!!"` aceptado (201). Validar contra catálogo de monedas del tenant. S.
- **FAC-PL-04** — eje 9 — pruebas — **alta** — sin specs. M.

## 7. Camino mínimo a producción
1. Implementar asignación (cliente/grupo) + resolver de precio usado por factura/cotización/POS (L, rehacer el alcance; la entidad sirve). 2. Validación de moneda y precisión (S). 3. Pruebas de integración (M). Todos los países.

## 8. Camino a 100
Resolver + asignación (+40, L) → escalas por cantidad y reglas por fórmula (+15, L) → precio con impuesto incluido por lista (+5, M) → auditoría de cambios y aprobación bajo margen (+5, M) → pruebas (+5, M).

## 9. Competitividad
Brecha básica: la lista no se aplica (bloquea). Avanzadas ausentes: reglas por fórmula, escalas, promociones. Sin diferenciadores. Fuentes: Odoo docs "Pricelists" (alta, conocimiento previo), Alegra (media).

## 10. Fortalezas a preservar
`assertTenantOwns` para los productos; transacción en create/update; validación de ventana de vigencia.

## 11. No verificado
Aislamiento B→A real (throttle de login compartido), UI en navegador. Baja confianza de ejes 8 y 11.
