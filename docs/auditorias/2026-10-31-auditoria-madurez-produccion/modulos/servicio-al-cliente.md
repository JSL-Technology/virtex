# Servicio al cliente (M31) — customer-service

> Sin crítico de seguridad explotable hoy: el "portal del cliente" NO está expuesto sin autenticación (401 sin sesión). Pero no tiene identidad de cliente: ver CS-01.

## 1. Identificación
Backend `customer-service/` (9 archivos, 249 LOC, **0 specs**): `GET /cases` (`CASES_VIEW`), `GET /customer-portal/my-cases|my-invoices|knowledge-base|knowledge-base/:id` (`CUSTOMER_PORTAL_ACCESS`). Entidades `cases`, `knowledge_base_articles`. `KnowledgeBaseService.create/update` existen sin controlador (código muerto). Sin UI (no hay feature en `client-web/src/app/features`). Países N/A. Núcleo: no.

## 2. Estándar de referencia
Zendesk/Freshdesk/Odoo Helpdesk: tickets multicanal (correo/portal/chat), SLA y escalamiento, asignación y colas, estados, respuestas/comentarios, base de conocimiento pública con búsqueda, portal donde el cliente sólo ve SUS tickets y facturas, CSAT. Invariante: un usuario de portal está ligado a un cliente y aislado de los demás clientes. Confianza media.

## 3. Resultado
Madurez **10** (5–15, alta) · Preparación **5 — No listo** · Eje débil: Autenticidad · Críticos 0 · Altos 2.

## 4. Ejes
| Eje | Nota | Evidencia | Falta |
|---|---|---|---|
| 1 | 8 (5–12, alta) | Sólo listado de casos; no se pueden crear, asignar ni comentar casos (sin POST); KB sin endpoints de alta. | Todo el ciclo de ticket. |
| 2 | 20 | — | — |
| 3 | N/A | — | — |
| 4 | 25 | Importa `InvoicesModule` para el portal. | Portal como contexto propio con identidad de cliente. |
| 5 | 30 | Código muerto (`knowledge-base.service.ts:17,43`). | — |
| 6 | 35 | Imports sin uso (`User`, `NotFoundException`). | — |
| 7 | 25 | `findAll` sin paginación (`cases.service.ts:13`), `invoicesService.findAll` para portal. | — |
| 8 | 30 (25–40, alta) | JWT global: sin sesión → 401 (probado). Con sesión qa-co: `my-invoices` → **todas las facturas de la organización** (200, `FAC-00000001…`); `my-cases` = `findAll(organizationId)` (`customer-portal.controller.ts:22-31`). No existe vínculo usuario↔cliente (grep `portal` en auth/users sólo step-up). | Identidad de cliente y filtro por `customerId`. |
| 9 | 5 | 0 specs. | — |
| 10 | 15 | — | — |
| 11 | N/A (sin UI) → no vendible | — | UI agente y portal. |
| 12 | 5 | — | — |

## 5. Compuertas
**1 No cumple** · 2 N/A (sin escrituras) · 3 **No cumple** para el portal (aislamiento por cliente inexistente) · 4 N/A · 5 N/A · 6 N/A · 7 No cumple · 8 No cumple · 9 Cumple · 10 No cumple · 11 No cumple · 12 No cumple.

## 6. Hallazgos
- **CS-01** · customer-service/invoices · Eje 8 · Seguridad (diseño) · **Alta** · `customer-portal.controller.ts:20-32` · Endpoints "my-*" devuelven todos los casos y facturas del tenant a quien tenga `customer_portal:access`; no hay concepto de usuario-cliente. Si se concede ese permiso a un cliente externo, verá las facturas de todos los clientes. Hoy ningún rol sembrado lo otorga salvo `*` (grep). · Identidad de portal (contacto→cliente), filtro por `customerId`, rutas separadas del ERP. · Bloquea venta del portal · L.
- **CS-02** · customer-service · Eje 1 · Funcionalidad · **Alta** · módulo · Esqueleto: sin crear/gestionar casos, sin SLA, sin UI. · Retirar del catálogo o construir (XL).
- **CS-03** · customer-service · Eje 5 · Higiene · **Baja** · `knowledge-base.service.ts:17,43` · Métodos sin uso. · S.

## 7. Camino mínimo
Retirar `customer-portal` hasta tener identidad de cliente (S) → ciclo de ticket con UI (XL).
## 8. Camino a 100
Rehacer: tickets+SLA (+30, L), portal con identidad (+20, L), KB pública (+10, M), canal correo (+10, M; existe `inbound-mail` en otro módulo).
## 9. Competitividad
Sin comparación posible con Zendesk/Freshdesk/Odoo Helpdesk. Nota 5 (alta).
## 10. Fortalezas
Consultas por `organizationId`; KB publicada sólo con `status=PUBLISHED`.
## 11. No verificado
Nada relevante; cobertura ~100 % backend, 5 endpoints ejecutados.

<!-- RESUMEN: modulo=servicio-al-cliente; madurez=10; prep=5; veredicto=No listo; eje_debil=Autenticidad; criticos=0; altos=2; camino_min=XL -->
