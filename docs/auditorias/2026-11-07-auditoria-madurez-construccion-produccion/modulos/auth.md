# Ficha de módulo — auth

Familia IAM · AppSec/arquitectura · 2026-11-07 · Diagnóstico.

## 1. Identificación
- Backend: `apps/backend/api/src/app/auth` (148 archivos, ~15.330 líneas, 8 controladores). Controladores: `auth` (login, refresh, forgot/reset-password, unlock-account, password-policy), `auth-mfa`, `auth-registration` (alta pagada), `auth-session`, `auth-social` (Google/Microsoft), `auth-step-up` (step-up, impersonación), `auth-webauthn` (passkeys), `sso-admin` (IdP/dominios empresariales).
- Servicios clave: `session-registry.service` (denylist de revocación), `mfa-orchestrator`, `two-factor-auth`, `enterprise-sso`/`oidc-provider`, `account-unlock`, `password.service` (argon2), `key-management` (RS256 JWT), `cookie.service`.
- Frontend: `features/auth`, `core/auth`, `core/guards`, `libs/shared/util-auth`.
- Países: N/A (país se fija en onboarding). Núcleo para vender: **sí, crítico**.

## 2. Estándar de referencia
Cookies `__Host-`/`__Secure-` httpOnly+secure+sameSite; CSRF double-submit; refresh rotativo con detección de reuso y revocación; MFA TOTP + WebAuthn + backup codes; step-up para operaciones sensibles; lockout + rate limit; SSO/OIDC empresarial con verificación de dominio; sin enumeración de usuarios; argon2id para contraseñas; claves de firma gestionadas (no efímeras en prod). Líderes (Auth0, Okta, Azure AD) definen la vara (confianza alta).

## 3. Resultado
- Madurez: **83 (77–88, confianza alta/media)** — amplitud y diseño excelentes; confianza media por no ejercitar SSO/MFA/social en runtime (requieren IdP/tokens externos) y por rama roja de CI.
- Preparación comercial: **82**; Veredicto: **Listo con reservas**.
- Eje más débil: 6 (calidad/lint) y 9 (typecheck api falla por `certificate-trust.spec`, aunque es einvoicing).
- Hallazgos críticos abiertos: **ninguno**.

## 4. Doce ejes
| Eje | Nota | Evidencia | Falta 100 |
|---|---|---|---|
| 1 Funcional | 86 (alta) | login/refresh/logout, MFA TOTP, WebAuthn, backup codes, SSO/OIDC, social, unlock por email, step-up (21 scopes), impersonación, alta pagada | — |
| 2 Integridad | 83 (media) | refresh revocable; `verify:session-revocation` ✓ "todo validador consulta la denylist"; argon2 con config `ARGON2_*` (password.service.ts:36) | pruebas de reuso de refresh token |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 84 (alta) | guards en capas (Jwt→Csrf→ActiveTenant→Throttle→Permissions→MfaEnrolment→Subscription); cookies vía `cookie.service` con prefijos `__Host-` | — |
| 6 Calidad | 66 (media) | parte de 522 warnings api; **4 endpoints con `@UsePipes(new ValidationPipe())` sin whitelist** (IAM-A2) | quitar overrides |
| 7 Robustez | 80 (media) | throttle por-principal; lockout 5 intentos | — |
| 8 Seguridad | **86 (81–90, alta)** | Ver §6: cookies `__Host-`, CSRF global, revocación completa, sin enumeración, lockout+throttle, headers helmet | cerrar IAM-A2; CSP sin `unsafe-inline` |
| 9 Pruebas | 74 (media) | muchas specs (login, step-up, mfa, oidc, sso-domain-claims, session-registry); `api:typecheck` FALLA (einvoicing) y 3 suites rojas | verde en CI |
| 10 Operabilidad | 82 (alta) | headers con `x-request-id`; sin secretos en logs (0 coincidencias de contraseña/token en api.log) | — |
| 11 UX | ver security-onboarding.md | — | — |
| 12 Competitividad | 80 (media) | cubre passkeys + SSO empresarial (nivel Okta básico) | adaptive/risk-based auth |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 Sin fachadas | Cumple | flujos reales |
| 4 Validación servidor | Cumple (con reserva) | ValidationPipe global; 4 overrides locales (IAM-A2) |
| 5 Humo sin 500 | Cumple | login/session/step-up/force-logout OK |
| 7 Pruebas en CI | **No cumple** | typecheck api falla + 3 suites rojas |
| 8 Auditoría | Cumple parcial | `auditTrailService.record` en change-password/email |

## 6. Hallazgos
- **IAM-A1** · auth/eje 8 · seguridad (positivo) · informativo · `services/cookie.service.ts`, `auth.controller.ts`. **Pruebas runtime propias:** (a) **revocación de sesión completa:** tras `POST /users/:id/force-logout` (step-up `manage_user_credentials`), el access-token previo del miembro → **401 `AUTH_SESSION_EXPIRED`** y `POST /auth/refresh` → **401 `AUTH_REFRESH_TOKEN_REVOKED`** (ambos canales revocados). (b) **CSRF global:** POST con cookie pero sin `x-xsrf-token` → 403; con token erróneo → 403 (`auth.invalid_csrf_token`). (c) **Cookies:** `__Host-access_token`/`__Host-auth_session` httpOnly+secure (fuera de dev)+sameSite=lax; `__Host-XSRF-TOKEN` httpOnly:false (double-submit, correcto); `__Secure-oauth_tx` con path `/api/v1/auth`. (d) **Headers helmet:** CSP, COOP, CORP, Referrer-Policy:no-referrer, X-Content-Type-Options:nosniff, X-Frame-Options:SAMEORIGIN, X-XSS-Protection:0. (e) **Lockout** `AUTH_MAX_FAILED_ATTEMPTS=5` + email de desbloqueo single-use; **throttle login 5/min/IP** (observados múltiples 429 en `/auth/login`). (f) **Sin enumeración:** `verify:auth-contract` ✓ "an unknown address and a wrong password are indistinguishable"; forgot-password responde `auth.if_account_exists...`.
- **IAM-A2** · auth/eje 8,6 · Categoría: seguridad/higiene · **media** · `auth.controller.ts:244,370,381,404`. `@UsePipes(new ValidationPipe())` (sin opciones) en change-password, forgot-password, reset-password, unlock-account **anula el pipe global** (pierde `whitelist`+`forbidNonWhitelisted`+`transform`). Los DTOs son estrechos (contraseñas/tokens/email) y los servicios leen campos explícitos, así que el riesgo de mass-assignment es bajo, pero es una inconsistencia que invita a un futuro DTO ancho sin whitelist. Forma correcta: no override, o `new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true})`. Impacto: deuda técnica/riesgo latente. Esfuerzo: S.
- **IAM-A3** · auth/eje 8 · seguridad · **media/baja** · headers CSP. `script-src 'self' 'unsafe-inline'` debilita la defensa XSS; sin `Strict-Transport-Security` en respuestas (probablemente añadido en el borde TLS en prod — **verificar con el equipo**). Forma correcta: CSP con nonces/hashes; HSTS explícito. Esfuerzo: M.
- **IAM-A4** · auth/eje 9 · pruebas · **alta** · `api:typecheck` falla (`einvoicing/.../certificate-trust.spec.ts:25` TS2345) y 3 suites api rojas → CI en rojo (bloquea el gate 7 para TODO el backend, auth incluido). Causa en otro módulo pero afecta la verificabilidad de auth. Esfuerzo: S–M.

## 7. Camino mínimo a producción
1. Quitar los 4 overrides de ValidationPipe (IAM-A2) — **S**. 2. Endurecer CSP y confirmar HSTS en el borde (IAM-A3) — **M**. 3. Verde en CI (IAM-A4) — **S/M**. 4. Verificar SSO/OIDC/social en un entorno con IdP real — **M**.

## 8. Camino a 100
- Risk-based/adaptive auth (+4, L). Detección y prueba de reuso de refresh token en CI (+2, S). CSP con nonces (+2, M).

## 9. Competitividad
Básicas y varias avanzadas cubiertas (passkeys, SSO empresarial, step-up granular). Falta: auth adaptativa por riesgo, device trust (vs Okta/Auth0; confianza alta).

## 10. Fortalezas a preservar
Cookies `__Host-`; CSRF y revocación globales; 21 scopes de step-up; argon2 con config; sin enumeración; sin secretos en logs; gating de `DEV_SEED`/`RECAPTCHA`/claves RS en prod.

## 11. No verificado
SSO/OIDC, social login, WebAuthn y MFA no ejercitados en runtime (requieren IdP/tokens/autenticadores externos; sin efecto externo garantizado). Brute-force con cuenta QA propia no ejecutado por el throttle compartido de localhost (habría contaminado a otros agentes); el rate limit quedó demostrado por los 429 observados y el lockout por config.
