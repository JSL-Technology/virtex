# Mapa de relaciones (M28) — relationship-map

## 1. Identificación
Backend `relationship-map/` (8 archivos, 1 802 LOC; 2 specs, 404 LOC): `GET relationship-map/types`, `GET relationship-map/search`, `GET relationship-map/:type/:id`, todos con `RELATIONSHIP_MAP_VIEW`. Catálogo de tipos y especificaciones de flujo documental (`document-flow.catalog.ts` 308 LOC, `document-flow.specs.ts` 533 LOC), servicio de 625 LOC. Frontend `features/relationship-map` (9 archivos, 1 249 LOC), rutas `analisis.manifest.ts:87,100`. Países N/A. Núcleo: no (diferenciador, tipo "document flow" de SAP).

## 2. Estándar de referencia
SAP "Document Flow"/NetSuite "Related Records": desde cualquier documento ver su cadena (cotización→pedido→entrega→factura→cobro→asiento) con estados e importes; respetar permisos por tipo; aislamiento. Confianza media.

## 3. Resultado
Madurez **52** (42–60, baja: sólo lectura estática y 1 endpoint) · Preparación **50 — Piloto controlado** · Eje débil: Pruebas/verificabilidad (no ejecutado) · Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Falta |
|---|---|---|---|
| 1 | 58 (48–65, baja) | `GET types` → 200 con tipos SALES_OPPORTUNITY (no buscable), SALES_QUOTE, SALES_INVOICE… | Ejecutar `:type/:id` sobre una cadena real. |
| 2 | 50 (baja) | Specs declarativas de relaciones. | Verificar que cada arista usa FK reales y no heurísticas. |
| 3 | N/A | — | — |
| 4 | 58 | Catálogo declarativo + servicio genérico. | — |
| 5 | 45 | El servicio consulta tablas de muchos dominios (5 referencias a organizationId en `document-flow.service.ts` para 625 LOC: revisar que todas las consultas por arista filtren tenant). | Puertos por dominio. |
| 6 | 60 | Contratos tipados (`contracts/document-flow.contracts.ts`). | — |
| 7 | 50 | Recorridos por grafo; límites no verificados. | Límite de profundidad/nodos. |
| 8 | 55 (45–62, baja) | Permiso único `RELATIONSHIP_MAP_VIEW` para ver documentos de todos los módulos. | Filtrar nodos por permiso del dominio (un usuario de ventas vería asientos/pagos). IDOR no probado. |
| 9 | 50 | 2 specs. | Integración con BD. |
| 10 | 45 | — | — |
| 11 | 45 (baja) | Pantalla existe; no ejecutada. | — |
| 12 | 55 | Diferenciador vs Odoo/QuickBooks. | — |

## 5. Compuertas
1 Cumple (estático) · 2 N/A (lectura) · 3 No verificado (filtro de tenant por arista) · 4 Cumple (pipe de tipo `flow-document-type.pipe.ts`) · 5 No verificado · 6 N/A · 7 Parcial · 8 N/A · 9 Cumple · 10 Parcial · 11 No verificado · 12 Parcial.

## 6. Hallazgos
- **REL-01** · relationship-map · Eje 8 · Seguridad · **Media** · `relationship-map.controller.ts:27-43` · Un permiso único expone documentos de todos los módulos; no se observó filtro por permiso de dominio (no verificado en profundidad). · Filtrar nodos por permiso. · S/M.
- **REL-02** · relationship-map · Eje 9 · Pruebas · **Media** · specs · Sin prueba de aislamiento por arista con dos tenants. · S.
- **REL-03** · relationship-map · Eje 5 · Higiene · **Media** · `document-flow.service.ts` · Lectura transversal de tablas ajenas. · M.

## 7–8. Caminos
Mínimo: prueba de aislamiento por arista + filtro por permiso (S/M). A 100: importes/estados en nodos y conciliación de cadena (+8), puertos por dominio (+5), exportación del grafo (+3).
## 9. Competitividad
Equivalente conceptual a SAP Document Flow; nota 55 (baja).
## 10. Fortalezas
Catálogo declarativo; tipos marcados como no buscables cuando no aplica.
## 11. No verificado
Ejecución de `search` y `:type/:id`, UI, aislamiento. Cobertura ~15 %.

<!-- RESUMEN: modulo=mapa-de-relaciones; madurez=52; prep=50; veredicto=Piloto controlado; eje_debil=Pruebas/Seguridad (no verificado); criticos=0; altos=0; camino_min=S -->
