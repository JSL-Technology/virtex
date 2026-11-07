# M18 — Correo entrante (`inbound-mail`)

> Sin hallazgos críticos de seguridad verificados. El enrutamiento por tenant se hace con un token aleatorio de 128 bits en la dirección; un remitente no puede elegir el tenant sin conocer ese token. Revisión **solo estática** (confianza baja): el webhook exige un secreto HMAC que no se usó, para no alterar la configuración.

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/inbound-mail/` (9 archivos, ~760 LOC, 2 specs).
- **Endpoints:**
  - `POST inbound-mail/webhook`: `@Public`, `@SkipCsrf`, con HMAC `x-virtex-signature` y throttler.
  - Buzones: listar, rotar y actualizar.
  - Mensajes: listar, reintentar, descartar y descargar adjunto.
- **Entidades:** `inbound_mailboxes`, `inbound_messages`. La función SQL `inbound_mailbox_by_token` resuelve el tenant.
- **Procesamiento:** cola (`inbound-mail.processor.ts`) y handlers por propósito; CxP registra `inbox/bill-mail.handler.ts` (captura de facturas con IA y match con OC).
- **Frontend:** `features/inbound-mail` (3 ts + 1 spec).

## 2. Estándar de referencia
- **Básico:** dirección por tenant no adivinable; verificación de origen (SPF, DKIM y DMARC, del receptor o propia); lista de remitentes; deduplicación por Message-ID; límites de tipo y tamaño; antivirus o sandbox de adjuntos; cola con reintentos; bandeja de revisión humana.
- **Referencias:** Bill.com, Dext/Hubdoc, Odoo (alias por empresa), QuickBooks (forward-to-email). Confianza media.

## 3. Resultado
**Madurez 52** (40–60, baja) · **Preparación 50 — Piloto controlado** (confianza baja, no ejecutado) · eje más débil: Pruebas y verificabilidad · críticos: 0 · altos: 2.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | Completitud | 60 (50–68, baja) | Buzones por propósito, rotación del token, cola, reintento y descarte, adjuntos; handler de facturas real. | Antivirus; verificación DMARC propia. |
| 2 | Integridad | 60 (baja) | Deduplicación por `messageId` y organización (`inbound-mail.service.ts:120`); procesamiento con `withTenant`. | Prueba E2E. |
| 3 | Multi-país | N/A | Canal agnóstico; el parsing fiscal corresponde a la captura de CxP. | — |
| 4 | Arquitectura | 65 | Separa transporte, payload, servicio y handlers por propósito (puerto). | — |
| 5 | Higiene | 62 | CxP se registra como handler; dependencia en la dirección correcta. | — |
| 6 | Calidad de código | 65 | — | — |
| 7 | Robustez | 55 | Cola con intento final. Límites de tamaño y cantidad (`inbound-payload.ts:56`, skipped por type/size/count). | Límite del cuerpo crudo no verificado. |
| 8 | Seguridad | 55 (45–62, baja) | HMAC con secreto; si falta el secreto se rechaza (`controller:62-65`). Token de 16 bytes aleatorios (`service:76`). Pero: verdicto SPF/DKIM ausente = aceptado (solo rechaza `authenticated === false`, `service:104`); `allowedSenders` vacío = cualquiera (`inbound-payload.ts:145`); sin antivirus (búsqueda `virus|clam` en el módulo: 0 resultados). | Exigir verdicto, remitentes por defecto, antivirus. |
| 9 | Pruebas | 40 (baja) | 2 specs unitarios (payload, servicio); nada E2E. | Prueba del webhook firmado y del enrutamiento entre tenants. |
| 10 | Operabilidad | 55 | Estados RECEIVED, FAILED, etc. con motivo. | Métricas. |
| 11 | UX | 55 (baja) | Bandeja de entrada; no probada. | — |
| 12 | Competitividad | 55 | A la par de forward-to-email básico. | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | Cumple (estático) | — |
| 2 | Integridad | Cumple (estático) | — |
| 3 | Aislamiento | Cumple (estático) | Token y `withTenant`; listados filtrados por `organizationId`. No ejecutado. |
| 4 | Validación en servidor | Cumple (estático) | — |
| 5 | E2E | No verificado | — |
| 6 | Cumplimiento por país | N/A | — |
| 7 | CI | No verificado | — |
| 8 | Auditoría | Parcial | Rotación con `createdByUserId`. |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | — |
| 11 | UI | No verificado | — |
| 12 | Documentación | Parcial | Formato del payload documentado en `inbound-payload.ts:1-15`. |

## 6. Hallazgos
**MAIL-01** — eje 8 · Seguridad · **Alta**
- **Ubicación:** `inbound-mail.service.ts:104`.
- **Qué pasa:** un correo sin verdicto SPF/DKIM se acepta. Junto con `allowedSenders` vacío por defecto (`inbound-payload.ts:145`, `if (!allowed.length) return true`), cualquiera que conozca la dirección `bills+<token>@` puede inyectar facturas en la bandeja de CxP del tenant. La dirección suele reenviarse a proveedores, así que no es secreta en la práctica.
- **Mitigación existente:** las facturas pasan por revisión o borrador. No se verificó si la captura crea borradores sin intervención.
- **Forma correcta:** exigir `pass` en el verdicto (o DMARC aligned) y avisar o poner en cuarentena a remitentes no listados.
- **Esfuerzo:** S.

**MAIL-02** — eje 8 · **Alta**
- **Qué pasa:** no hay escaneo antivirus de los adjuntos, que se almacenan y se descargan desde la bandeja (`GET …/attachments/:attachmentId`). Solo filtra por tipo y tamaño. No se verificó si el tipo se comprueba por contenido (magic bytes) o solo por el `contentType` declarado.
- **Esfuerzo:** M.

**MAIL-03** — eje 9 · **Media**. Sin prueba E2E del webhook firmado ni del enrutamiento entre tenants con BD.

## 7. Camino mínimo
1. MAIL-01 (S)
2. MAIL-02 (M)
3. Prueba E2E (S)

## 8. Camino a 100
| Mejora | Puntos | Esfuerzo |
|---|---|---|
| Verdictos obligatorios y DMARC | +8 | S |
| Antivirus/sandbox | +10 | M |
| Validación por magic bytes | +4 | S |
| E2E en CI | +8 | S |
| Métricas | +5 | S |

## 9. Competitividad (55)
Comparable al forward-to-email de QuickBooks y al alias de Odoo. Le faltan la cuarentena y el escaneo que ofrecen Dext y Bill.com.

## 10. Fortalezas
- HMAC obligatorio.
- Token rotable no adivinable.
- Deduplicación por Message-ID.
- Handlers desacoplados por propósito.

## 11. No verificado
- Todo lo ejecutable: webhook, procesamiento, captura de IA y UI.
- Cómo se comprueba el tipo de los adjuntos.

Cobertura: ~60 % de los archivos leídos (parcialmente) y 0 endpoints ejecutados.

<!-- RESUMEN: modulo=correo-entrante; madurez=52; prep=50; veredicto=Piloto controlado (confianza baja); eje_debil=Pruebas; criticos=0; altos=2; camino_min=M -->
