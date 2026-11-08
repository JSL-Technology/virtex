# Ficha de módulo — saas + payment (planes, suscripciones, Stripe)

Familia IAM · AppSec/arquitectura · 2026-11-07 · Diagnóstico. **No se hizo ningún cobro**: Stripe no está configurado en este entorno (proveedor `simulated`).

## 1. Identificación
- Backend: `apps/backend/api/src/app/saas` (24 archivos, ~2.634 líneas, 1 controlador: `GET /saas/plans` público, `GET /saas/usage`), con `SubscriptionActiveGuard` (APP_GUARD), `@CheckFeature`/`FeatureFlagGuard` y `saas.config.ts` (límites por plan). `apps/backend/api/src/app/payment` (11 archivos, ~1.768 líneas, 1 controlador: checkout y `POST /payment/webhook`), adaptadores `stripe-payment.adapter.ts` y `simulated-payment.adapter.ts`.
- Tablas: planes/límites, suscripciones (estado y `gracePeriodEnd` en la organización), `payment_webhook_events` (PK = id del evento de Stripe).
- Frontend: `features/payment` (selección de plan y checkout). Núcleo para vender: **sí** (es cómo se cobra).

## 2. Estándar de referencia
Webhooks firmados y verificados sobre el cuerpo crudo, idempotentes y tolerantes al desorden; gracia/dunning (`past_due`) antes de cortar; límites por plan aplicados en servidor; entitlement deny-by-default; el proveedor simulado no puede activarse en producción; conciliación de la suscripción con el proveedor. Referencia: la documentación de Stripe Billing sobre webhooks e idempotencia (confianza alta); Chargebee/Recurly para dunning (confianza media).

## 3. Resultado
- Madurez (calibrada por el coordinador): **55 (48–62, confianza media)**; el agente propuso 74.
- Preparación comercial: **50**; Veredicto: **No listo**.
  - _Motivo de la calibración (Paso 9):_ la causa raíz del crítico **FAC-INV-01** está en este módulo. `saas/repositories/usage-metric.repository.ts:64-108` atrapa el `23505` dentro de la transacción del llamador, y PostgreSQL deja esa transacción abortada. Por eso, al agotarse el cupo del plan, las notas de crédito y anulaciones dan 500. El coordinador lo verificó (ver `09-cobertura-y-verificacion.md`).
  - Hay otros dos problemas:
    - Los límites de plan salen como 500 y no como error de dominio, también en `POST /customers` y en importaciones (PLT-DT-01).
    - La clave del período de cupo de facturas aparece como `2027-11-07` para un período declarado mensual (observado por FAC; verificar).
  - Además, el flujo real con Stripe no se ejercitó. Con un crítico abierto, la madurez queda en ≤59 y la preparación en ≤69, y la compuerta 2 (integridad) no se cumple.
- _(Original del agente: madurez 74, preparación 72, Listo con reservas.)_
- Eje más débil: 9 (sin prueba e2e del webhook real aquí) / 2 (orden de eventos no verificado).
- Críticos abiertos: **ninguno**.

## 4. Doce ejes
| Eje | Nota | Evidencia | Falta 100 |
|---|---|---|---|
| 1 Funcional | 74 (media) | planes reales en BD (`starter` 9,00 USD con límites); `GET /saas/usage` devuelve uso/límite real (qa-do-a: users 2/2, invoices 0/10); checkout y webhook implementados para Stripe | probar el checkout en Stripe modo test |
| 2 Integridad | 72 (media) | webhook en una transacción; idempotencia con PK `payment_webhook_events.id`; dunning con `invoice.payment_failed`/`invoice.paid` | protección contra eventos fuera de orden (comparar `event.created`), no verificada |
| 3 Multi-país | 60 (baja) | precios en USD con `minorUnits`; sin impuestos de venta del SaaS por país en este módulo | facturación del SaaS con IVA/ITBIS por país: verificar con contador local |
| 4 Arquitectura | 80 (alta) | puerto de proveedor con 2 adaptadores; `SubscriptionActiveGuard` global con `@AllowInactiveSubscription()` como excepción explícita | — |
| 6 Calidad | 70 (media) | comentarios precisos; parte de los warnings de api | — |
| 7 Robustez | 72 (media) | throttle en el webhook; un duplicado concurrente falla por PK, se revierte y Stripe reintenta | responder 200 ante un conflicto de PK en vez de error |
| 8 Seguridad | **84 (78–89, alta)** | Ver §6 | — |
| 9 Pruebas | 62 (media) | specs de `subscription-active.guard`; sin e2e del webhook firmado | e2e con firma de prueba |
| 10 Operabilidad | 76 (media) | eventos `payment_provider_simulated`, error claro si falta `STRIPE_WEBHOOK_SECRET` | métricas de webhooks fallidos |
| 11 UX | 65 (baja) | UI de pago no recorrida | — |
| 12 Competitividad | 66 (media) | básico SaaS correcto; sin prorrateo/cupones/facturación anual verificados (`annualBillingAvailable:false`) | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | **Cumple con reserva** | el simulado solo se usa en dev/test; en prod `env.validation.ts:485-495` lo rechaza y exige las `STRIPE_*` |
| 2 | Integridad | Cumple parcial | transacción + PK; orden de eventos no verificado |
| 3 | AuthZ | Cumple | webhook `@Public` + firma; usage por tenant |
| 5 | Humo | Cumple | sin 500 |
| 7 | Pruebas en CI | No cumple | rama roja; sin e2e del webhook |

## 6. Hallazgos
- **IAM-P1** · payment/eje 8 · seguridad (positivo) · informativo · `payment.controller.ts:183-215`, `stripe-payment.adapter.ts:639-660`. Webhook `@Public` + `@SkipCsrf`, la firma `stripe-signature` se verifica con `stripe.webhooks.constructEvent` sobre `rawBody` y exige `STRIPE_WEBHOOK_SECRET`. **Pruebas runtime:** sin cabecera → **400 `payment.missing_stripe_signature_header`**; con firma falsa → **503 `payment.webhooks_unavailable_simulated_provider`** (en este entorno no hay Stripe, así que no se procesa nada).
- **IAM-P2** · payment/eje 1 · funcionalidad simulada (controlada) · **media** · `payment-provider.ts:28-29`, `env.validation.ts:485-495`. Si no hay `STRIPE_SECRET_KEY`, el proveedor por defecto es `simulated`, que "completa checkouts sin cobrar". **Está bloqueado fuera de dev/test**: Joi rechaza `PAYMENT_PROVIDER=simulated` y las claves Stripe dejan de ser opcionales. El riesgo residual es un entorno de staging con `NODE_ENV=development`. Forma correcta: así está; añadir una alerta si un despliegue arranca en modo simulado. Esfuerzo: S.
- **IAM-P3** · payment/eje 2,7 · integridad · **media** · `stripe-payment.adapter.ts:653-700`. La idempotencia es un `findOne` y luego `save` dentro de la transacción (READ COMMITTED). Dos entregas simultáneas del mismo evento pasan el `findOne`; la segunda falla por la PK, su transacción se revierte (no hay doble efecto) y responde error, así que Stripe reintenta. Es correcto en efecto pero ruidoso. Lo más importante: **no se verificó que haya protección contra eventos fuera de orden** (un `subscription.updated` antiguo que llega tarde podría pisar el estado). Forma correcta: `INSERT … ON CONFLICT DO NOTHING` primero y comparar `event.created`/versión de la suscripción. Impacto: riesgo operativo en cobros. Esfuerzo: M.
- **IAM-P4** · saas/eje 1 · funcionalidad · **media** · `GET /saas/usage`: qa-do-a está en users 2/2 (plan starter). No verifiqué si `POST /users/invite` rechaza en servidor al superar el límite (requería step-up más una invitación real). `saas.config.ts:171-174` señala que "un recurso que falta en un plan es ilimitado en ese plan, silenciosamente", lo que hace que el sistema falle abierto ante un olvido de configuración. Forma correcta: fallar cerrado (límite 0) ante un recurso no declarado, o validar en el arranque que cada plan declara todos los recursos (el comentario sugiere que esta validación existe: verificar con el equipo). Esfuerzo: S.

## 7. Camino mínimo a producción
1. Probar checkout y webhooks con Stripe en modo test (firma real, duplicados, desorden), **M**. 2. Protección contra desorden más `ON CONFLICT` (IAM-P3), **M**. 3. Prueba del límite de usuarios al invitar (IAM-P4), **S**. 4. Impuestos sobre la factura del SaaS por país (verificar con contador), **L**.

## 8. Camino a 100
E2E del webhook firmado en CI (+4, S). Prorrateo/upgrade/downgrade verificados (+3, M). Facturación anual y cupones (+3, M). Portal de facturación del cliente (+2, M).

## 9. Competitividad
Cubre lo básico (planes, límites, gracia, dunning). Frente a Chargebee/Stripe Billing nativo le faltan prorrateo verificado, cupones, facturación anual e impuestos por país (confianza media).

## 10. Fortalezas a preservar
Firma sobre `rawBody`; entitlement global deny-by-default; simulado bloqueado en producción; dunning manejado; mensaje de error claro cuando falta el secreto.

## 11. No verificado
Ningún flujo con Stripe real ni en modo test (sin claves, y riesgo de efecto externo). Orden de eventos, prorrateo, límite de plan al invitar y UI de pago no verificados. La confianza baja a media.
