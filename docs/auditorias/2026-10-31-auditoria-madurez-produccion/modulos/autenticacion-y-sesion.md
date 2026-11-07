# Ficha: Autenticación y sesión (T01 — familia F1 Identidad y acceso)

> **HALLAZGOS CRÍTICOS ABIERTOS**
> - **AUTH-01 (Crítica, funcional/seguridad):** la recuperación de contraseña está ROTA para toda cuenta existente: `POST /auth/forgot-password` responde **500** (`TypeError: ms is not a function`, `auth/services/password-recovery.service.ts:5,63,231`) y **200** para correos inexistentes → nadie puede recuperar su contraseña y además hay un **oráculo de enumeración de cuentas** trivial. Reproducido 3 veces (2026-10-31 18:34 y 2026-11-01 01:04, log `scratchpad/logs/api5.log:4294`).
> - **Toma de cuenta del administrador por un usuario con `users:edit`** — hallazgo `USR-01` de la ficha `usuarios-roles-permisos.md` (afecta directamente a este módulo: cambio de email administrativo sin confirmación ni jerarquía + cierre de sesiones de la víctima). Probado por HTTP.

## 1. Identificación
- **Alcance backend:** `apps/backend/api/src/app/auth` (111 archivos no-spec, ~15.300 LOC, 36 specs), `apps/backend/api/src/app/security` (12 archivos, 550 LOC, 3 specs). Controladores: `auth.controller`, `auth-session`, `auth-mfa`, `auth-webauthn`, `auth-step-up`, `auth-social`, `auth-registration`, `sso-admin`. 33 rutas `@Public` en auth + MCP OAuth (`ai/mcp/*`). Entidades: `refresh_tokens`, `verification_codes`, `pending_registrations`, `identity_providers`, `legal_acceptances` (+ `user_security` en users).
- **Frontend:** `features/auth` (25 ts, 8 specs), `core/auth` (3 ts, 2 specs), `libs/shared/util-auth` (163 LOC).
- **Países:** N/A (transversal); el alta (RegistrationService) tiene estrategias por país (`strategies/registration/country-registration.strategy.ts`), no auditadas a fondo.
- **Dependencias:** users, roles, organizations, saas/payment (alta con checkout), mail (cola Bull), Redis (denylist, contadores, caché de principal).
- **¿Núcleo para vender?** Sí: sin autenticación segura no hay producto.

## 2. Estándar de referencia (escrito antes de revisar a fondo)
- **Básicas:** login con hash fuerte (Argon2id/bcrypt), sesión en cookie HttpOnly/Secure/SameSite o token corto + refresh rotado con detección de reutilización; CSRF en flujos de cookie; logout y revocación global; recuperación de contraseña con token de un solo uso, caducidad corta, respuesta uniforme (sin enumeración); limitación por IP y por cuenta; bloqueo temporal con desbloqueo; MFA TOTP + códigos de respaldo; política de contraseñas con comprobación de filtraciones (HIBP); auditoría de eventos de autenticación.
- **Avanzadas:** passkeys/WebAuthn, SSO empresarial OIDC/SAML con verificación de dominio y JIT provisioning, SCIM, step-up/re-autenticación por acción sensible, políticas de MFA obligatoria por tenant, detección de riesgo (viaje imposible), gestión de sesiones por dispositivo, rotación de claves de firma (JWKS), suplantación auditada.
- **Invariantes:** ninguna respuesta distingue "cuenta existe/no existe"; cambiar/restablecer contraseña invalida todas las sesiones; refresh reutilizado revoca la familia; secretos nunca con valores por defecto fuera de desarrollo; seed de desarrollo imposible en producción.
- **Líderes:** Okta/Auth0/Entra ID ofrecen todo lo anterior + SAML, SCIM, MFA adaptativa, detección de credenciales filtradas y bot detection (fuente: documentación pública de Auth0 "Attack Protection" y Entra "Conditional Access"; confianza alta). OWASP ASVS v4 cap. 2–3 y OWASP Forgot Password Cheat Sheet como vara técnica (confianza alta).
- **Construcción de referencia:** módulo de identidad con puertos hacia usuarios/tenancy, guards globales "deny by default", almacén compartido (Redis) para contadores y denylist, claves asimétricas rotables, pruebas de integración de los flujos de sesión.

## 3. Resultado
- **Madurez: 55** (48–62, confianza media-alta) — tope por hallazgo crítico abierto (≤59).
- **Preparación comercial: 52 — No listo** (compuerta 1 y 5 incumplidas por AUTH-01; compuerta 3 incumplida por USR-01).
- **Eje más débil:** 1 Autenticidad y completitud funcional (recuperación de contraseña inutilizable).
- **Críticos abiertos:** 1 propio (AUTH-01) + 1 cruzado (USR-01).

## 4. Doce ejes
| Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad/completitud | 50 (42–58, alta) | Login, refresh, logout, logout-all, sesiones, 2FA TOTP, WebAuthn, SSO OIDC, step-up, desbloqueo por email existen y son reales; **forgot-password 500 para toda cuenta real** (AUTH-01). SAML/SCIM no encontrados (grep `saml\|scim` en auth: sin resultados funcionales). | Arreglar AUTH-01 + test E2E; SAML y SCIM para venta enterprise. |
| 2 Corrección/integridad | 62 (55–68, media) | Rotación de refresh con detección de reutilización probada (familia revocada y access token invalidado al instante); reset invalida sesiones (`password-recovery.service.ts` incrementa `tokenVersion` + `terminateAllSessions`). Bug de contador step-up (AUTH-03). | Contadores atómicos coherentes; pruebas de concurrencia. |
| 3 Multi-país | N/A | Transversal. | — |
| 4 Arquitectura | 72 (65–78, media) | Guards globales ordenados (`app.module.ts:389-476`), puertos (`auth/ports/*`), principal desacoplado (`security/principal.ts`). Pero `auth` es enorme (15k LOC) y mezcla alta/registro con pago (`registration-payment.port`). | Separar registro/alta y SSO-admin como submódulos; reducir AuthService (864 LOC). |
| 5 Higiene/separación | 60 (52–66, media) | `verify:boundaries` FALLA con identidad→contabilidad +1 (ver logs globales). `auth` importa entidades de `users` (`users/entities/...`) y `saveIdentity` de `users/persistence`. | Un dueño por dato (users posee `user_security`), sólo puertos entre módulos. |
| 6 Calidad de código | 62 (55–70, media) | Código muy comentado y defensivo, pero comentarios de "FIX" que no garantizan corrección (el `import * as ms` roto lo demuestra); `any` en manejadores (`stripe`/2FA). | Lint estricto `no-explicit-any`, test de humo por endpoint público. |
| 7 Robustez/rendimiento | 60 (50–68, media) | Argon2id 64MB/t3 por login; limitación de login 5/min por IP (`auth.controller.ts:88`, `AuthConfig.THROTTLE_LIMIT`) y bloqueo 5 fallos/15 min; ThrottlerModule duplicado (`auth.module.ts:121` y `app.module.ts:243`) con TTL ambiguo (hallazgo global ya registrado). Límite por IP compartido: detrás de NAT corporativo bloquea a toda la empresa. | Límite por cuenta+IP con almacén Redis único, backoff progresivo, CAPTCHA adaptativo. |
| 8 Seguridad/aislamiento | 50 (42–58, media-alta) | Fuertes: cookies HttpOnly + SameSite=Lax, `__Host-`/`Secure` fuera de dev (`cookie.service.ts:108-123`); CSRF global double-submit firmado y ligado al usuario + `Sec-Fetch-Site` (probado: sin token 403, token falso 403, cross-site 403); JWT RS256 con `alg` fijado, sólo cookie (Bearer rechazado 401), `kid` y JWKS; claves efímeras sólo en dev (`key-management.service.ts:59`); secretos con fail-fast fuera de dev (`auth.config.ts`); logout revoca access y refresh (probado). Débiles: AUTH-01 (enumeración), USR-01 (toma de admin), AUTH-02. | Cerrar AUTH-01/USR-01; tests de enumeración en CI. |
| 9 Pruebas | 60 (52–68, media) | 36 specs en auth (login, step-up, sesión, registro); CI corre integración con `DB_HOST` (`ci.yml:58`). Ningún test cubre `sendPasswordResetLink` con el módulo `ms` real (el 500 llegó a HEAD). | Test de integración HTTP de cada ruta `@Public` (status ≠ 500). |
| 10 Operabilidad | 65 (58–72, media) | Eventos de auditoría de login (`listeners/auth-audit.listener.ts`), logs `[SECURITY]` estructurados, correlationId por login. | Métricas/alertas de fallos de login y de 5xx en rutas públicas. |
| 11 UX | 55 (45–62, baja) | Mensajes localizados; política de contraseña servida por API. Step-up limitado a 5 por 5 min incluso si aciertas (AUTH-03); validación fallida consume el step-up. UI no probada con navegador. | Probar flujos en UI; arreglar AUTH-03. |
| 12 Competitividad | 60 (50–68, media) | Passkeys, step-up por alcance, MFA obligatorio por tenant, viaje imposible: por encima de ERPs locales; sin SAML/SCIM/MFA adaptativa frente a Okta/Entra. | SAML 2.0, SCIM 2.0, políticas de acceso condicional. |

Promedio simple de ejes aplicables ≈ 60; madurez 55 por tope de crítico.

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, capacidades básicas | **No cumple** | Recuperación de contraseña rota (AUTH-01). |
| 2 | Integridad en escrituras críticas | Cumple (con reservas) | Refresh rotado con detección de reutilización; reset transaccional parcial (cache clear antes de save). |
| 3 | Autorización y aislamiento | **No cumple** | USR-01 (cruzado). Por lo demás: 800/800 rutas con marcador, deny-by-default. |
| 4 | Validación en servidor | Cumple | `ValidationPipe` whitelist + forbidNonWhitelisted (`main.ts:201-203`), probado (campos extra → 400). |
| 5 | Flujos E2E sin 500 | **No cumple** | forgot-password 500. |
| 6 | Cumplimiento por país | N/A | — |
| 7 | Pruebas en CI | Cumple parcialmente | Specs + integración en CI; hueco en recuperación. |
| 8 | Auditoría de operaciones sensibles | Cumple | Eventos de login/lockout; audit en email-change admin. |
| 9 | Migraciones | Cumple | Global OK. |
| 10 | Observabilidad | Cumple parcialmente | Logs estructurados, sin métricas. |
| 11 | UI/traducciones | No verificado | UI no probada. |
| 12 | Documentación | Cumple parcialmente | `.env.example` extenso; sin runbook de rotación de claves. |

## 6. Hallazgos
**AUTH-01** — auth; ejes 1, 8. **Categoría:** bug / seguridad. **Severidad: Crítica.** **Ubicación:** `apps/backend/api/src/app/auth/services/password-recovery.service.ts:5` (`import * as ms from 'ms'`), `:63`, `:231`; endpoint `POST /api/v1/auth/forgot-password`. **Qué está mal:** con `esModuleInterop: true` (`apps/backend/api/tsconfig.json:14`) el namespace import de `ms` no es invocable; `convertToMs` lanza `TypeError: ms is not a function` en cuanto el correo existe. Pasos: `curl -X POST /auth/forgot-password -d '{"email":"qa-b@virtex.test"}'` → 500; con `nobody2-qa-f1@virtex.test` → 200 "Si existe una cuenta…". Log `api5.log:4294`. Consecuencias: (1) ningún usuario puede restablecer su contraseña; (2) oráculo de enumeración perfecto que anula todo el trabajo anti-enumeración del login. **Forma correcta:** `import ms from 'ms'` o usar `parseDuration` de `auth.config.ts`; respuesta uniforme siempre (envolver en try/catch y encolar); test de integración. **Impacto:** bloquea la venta. **Esfuerzo:** S.

**AUTH-02** — auth; eje 8. **Categoría:** seguridad. **Severidad: Media.** **Ubicación:** `password-recovery.service.ts` `sendPasswordResetLink`. **Qué está mal:** para cuentas inexistentes espera 500 ms fijos; para existentes hace escritura en BD + encolado sin igualar tiempos → oráculo temporal (no medido con rigor por el throttling compartido; inferido del código). **Forma correcta:** procesar de forma asíncrona (cola) y responder en tiempo constante. **Impacto:** riesgo operativo. **Esfuerzo:** S.

**AUTH-03** — auth; ejes 2, 11. **Categoría:** bug. **Severidad: Media.** **Ubicación:** `apps/backend/api/src/app/cache/atomic-cache.service.ts:116-134`; `auth/auth.service.ts:600,652,835-846`. **Qué está mal:** `increment` usa el cliente Redis directo (`INCR step-up-attempts:<uid>`) pero `reset` borra vía `cacheManager.del` (espacio de nombres de Keyv), así que el contador nunca se reinicia tras un step-up correcto. Verificado: tras 8 step-ups correctos `redis-cli GET step-up-attempts:133a5ada…` = 9 y el 9.º recibe 403 `too_many_verification_attempts_wait_minutes`. Un administrador queda bloqueado para acciones sensibles tras 5 re-autenticaciones en 5 min. Además un 400 de validación posterior al guard consume el token de step-up de un solo uso. **Forma correcta:** `reset` con el mismo cliente (`DEL` sobre la clave cruda). **Impacto:** riesgo operativo/UX. **Esfuerzo:** S.

**AUTH-04** — auth; eje 7. **Categoría:** robustez. **Severidad: Media.** **Ubicación:** `auth.controller.ts:88-96` + `auth.module.ts:121-146` + `app.module.ts:243-270`. **Qué está mal:** limitación de login sólo por IP (sin clave por cuenta) y dos `ThrottlerModule` con configuración divergente (ya registrado globalmente); el bloqueo por cuenta (5 fallos / 15 min) permite a un atacante bloquear cuentas ajenas a voluntad (mitigado por email de desbloqueo `account-unlock.service.ts`). **Forma correcta:** throttler único, clave `ip+email`, backoff progresivo y CAPTCHA tras N fallos. **Impacto:** riesgo operativo. **Esfuerzo:** M.

**AUTH-05** — auth; eje 12. **Categoría:** competitividad. **Severidad: Alta.** **Ubicación:** `auth/services/enterprise-sso.service.ts` (sólo OIDC). **Qué está mal:** sin SAML 2.0 ni SCIM (búsqueda `saml|scim` en `apps/backend/api/src/app`: sin implementación). Clientes enterprise lo exigen. **Forma correcta:** SAML SP + SCIM 2.0 dentro del módulo SSO. **Impacto:** brecha competitiva. **Esfuerzo:** L.

**AUTH-06** — auth; eje 5. **Categoría:** higiene. **Severidad: Media.** `auth` escribe en tablas de `users` (`saveIdentity`, `UserSecurity`) y depende de `organizations`/`payment` vía puertos parcialmente. **Forma correcta:** users dueño de `user_security`; auth sólo por puerto. **Esfuerzo:** M.

## 7. Camino mínimo a producción
1. AUTH-01 arreglar import + respuesta uniforme + test HTTP (S).
2. USR-01 (ficha usuarios) jerarquía de actor y confirmación por el nuevo correo (M).
3. AUTH-03 contador step-up (S).
4. Smoke test automatizado de las 45 rutas `@Public` (ninguna 500) en CI (S).
5. AUTH-04 throttler unificado por cuenta+IP (M).

## 8. Camino a 100
| Ítem | +pts | Esfuerzo | Retocar/rehacer |
|---|---|---|---|
| AUTH-01 + test | +8 (eje 1, 8) | S | Retocar |
| USR-01 | +6 (eje 8) | M | Retocar |
| AUTH-03/AUTH-02 | +3 | S | Retocar |
| Throttler por cuenta + bot detection | +3 | M | Retocar |
| SAML + SCIM | +6 (eje 12) | L | Nuevo submódulo |
| Partir AuthService/registro | +3 (ejes 4–5) | M | Reorganizar |
| Métricas de seguridad y alertas | +2 | S | Retocar |

## 9. Competitividad
- **Básicas faltantes:** recuperación de contraseña funcional (hoy rota).
- **Avanzadas:** SAML, SCIM, acceso condicional/MFA adaptativa (Okta, Auth0, Entra — confianza alta). NetSuite y Dynamics 365 delegan en IdP con SAML (confianza alta); Odoo ofrece OAuth/LDAP y SAML en Enterprise (confianza media).
- **Diferenciadores existentes:** passkeys, step-up por alcance con un solo uso, MFA obligatoria por tenant con sesión retenida, detección de viaje imposible, refresh con detección de reutilización. Por encima de Alegra/Siigo/CONTPAQi (confianza media).
- **Nota competitividad:** 60 (50–68, media).

## 10. Fortalezas a preservar
Guards globales deny-by-default (JWT, CSRF, permisos, MFA, suscripción); CSRF ligado al usuario + Sec-Fetch-Site; RS256 sólo-cookie; detección de reutilización de refresh que invalida al instante el access token; step-up de un solo uso por alcance; secretos y seed gobernados por lista blanca de entorno (`config/environment.ts`, `dev-seeder.service.ts:59-66`); login sin oráculo de bloqueo.

## 11. No verificado
2FA TOTP/WebAuthn/SSO OIDC por HTTP (requieren dispositivo/IdP); MCP OAuth consent; impersonación; UI Angular; comportamiento con `NODE_ENV=production` (cookies `__Host-`); estrategias de registro por país; timing preciso (throttling compartido por todos los auditores desde 127.0.0.1).

**Pruebas ejecutadas (resumen):** login qa-a (200, cookies HttpOnly SameSite=Lax; sin Secure por dev); POST sin CSRF/CSRF falso/`sec-fetch-site: cross-site` → 403/403/403; Bearer en cabecera → 401; refresh rotado y reutilización del viejo tras 3 s → 401 `AUTH_REFRESH_TOKEN_REVOKED` y la sesión nueva también 401; logout → access y refresh viejos 401; login email inexistente vs existente → mismo cuerpo 401; forgot-password inexistente 200 / existente 500.

**Cobertura honesta:** ~35% de archivos de auth leídos (controladores, AuthService login/step-up, cookie, CSRF, recovery, config, key-management), ~25% de rutas ejecutadas por HTTP; frontend no inspeccionado.

<!-- RESUMEN: modulo=autenticacion-y-sesion; madurez=55; prep=52; veredicto=No listo; eje_debil=1 Autenticidad y completitud; criticos=1; altos=1; camino_min=M -->
