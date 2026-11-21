# Ficha — mail + inbound-mail
Familia PLTA · 2026-11-07 · Diagnóstico. **No se envió ningún correo real** (sin MAIL_HOST: buzón local `tmp/mail-outbox`, 52 archivos; webhook entrante probado solo con firmas inválidas).

## 1. Identificación
- `mail/` (8 archivos, 1.311 l.; 4 specs): `MailService` (≈20 plantillas: reset, invitación, factura, recordatorio de cobro, bienvenida…), cola BullMQ `mail` (`MAIL_JOB_OPTIONS`: 5 intentos, backoff exponencial 5 s, `removeOnComplete` 1 h/1.000, `removeOnFail:false`), `MailProcessor`, plantillas Handlebars con claves i18n, `dev-outbox.ts`.
- `inbound-mail/` (7 archivos, 763 l.; 2 specs): `POST /inbound-mail/webhook` (público, HMAC `t=…,v1=…` con tolerancia), buzones por propósito BILLS/ORDERS con token aleatorio de 128 bits, lista de remitentes permitidos, cola `inbound-mail` (3 intentos, backoff 30 s), adjuntos ≤10 × 7 MB, tipos permitidos. Tablas `inbound_mailboxes`, `inbound_messages` (unique (organization_id, message_id)).
- Núcleo: alto (envío de facturas, recuperación de contraseña).

## 2. Estándar de referencia
(a) Envío asíncrono con reintentos y DLQ, plantillas por idioma, remitente por empresa (Reply-To), registro de envíos por documento (quién, cuándo, a quién, estado/rebote), webhooks de rebote/queja, SPF/DKIM documentado. Entrante: dirección única por tenant, autenticación del proveedor, deduplicación, cuarentena. (b) Invariantes: nunca enviar dos veces el mismo documento por reintento; secretos (tokens) no persistidos en claro fuera de su tabla; un correo entrante solo cae en un tenant. (c) NetSuite/Odoo/QuickBooks: historial de correos por factura con estado de entrega; Odoo alias de correo entrante por modelo (confianza media). (d) Outbox transaccional + cola + tabla de mensajes enviados.

## 3. Resultado
**Madurez 56 (48–62, confianza media)**; preparación 58; **Piloto controlado**. Eje más débil: 10 (sin historial de envíos ni rebotes). Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 60 | Correos reales renderizados en `tmp/mail-outbox` (p.ej. `…te-damos-la-bienvenida-a-virtex.html`); entrante con buzones/rotación (`GET /inbound-mail/mailboxes` → `configured:false` sin dominio) | Historial de envíos por documento; rebotes |
| 2 | 50 (media) | `enqueue` sin `jobId` (mail.service.ts:63) → un reintento HTTP del cliente encola dos veces (sin deduplicación); el encolado ocurre fuera de la transacción del negocio (no hay outbox) | jobId determinista por (documento, destinatario, plantilla); outbox |
| 3 | 65 | Plantillas por idioma vía catálogo (`mail-template.helpers.ts`) | Terminología por país en plantillas fiscales |
| 4 | 65 | Cola + procesador + plantillas; entrante con registro de manejadores por propósito (`InboundMailHandlerRegistry`) | — |
| 5 | 65 | Entrante usa contrato `contracts/inbound-mail` y `recordAiProvenance` | — |
| 6 | 70 | — | — |
| 7 | 60 | Reintentos + backoff; `removeOnFail:false` sin purga: los fallidos se acumulan para siempre | Purga/DLQ con alerta |
| 8 | 62 (media) | Webhook sin firma → 401, firma malformada → 401 (`inbound_mail.invalid_signature`); token de buzón aleatorio; log usa `recipientHash`. **Pero** el payload del job (incl. contexto con enlaces/tokens de reset e invitación y adjuntos base64 de facturas) queda en Redis en claro 1 h tras completar y para siempre si falla (`redis-cli hgetall bull:mail:26` muestra `to`, contexto completo) | Pasar solo ids y resolver el token al procesar; cifrar o reducir retención |
| 9 | 60 | 6 specs; pasan | Prueba de idempotencia de envío |
| 10 | 45 | Solo logs `mail_sent`/`mail_delivery_failed`; no hay tabla de envíos (pg_tables: ninguna tabla `*mail*` salvo inbound) ni webhook de rebotes | Tabla `outbound_messages` con estado |
| 11 | N/A (UI de buzones no probada) | — | — |
| 12 | 50 | Entrada de facturas por correo es diferenciador; falta historial/rebotes (básico en QuickBooks/Xero) | — |

## 5. Compuertas
1 Parcial · 2 Parcial (sin idempotencia) · 3 Cumple (webhook firmado, buzón por token) · 4 Cumple · 5 Cumple · 6 N/A · 7 Parcial · 8 No cumple (no se registra qué se envió a quién) · 9 N/A · 10 Parcial · 11 No verificado · 12 Parcial.

## 6. Hallazgos
- **PLT-MAIL-01** · mail · eje 10/12 · operabilidad · **Alta** · `mail/mail.service.ts` (todos los `send*`), BD sin tabla de envíos · No hay registro persistente de correos enviados (factura X enviada a Y, estado, rebote); tras 1 h el job desaparece de Redis. Un cliente no puede probar que envió una factura o un recordatorio de cobro. · Tabla de mensajes salientes por tenant + webhooks de rebote. · Brecha competitiva/riesgo. · M.
- **PLT-MAIL-02** · mail · eje 2 · integridad · Media · `mail/mail.service.ts:63` · Sin `jobId`/deduplicación ni outbox: doble envío por reintento, o envío de un documento cuya transacción luego hace rollback. · S/M.
- **PLT-MAIL-03** · mail · eje 8 · seguridad · Media · `mail/mail.queue.ts` (`MAIL_JOB_OPTIONS`), `mail.service.ts:127-200` · Tokens de reset/invitación y PDFs en claro en Redis (1 h completados; indefinido fallidos). · Datos mínimos en el job. · S.
- **PLT-MAIL-04** · mail · eje 7 · Baja · `removeOnFail:false` también en `QueuesModule.defaultJobOptions` → crecimiento sin límite de Redis. · S.

## 7. Camino mínimo
1. Registro de envíos (M). 2. jobId idempotente (S). 3. Reducir datos en Redis (S).
## 8. Camino a 100
Rebotes/quejas (+8, M); outbox transaccional (+6, M); plantillas editables por tenant (+5, M); DKIM por dominio del cliente (+5, M).
## 9. Competitividad
QuickBooks/Xero muestran "enviado/visto" por factura (confianza media). Diferenciador: facturas de proveedor por correo con IA.
## 10. Fortalezas
Cola con reintentos; buzón de desarrollo que impide envío real fuera de prod (`devOutboxEnabled` exige dev-like y sin MAIL_HOST); MAIL_HOST obligatorio en producción (env.validation); HMAC con ventana de tiempo y `timingSafeEqual`; dedupe de entrantes por Message-ID con unique en BD.
## 11. No verificado
Entrega SMTP real, rebotes, procesamiento de correo entrante válido (requiere secreto/dominio configurados; no se forjó firma).
