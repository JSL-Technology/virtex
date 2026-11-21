# Ficha de módulo — `collections` (cobranza: lista de trabajo, actividades, promesas, recordatorios)

Familia TES · 2026-11-07 · script `…/scratchpad/agents/tes/s16.mjs`.

## 1. Identificación
- Backend `apps/backend/api/src/app/collections/` — 11 archivos, 1.548 l. (`collections.service.ts` 494, `collection-priority.ts` 129, `collections.controller.ts` 101, `reminder-prompt.ts` (prompt LLM), `collections.workflow-actions.ts`, `collections.copilot-tools.ts`).
- Endpoints: `GET /collections/worklist`, `GET /collections/invoices/:id/activities`, `GET /collections/customers/:id/activities`, `POST /collections/activities` (CALL/PROMISE/NOTE), `POST /collections/invoices/:id/reminder/compose|draft|send`, `DELETE /collections/drafts/:id`. Clase con `@HasPermission(AI_COLLECTIONS_VIEW, ACCOUNTS_RECEIVABLE_VIEW)`.
- Tabla: collection_activities (índices org+invoice, org+customer+fecha; triggers same-tenant).
- Frontend: `features/sales/collections/collections.page` (ruta `/e/<slug>/collections`, permiso `ai_collections:view`).
- Pruebas: `collections.spec.ts` 9 tests, `collection-priority.spec.ts`.
- Núcleo para vender: sí (cobranza básica es esperada en CxC).

## 2. Estándar de referencia
(a) Básicas: lista de vencidos priorizada, registro de llamadas/promesas con seguimiento, recordatorios por correo con plantillas, secuencias de cobranza automáticas (dunning) por días de vencido, bloqueo de crédito por mora. Avanzadas: IA para redactar, predicción de pago, portal de pago con enlace.
(b) Invariantes: no enviar a quien no corresponde; registrar cada contacto; no duplicar recordatorios; respetar opt-out.
(c) Líderes: NetSuite/D365 (collections management con estrategias de dunning), Xero/QBO (invoice reminders automáticos incluidos en planes básicos), Zoho Books (payment reminders automáticos) — confianza media, sin verificación web en esta sesión.
(d) Construcción: job programado idempotente de dunning, plantillas versionadas por idioma/país, cola de correo con reintentos.

## 3. Resultado
- **Madurez: 33 (22–45, confianza baja)** — no pude ejecutar ningún flujo: todos los endpoints devuelven **403 `saas.feature_disabled` (`ai_collections`)** en el plan *starter* (21 de 22 organizaciones del entorno; solo el tenant dev, vetado, es enterprise).
- **Preparación: 35 (25–45)** · **Veredicto: No listo** (compuerta 1: la cobranza básica está detrás de una feature de IA de pago; sin dunning automático).
- Eje más débil: 1 · Críticos: 0 (no verificable).

## 4. Ejes
| # | Eje | Nota | Evidencia | Falta |
|---|---|---|---|---|
| 1 | Completitud | 30 (22–40, media) | Todo el módulo (incluido registrar una llamada o ver la lista de vencidos) exige la feature `ai_collections` → 403 en starter (s16: worklist, activities, draft, send). Sin dunning programado: `grep -rn "Cron\|@Interval\|Processor" collections` vacío. | Separar cobranza básica (lista, actividades, recordatorio con plantilla, dunning) de la IA. |
| 2 | Integridad | 45 (30–55, baja) | Código: un borrador abierto por factura (`saveDraft`), `openInvoice` filtra org y sucursal; no verificado en ejecución. | Pruebas reales. |
| 3 | Multi-país | 40 (30–50, baja) | Prompt LLM en inglés con tonos; plantillas de correo vía MailService (idioma no verificado). | Plantillas por idioma/país. |
| 4 | Arquitectura | 55 (45–62, baja) | Servicio razonable; depende de invoices (11 imports) y mail. | — |
| 5 | Higiene | 50 (40–58, media) | Mezcla cobranza y IA (prompt, copilot tools) en el mismo módulo. | Separar. |
| 6 | Calidad | 60 (50–66, media) | Tamaño moderado. | — |
| 7 | Robustez | 45 (35–55, baja) | Worklist con límite ≤200 y offset (DTO); envío de correo síncrono en la request (`sendReminder` → `mail.sendPaymentReminder`). | Cola con reintentos. |
| 8 | Seguridad | 65 (55–72, media) | Member → 403; qa-do-b → 403 por feature antes de llegar a aislamiento (aislamiento **no verificado**); `to` libre (IsEmail) permite enviar el recordatorio a cualquier dirección. | Probar IDOR con plan pro; restringir destinatarios a contactos del cliente o auditarlo. |
| 9 | Pruebas | 45 (35–55, media) | 9 tests + prioridad. | Flujos completos y autorización. |
| 10 | Operabilidad | 45 (35–55, baja) | Actividades registran usuario y destinatario. | — |
| 11 | UX | 35 (25–45, media) | Pantalla Cobranza visible en el menú pero falla con 403 `/collections/worklist?limit=200` (Playwright). | Ocultar o explicar el upsell. |
| 12 | Competitividad | 30 (22–40, media) | Recordatorios automáticos son básicos gratuitos en Xero/QBO/Zoho; aquí son de pago y manuales. | Dunning automático incluido. |

## 5. Compuertas
1 **No cumple** · 2 No verificado · 3 No verificado (bloqueado por plan) · 4 Cumple (DTOs) · 5 No cumple (pantalla con 403) · 6 No verificado · 7 No cumple (CI rojo) · 8 Reservas · 9 Cumple · 10 Reservas · 11 No cumple · 12 No cumple.

## 6. Hallazgos
**TES-13** · collections (eje 1/12) · Funcionalidad/competitividad · **Alta** · `collections.controller.ts:26-27` + guard de feature `ai_collections` · La cobranza básica no existe para el plan starter; no hay recordatorios automáticos en ningún plan. · Núcleo de cobranza sin IA y job de dunning idempotente. · Brecha competitiva · M.
**TES-20** · collections (eje 11) · UX · Media · manifiesto `ventas.manifest.ts:81-90` muestra «Cobranza» y la página recibe 403. · Gating de menú por feature. · S.
**TES-21** · collections (eje 8) · Seguridad · Media · `dto/collections.dto.ts` (`to` IsEmail libre) · Recordatorio con datos de la factura a cualquier dirección (no ejecutado). · Restringir a contactos o exigir permiso adicional. · S.

## 7. Camino mínimo
Separar núcleo de cobranza del plan IA (M) → dunning programado (M) → pruebas e IDOR (S).

## 8. Camino a 100
Dunning por estrategia (+15) · enlace de pago (+8, depende de saas-payment) · plantillas por país (+5) · predicción IA ya existe como diferenciador (+5 cuando sea verificable).

## 9. Competitividad
Básica faltante: recordatorios automáticos. Diferenciador potencial: redacción IA y priorización. Confianza media.

## 10. Fortalezas
Priorización explícita (`collection-priority.ts`), borrador revisable antes de enviar, registro de promesas.

## 11. No verificado
Todo el flujo funcional, aislamiento y envío (bloqueado por plan; no usé el tenant dev ni cambié planes). No se envió ningún correo.
