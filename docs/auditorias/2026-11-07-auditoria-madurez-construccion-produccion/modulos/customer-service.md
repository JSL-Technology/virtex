# Ficha — `customer-service` (casos, base de conocimiento, portal del cliente) · Familia NOM

> Auditoría diagnóstica 2026-11-07. Evidencia con `qa-do-a` / `qa-do-b` / `qa-do-a-member`.
> **Pregunta de la coordinación — FK `FK_customer_portal_accounts_customer` sin guarda de mismo tenant: NO es explotable vía API** (probado: 404 `customer_service.portal_customer_not_found`). Es una brecha de defensa en profundidad (Media), no un CRÍTICO.

## 1. Identificación

| Campo | Valor |
|---|---|
| Backend | `apps/backend/api/src/app/customer-service` (13 archivos, 570 líneas) |
| Endpoints | 8: `GET /cases`; portal `GET my-cases`, `GET my-invoices`, `GET knowledge-base`, `GET knowledge-base/:id`, `GET/POST/DELETE accounts` |
| Tablas | `cases`, `knowledge_base_articles`, `customer_portal_accounts` (índice único parcial usuario vivo; **sin** trigger `tg_same_tenant` — confirmado en `pg_trigger`) |
| Frontend | Ninguno: grep `customer-service|/cases|knowledge-base|customer-portal` en `apps/core/client-web/src/app` sin resultados de pantalla |
| Pruebas | `customer-portal.spec.ts`: sus 4 tests **pasan** pero la suite **falla** por el arnés (ver NOM-43); `database/same-tenant-references.spec.ts:56` falla por la FK sin guarda |
| ¿Núcleo? | No para la venta base; sí para CRM/servicio |

## 2. Estándar de referencia

(a) Básicas: crear/asignar/escalar casos (canales correo/portal/web), estados y SLA, historial de conversación, base de conocimiento con autoría y publicación, portal del cliente con login propio (no usuarios internos) para ver casos/facturas y abrir casos. Avanzadas: SLA con escalado, macros, CSAT, omnicanal, IA de respuesta. (b) Invariantes: un usuario de portal ve solo su cliente y su tenant; el portal no da acceso al ERP interno; casos auditados. (c) Líderes: Zendesk, Freshdesk, Salesforce Service Cloud, Odoo Helpdesk + portal (alta, documentación de producto pública); Zoho Desk. (d) Construcción: identidad de portal separada de la de empleados, agregado Caso con transiciones, KB versionada.

## 3. Resultado

| | |
|---|---|
| **Madurez** | **14 (8–20, confianza alta)** |
| **Preparación comercial** | **5** |
| **Veredicto** | **No listo** (fachada: no se puede crear un caso ni un artículo) |
| Eje más débil | 1 (autenticidad) |
| Críticos abiertos | 0 |

## 4. Tabla de 12 ejes

| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad (crítico) | 8 (5–12, alta) | Sin endpoint para crear/editar casos ni artículos: `cases.controller.ts` solo `@Get()`; `KnowledgeBaseService.create/update` existen pero ningún controlador los usa (grep `knowledgeBaseService.(create|update)` sin coincidencias). `GET /cases` y `/customer-portal/knowledge-base` → `[]` en qa-do-a | CRUD de casos/KB, flujo de estados, UI |
| 2 Corrección (crítico) | 40 (30–48, media) | Concesión de portal con `pg_advisory_xact_lock` y un cliente por usuario vivo (spec y prueba: conceder/revocar 201/200) | Transiciones de caso inexistentes |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 25 (18–32, media) | Portal = **usuario interno del tenant** (`assertTenantMember`, `customer-portal-accounts.service.ts`) con permiso `customer_portal:access`; ningún rol lo trae (SQL `roles.permissions` sin `customer_portal`); un cliente externo tendría que ser miembro de la empresa | Identidad de portal separada |
| 5 Higiene | 45 (38–52, media) | Importa `User` de identidad (`cases.controller.ts:3`, entidades) y `InvoicesService` de ventas en el controlador del portal | Puertos |
| 6 Calidad | 55 (48–62, media) | 2 warnings de lint (imports sin uso) | — |
| 7 Robustez | 35 (28–42, media) | `GET /cases` sin paginación; sin índice por `organization_id` en `cases` | Paginación, índices |
| 8 Seguridad (crítico) | 55 (48–62, alta) | `POST /customer-portal/accounts` desde qa-do-a con `customerId` de qa-do-b → **404** `customer_service.portal_customer_not_found`; con `userId` no miembro → 404; portal filtra por tenant **y** cliente (`requireCustomer` + `findAll(org,{customerId})`; spec «answers only the bound customer's…» pasa); member sin permiso → 403. Brecha: FK sin guarda de mismo tenant (NOM-41); concesión/revocación no auditadas | Trigger de mismo tenant, auditoría |
| 9 Pruebas | 30 (22–38, alta) | Suite roja por arnés (NOM-43) | Arreglar arnés, pruebas de casos |
| 10 Operabilidad | 20 (12–28, media) | `audit_logs` sin filas `customer_portal_accounts` tras conceder/revocar | Auditoría |
| 11 UX | 3 (1–8, alta) | Sin pantallas | UI interna + portal |
| 12 Competitividad | 5 (2–10, alta) | Frente a Zendesk/Odoo Helpdesk no hay producto | — |

## 5. Compuertas

1 No cumple (fachada) · 2 N/A práctico · 3 Cumple en API (aislamiento probado), no en BD · 4 Parcial · 5 N/A sin UI · 6 N/A · 7 No cumple (suite roja) · 8 No cumple · 9 Cumple · 10 No cumple · 11 No cumple · 12 No cumple.

## 6. Hallazgos

**NOM-40 — Casos y base de conocimiento son de solo lectura: no hay forma de crearlos** · eje 1 · funcionalidad falsa o mock · **Alta** (el módulo se presenta en permisos `cases:view` y portal) · `cases.controller.ts`, `knowledge-base.service.ts`. Esfuerzo: L (rehacer como dominio).

**NOM-41 — `FK_customer_portal_accounts_customer` sin guarda de mismo tenant** · eje 8 · seguridad (defensa en profundidad) · **Media** · Evidencia: `pg_trigger` sin `tg_same_tenant` para la tabla; `same-tenant-references.spec.ts:56` falla. Explotabilidad: **no explotable por API** (guarda en `grant` vía `assertTenantOwns('customers', …)`; probado 404). Riesgo si otra ruta/ETL escribe la tabla. Forma correcta: añadir el trigger generado como en el resto de tablas. Esfuerzo: S.

**NOM-42 — Modelo de portal = usuario interno; ningún rol con `customer_portal:access`; sin UI** · eje 4/1 · arquitectura · **Alta** · Esfuerzo: L.

**NOM-43 — `customer-portal.spec.ts` falla siempre por el arnés** · eje 9 · pruebas · **Media** · `afterAll` llama dos veces a `dropTestOrganization` (que destruye el `DataSource`, `common/database/testing/integration-db.ts:46-50`) y luego `dataSource.destroy()` → `CannotExecuteNotConnectedError` (`customer-portal.spec.ts:64`). Los 4 tests pasan (ejecutado con `DB_HOST=localhost DB_NAME=virteex_test`). Mantiene CI en rojo. Esfuerzo: S.

**NOM-44 — Concesiones de portal sin auditoría; `GET /cases` sin paginación ni índice** · ejes 7/10 · Media · Esfuerzo: S.

## 7. Camino mínimo a producción

Arreglar arnés + trigger (S) → identidad de portal externa (L) → CRUD de casos con estados/asignación y KB con publicación (L) → UI interna y portal (L) → auditoría (S). Rehacer, no retocar.

## 8. Camino a 100

Casos con SLA/escalado (+25, L), portal externo con apertura de casos y facturas (+20, L), KB con editor/versionado (+15, M), canales correo (+15, L), auditoría/pruebas (+10, S-M), CSAT/IA (+10, L).

## 9. Competitividad

Básicas faltantes: todas (Zendesk/Freshdesk/Odoo Helpdesk — alta). Sin diferenciadores.

## 10. Fortalezas

Filtro del portal por tenant y cliente correcto; concesión serializada con bloqueo consultivo y unicidad de usuario vivo.

## 11. No verificado

Acceso real de un usuario con `customer_portal:access` (ningún rol lo trae; no se modificaron roles); `my-invoices` con datos.
