# Notificaciones (T11) — familia F2

> Auditoría 2026-10-31. Diagnóstico sin cambios en el repo. Tenant qa-a. No se enviaron correos ni push reales (sin `MAIL_HOST` en dev: buzón local `tmp/mail-outbox`; VAPID no verificado).

**Sin hallazgo crítico de seguridad.** Los eventos websocket se emiten a rooms `org:<organizationId>` derivados del principal revalidado (`websockets/events.gateway.ts:153-172,287-288`).

## 1. Identificación
- `notifications/` (7 archivos, 800 LOC, 3 specs): GET `/notifications` (máx. `NOTIFICATION_PAGE`), POST `/:id/read`, `/read-all`, `/access-request` (throttle 5/min), `/test-notification`; listeners de aprobaciones e IA; productores: workflow-engine, billing SaaS.
- `push-notifications/` (4 archivos, 142 LOC, 0 specs): web-push con VAPID opcional; subscribe/unsubscribe.
- `mail/` (8 archivos, 1.3k LOC, 4 specs): BullMQ `mail` (5 intentos, backoff exponencial 5 s, `removeOnFail:false` — `mail/mail.queue.ts:64-73`), procesador con log hasheado, 26 plantillas Handlebars (`mail/templates/*.hbs` + partials, sin MJML), buzón de desarrollo `dev-outbox.ts`, identidad/branding por empresa, SMTP por organización (`/organizations/mail-settings`).
- `websockets/` (5 archivos, 463 LOC, 1 spec): Socket.IO con CORS por configuración, autenticación por cookie vía Identity, revalidación periódica, rooms por organización, presencia en memoria.
- Frontend `features/notifications` (1 página, 83 LOC) + campana en el layout.
- Países: N/A (idioma por usuario: claves i18n en notificaciones, `notifications.service.ts:168-190`).

## 2. Estándar de referencia
- (a) Básico: centro de notificaciones in-app por usuario y empresa, tiempo real, email transaccional fiable (cola, reintentos, DLQ, rebotes), plantillas localizadas y con marca del tenant, preferencias por usuario/canal, sin fuga entre tenants. Avanzado: digest, push móvil, reglas de suscripción por evento, SMS/WhatsApp (muy relevante en LatAm).
- (c) Líderes: Odoo Discuss/Activities + mail con followers y preferencias (confianza alta); NetSuite email templates + SuiteFlow alerts (confianza media); Zoho/QuickBooks recordatorios y digest (confianza media).
- (d) Construcción: outbox transaccional → cola → proveedor; websocket con adaptador Redis para varias réplicas; preferencias como datos.

## 3. Resultado
- **Madurez: 55 (48–62, confianza media)** · **Preparación: 55 — Piloto controlado.**
- Eje más débil: Robustez multi-instancia (websocket sin adaptador Redis) y completitud (sin preferencias).
- Críticos: 0. Altos: 2.

## 4. Ejes
| Eje | Nota | Evidencia | Falta |
|---|---|---|---|
| 1 Completitud | 55 (48–62, media) | GET `/notifications` (qa-a) → 200 con aviso real de límite de plan ("Has usado 8 de 10 facturas"); cola de correo real; push opcional | Preferencias por usuario/canal (grep `NotificationPreference|notification_preferences` → 0); WhatsApp/SMS; digest |
| 2 Corrección | 58 (50–65, media) | Lista filtra `{userId, organizationId}` o personales (`notifications.service.ts:172-180`); `markRead` filtra `userId` | `read-all` marca leídas las de TODAS las empresas del usuario (`:235`, sólo `userId`) |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 58 (50–65, media) | Cola BullMQ para mail; listeners por eventos | Push y websocket síncronos en la request (`notifications.service.ts:122-130`) |
| 5 Higiene | 55 (48–62, media) | `test-notification` con texto español fijo (`notifications.controller.ts:52-54`) | — |
| 6 Calidad | 60 (52–66, media) | Errores de push logueados | — |
| 7 Robustez | 42 (35–50, media) | Presencia y `sendToUser` en `Map` en memoria (`events.gateway.ts:58-60`); sin `@socket.io/redis-adapter` (grep `redis-adapter|createAdapter` → 0) | Adaptador Redis |
| 8 Seguridad | 70 (62–76, media) | Rooms por organización; CORS explícito (`configured-io.adapter.ts:40`); revalidación periódica de sesión | `notification`/`push_subscription` sin RLS (clasificadas cross-tenant) |
| 9 Pruebas | 50 (42–58, media) | specs de gateway, outbox, plantillas, marca; push 0 specs | — |
| 10 Operabilidad | 55 (48–62, baja) | Jobs fallidos se conservan; log con hash del destinatario | DLQ visible/alerta; rebotes |
| 11 UX | 50 (40–58, baja) | Página 83 LOC | Filtros, preferencias |
| 12 Competitividad | 45 (38–52, baja) | Sin WhatsApp (canal dominante en LatAm) | — |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | Cumple | datos reales |
| 2 | Cumple con reservas | mail encolado; push síncrono |
| 3 | Cumple | aislamiento por usuario/org y rooms |
| 4 | Cumple | — |
| 5 | No verificado por UI | — |
| 6 | N/A | — |
| 7 | Parcial | push sin specs |
| 8 | N/A | — |
| 9 | Cumple | — |
| 10 | Parcial | — |
| 11 | No verificado | — |
| 12 | Parcial | — |

## 6. Hallazgos
**NOT-01** — Alta — robustez — `websockets/events.gateway.ts:58-60,249`: presencia y entrega a usuario en memoria del proceso, sin adaptador Redis. Con ≥2 réplicas, una notificación emitida en la réplica A no llega a un socket conectado a la B; la presencia ("en línea") es incoherente y `user.force-logout` sólo desconecta sockets de la réplica que recibió el evento (riesgo de sesión revocada que sigue recibiendo eventos hasta la revalidación periódica). Forma correcta: `@socket.io/redis-adapter` sobre el Redis existente y presencia en Redis. Esfuerzo: S–M.

**NOT-02** — Alta — completitud — sin preferencias de notificación por usuario/canal ni bajas de email de producto. Esfuerzo: M.

**NOT-03** — Media — robustez — push enviado en línea en la request (await por suscripción) y suscripciones caducadas (HTTP 404/410 de web-push) no se eliminan (`push-notifications.service.ts:46-50`): acumulación y latencia. Esfuerzo: S.

**NOT-04** — Media — corrección — `POST /notifications/read-all` usa sólo `userId` (`notifications.service.ts:235`): en multiempresa marca como leídas las de otras empresas. Esfuerzo: S.

**NOT-05** — Baja — `POST /notifications/test-notification` con texto español fijo (no i18n).

**NOT-06** — Media — sin MJML/plantillas responsivas verificadas; 26 `.hbs` (no se buscó triple-mustache sin escapar: grep `{{{` → 0 coincidencias, correcto).

## 7. Camino mínimo a producción
NOT-01 (S–M), NOT-03 (S), NOT-04 (S).

## 8. Camino a 100
Adaptador Redis (+10); preferencias (+10); WhatsApp/SMS (+10, L, efecto externo); digest (+5); DLQ con panel y alertas (+5); push a cola (+5).

## 9. Competitividad
Brecha avanzada en LatAm: WhatsApp para recordatorios de cobro (Alegra, Bind y otros lo ofrecen — confianza media, no verificado en fuente). Fortaleza: correo con marca y SMTP por empresa.

## 10. Fortalezas
Cola de correo con reintentos y conservación de fallidos; buzón local seguro en dev; rooms por organización con principal revalidado; i18n de notificaciones al leer.

## 11. No verificado
Envío real de correo/push (riesgo de efecto externo); conexión websocket desde el portal; render de plantillas.
Cobertura: ~55 % de archivos; 1 llamada API.

<!-- RESUMEN: modulo=notificaciones; madurez=55; prep=55; veredicto=Piloto controlado; eje_debil=Robustez; criticos=0; altos=2; camino_min=M -->
