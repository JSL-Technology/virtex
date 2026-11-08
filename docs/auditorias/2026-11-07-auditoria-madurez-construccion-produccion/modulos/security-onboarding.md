# Ficha de módulo — security (cripto, KMS, rate limits, configuración segura) + onboarding

Familia IAM · AppSec/arquitectura · 2026-11-07 · Diagnóstico.

## 1. Identificación
- **security** (backend `apps/backend/api/src/app/security`, 12 archivos, ~550 líneas, sin controladores): decoradores (`@Public`, `@HasPermission`, `@AuthenticatedOnly`, `@CheckPermissions`, `@PlatformPermission`, `@SkipCsrf`, `@CurrentUser`), `PermissionsGuard`, `PlatformPermissionsGuard`, `principal.ts`. La cripto de campos vive en `shared/utils/crypto.util.ts` (AES-256-GCM) y `auth/services/secret-encryption.service.ts`; las claves JWT en `auth/services/key-management.service.ts`; el rate limit en `shared/rate-limit/principal-throttler.guard.ts`; el gating de entorno en `config/env.validation.ts` y `config/environment.ts`.
- **onboarding** (no existe una carpeta backend `onboarding`): registro y alta pagada en `auth/auth-registration.controller.ts` + `RegistrationService.completePendingRegistration`; país y fiscalidad vía `auth-contract`/localization. Frontend en `apps/core/client-web/src/app/features/auth` (`register`, `country-picker`, `checkout-complete`, `set-password`, `login`, `forgot-password`, `reset-password`, `unlock`), `features/payment`, `core/auth`, `core/guards` (`auth-guard`, `permissions-guard`, `country.guard`, `public.guard`), `core/interceptors` (`auth.interceptor` con `withCredentials`, `step-up.interceptor`) y `libs/shared/util-auth`.
- Núcleo para vender: **sí** (puerta de entrada y base de la confianza).

## 2. Estándar de referencia
Cifrado autenticado de campos con rotación de claves; claves de firma persistentes y gestionadas en producción; hashing argon2id; rate limit por principal; ningún comportamiento de desarrollo activable en producción; sin secretos en el repositorio; tokens fuera de JS (cookies httpOnly); onboarding con correo verificado, validación fiscal por país en servidor y rechazo de duplicados antes de cobrar. Referencias: OWASP ASVS v4 capítulos 2, 3, 6 y 14 (confianza alta).

## 3. Resultado
- Madurez **security**: **82 (76–87, confianza alta)**. Madurez **onboarding**: **74 (66–80, confianza media)**, porque la UI no se recorrió de punta a punta.
- Preparación comercial: **78**; Veredicto: **Listo con reservas**.
- Eje más débil: 8 (onboarding: `RECAPTCHA_DISABLED=true` aceptado en producción; clave de Maps embebida) y 11 (UX no verificada).
- Críticos abiertos: **ninguno**.

## 4. Doce ejes
| Eje | Nota | Evidencia | Falta 100 |
|---|---|---|---|
| 1 Funcional | 78 (media) | alta real (los tenants QA se crearon con `completePendingRegistration`); selector de país; checkout; set-password desde invitación | recorrer la UI de alta |
| 2 Integridad | 80 (media) | `verify:auth-contract` ✓ "a tax id already registered is refused BEFORE checkout, not after the charge"; "signup demands a verified email before anything else" | — |
| 3 Multi-país | 76 (media) | `verify:auth-contract` ✓: países publicados, especificación fiscal por país, RFC inválido rechazado con etiqueta "RFC", régimen fiscal MX exigido, EE. UU. con SSN/ITIN y estados codificados; sin mensajes en inglés filtrados a respuestas en español | verificar los 19 mercados con contador local (solo se cubrieron DO/MX/US) |
| 4 Arquitectura | 82 (alta) | `verify:security` ✓ "crypto: 4 sanctioned implementation(s), no others"; "env-gating: every environment decision goes through the allow-list" | — |
| 6 Calidad | 70 (media) | lint client-web con 480 warnings (156 `any`) | — |
| 7 Robustez | 78 (media) | throttle por usuario+org (autenticado) o por IP (anónimo), sin confiar en `X-Forwarded-For`; registro limitado a 20/min | — |
| 8 Seguridad | **82 (76–87, alta)** | Ver §6 | IAM-S1, IAM-S2 |
| 9 Pruebas | 74 (media) | specs de guards e interceptors en el front (239 suites en verde); `verify:auth-contract` | e2e de alta en navegador |
| 10 Operabilidad | 80 (alta) | 0 contraseñas o tokens en `api.log`; `x-request-id` en cada respuesta | — |
| 11 UX | 62 (baja) | no recorrida con Playwright | prueba de UI |
| 12 Competitividad | 72 (media) | alta con validación fiscal por país en servidor, por encima de muchos ERP locales | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | Cumple | alta real |
| 2 | Integridad | Cumple | duplicado fiscal rechazado antes del cobro |
| 3 | AuthZ | Cumple | rutas públicas acotadas (login, alta, recuperación, webhooks, planes, salud) |
| 4 | Validación servidor | Cumple | validación fiscal por país en servidor |
| 6 | Cumplimiento por país | **Cumple parcial** | DO/MX/US verificados por `auth-contract`; el resto no verificado |
| 11 | UI y traducciones | No verificado | — |
| 12 | Documentación | Cumple parcial | `docs/DEPLOYMENT.md` cubre los roles de BD; no detalla `RECAPTCHA_DISABLED` |

## 6. Hallazgos
- **IAM-S1** · onboarding/eje 8 · seguridad · **media** · `config/env.validation.ts:445-452`. `RECAPTCHA_DISABLED` vale `false` por defecto en producción, pero un `true` explícito **se acepta** en producción, y entonces `RECAPTCHA_V3_SECRET_KEY` deja de ser obligatoria. `DEV_SEED`, en cambio, se rechaza fuera de dev/test (`env.validation.ts:278-282`). Con ese interruptor encendido, registro, login y forgot-password quedan solo con el throttle por IP. Forma correcta: rechazarlo fuera de dev/test, como `DEV_SEED` o `PAYMENT_PROVIDER=simulated`, o exigir un flag de anulación con fecha de caducidad. Impacto: riesgo operativo (alta masiva de cuentas y bots). Esfuerzo: S.
- **IAM-S2** · onboarding (frontend)/eje 8 · seguridad (secreto) · **media** · `apps/core/client-web/src/environments/environment.ts:16` y `environment.development.ts:16`: **clave de API de Google Maps** escrita en el código (`AIzaSy…J6yQ`, valor enmascarado). Es una clave de navegador, pública por naturaleza porque viaja en el bundle, pero sirve para cualquiera que no esté restringido por referrer HTTP y API. La misma clave se usa en desarrollo y en producción. Forma correcta: inyectarla por entorno en el build, usar claves distintas por entorno y restringirlas por referrer (verificar en la consola de Google). Esfuerzo: S.
- **IAM-S3** · security/eje 8 · seguridad (positivo) · informativo. Cifrado de campos **AES-256-GCM** con IV aleatorio y rotación (lista de claves con las anteriores) en `shared/utils/crypto.util.ts:53-96`. Contraseñas con **argon2** y configuración `ARGON2_*` (`auth/services/password.service.ts:36`); códigos MFA y de respaldo también con argon2. `RS_PRIVATE_KEY`/`RS_PUBLIC_KEY` son **obligatorias en producción** (`env.validation.ts:349-350`), sin claves efímeras. `NODE_ENV` debe ser explícito. El escaneo de secretos del repo no encontró claves privadas, AWS, Stripe live ni tokens de GitHub o Slack (0 coincidencias en apps/libs/tools). Los `.p12` de `tools/fixtures/ecf-certificates/test-ecf-*.p12` son fixtures de prueba de e-factura (pertenecen a la familia einvoicing).
- **IAM-S4** · security/eje 6 · higiene · baja · `crypto.util.ts:89`: hay un camino de derivación con la sal literal `'salt'` (`scryptSync(secret, 'salt', 32)`), que parece compatibilidad con datos antiguos. **Verificar con el equipo** que solo sirve para descifrar y nunca para cifrar datos nuevos, y fijar una fecha para retirarlo. Esfuerzo: S.
- **IAM-S5** · onboarding (frontend)/eje 8 · seguridad (positivo) · informativo. El front no guarda tokens en JS: usa `auth.interceptor` con `withCredentials: true` (cookies httpOnly). El borrador del alta guarda en `sessionStorage` solo `{step, savedAt}`, sin PII (`register.page.ts:436-446`, H-08). `permissions-guard` del front es solo cosmético: el servidor deniega por defecto (ver roles-permisos.md).
- **IAM-S6** · security/eje 7 · robustez/operabilidad · baja. El throttle anónimo de login (5/min por IP) bloquea a usuarios legítimos detrás de un NAT compartido. Lo observé en este entorno: varios agentes en localhost se quedaron sin poder iniciar sesión durante minutos. Es correcto contra la fuerza bruta, pero conviene combinar IP con cuenta. Esfuerzo: M.

## 7. Camino mínimo a producción
1. Rechazar `RECAPTCHA_DISABLED=true` fuera de dev/test (IAM-S1), **S**. 2. Mover la clave de Maps a configuración por entorno con restricción por referrer (IAM-S2), **S**. 3. Recorrer la UI de alta de punta a punta (Playwright) en DO, MX y US, **M**. 4. Retirar la sal literal heredada (IAM-S4), **S**.

## 8. Camino a 100
Validación fiscal verificada en los 19 mercados (+5, L, con contador local). Throttle de login por IP y cuenta (+2, M). CSP con nonces (+2, M, ver auth.md). E2E de alta en CI (+2, S).

## 9. Competitividad
La validación fiscal por país en servidor durante el alta y el rechazo del duplicado antes de cobrar están por encima de muchos ERP de LatAm (Alegra y Siigo validan menos durante el alta; confianza baja, no verificado con fuentes).

## 10. Fortalezas a preservar
Superficie cripto cerrada y verificada (`verify:crypto`); gating de entorno con lista blanca; claves RS obligatorias; argon2; sin tokens en JS; sin PII en el storage del navegador; sin secretos en logs.

## 11. No verificado
UI de onboarding y pago no recorrida en navegador. Validación fiscal fuera de DO/MX/US. Restricciones reales de la clave de Maps en Google Cloud. Prueba de fuerza bruta con una cuenta QA propia, que no ejecuté porque el throttle compartido habría bloqueado a los demás agentes.
