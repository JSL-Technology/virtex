# Ficha: Suscripción SaaS y pagos (T04 — familia F1)

> Sin hallazgos CRÍTICOS de seguridad abiertos en este módulo. El punto más serio es la **falta de reconciliación de estado de suscripción en tiempo real** (hallazgo SAAS-02, Alto) y que no se pudo probar el webhook con una clave Stripe real (entorno usa el adaptador simulado).

## 1. Identificación
- **Backend:** `saas` (24 archivos no-spec, 2.617 LOC, 5 specs) y `payment` (11 archivos, 1.768 LOC, 1 spec). Endpoints saas: `GET /saas/plans` (público), `GET /saas/usage` (`billing:view`); payment: checkout-session, overview, checkout/confirm, invoices, portal-session, **webhook** (público, sin CSRF). Entidades: `saas_plans`, `saas_plan_limits`, `saas_plan_features`, `saas_usage_metrics`, `payment_webhook_events`, `organization_subscription_history`.
- **Frontend:** `features/payment` (3 ts, 0 specs) + componentes de billing en settings.
- **Países:** moneda por plan (USD base; `priceFor` por slug/moneda). Precios en **enteros de unidades menores** (`monthlyPrice:900, minorUnits:100` → dinero correcto, no float). Verificado en `GET /saas/plans`.
- **Dependencias:** organizations (estado de suscripción vive en `organizations`), auth/registro (alta con checkout), invoices/customers/etc. (consumen límites).
- **¿Núcleo para vender?** Sí para el modelo SaaS (cobro y límites de plan).

## 2. Estándar de referencia
- **Básicas:** catálogo de planes, checkout, webhooks firmados e idempotentes, aplicación de límites de plan en el servidor, ciclo de vida (trial, activo, impago/gracia, cancelación, suspensión) con bloqueo efectivo, portal de facturación.
- **Avanzadas:** prorrateo, cambios de plan, dunning (reintentos de cobro), facturación por uso/metered, multimoneda, impuestos sobre la suscripción, reconciliación periódica.
- **Invariantes:** firma de webhook verificada; cada evento procesado una sola vez (idempotencia); el estado de la cuenta refleja al proveedor; un plan superado se rechaza en el servidor; dinero en enteros.
- **Líderes:** Stripe Billing (webhooks firmados, idempotencia por `event.id`, dunning configurable), Chargebee (dunning + prorrateo + impuestos) — confianza alta (documentación pública de Stripe/Chargebee).
- **Construcción de referencia:** adaptador de pasarela tras un puerto, verificación de firma sobre el cuerpo crudo, tabla de eventos procesados, guard global de entitlement.

## 3. Resultado
- **Madurez: 60** (52–68, confianza media) — sin crítico abierto; tope por min(ejes 1,2,8) y dependencias no probadas con Stripe real.
- **Preparación comercial: 62 — Piloto controlado** (compuertas críticas cumplen en código; límites y entitlement aplicados en servidor; webhook no probado con clave real).
- **Eje más débil:** 2 Corrección/integridad (reconciliación y orden de eventos).
- **Críticos abiertos:** 0.

## 4. Doce ejes
| Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad/completitud | 62 (54–70, media) | Checkout, confirm, overview, invoices, portal real contra Stripe (`stripe-payment.adapter.ts`); adaptador simulado para dev que **rechaza webhooks** (`simulated-payment.adapter.ts:198`, 503). Catálogo de planes real y DTO allow-listed (el `GET /payment/config` que filtraba price IDs fue retirado, `payment.controller.ts:170`). | Cambio de plan/prorrateo; dunning configurable. |
| 2 Corrección/integridad | 55 (46–63, media) | Idempotencia de webhook por `event.id` en tabla `payment_webhook_events` dentro de transacción (`stripe-payment.adapter.ts:654-707`); firma verificada sobre `rawBody` (`:647`). **Pero** `subscription.updated/deleted` sólo actúa si encuentra `organization` por `externalSubscriptionId` y no hay reconciliación por marca de tiempo del evento (posible desorden); grace sólo se extiende, nunca se acorta. | Ordenar por `event.created`; reconciliación periódica (ya hay cron de usage, no de estado). |
| 3 Multi-país | 55 (45–63, baja) | Precios por moneda y unidades menores correctos; **sin impuestos sobre la suscripción** (IVA/ITBIS no aplicados al cobro SaaS). Verificar con contador local. | Stripe Tax o cálculo propio por país. |
| 4 Arquitectura | 72 (65–78, media) | Puerto `PaymentGateway` + `resolvePaymentProvider` (`payment-provider.ts:25`), stripe vs simulated por entorno (fuera de dev siempre stripe); entitlement como `APP_GUARD` (`SubscriptionActiveGuard`). | — |
| 5 Higiene/separación | 60 (52–66, media) | El estado de suscripción vive en `organizations` (no en saas), lo que acopla; `payment` escribe en `Organization`. | Un dueño claro del estado de suscripción. |
| 6 Calidad | 62 (54–68, media) | `manager: any` en los handlers de webhook (`stripe-payment.adapter.ts:712,891`); resto tipado. | Tipar `EntityManager`. |
| 7 Robustez/rendimiento | 60 (52–66, media) | Webhook idempotente y transaccional; throttler en webhook; caché de entitlement por org con invalidación. | Reintentos/cola para eventos fallidos (hoy lanza y Stripe reintenta). |
| 8 Seguridad/aislamiento | 68 (60–74, media) | Webhook `@Public @SkipCsrf` pero **exige firma** (probado: sin `stripe-signature` → 400; con firma inválida → 503 en simulado / 400 verificación en stripe). Confirmación de checkout liga la sesión al tenant (`claims.organizationId !== organizationId` → rechazo, `simulated-payment.adapter.ts:133`). `billing:view/manage` + step-up `manage_payment` en rutas sensibles. | Verificado sólo en simulado; probar firma Stripe real. |
| 9 Pruebas | 52 (44–60, media) | 5 specs saas (entitlements, usage-report) + 1 spec stripe-adapter; `payment.service` es passthrough sin test propio. | Tests de ciclo de vida (impago→gracia→suspensión) y de orden/duplicado de webhook. |
| 10 Operabilidad | 62 (54–68, media) | Logs estructurados de billing; cron de reconciliación de usage (`saas-cron.service.ts`, 02:00, con lock). | Alertas de webhooks fallidos y de suscripciones en impago. |
| 11 UX | N/A (no verificado) | `features/payment` no probado en navegador. | — |
| 12 Competitividad | 58 (50–66, media) | Límites por plan reales en servidor; metered AI credits. Sin prorrateo/dunning/impuestos frente a Stripe Billing/Chargebee. | Dunning, prorrateo, impuestos, cambios de plan self-service. |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas / básicas | Cumple (con reserva) | Stripe real en prod; simulado sólo en dev y rechaza webhooks. |
| 2 | Integridad escrituras | Cumple parcialmente | Idempotencia + firma OK; falta orden por `event.created` y reconciliación de estado (SAAS-02). |
| 3 | Autorización/aislamiento | Cumple | Firma de webhook; checkout ligado al tenant; rutas con permiso + step-up. |
| 4 | Validación servidor | Cumple | DTOs; firma obligatoria. |
| 5 | E2E sin 500 | Cumple parcialmente | Webhook simulado 503 (por diseño); flujo real no probado. |
| 6 | Cumplimiento por país | **No cumple** | Sin impuestos sobre la suscripción (verificar con contador). |
| 7 | Pruebas CI | Cumple parcialmente | Specs saas en CI; payment poco cubierto. |
| 8 | Auditoría | Cumple parcialmente | Logs; sin audit trail de negocio de cambios de suscripción salvo `organization_subscription_history`. |
| 9 | Migraciones | Cumple | Global OK. |
| 10 | Observabilidad | Cumple parcialmente | Logs, sin alertas. |

## 6. Hallazgos
**SAAS-01** — saas/payment; eje 3/6. **Categoría:** multi-país / competitividad. **Severidad: Alta.** **Ubicación:** `stripe-payment.adapter.ts` (creación de checkout) y catálogo de planes. **Qué está mal:** la suscripción se cobra sin impuestos por jurisdicción (no se encontró `tax`/`automatic_tax` en el adaptador). En varios países declarados el SaaS debe facturar con IVA/ITBIS. **Forma correcta:** Stripe Tax o cálculo propio; emitir factura fiscal de la suscripción. **Impacto:** riesgo de cumplimiento (verificar con contador/abogado local). **Esfuerzo:** M.

**SAAS-02** — payment; eje 2. **Categoría:** integridad de datos. **Severidad: Alta.** **Ubicación:** `stripe-payment.adapter.ts:891-915` (`handleSubscriptionUpdated`) y `654-707`. **Qué está mal:** el estado de la suscripción se escribe en el orden de llegada del webhook sin comparar `event.created`/`subscription.status` timestamps; Stripe puede entregar eventos fuera de orden y un `updated` viejo podría pisar a uno nuevo. No hay cron de reconciliación del *estado* de suscripción (sí de *usage*). **Forma correcta:** ignorar eventos más antiguos que el estado almacenado; cron diario que reconcilie estado contra Stripe. **Impacto:** riesgo operativo (cliente suspendido/activo incorrectamente). **Esfuerzo:** M.

**SAAS-03** — payment; eje 6. **Categoría:** calidad. **Severidad: Media.** `manager: any` en handlers de webhook (`:712,891`). **Forma correcta:** tipar `EntityManager`. **Esfuerzo:** S.

**SAAS-04** — payment; eje 9. **Categoría:** pruebas. **Severidad: Media.** `payment.service.ts` es passthrough puro sin tests de los flujos de ciclo de vida (impago→gracia→suspensión). `SubscriptionActiveGuard` sí tiene spec. **Forma correcta:** tests de integración del ciclo con eventos simulados. **Esfuerzo:** M.

**Controles que SÍ funcionan (verificado):**
- **Límites de plan en servidor:** `enforceLimit`/`checkLimit` (`saas.service.ts:714`) se invocan en escritura de users (`users.service.ts:897`), customers (`:137`), suppliers (`:111`), journal-entries (`:158`), invoices (guard `PlanLimitCheckGuard` + `@CheckPlanLimit`). Límites sembrados coherentes (starter/pro/enterprise; starter subsidiaries=0). No sólo se oculta en UI.
- **Webhook:** exige `stripe-signature` (sin ella 400 `missing_stripe_signature_header`); verifica firma sobre `rawBody`; idempotente por `event.id` en tabla + transacción; público y sin CSRF por diseño correcto (firma como autenticación).
- **Entitlement global:** `SubscriptionActiveGuard` como `APP_GUARD` deniega a tenants fuera de `active/trialing/past_due` salvo dentro de gracia; opt-out explícito `@AllowInactiveSubscription` (reproduce el patrón deny-by-default).
- **Precios en enteros de unidades menores** (no float).

## 7. Camino mínimo a producción
1. SAAS-02: orden de eventos por timestamp + cron de reconciliación de estado (M).
2. SAAS-01: impuestos sobre la suscripción en los países que lo requieran (M, verificar con contador).
3. SAAS-04: tests de ciclo de vida impago/gracia/suspensión (M).
4. Prueba real de webhook con clave de test de Stripe en staging (S).

## 8. Camino a 100
| Ítem | +pts | Esfuerzo | Retocar/rehacer |
|---|---|---|---|
| SAAS-02 orden+reconciliación | +5 (eje 2) | M | Retocar |
| SAAS-01 impuestos | +4 (ejes 3,6) | M | Retocar |
| Dunning + prorrateo + cambio de plan self-service | +5 (eje 12) | L | Nuevo |
| Tests de ciclo de vida | +3 (eje 9) | M | Retocar |
| Alertas de billing | +2 (eje 10) | S | Retocar |

## 9. Competitividad
- **Básicas:** cubiertas (planes, límites en servidor, webhook firmado e idempotente).
- **Avanzadas faltantes:** dunning, prorrateo, impuestos sobre la suscripción, cambios de plan self-service, facturación fiscal de la suscripción (Stripe Billing/Chargebee — confianza alta).
- **Diferenciadores:** entitlement como guard global deny-by-default; créditos de IA medidos; reconciliación de usage con lock.
- **Nota competitividad:** 58 (50–66, media).

## 10. Fortalezas a preservar
Puerto de pasarela con adaptador stripe/simulado por entorno; firma de webhook sobre cuerpo crudo + idempotencia por `event.id` en transacción; entitlement como `APP_GUARD`; límites de plan aplicados en el servidor en cada escritura metered; dinero en enteros; checkout ligado al tenant.

## 11. No verificado
Webhook con firma Stripe real (entorno usa simulado, sin clave); flujo de checkout end-to-end; portal de facturación; UI de `features/payment`; comportamiento real de impago→gracia→suspensión con eventos de Stripe; impuestos (requiere decisión fiscal).

**Cobertura honesta:** ~45% del backend de saas/payment leído (controladores, service, adaptador stripe webhook/subscription, simulado, guard, módulo, usage), límites verificados en BD y por los call-sites; webhook probado sólo localmente (simulado). Frontend no inspeccionado.

<!-- RESUMEN: modulo=suscripcion-saas; madurez=60; prep=62; veredicto=Piloto controlado; eje_debil=2 Corrección e integridad; criticos=0; altos=2; camino_min=M -->
