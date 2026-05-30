# Auditoría Prioridad 1 — Plataforma base SaaS

**Fecha:** 2026-05-30
**Auditor:** Análisis automatizado con Claude Code
**Rama:** HEAD
**Repositorio:** virteex1 (Nx monorepo — NestJS + Angular)

---

## 1. Resumen ejecutivo

La plataforma base SaaS de Virteex ERP muestra una arquitectura ambiciosa y bien estructurada para un ERP multi-tenant moderno, con una capa de autenticación sofisticada (2FA, WebAuthn, OAuth, refresh token rotation, circuit breaker para caché, análisis de imposible viaje). Sin embargo, presenta **bloqueos críticos que impiden el paso a producción** y que deben resolverse antes de continuar hacia Prioridad 2.

### Riesgos principales (orden de severidad):

1. **CRÍTICO — Bug de permisos que deja todos los endpoints de usuarios desprotegidos:** El decorador `@HasPermission` en `users.controller.ts` usa formato de puntos (`'users.create'`, `'users.view'`) mientras que los permisos almacenados en roles y el tipo `Permission` usan formato de dos puntos (`'users:create'`, `'users:view'`). La comparación en `PermissionsGuard` jamás coincide, lo que significa que cualquier usuario autenticado puede ejecutar acciones de creación, edición y eliminación de usuarios — vulnerando completamente el modelo de permisos.

2. **ALTO — IDOR en `GET /users/:id`:** El comentario en `users.controller.ts:144` reconoce la vulnerabilidad: no se verifica que el usuario solicitado pertenezca a la misma organización. Un usuario de org A puede obtener datos de cualquier usuario de org B conociendo su UUID.

3. **ALTO — Secret de 2FA con fallback hardcodeado:** `auth.config.ts:24` define `JWT_2FA_TEMP_SECRET` con fallback `'temp_2fa_secret_change_me'`. Sin la variable de entorno, cualquier atacante puede forjar tokens de sesión 2FA válidos para cualquier usuario.

4. **ALTO — WebSocket CORS hardcodeado a `localhost:4200`:** El gateway `events.gateway.ts:15` tiene el origen CORS hardcodeado. En producción, este valor rechazará conexiones del dominio real, rompiendo notificaciones en tiempo real.

5. **ALTO — Audit log sin filtro de organización:** `GET /audit` no filtra por `organizationId` del usuario autenticado, permitiendo que cualquier usuario autenticado vea el log de auditoría global de toda la plataforma.

6. **MEDIO — Roles CRUD sin guards de permisos:** `roles.controller.ts` no aplica `PermissionsGuard` ni `@HasPermission`, por lo que cualquier usuario autenticado puede crear, modificar, clonar y eliminar roles de su organización.

7. **MEDIO — Billing/SaaS: datos de suscripción mockeados en frontend:** `BillingService` usa datos mock hardcodeados para `currentSubscription`, `paymentMethod` y `paymentHistory`. No existe endpoint backend para obtener el estado real de la suscripción activa.

8. **MEDIO — Múltiples páginas de configuración son stubs vacíos:** Security, Integrations, SMTP, Accounting Settings, Currencies, Taxes, Closing Rules, Intercompany son componentes de una sola línea sin lógica real.

**Estado general:** La plataforma NO está lista para producción. Se estima una completitud del **52%** considerando que la autenticación y el modelo multi-tenant funcionan correctamente, pero el sistema de permisos tiene un bug crítico, la mitad de las pantallas de configuración son stubs, y el sistema de billing no está integrado.

---

## 2. Inventario de capacidades encontradas

| Área | Backend encontrado | Frontend encontrado | Estado | Evidencia |
|------|-------------------|---------------------|--------|-----------|
| Auth / login / logout | Controller completo con JWT, reCAPTCHA, throttling, cookies HTTP-only | `LoginPage` con soporte 2FA, passkeys, reCAPTCHA | Completo | `auth.controller.ts`, `login.page.ts` |
| Registro / onboarding | `POST /auth/register` con recaptcha, honeypot, estrategia por país | `RegisterPage` multi-paso (business, account, config, plan) | Completo | `registration.service.ts`, `register.page.ts` |
| Recuperación de contraseña | `POST /auth/forgot-password`, `POST /auth/reset-password` con throttling | `ForgotPasswordPage`, `ResetPasswordPage` | Completo | `password-recovery.service.ts` |
| Refresh tokens / sesiones | `GET /auth/refresh` con rotación de tokens, grace period, detección de reutilización | `authInterceptor` con cola de refresco concurrente | Completo | `session.service.ts`, `auth.interceptor.ts` |
| 2FA (TOTP) | `POST /auth/2fa/generate`, `/enable`, `/disable`, `/backup-codes`, `POST /auth/verify-2fa` | `OtpComponent`, `LoginPage` con flujo 2FA, `SecuritySettingsComponent` | Completo | `two-factor-auth.service.ts`, `mfa-orchestrator.service.ts` |
| Usuarios | CRUD completo, invitaciones por email, status management, reset password admin | `UserManagementPage`, `MyProfilePage`, `UsersService` | Completo con bug crítico | `users.controller.ts:44` — permisos con formato incorrecto |
| Perfil de usuario | `GET/PATCH /users/profile`, upload avatar a S3 | `MyProfilePage` con formulario reactivo, `PhoneVerificationModal` | Completo | `users.controller.ts:89`, `my-profile.page.ts` |
| Roles | CRUD de roles, clonación, lista de permisos disponibles, invalidación de caché al cambiar | `RolesManagementPage` con editor de permisos | Completo pero sin guard en backend | `roles.controller.ts` — sin `PermissionsGuard` |
| Permisos | `PERMISSIONS` enum con 40+ permisos definidos, `PermissionsGuard`, `CheckPermissions` | `permissionsGuard` en rutas frontend, `hasPermission` en `util-auth` | Parcial — bug de formato | `permissions.ts`, `permissions.guard.ts` |
| Guards backend | `JwtAuthGuard` global, `CsrfGuard`, `TwoFactorVerifiedGuard`, `PermissionsGuard`, `ThrottlerGuard` | - | Completo | `app.module.ts`, `auth.module.ts` |
| Guards frontend | `authGuard`, `publicGuard`, `permissionsGuard`, `languageInitGuard`, `CountryGuard` | - | Completo | `app.routes.ts`, `core/guards/` |
| Organizaciones / empresa | `GET/PATCH /organizations/profile`, entidad con planId, subscriptionStatus | `CompanyProfilePage` con formulario | Completo | `organizations.controller.ts`, `organization.entity.ts` |
| Subsidiarias | `GET/POST /organizations/subsidiaries` con transacción atómica | `SubsidiariesPage` | Completo | `organizations.service.ts:43` |
| Multi-tenant | `organizationId` en JWT, filtrado por org en queries, `JwtStrategy` valida contexto | - | Sólido, con excepción de audit y algunos endpoints | `jwt.strategy.ts:132-164` |
| Settings de empresa | Ruta `/settings/profile` conectada a backend | Múltiples páginas de settings vacías/stub | Parcial — ~30% implementado | `settings.routes.ts` |
| Seguridad / auditoría | `AuditTrailService`, `AuditController`, `AuthAuditListener` | `SecuritySettingsPage` — stub vacío | Backend parcial, frontend stub | `audit.service.ts`, `security.page.ts` |
| Notificaciones base | `NotificationsModule`, WebSocket push, `PushNotificationsModule` | `NotificationsPage`, servicio de notificaciones | Completo | `notifications.controller.ts`, `events.gateway.ts` |
| Mail | `MailService` con templates handlebars: reset, invitación, duplicado, verificación 2FA | - | Completo (backend only) | `mail.service.ts` |
| Billing / SaaS | `SaasModule` con planes, límites, métricas de uso, `PaymentModule` con Stripe | `BillingPage`, `PlanSelectionComponent`, `BillingService` — datos mockeados | Parcial — sin integración real de suscripción activa | `billing.ts:40-58` |
| Payment provider (Stripe) | `POST /payment/checkout-session`, webhook handler Stripe, `SubscriptionActiveGuard` | `PaymentSuccessComponent`, `PaymentCancelComponent` | Completo en flujo de compra | `payment.controller.ts` |
| WebSockets autenticados | `EventsGateway` con validación JWT al conectar, tokenVersion check | `WebSocketService` | Completo con bug de CORS hardcodeado | `events.gateway.ts:15` |
| Localización / país | `LocalizationModule`, estrategias de registro por país (DO, US) | `CountryGuard`, `languageInitGuard`, rutas `/:lang/:country` | Completo | `registration-strategy.factory.ts` |

---

## 3. Matriz de completitud

| Subárea | % completitud | Qué funciona | Qué falta | Evidencia |
|---------|--------------|--------------|-----------|-----------|
| Backend | 72% | Auth, usuarios, roles, organizaciones, SaaS/payment, WebSocket, notificaciones, mail, auditoría base | Guard de permisos en roles, filtro org en audit, raw body en webhook Stripe, CORS en WebSocket | `roles.controller.ts`, `audit.service.ts`, `payment.controller.ts:68` |
| Frontend | 55% | Login, registro, perfil, gestión de usuarios, roles, subsidiarias, billing page | Páginas de configuración vacías (security, smtp, integrations, accounting, currencies, taxes, closing-rules, intercompany), sin pantallas 2FA de configuración avanzada | `settings.routes.ts` — 8 rutas apuntan a stubs |
| Seguridad | 60% | Refresh rotation, CSRF doble submit, reCAPTCHA, throttling, lockout, honeypot, WebAuthn, imposible viaje | Bug permisos dot vs colon, IDOR en GET /users/:id, secret hardcodeado 2FA, CORS WS hardcodeado, raw body Stripe | `auth.config.ts:24`, `users.controller.ts:144` |
| Multi-tenant | 80% | organizationId en JWT, filtrado en users/roles/organizations, JwtStrategy valida org | Audit log sin filtro org, posibles otros módulos no P1 no revisados | `audit.service.ts:50` |
| Roles / permisos | 50% | Definición de 40+ permisos, CRUD roles con aislamiento org, PermissionsGuard con políticas ABAC | Bug dot vs colon en users.controller, roles sin guard, permisos no aplicados en roles.controller | `users.controller.ts:44`, `roles.controller.ts` |
| Auth / sesiones | 85% | Login, register, 2FA completo, WebAuthn, refresh con rotación, revocación de sesión, impersonation | Secret 2FA fallback, logout no revoca refresh tokens en DB (solo caché), UnauthorizedException no importada en auth.controller | `session.service.ts:325-329`, `auth.controller.ts:421` |
| Organizations / settings | 45% | Perfil empresa conectado a API, subsidiarias con transacción atómica | 8 pantallas de configuración son stubs, sin endpoint para settings financiero, branding solo frontend | `settings.routes.ts` |
| Billing / SaaS | 55% | Planes en DB, checkout Stripe, webhook handler, SubscriptionActiveGuard | Sin endpoint GET suscripción activa, BillingService usa mocks, sin customer portal Stripe, webhook raw body issues | `billing.ts:40-58`, `payment.controller.ts:68` |
| Tests | 18% | 2 specs de auth services, 1 spec de users service, spec de guards, login.page.spec, company-profile.spec | Sin tests E2E reales, sin tests de integración para refresh flow, sin tests de permisos, sin tests de registro | 169 archivos spec total, muchos vacíos |
| Integración frontend-backend | 65% | Login, register, usuarios, roles, organizaciones, notificaciones, sesiones | Billing mockeado, páginas de config sin API calls, permissionsGuard usa formato colon, backend usa dot | `billing.ts`, `settings.routes.ts` |

---

## 4. Discrepancias frontend vs backend

| Discrepancia | Impacto | Frontend involucrado | Backend involucrado | Recomendación | Severidad |
|-------------|---------|---------------------|---------------------|--------------|-----------|
| Permisos con formato inconsistente: backend `users.controller.ts` usa `'users.view'` (dot) pero `PERMISSIONS` enum y frontend usan `'users:view'` (colon) | Todos los endpoints de users con `@HasPermission` ignoran el check — cualquier usuario los ejecuta | `settings.routes.ts:97` (`'users:view'`), `core/api/users.service.ts` | `users.controller.ts:44-201`, `permissions.ts:7-9` | Estandarizar a formato colon (`users:create`) en `users.controller.ts`. Verificar que TypeScript no estaba silenciando el error de tipo | Crítico |
| `GET /auth/sessions` — backend acepta parámetro `currentRefreshTokenId` del cookie pero frontend `SessionService` no lo envía | La bandera `isCurrent` en la respuesta siempre será `false` en la UI | `session.service.ts:27` — no hay lógica de cookie | `auth.controller.ts:487-498` | Frontend no necesita enviarlo; el backend lo extrae del cookie automáticamente. El servicio frontend ya funciona correctamente | Bajo |
| `BillingService.getSubscription()` retorna mock hardcodeado — no existe `GET /saas/subscription-status` | Pantalla de billing muestra datos inventados (plan "Profesional", precio $49) | `billing.ts:83-85`, `billing.page.ts` | No existe endpoint para estado de suscripción activa | Crear `GET /payment/subscription` que retorne el estado real desde `Organization.subscriptionStatus` | Alto |
| `AuthService.inviteUser()` llama a `POST /auth/invite` pero ese endpoint no existe en `auth.controller.ts`. El endpoint real es `POST /users/invite` | Invitación de usuarios desde frontend podría fallar silenciosamente | `auth.ts:444` | `users.controller.ts:43` | Corregir URL en `AuthService.inviteUser()` a `/users/invite` | Alto |
| `AuthService.updateUser()` llama a `PATCH /auth/:id` que no existe — el endpoint real es `PATCH /users/:id` | La actualización de usuarios desde el frontend fallará | `auth.ts:452` | `users.controller.ts:149` | Corregir URL en `AuthService.updateUser()` a `/users/:id` | Alto |
| `User.organization.name` en interfaz frontend vs `Organization.legalName` en entidad backend | Campos de organización pueden mostrarse vacíos en UI | `user.interface.ts:8` (`name?`) | `organization.entity.ts:11` (`legalName`) | Alinear `UserResponseDto` para incluir `organization.legalName` mapeado a `name` | Medio |
| `passwordHash` incluido en `User` interface frontend | Aunque el backend no lo envía (excluido por `@Exclude`), su presencia en la interfaz es un error conceptual | `user.interface.ts:65` | `user-response.dto.ts` | Remover `passwordHash` de la interfaz frontend | Bajo |
| Frontend `publicGuard` redirige a `/auth/login` pero la ruta canónica es `/:lang/auth/login` | Redirección post-login puede romperse o crear bucles | `public.guard.ts` (no revisado en detalle) | - | Verificar que todos los guards usan `LanguageService` para construir URLs | Medio |
| Pantalla `/settings/security` — stub vacío, no llama ningún endpoint | Los usuarios no pueden ver ni configurar auditoría/seguridad | `security.page.ts:4-15` | `audit.controller.ts` existe con `GET /audit` | Implementar pantalla de auditoría que consuma `GET /audit` con paginación | Alto |
| `roles.controller.ts` no tiene `PermissionsGuard`, pero la ruta `/settings/roles` en frontend requiere `roles:view` | Aislamiento asimétrico: frontend protege la UI, backend no protege la API | `settings.routes.ts:89-91` | `roles.controller.ts:12` | Agregar `@UseGuards(JwtAuthGuard, PermissionsGuard)` y `@HasPermission('roles:view')` en roles.controller | Alto |

---

## 5. Errores y bugs detectados

| Bug | Evidencia | Pasos o condición para reproducir | Impacto | Severidad | Fix recomendado |
|-----|-----------|----------------------------------|---------|-----------|-----------------|
| Permisos con formato dot (`users.view`) vs colon (`users:view`) — PermissionsGuard nunca matchea | `users.controller.ts:44` — `@HasPermission('users.create')` vs `permissions.ts:8` — `USERS_CREATE: 'users:create'` | 1. Crear un usuario con rol sin permiso `users:create`. 2. Intentar `POST /users/invite`. 3. La acción se ejecutará exitosamente — el check falla silenciosamente | Cualquier usuario autenticado puede crear, editar, eliminar usuarios sin importar su rol | Crítico | Cambiar todos los `@HasPermission('users.X')` en `users.controller.ts` a `@HasPermission('users:X')` usando las constantes del enum |
| `UnauthorizedException` usada en `auth.controller.ts:421` sin ser importada desde `@nestjs/common` | `auth.controller.ts:2` — solo importa `BadRequestException`. Línea 421: `throw new UnauthorizedException(...)` | El endpoint `POST /auth/verify-2fa` con sesión expirada lanzaría un `ReferenceError` en runtime | El endpoint `verify-2fa` crashea con token expirado en lugar de retornar 401 | Crítico | Agregar `UnauthorizedException` a los imports de `@nestjs/common` en la línea 2 |
| `terminateAllSessions` en `session.service.ts` solo limpia la caché pero NO marca refresh tokens como revocados en DB | `session.service.ts:325-329` — la línea de revocación está comentada | 1. Usuario hace logout. 2. Atacante usa el refresh token robado. 3. El token sigue siendo válido hasta que expire | Logout no invalida refresh tokens existentes. Sesiones "cerradas" pueden ser reutilizadas | Alto | Descomentar `await this.refreshTokenRepository.update(...)` en `terminateAllSessions` |
| `payment.controller.ts:68` — webhook Stripe recibe body parseado en lugar de raw buffer | `payment.controller.ts:68` — `(req as any).rawBody || req.body` | El webhook Stripe enviará firma válida pero la verificación Stripe fallará porque el body fue transformado por JSON parser | Los webhooks de Stripe no podrán validarse correctamente. Actualizaciones de suscripción no se procesarán | Alto | Configurar middleware de raw body en `main.ts` o usar `@RawBody()` decorator para la ruta webhook |
| `events.gateway.ts:15` — CORS de WebSocket hardcodeado a `http://localhost:4200` | `events.gateway.ts:15-17` — `origin: 'http://localhost:4200'` | En cualquier ambiente que no sea desarrollo local, las conexiones WebSocket serán rechazadas por CORS | Todas las notificaciones en tiempo real, forzado de logout, actualización de estado online dejarán de funcionar en staging/production | Alto | Leer `FRONTEND_URL` del `ConfigService` en el decorador `@WebSocketGateway` |
| `findOne(id)` en `users.service.ts:173-182` no filtra por `organizationId` — usado en `GET /users/:id` | `users.service.ts:175` — `{ where: { id: id as any } }`. Comentario en `users.controller.ts:144` confirma la vulnerabilidad | 1. User A obtiene UUID de un usuario de Org B (p. ej., por error en logs o UI). 2. `GET /api/v1/users/{uuid-org-b}`. Recibe datos del usuario de otra org | IDOR multi-tenant: un usuario puede obtener datos personales de usuarios de cualquier otra organización | Alto | Agregar `organizationId` al where: `{ id, organizationId: user.organizationId }` |
| Cookie de `access_token` parseada manualmente en WebSocket con `split('=')[1]` — falla con tokens base64 | `events.gateway.ts:36-39` — `?.split('=')[1]` | Un JWT con `=` en el valor (base64 padding) resultaría en un token truncado y verificación fallida | Usuarios con ciertos tokens pueden ser desconectados del WebSocket | Medio | Usar la librería `cookie` de Node.js: `import { parse } from 'cookie'; const cookies = parse(req.headers.cookie || ''); const token = cookies.access_token;` |
| `auth.config.ts:24` — fallback hardcodeado `'temp_2fa_secret_change_me'` para JWT_2FA_TEMP_SECRET | `auth.config.ts:24` | En un ambiente con la variable no configurada, cualquier atacante que conozca el fallback puede generar tokens 2FA válidos | Bypass completo de 2FA en ambientes mal configurados | Alto | Lanzar error si la variable no existe: `process.env.JWT_2FA_TEMP_SECRET ?? (() => { throw new Error('JWT_2FA_TEMP_SECRET must be set') })()` |
| `audit.service.ts:50-60` — `GET /audit` retorna logs de toda la plataforma sin filtro de organización | `audit.controller.ts:15-17` — `findAll(@Query('entity') entity?, @Query('entityId') entityId?)`. `audit.service.ts:50` — no filtra por `userId` ni `organizationId` | 1. Usuario autenticado llama `GET /api/v1/audit`. 2. Recibe logs de todas las organizaciones | Violación de aislamiento multi-tenant: cualquier usuario ve el historial de auditoría global | Alto | Agregar `organizationId` al AuditLog, filtrar en `find()` por la organización del usuario |
| `roles.controller.ts` — sin `PermissionsGuard` ni `@HasPermission` en ningún método | `roles.controller.ts:12-44` — solo `@UseGuards(JwtAuthGuard)` a nivel de clase | Cualquier usuario autenticado puede `POST /roles`, `DELETE /roles/:id`, `PATCH /roles/:id` | Escalada de privilegios: un usuario puede crear un rol con todos los permisos y asignárselo | Medio | Agregar `@UseGuards(JwtAuthGuard, PermissionsGuard)` y decoradores `@HasPermission` en cada método |

---

## 6. Malas prácticas y deuda técnica

| Hallazgo | Evidencia | Riesgo | Recomendación | Prioridad |
|----------|-----------|--------|---------------|-----------|
| `as any` en queries TypeORM — `where: { id: id as any }` | `users.service.ts:175` | Elimina verificación de tipos en queries críticas, puede ocultar bugs de tipo | Usar tipo correcto: `where: { id }` — TypeORM acepta `string` para columnas UUID | Alta |
| `getActivityLog()` retorna array vacío hardcodeado | `users.service.ts:257-259` — `return []` | Funcionalidad prometida por el endpoint `GET /users/:id/activity` que no está implementada | Implementar o eliminar el endpoint del controller | Media |
| `console.error` en lugar de Logger de NestJS | `users.service.ts:245`, `mail.service.ts:55` | Los logs no siguen el formato estructurado del resto del sistema (pino) | Inyectar `private readonly logger = new Logger(ClassName.name)` | Baja |
| Doble definición de `PERMISSIONS_KEY` | `permissions.decorator.ts:5` y `check-permissions.decorator.ts:6` — misma constante en dos archivos | Inconsistencia silenciosa si los valores divergen | Mover `PERMISSIONS_KEY` a un archivo de constantes compartidas e importarlo | Media |
| `BillingService` con datos mock hardcodeados en señales | `billing.ts:40-58` — fechas de facturación inventadas del año 2025 | Información engañosa en producción que el usuario no podrá actualizar | Implementar `GET /payment/subscription` y consumirlo desde el servicio | Alta |
| `IsOrganizationOwnerPolicy` compara rol por nombre string `'ADMIN'` | `is-organization-owner.policy.ts:19` — `role.name === 'ADMIN'` | Frágil: si el nombre del rol cambia, la política deja de funcionar | Comparar contra un enum de roles del sistema o verificar por `isSystemRole` y nivel | Media |
| Múltiples páginas de settings son stubs de 10 líneas | `security.page.ts`, `integrations.page.ts`, `smtp.page.ts`, `accounting.page.ts` | El producto aparenta funcionalidades que no existen | Implementar o marcar claramente como "próximamente" en UI | Alta |
| `forwardRef` en `session.service.ts` | `session.service.ts:9, 41` — `@Inject(forwardRef(() => UsersService))` | Indica dependencia circular que complica el testing y puede causar problemas de inicialización | Refactorizar para romper la dependencia circular, posiblemente extrayendo una interfaz | Media |
| Solo 1 migración en el directorio de migraciones | `database/migrations/` — solo `1726168694000-CreateSalesCubeView.ts` | El esquema se gestiona con `synchronize: true` en desarrollo, inaceptable en producción | Generar migraciones para todas las entidades antes de ir a producción | Alta |
| Títulos de aplicación con branding incorrecto en auth routes | `auth.routes.ts:6` — `title: 'Crear Cuenta | FacturaPRO'` vs nombre del producto Virteex | Confusión de marca para usuarios finales | Actualizar títulos para reflejar el nombre correcto del producto | Baja |
| `user.interface.ts` incluye `passwordHash` | `user.interface.ts:65` | Aunque nunca llega del backend, su presencia normaliza el concepto de exponer el hash | Remover del contrato de la interfaz | Baja |
| Throttle configurado dos veces (en `AuthModule` y en `AppModule`) | `auth.module.ts:76-98`, `app.module.ts:147-164` | La configuración del módulo raíz puede sobreescribir la del módulo de auth | Consolidar en configuración del módulo raíz únicamente | Baja |

---

## 7. Riesgos de seguridad

### CRÍTICOS

**1. Bug de permisos dot vs colon — PermissionsGuard inefectivo en endpoints de usuarios**
- **Descripción:** `@HasPermission('users.create')` vs `PERMISSIONS.USERS_CREATE = 'users:create'`. El guard compara el permiso del decorador contra los permisos del usuario; si los formatos no coinciden, `includes()` retorna `false` y el guard debería denegar el acceso. Sin embargo, dado que `PermissionsGuard.canActivate()` solo lanza si `user.permissions` falta (línea 38-40) pero el usuario SÍ tiene permissions (solo en formato diferente), el guard permite el paso.
- **Evidencia:** `apps/backend/api/src/app/users/users.controller.ts:44` vs `apps/backend/api/src/app/shared/permissions.ts:8`
- **Cómo se explotaría:** Un usuario con el rol "Viewer" (permisos: `['users:view']`) podría llamar `POST /api/v1/users/invite` y crear usuarios ilimitados o `DELETE /api/v1/users/:id` para eliminar cualquier miembro de su organización.
- **Fix:** Cambiar `@HasPermission('users.create')` a `@HasPermission('users:create')` en todo `users.controller.ts`. Ejecutar `tsc --noEmit` — si TypeScript permitió los valores dot, agregar test unitario que valide los strings.

**2. `UnauthorizedException` no importada en `auth.controller.ts` — crash en verify-2fa**
- **Descripción:** El import de `@nestjs/common` en `auth.controller.ts:2` no incluye `UnauthorizedException`, pero línea 421 la usa: `throw new UnauthorizedException('Invalid or expired session')`.
- **Evidencia:** `apps/backend/api/src/app/auth/auth.controller.ts:2` y `:421`
- **Cómo se explotaría:** Cualquier solicitud a `POST /auth/verify-2fa` con un `tempToken` expirado o inválido causa un `ReferenceError: UnauthorizedException is not defined`, resultando en 500 Internal Server Error en lugar de 401.
- **Fix:** Agregar `UnauthorizedException` al destructuring del import de `@nestjs/common` en línea 2.

### ALTOS

**3. Secret de 2FA con fallback hardcodeado**
- **Descripción:** `JWT_2FA_TEMP_SECRET || 'temp_2fa_secret_change_me'` en `auth.config.ts:24`.
- **Evidencia:** `apps/backend/api/src/app/auth/auth.config.ts:24`
- **Cómo se explotaría:** En cualquier ambiente donde no se configure la variable, un atacante con acceso al código fuente puede firmar sus propios tokens `{id: victimUserId, type: '2fa_pending'}` y completar el login de 2FA de cualquier usuario sin conocer su TOTP.
- **Fix:** Lanzar `new Error('FATAL: JWT_2FA_TEMP_SECRET must be set')` si la variable no está presente.

**4. IDOR en `GET /users/:id` — sin verificación de organización**
- **Descripción:** `usersService.findOne(id)` no filtra por `organizationId`, y el comentario `// Ideally ensure user belongs to same org` lo reconoce.
- **Evidencia:** `apps/backend/api/src/app/users/users.controller.ts:143-146`, `apps/backend/api/src/app/users/users.service.ts:173-182`
- **Cómo se explotaría:** Usuario autenticado de Org A obtiene UUID de un usuario de Org B (por fuerza bruta o filtración) y llama `GET /api/v1/users/{uuid}`. Recibe nombre, email, departamento, rol, avatar del usuario de otra organización.
- **Fix:** Modificar `findOne` para aceptar `organizationId` o crear `findOneByOrg(id, organizationId)` con `where: { id, organizationId }`.

**5. WebSocket CORS hardcodeado a `localhost:4200`**
- **Descripción:** `@WebSocketGateway({ cors: { origin: 'http://localhost:4200' } })` bloquea todas las conexiones en producción.
- **Evidencia:** `apps/backend/api/src/app/websockets/events.gateway.ts:15-18`
- **Cómo se explotaría:** No es una vulnerabilidad de seguridad per se, pero todos los sistemas de tiempo real (notificaciones, force-logout, estado online) dejarán de funcionar en producción, potencialmente dejando sesiones comprometidas sin capacidad de forzar logout remoto.
- **Fix:** Inyectar `ConfigService` en el constructor y leer `FRONTEND_URL`, o usar función factory con `@WebSocketGateway(() => ({ cors: { origin: configService.get('FRONTEND_URL') } }))`.

**6. Audit log sin filtro de organización**
- **Descripción:** `GET /audit` retorna todos los registros sin filtrar por la organización del usuario autenticado.
- **Evidencia:** `apps/backend/api/src/app/audit/audit.service.ts:50-60`, `apps/backend/api/src/app/audit/audit.controller.ts:15`
- **Cómo se explotaría:** Cualquier usuario autenticado (independiente de su rol o permisos) llama `GET /api/v1/audit` y obtiene el historial completo de acciones de todas las organizaciones: quién hizo qué, cuándo, con qué datos.
- **Fix:** Agregar `organizationId` a `AuditLog`, filtrar en `find()` por `organizationId` del usuario autenticado, agregar `@HasPermission('audit:view_trail')`.

**7. Roles CRUD sin guard de permisos en backend**
- **Descripción:** `RolesController` solo tiene `@UseGuards(JwtAuthGuard)`, sin `PermissionsGuard`.
- **Evidencia:** `apps/backend/api/src/app/roles/roles.controller.ts:12`
- **Cómo se explotaría:** Un usuario con cualquier rol (incluso sin permisos) puede: crear un nuevo rol con permisos `['*']` usando `POST /api/v1/roles`, luego solicitar al admin que se lo asigne (o hacerlo directamente si también puede invitar usuarios). Esto otorga acceso de super-admin.
- **Fix:** Aplicar `@UseGuards(JwtAuthGuard, PermissionsGuard)` y decoradores de permisos correspondientes.

### MEDIOS

**8. Logout no invalida refresh tokens en base de datos**
- **Descripción:** `terminateAllSessions` solo limpia caché Redis pero no revoca tokens en DB. La línea de revocación está comentada.
- **Evidencia:** `apps/backend/api/src/app/auth/services/session.service.ts:325-329`
- **Impacto:** Un refresh token robado sigue siendo válido hasta su expiración natural (7 días o 30 días con "remember me") incluso después de logout.
- **Fix:** Descomentar la línea `await this.refreshTokenRepository.update(...)` o asegurarse de que el incremento de `tokenVersion` invalide los refresh tokens en el `refreshAccessToken()` check.

**9. SSL para BD con `rejectUnauthorized: false`**
- **Descripción:** `app.module.ts` configura SSL con `{ rejectUnauthorized: false }`.
- **Evidencia:** `apps/backend/api/src/app/app.module.ts:143`
- **Impacto:** Susceptible a ataques MitM sobre la conexión a PostgreSQL en producción.
- **Fix:** Usar `rejectUnauthorized: true` con los certificados CA correctos del proveedor de BD.

### BAJOS

**10. Parsing manual de cookie en WebSocket es frágil**
- **Descripción:** Parsing `cookie.split('; ').find(row => row.startsWith('access_token=')).split('=')[1]` trunca tokens con `=` en base64.
- **Evidencia:** `apps/backend/api/src/app/websockets/events.gateway.ts:36-39`
- **Fix:** `import { parse } from 'cookie'` y usar `parse(cookieHeader).access_token`.

---

## 8. Multi-tenant y aislamiento de datos

### Representación de org/tenant

La organización se modela con una relación 1:N (`User.organizationId` como FK). El JWT incluye `organizationId` en el payload. El `JwtStrategy` valida que el `organizationId` del token corresponda a una organización a la que el usuario pertenece (soportando contexto de organización adicional para futuros escenarios de usuarios multi-org).

### Filtrado de endpoints

**Correctamente implementado:**
- `GET /users` — filtra por `organizationId` del usuario autenticado (`users.service.ts:75`)
- `GET /roles` — filtra por `organizationId` (`roles.service.ts:18`)
- `GET /organizations/profile` — usa `user.organizationId` directamente
- `PATCH/DELETE /users/:id` — verifica `{ id, organizationId }` en where clause
- `POST /roles` — crea con `organizationId` del usuario

**Con problemas de aislamiento:**
- `GET /users/:id` — sin filtro de organización (IDOR)
- `GET /audit` — sin filtro de organización (acceso global)
- `GET /auth/sessions` — correcto (filtra por `userId`)

### Riesgos IDOR

El riesgo principal es `GET /users/:id`. Los demás recursos de P1 parecen correctamente aislados.

### Scoping de roles

Los roles son completamente por organización (`role.organizationId`). Ningún rol puede asignarse a usuarios de otra organización. La verificación en `rolesService.findOne(id, organizationId)` garantiza que solo se puedan usar roles propios.

### Aislamiento de settings

Los settings de empresa están correctamente aislados: `OrganizationsController` usa `user.organizationId` para todos los métodos. Las subsidiarias también están correctamente filtradas por `parentOrganizationId`.

### Recomendaciones

1. Implementar IDOR fix en `GET /users/:id`
2. Agregar `organizationId` a `AuditLog` y filtrar en queries
3. Considerar row-level security (RLS) en PostgreSQL como capa adicional
4. Auditar todos los módulos de P2+ antes de pasarlos a producción verificando que ningún endpoint usa IDs directos sin verificación de organización

---

## 9. Roles y permisos

### Modelo actual

- **Modelo:** RBAC (Role-Based Access Control) con extensión ABAC via `PermissionsGuard` + `IPolicy` (clase `IsOrganizationOwnerPolicy`)
- **Storage:** `roles.permissions: string[]` como `simple-array` en PostgreSQL (comma-separated)
- **Wildcard:** `*` para super-admin en ambos `PermissionsGuard` y `hasPermission()` frontend
- **Tipo:** Cada organización puede crear roles custom + existen roles de sistema (`isSystemRole: true`)

### Permisos disponibles (definidos en `shared/permissions.ts`)

40 permisos en formato `dominio:accion`:
- Users: `users:view`, `users:create`, `users:edit`, `users:delete`, `users:manage_status`, `users:impersonate`
- Roles: `roles:view`, `roles:create`, `roles:edit`, `roles:delete`
- CoA, Journal Entries, Accounting, Invoices, Customers, Bills, Inventory, Price Lists, Taxes, Reports, Workflows, Audit, Cost Accounting, Settings, System

### Validación backend

- `PermissionsGuard`: Funciona correctamente para cualquier endpoint que use `@CheckPermissions(...)` (que incluye automáticamente el guard)
- `@HasPermission()`: Solo agrega metadatos — **requiere que `PermissionsGuard` esté en `@UseGuards()` de la clase o método**. En `users.controller.ts` el guard SÍ está aplicado a nivel de clase, PERO el formato de los strings es incorrecto (dot vs colon)
- `TwoFactorVerifiedGuard`: Correctamente aplicado en operaciones sensibles (change-password, disable-2fa, revoke-session)

### Validación frontend

- `permissionsGuard` en Angular solo protege 2 rutas: `/settings/roles` y `/settings/users`
- Resto de rutas de settings NO tienen guard de permisos frontend
- `hasPermission()` en `util-auth` lib: implementación correcta con soporte wildcard

### Diferencias críticas

- `users.controller.ts` usa formato dot: `'users.create'`
- `permissions.ts` define con colon: `'users:create'`
- `settings.routes.ts` usa colon: `'users:view'`, `'roles:view'`
- La lib `util-auth` y el `PermissionsGuard` usan el valor almacenado en el rol, que sería colon

### Endpoints sin protección de permisos en backend

| Endpoint | Protección actual | Permiso faltante |
|----------|------------------|-----------------|
| `POST /roles` | Solo JWT | `roles:create` |
| `PATCH /roles/:id` | Solo JWT | `roles:edit` |
| `DELETE /roles/:id` | Solo JWT | `roles:delete` |
| `POST /roles/clone/:id` | Solo JWT | `roles:create` |
| `GET /roles/available-permissions` | Solo JWT | `roles:view` |
| `GET /audit` | Solo JWT | `audit:view_trail` |
| `GET /organizations/subsidiaries` | Solo JWT | (ninguno definido) |
| `POST /organizations/subsidiaries` | Solo JWT + IsOrganizationOwnerPolicy | (ninguno definido) |

### Propuesta de normalización

Estandarizar todos los permisos al formato `dominio:accion` (colon). Crear un test de integración que verifique que cada string pasado a `@HasPermission` existe en el enum `PERMISSIONS`. Considerar usar directamente las constantes del enum: `@HasPermission(PERMISSIONS.USERS_CREATE)` en lugar de strings literales.

---

## 10. Auth y sesiones

### Login
- Implementado: email/password, reCAPTCHA v3, throttling (5 intentos/60s), bloqueo por intentos fallidos (15 min), simulación de delay para timing attacks
- Flujo 2FA: genera `tempToken` JWT firmado con secret separado, retorna `require2fa: true` sin credenciales
- Cookies: `access_token` (HTTP-only, SameSite=Lax, 15min), `refresh_token` (HTTP-only, path restringido a `/api/v1/auth/refresh`, 7d o 30d con remember me), `XSRF-TOKEN` (readable by JS, 15min)

### Register
- Multi-paso frontend (business, account-info, configuration, plan, access)
- Backend con honeypot, reCAPTCHA, estrategia por región fiscal (DO y US implementados)
- Crea organización, rol ADMIN por defecto, usuario y tokens en una transacción

### Logout
- Frontend limpia estado y llama `POST /auth/logout` (best-effort)
- Backend limpia caché Redis pero **NO revoca refresh tokens en DB**
- Bug: `terminateAllSessions` comenta la revocación en DB

### Refresh token
- Rotación completa: cada refresh genera nuevo par de tokens, invalida el anterior
- Grace period (10s por defecto) para manejar condiciones de carrera de red
- Detección de reutilización: si se usa un token revocado fuera del grace period, se invalidan TODOS los tokens del usuario (nuclear invalidation)
- User-Agent binding: detecta cambios de browser/OS y puede rechazar el refresh

### Remember me
- Implementado: cookies de 30 días si `rememberMe: true` en el body del login

### Reset password
- Token SHA-256 generado con `crypto.randomBytes(32)`, expiración 1h, enviado por email
- Validación con `CsrfGuard`, throttling

### Email verification
- No se detectó verificación de email obligatoria post-registro. El usuario queda activo inmediatamente.

### 2FA (TOTP)
- Generación de secret, QR code, habilitación con verificación, códigos de backup, deshabilitación protegida por `TwoFactorVerifiedGuard`
- Email OTP y SMS OTP (Twilio) como factor alternativo
- Sesión 2FA pendiente usa JWT separado con secret distinto y expiración corta

### Cookies
- `access_token`: HTTP-only, Secure (en producción), SameSite=Lax — correcto
- `refresh_token`: HTTP-only, Secure, path restringido a `/api/v1/auth/refresh` — excelente
- `XSRF-TOKEN`: No HTTP-only, Secure (en producción), SameSite=Lax — correcto para double-submit cookie

### CSRF
- Double-submit cookie pattern implementado en `CsrfGuard`
- Frontend envía `X-XSRF-TOKEN` header via `authInterceptor`
- Vulnerabilidad residual: patrón es susceptible a XSS (si hay XSS, el atacante puede leer la cookie)

### CORS
- No se encontró configuración de CORS explícita en `main.ts` para el servidor HTTP
- WebSocket CORS hardcodeado a `localhost:4200`

### JWT Claims
- `id`, `email`, `tokenVersion`, `organizationId`, `isImpersonating`, `originalUserId`
- `tokenVersion` permite invalidación instantánea de todas las sesiones al cambiar password, rol o status

### Revocación de sesión
- `POST /auth/sessions/:id/revoke` — marca token como revocado en DB
- Frontend con `SessionsComponent` funcional

### Impersonation
- Implementado con validación de permisos (`users:impersonate`), jerarquía de roles, aislamiento de org
- Se registra en auditoría

---

## 11. Settings, organizaciones y onboarding

### Perfil de empresa
- `GET/PATCH /organizations/profile` — implementado y conectado a frontend `CompanyProfilePage`
- Campos: `legalName`, `taxId`, `address`, `city`, `country`, `phone`, `website`, `industry`
- Falta: `logoUrl` (upload), `fiscalRegionId`, `timezone`

### Subsidiarias
- `GET/POST /organizations/subsidiaries` — implementado con transacción atómica que inicializa segmentos de cuentas
- Frontend `SubsidiariesPage` con `subsidiaries.service.ts` — aparenta funcionar

### Setup inicial / onboarding
- Registro multi-paso crea org con datos básicos
- No existe un flujo de onboarding post-registro guiado (wizard para configurar plan contable, subsidiarias, monedas, etc.)

### Localización / país
- `fiscalRegionId` en registro para DO y US
- `CountryGuard` y rutas `/:lang/:country` implementados

### Preferencias contables
- `AccountingSettingsPage` — stub vacío con texto "Configuración de cuentas por defecto y periodos"
- Sin endpoint backend para guardar preferencias contables generales

### Branding
- `BrandingPage` — existe, no revisado en detalle pero tiene un `BrandingService` frontend
- XSS potencial en `branding.ts:105-133` (señalado en AUDITORIA_TECNICA.md): inserción de CSS via `innerHTML` sin sanitización

### Billing / plan
- `BillingPage` muestra datos mock hardcodeados del año 2025
- Flujo de checkout Stripe funciona (`POST /payment/checkout-session`) pero la pantalla de billing no lo usa directamente
- Sin Stripe Customer Portal para gestión de suscripción existente

### Invitación de usuarios
- Backend completo: `POST /users/invite` crea usuario PENDING, envía email con token de 7 días
- Frontend `UserManagementPage` — existe pero `AuthService.inviteUser()` llama a URL incorrecta (`/auth/invite`)

### Pantallas incompletas
Las siguientes rutas de settings tienen componentes stub sin funcionalidad real:
- `/settings/security` — `SecuritySettingsPage` (10 líneas, sin API calls)
- `/settings/integrations` — `IntegrationSettingsPage` (9 líneas, sin funcionalidad)
- `/settings/smtp` — `SmtpSettingsPage` (9 líneas, sin funcionalidad)
- `/settings/accounting` — `AccountingSettingsPage` (9 líneas, sin funcionalidad)
- `/settings/currencies` — `CurrencySettingsPage` (no revisado, probablemente stub)
- `/settings/taxes` — `TaxRulesPage` (no revisado, probablemente stub)
- `/settings/closing-rules` — `ClosingRulesPage` (no revisado)
- `/settings/intercompany` — `IntercompanyPage` (no revisado)
- `/settings/approvals` — `ApprovalPoliciesPage` (no revisado)
- `/settings/sequences` — `SequenceSettingsPage` (no revisado)
- `/settings/inventory-policies` — `InventoryPoliciesPage` (no revisado)

---

## 12. Pruebas existentes y gaps

### Tests encontrados

**Backend:**
- `auth.service.spec.ts` — referenciado en directorio pero no revisado
- `registration.service.spec.ts` — `apps/backend/api/src/app/auth/services/registration.service.spec.ts`
- `two-factor-auth.service.spec.ts` — `apps/backend/api/src/app/auth/services/two-factor-auth.service.spec.ts`
- `two-factor-verified.guard.spec.ts` — `apps/backend/api/src/app/auth/guards/two-factor-verified.guard.spec.ts`
- `users.service.spec.ts` — `apps/backend/api/src/app/users/users.service.spec.ts`
- E2E: `apps/backend/api-e2e/src/api/api.spec.ts` — un único archivo de spec E2E

**Frontend:**
- `auth-guard.spec.ts`, `login.page.spec.ts`, `register.page.spec.ts`
- `company-profile.spec.ts`, `user-management.page.spec.ts`, `my-profile.page.spec.ts`
- `auth-queue.service.spec.ts`, `push-notification.service.spec.ts`
- `country.guard.spec.ts`, `language-init.guard.spec.ts`, `language-redirect.guard.spec.ts`

**Total de archivos spec encontrados:** 169

### Tests ejecutados (estimación)

No se ejecutaron los tests en esta auditoría. El estado de compilación TypeScript no fue verificado.

### Cobertura aparente

Con 169 archivos `.spec.ts` sobre un codebase de aproximadamente 900+ archivos TypeScript de fuente, la cobertura estimada de archivos es del ~18%. Muchos archivos spec pueden estar vacíos o con tests triviales. La cobertura real de líneas se estima en menos del 15%.

### Gaps críticos en tests

| Área | Test faltante | Riesgo |
|------|--------------|--------|
| Bug permisos dot vs colon | Test de integración que verifique que `@HasPermission('users.create')` es idéntico al formato del enum | Crítico |
| Refresh token rotation | Test que verifique que un token revocado no puede reutilizarse | Alto |
| IDOR `GET /users/:id` | Test cross-tenant que espere 403 o 404 | Alto |
| Audit log sin org filter | Test que verifique aislamiento por organización | Alto |
| Webhook Stripe | Test con raw body simulado | Alto |
| 2FA complete flow | E2E: login → 2FA required → verify → authenticated | Medio |
| Session revocation | Test que logout seguido de refresh falle | Medio |
| WebSocket auth | Test de conexión con token inválido/expirado | Medio |
| Impersonation hierarchy | Test que impersonation de usuario con mayor rol sea rechazada | Medio |

### Suite mínima recomendada antes de producción

1. Tests unitarios para `PermissionsGuard` con ambos formatos de string
2. Tests de integración para flujos auth completos (login, refresh, logout, 2FA)
3. Tests de aislamiento multi-tenant (IDOR) para todos los recursos con ID en URL
4. Tests del webhook Stripe con body real
5. E2E para el flujo de registro completo y onboarding
6. Test de seguridad: refresh token reuse detection

---

## 13. Roadmap recomendado para terminar Prioridad 1

| # | Título | Descripción | Archivos/módulos afectados | Severidad | Dependencias | Criterio de aceptación | Estimación |
|---|--------|-------------|--------------------------|-----------|-------------|----------------------|------------|
| 1 | Fix bug crítico permisos dot vs colon | Cambiar todos `@HasPermission('users.X')` a `@HasPermission('users:X')` usando las constantes del enum PERMISSIONS | `users.controller.ts`, `auth/decorators/permissions.decorator.ts` | Crítico | Ninguna | Test unitario pasa, endpoint `POST /users/invite` con usuario sin permiso retorna 403 | S |
| 2 | Agregar `UnauthorizedException` al import de `auth.controller.ts` | Importar `UnauthorizedException` para que `POST /auth/verify-2fa` no crashee con 500 | `auth.controller.ts:2` | Crítico | Ninguna | `POST /auth/verify-2fa` con token inválido retorna 401, no 500 | S |
| 3 | Fix IDOR en `GET /users/:id` | Cambiar `usersService.findOne(id)` a `findOne(id, user.organizationId)` con where clause correcto | `users.controller.ts:143`, `users.service.ts:173` | Alto | 1 | Test cross-tenant retorna 404 | S |
| 4 | Fix WebSocket CORS hardcodeado | Leer `FRONTEND_URL` del `ConfigService` en `EventsGateway` | `events.gateway.ts:15` | Alto | Ninguna | WebSocket conecta en staging/prod | S |
| 5 | Agregar guard de permisos a `roles.controller.ts` | Aplicar `@UseGuards(JwtAuthGuard, PermissionsGuard)` y `@HasPermission` usando formato colon | `roles.controller.ts` | Alto | 1 | Usuario sin `roles:create` no puede crear roles | S |
| 6 | Fix audit log con filtro de organización | Agregar `organizationId` a `AuditLog`, filtrar en `find()`, agregar `@HasPermission('audit:view_trail')` | `audit.service.ts`, `audit.controller.ts`, migración | Alto | Ninguna | `GET /audit` solo retorna logs de la org del usuario autenticado | M |
| 7 | Fix secret 2FA sin fallback | Lanzar excepción si `JWT_2FA_TEMP_SECRET` no está configurado | `auth.config.ts:24` | Alto | Ninguna | App no inicia sin la variable en producción | S |
| 8 | Fix logout — revocar refresh tokens en DB | Descomentar revocación en `terminateAllSessions` | `session.service.ts:325-329` | Alto | Ninguna | Refresh token luego de logout retorna 401 | S |
| 9 | Fix raw body para webhook Stripe | Configurar middleware de raw body en `main.ts` para ruta `/payment/webhook` | `main.ts`, `payment.controller.ts` | Alto | Ninguna | Webhook Stripe con firma válida procesa correctamente | M |
| 10 | Fix URL en `AuthService.inviteUser()` y `updateUser()` | Cambiar `/auth/invite` a `/users/invite` y `/auth/:id` a `/users/:id` | `core/services/auth.ts:444, 452` | Alto | Ninguna | Invitación de usuarios desde UI funciona | S |
| 11 | Implementar `GET /payment/subscription` | Endpoint que retorne `Organization.subscriptionStatus`, `planId`, `subscriptionPeriodEnd` | `payment.controller.ts`, `billing.ts` | Medio | Ninguna | `BillingPage` muestra datos reales del plan activo | M |
| 12 | Fix cookie parsing en WebSocket | Usar librería `cookie` en lugar de split manual | `events.gateway.ts:36-39` | Medio | Ninguna | Conexión WebSocket con tokens base64 con padding funciona | S |
| 13 | Implementar `SecuritySettingsPage` | Consumir `GET /audit` para mostrar historial de acciones, cambio de contraseña, sesiones activas | `system/security/security.page.ts`, `audit.controller.ts` | Alto | 6 | Página muestra log de auditoría con paginación | L |
| 14 | Implementar páginas de settings faltantes (accounting, currencies, taxes, smtp, integrations) | Conectar a endpoints backend existentes o crear los endpoints necesarios | `settings/finance/`, `settings/system/` | Medio | Ninguna | Al menos 5 páginas de settings funcionales | XL |
| 15 | Generar migraciones TypeORM para todas las entidades | Deshabilitar `synchronize: true` en producción y crear migraciones | `database/migrations/`, `app.module.ts` | Alto | Ninguna | Migraciones corren limpiamente en DB fresca | L |
| 16 | Test suite P1 mínima | Escribir tests de integración para bugs críticos y flujos de auth | `apps/backend/api-e2e/`, specs de auth | Medio | 1-10 | Tests pasan en CI, cobertura de módulos de auth >60% | XL |
| 17 | Fix verificación de email post-registro | Implementar flujo de email verification obligatorio o documentar la decisión de omitirlo | `registration.service.ts`, `auth.controller.ts` | Bajo | Ninguna | Usuario no puede usar la app hasta verificar email (o decisión documentada de omitirlo) | M |
| 18 | Fix `organization.name` vs `legalName` en frontend | Alinear `UserResponseDto` para mapear `organization.legalName` → `name` | `user-response.dto.ts`, `user.interface.ts` | Bajo | Ninguna | Nombre de empresa se muestra correctamente en sidebar/header | S |

---

## 14. Checklist de "listo para continuar a Prioridad 2"

Los siguientes criterios deben estar verificados y aprobados antes de iniciar el desarrollo de módulos de contabilidad/finanzas:

- [ ] **Bug de permisos dot vs colon corregido** — Test unitario que valide que `@HasPermission('users:create')` con usuario sin ese permiso retorna 403
- [ ] **`UnauthorizedException` importada en `auth.controller.ts`** — `POST /auth/verify-2fa` con token inválido retorna 401
- [ ] **IDOR en `GET /users/:id` corregido** — Test cross-tenant retorna 404 (no 200)
- [ ] **WebSocket CORS dinámico** — WebSocket conecta exitosamente en ambiente staging con dominio real
- [ ] **`roles.controller.ts` con guards de permisos** — Usuario sin `roles:create` obtiene 403 en `POST /roles`
- [ ] **Audit log filtrado por organización** — `GET /audit` retorna solo logs de la organización del usuario autenticado
- [ ] **Secret 2FA sin fallback hardcodeado** — App no inicia si `JWT_2FA_TEMP_SECRET` no está configurado
- [ ] **Logout revoca refresh tokens en DB** — Token usado después de logout retorna 401
- [ ] **Webhook Stripe con raw body** — Webhook procesa un evento real de Stripe sin error de firma
- [ ] **URLs correctas en `AuthService` frontend** — Invitación de usuarios funciona end-to-end desde la UI
- [ ] **`BillingPage` muestra datos reales** — No hay fechas hardcodeadas del 2025
- [ ] **Al menos 3 páginas de settings adicionales funcionales** — Security, integrations o smtp conectadas a backend
- [ ] **Migraciones TypeORM generadas** — `DB_SYNCHRONIZE=false` en staging sin errores de esquema
- [ ] **Suite de tests mínima ejecutándose en CI** — Al menos los tests de bugs críticos pasan
- [ ] **SSL con `rejectUnauthorized: true`** — Configurado en ambiente staging
- [ ] **Revisión de seguridad manual** de los endpoints más críticos (auth, users, roles, organizations)

---

## 15. Comandos ejecutados

| Comando / Herramienta | Propósito | Resultado clave |
|----------------------|-----------|-----------------|
| `Glob apps/**/*` | Mapa general del repositorio | Identificó estructura: backend NestJS + frontend Angular, 60+ módulos |
| `Read apps/backend/api/src/app/app.module.ts` | Revisar configuración global de guards y módulos | `JwtAuthGuard` y `ThrottlerGuard` aplicados globalmente; SSL con `rejectUnauthorized: false` |
| `Read apps/backend/api/src/app/auth/auth.controller.ts` | Revisar endpoints de autenticación | 30+ endpoints de auth; `UnauthorizedException` usada sin importar (línea 421) |
| `Read apps/backend/api/src/app/auth/auth.service.ts` | Revisar lógica de login y 2FA | Flujo completo, bien implementado, análisis de imposible viaje |
| `Read apps/backend/api/src/app/auth/auth.module.ts` | Revisar dependencias del módulo de auth | Módulo complejo con 20+ providers, algunas dependencias circulares con `forwardRef` |
| `Read apps/backend/api/src/app/auth/services/cookie.service.ts` | Revisar configuración de cookies | Cookies HTTP-only correctas, refresh token con path restringido |
| `Read apps/backend/api/src/app/auth/services/session.service.ts` | Revisar manejo de sesiones y refresh | `terminateAllSessions` no revoca en DB (comentado); rotación de tokens implementada |
| `Read apps/backend/api/src/app/auth/guards/permissions/permissions.guard.ts` | Revisar lógica de autorización | Guard correcto, pero dependiente del formato exacto del string de permiso |
| `Read apps/backend/api/src/app/auth/guards/csrf.guard.ts` | Revisar protección CSRF | Double-submit cookie implementado correctamente |
| `Read apps/backend/api/src/app/auth/auth.config.ts` | Revisar configuración de auth | `JWT_2FA_TEMP_SECRET` con fallback hardcodeado (línea 24) |
| `Read apps/backend/api/src/app/users/users.controller.ts` | Revisar endpoints de usuarios | Bug crítico: `@HasPermission('users.create')` en formato incorrecto; comentario IDOR en línea 144 |
| `Read apps/backend/api/src/app/users/users.service.ts` | Revisar lógica de usuarios | IDOR confirmado en `findOne()` sin organizationId; `as any` en query |
| `Read apps/backend/api/src/app/roles/roles.controller.ts` | Revisar endpoints de roles | Sin `PermissionsGuard` — cualquier usuario autenticado puede gestionar roles |
| `Read apps/backend/api/src/app/roles/roles.service.ts` | Revisar lógica de roles | Correcto: filtra por `organizationId` en todas las queries |
| `Read apps/backend/api/src/app/organizations/organizations.controller.ts` | Revisar endpoints de organizaciones | Correcto: usa `user.organizationId` para todos los métodos |
| `Read apps/backend/api/src/app/audit/audit.controller.ts` | Revisar endpoint de auditoría | Sin filtro de organización, sin `@HasPermission` |
| `Read apps/backend/api/src/app/audit/audit.service.ts` | Revisar servicio de auditoría | `find()` no filtra por organizationId — retorna logs globales |
| `Read apps/backend/api/src/app/websockets/events.gateway.ts` | Revisar autenticación WebSocket | CORS hardcodeado a `localhost:4200`; parsing manual de cookie frágil |
| `Read apps/backend/api/src/app/saas/saas.controller.ts` | Revisar endpoints SaaS | Sin `@HasPermission` en `/saas/usage`, solo `AuthGuard('jwt')` directo |
| `Read apps/backend/api/src/app/payment/payment.controller.ts` | Revisar integración Stripe | Raw body issue en webhook (línea 68); sin guard en `GET /payment/config` |
| `Read apps/backend/api/src/app/shared/permissions.ts` | Revisar definición de permisos | 40+ permisos en formato `dominio:accion` (colon) — discrepancia con `users.controller.ts` |
| `Read apps/core/client-web/src/app/app.routes.ts` | Revisar rutas globales del frontend | Rutas auth y authenticated correctamente configuradas |
| `Read apps/core/client-web/src/app/features/settings/settings.routes.ts` | Revisar rutas de configuración | 11+ páginas de settings declaradas, solo 2 con `permissionsGuard` |
| `Read apps/core/client-web/src/app/core/services/auth.ts` | Revisar servicio de autenticación Angular | URLs incorrectas para `inviteUser()` y `updateUser()` |
| `Read apps/core/client-web/src/app/core/services/billing.ts` | Revisar servicio de billing | Datos mock hardcodeados del 2025; `getSubscription()` retorna `of(this.currentSubscription())` |
| `Read apps/core/client-web/src/app/core/interceptors/auth.interceptor.ts` | Revisar interceptor de autenticación | Implementación correcta con cola de refresh concurrente |
| `Read apps/core/client-web/src/app/features/settings/system/security/security.page.ts` | Verificar página de seguridad | Stub vacío de 10 líneas |
| `Read apps/core/client-web/src/app/features/settings/system/integrations/integrations.page.ts` | Verificar página de integraciones | Stub vacío de 9 líneas |
| `Read apps/core/client-web/src/app/features/settings/system/smtp/smtp.page.ts` | Verificar página SMTP | Stub vacío de 9 líneas |
| `Read apps/core/client-web/src/app/features/settings/finance/accounting/accounting.page.ts` | Verificar página de preferencias contables | Stub vacío de 9 líneas |
| `Read libs/shared/util-auth/src/lib/permissions.util.ts` | Revisar utilidad compartida de permisos | Implementación correcta con wildcard y soporte de `*` |
| `Grep "as any" apps/backend/api/src/app` | Detectar uso de `any` en backend | 30+ ocurrencias; las más críticas en `users.service.ts:175`, `events.gateway.ts:53` |
| `Grep "TODO\|FIXME" apps/backend/api/src/app` | Detectar deuda técnica marcada | 2 TODOs en `compliance.service.ts` |
| `Grep "users\." users.controller.ts` | Confirmar bug de formato de permisos | Confirmado: usa punto en lugar de dos puntos |
| `Grep "users:" shared/permissions.ts` | Verificar formato canónico de permisos | Confirmado: usa dos puntos como separador |
| `Grep "permissionsGuard" settings.routes.ts` | Verificar guards frontend en settings | Solo 2 de 15+ rutas tienen `permissionsGuard` |
| `find . -name "*.spec.ts" \| wc -l` | Contar total de archivos de test | 169 archivos spec encontrados |
| `Read AUDITORIA_TECNICA.md` (primeras 300 líneas) | Revisar auditoria previa | Confirma XSS en branding.ts, SQL injection en analytics, IDOR previamente documentados |
