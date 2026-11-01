# Ficha: Usuarios, roles y permisos (T02 — familia F1 Identidad y acceso)

> **HALLAZGO CRÍTICO DE SEGURIDAD ABIERTO — USR-01.** El cambio administrativo de correo (`POST /users/:id/email-change`) no comprueba que el actor tenga al menos los privilegios del usuario objetivo: un rol con `users:edit` puede reasignar el correo de un ADMINISTRATOR. Verificado por HTTP sobre tenants QA. Detalle y mitigación en Hallazgos (abajo).

## 1. Identificación
- **Backend:** `users` (24 archivos no-spec, 3.248 LOC, 5 specs), `roles` (10 archivos, 735 LOC, 3 specs), `shared/permissions.ts` (agrega `*.permissions.ts` por módulo), `security/guards/permissions.guard.ts`, `security/guards/platform-permissions.guard.ts`, `libs/shared/util-auth/permissions.util.ts`.
- **Endpoints:** users 16 rutas (`users.controller.ts`), roles 7 (`roles.controller.ts`), invitaciones 6, workspace/favoritos. Entidades: `users`, `user_security`, `roles` (permisos como texto), `user_roles`, `organization_invitations`.
- **Frontend:** `features/settings/user-management` y `features/settings/roles` (dentro de las 48 ts / 16 specs de settings; no probado en navegador).
- **Países:** N/A (transversal).
- **Dependencias:** auth (step-up, caché de principal), saas (límite de usuarios), organizations, mail.
- **¿Núcleo para vender?** Sí: el control de acceso del servidor es la base de un ERP multi-tenant.

## 2. Estándar de referencia
- **Básicas:** autorización aplicada en el servidor (no sólo ocultar botones); un único mecanismo de permisos; roles por tenant; invitaciones con rol; no escalada de privilegios (nadie se concede permisos que no tiene, ni `"*"`); sin asignación masiva de campos en PATCH; aislamiento total entre tenants.
- **Avanzadas:** permisos granulares por recurso/acción, ABAC/políticas contextuales, jerarquía de actor sobre objetivo, roles de sistema inmutables, step-up en cambios de autorización, revocación inmediata al cambiar roles, auditoría de cambios de permisos.
- **Invariantes:** cambiar el rol de alguien requiere poseer esos permisos; sólo un super-admin asigna `"*"`; una organización nunca se queda sin administrador; la edición de un usuario sensible exige al menos el poder del objetivo.
- **Líderes:** NetSuite usa roles+permisos con niveles de acceso y restricciones por subsidiaria; Dynamics 365 roles de seguridad con niveles por registro/BU; Odoo grupos+reglas de registro (`ir.rule`) (confianza media, documentación pública de cada proveedor). OWASP ASVS cap. 4 como vara (confianza alta).
- **Construcción de referencia:** un guard global deny-by-default, catálogo de permisos tipado, verificación de delegación y de jerarquía de actor en cada mutación de identidad.

## 3. Resultado
- **Madurez: 50** (42–58, confianza alta) — tope por crítico abierto (≤59).
- **Preparación comercial: 48 — No listo** (compuerta 3 incumplida por USR-01).
- **Eje más débil:** 8 Seguridad y aislamiento.
- **Críticos abiertos:** 1 (USR-01).

## 4. Doce ejes
| Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad/completitud | 72 (65–78, alta) | CRUD de usuarios, invitaciones, estados, reset admin, force-logout, roles CRUD + clonar + catálogo; todos reales por HTTP. | Jerarquía de actor; grupos/equipos. |
| 2 Corrección/integridad | 66 (58–72, media) | `update` de rol es transaccional y purga caché de los portadores tras el commit (`roles.service.ts` update); borrado de rol rechaza si hay asignados; "la organización retiene administrador" (`users.service.ts:273-275,563-565`). | Cerrar USR-01; test de concurrencia. |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 70 (62–76, media) | Guard único `PermissionsGuard` como `APP_GUARD` deny-by-default (`app.module.ts:437`); permisos de plataforma separados (`platform-permissions.guard.ts`); principal desacoplado. | — |
| 5 Higiene/separación | 58 (50–65, media) | `verify:boundaries` FALLA (identidad→contabilidad +1, global). `roles.service` importa `User` de users y `UserCacheService` de auth. Permisos definidos de forma distribuida en cada módulo (`*.permissions.ts`) y agregados: razonable. | Puertos en vez de import directo de la entidad `User`. |
| 6 Calidad | 64 (56–70, media) | Código claro, DTOs con whitelist. | Reducir `any` en `users.service` (`actor as unknown as AuthenticatedUser`). |
| 7 Robustez/rendimiento | 62 (54–68, media) | Caché de principal por request; límite de usuarios por plan en escritura. | Paginación/consultas N+1 no auditadas a fondo. |
| 8 Seguridad/aislamiento | 48 (40–56, alta) | **Aislamiento entre tenants: SÓLIDO** (probado). **Anti-escalada vía roles: SÓLIDO** (probado). Pero USR-01 rompe la jerarquía de actor en email-change. | Cerrar USR-01; revisar todas las operaciones que tocan credenciales/estado del objetivo. |
| 9 Pruebas | 60 (52–66, media) | 8 specs (roles catalogue, roles service, users service, provisioning); `assertCanAssignRole` con pruebas. Ningún test del cruce email-change + jerarquía. | Test de "actor no puede tocar a objetivo más poderoso". |
| 10 Operabilidad | 62 (54–68, media) | Audit en cambios sensibles (email-change admin, status). | Auditoría de toda mutación de rol/permiso. |
| 11 UX | N/A-parcial (no verificado) | UI no probada. | — |
| 12 Competitividad | 65 (56–72, media) | Permisos granulares + wildcard por prefijo + ABAC (policy `IsOrganizationOwner`) + step-up en cambios de autorización: competitivo. Sin jerarquía de roles ni restricción por subsidiaria/registro como NetSuite/Dynamics. | Niveles de acceso por registro, jerarquía. |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas / básicas | Cumple | CRUD real probado. |
| 2 | Integridad escrituras | Cumple parcialmente | Transaccional; USR-01 rompe un invariante de autorización. |
| 3 | Autorización y aislamiento | **No cumple** | USR-01. Resto: deny-by-default, 800/800 rutas con marcador, IDOR/cross-tenant rechazados. |
| 4 | Validación servidor | Cumple | whitelist + `forbidNonWhitelisted` (campos `permissions`/`roles`/`organizationId` extra → 400, probado). |
| 5 | E2E sin 500 | Cumple | Sin 500 en las pruebas de este módulo. |
| 6 | País | N/A | — |
| 7 | Pruebas CI | Cumple parcialmente | Specs en CI; hueco en jerarquía. |
| 8 | Auditoría | Cumple parcialmente | Falta auditar cada cambio de rol. |
| 9–12 | — | Mayormente cumple / no verificado UI | — |

## 6. Hallazgos
**USR-01** — users, auth; eje 8. **Categoría:** seguridad (escalada de privilegios / autorización rota). **Severidad: Crítica.** **Ubicación:** `apps/backend/api/src/app/users/users.controller.ts:335-353` y `apps/backend/api/src/app/users/users.service.ts:985-1015` (`adminChangeEmail`). **Qué está mal y por qué:** la ruta exige `users:edit` + step-up `manage_user_credentials`, pero `adminChangeEmail(userId, newEmail, organizationId)` **no recibe al actor** y por tanto **no verifica la jerarquía**: un usuario cuyos permisos son un subconjunto estricto (`users:view, users:edit, customers:view`) puede reescribir el correo de un ADMINISTRATOR del mismo tenant. Verificado sobre tenants QA el 2026-11-01: actor con rol `QA-F1-Restringido` → `POST /users/<id-admin>/email-change` → `200`. A diferencia de la asignación de roles —que sí está protegida por `assertCanAssignRole` (`roles.service.ts:134-170`)— aquí no hay comprobación equivalente. El efecto inmediato es que la víctima pierde el acceso (su sesión se cierra y su correo ya no es el suyo); combinado con el flujo de recuperación de contraseña permite completar una toma de cuenta del administrador. **Forma correcta:** pasar el actor y aplicar la misma regla que en roles: el actor debe poseer al menos todos los permisos del objetivo (reutilizar `assertCanAssignRole`/una comprobación de "outrank"); y/o exigir confirmación desde el nuevo correo antes de aplicar el cambio, como ya hace el auto-cambio de email del usuario (`requestEmailChange`/`confirmEmailChange`, `users.service.ts:653,688`). **Impacto comercial:** bloquea la venta (brecha de control de acceso explotable por un empleado de bajo privilegio). **Esfuerzo:** S-M.

**USR-02** — users; eje 8/6. **Categoría:** seguridad (defensa en profundidad). **Severidad: Alta.** **Ubicación:** operaciones de `users.service` que toman al objetivo por id dentro del tenant (`updateUserStatus`, `forceLogout`, `resetPassword`, `adminChangeEmail`). **Qué está mal:** salvo en la asignación de rol, no hay una verificación general de que el actor "supere" al objetivo; hoy sólo protege que la organización retenga un administrador. Un `users:manage_status` podría bloquear a un administrador (no probado end-to-end por presupuesto; inferido del código — "no verificado"). **Forma correcta:** una comprobación central `assertActorOutranksTarget(actor, target)` aplicada a toda mutación sobre otro usuario. **Impacto:** riesgo operativo. **Esfuerzo:** M.

**USR-03** — roles; eje 5. **Categoría:** higiene. **Severidad: Media.** `roles.service.ts` importa la entidad `User` y `UserCacheService` (de auth) y ejecuta queries sobre `user`/`user_roles`; cruza fronteras de módulo (contribuye al fallo de `verify:boundaries`). **Forma correcta:** puerto `RoleMembershipPort` servido por users. **Esfuerzo:** M.

**Controles que SÍ funcionan (verificado por HTTP, no son hallazgos):**
- **Anti-escalada en roles:** crear rol con `["*"]` → 400 (catálogo `IsIn`); con `platform:*` → 400; `assertAssignablePermissions` y `assertCanAssignRole` bloquean `"*"` y permisos de plataforma (`roles.service.ts:62-100,134-170`). Un usuario restringido no puede crear roles sin `roles:create` (403) ni asignarse el rol ADMINISTRATOR (`roles.you_cannot_assign_role_with_full`, 403).
- **Asignación masiva (mass assignment):** PATCH `/users/:id` y `/users/profile` con campos `permissions`/`roles`/`organizationId`/`isSystemRole` → 400 whitelist. El único campo de autorización editable es `roleId`, y pasa por `assertCanAssignRole`.
- **Aislamiento entre tenants / IDOR:** con sesión de qa-a, leer/editar recursos de qa-b por id → 404 (`users`, `roles`); cabecera `x-virtex-organization` de otro tenant → 403 `organization_not_accessible`. La capa de aplicación filtra por organización de forma consistente.
- **Endpoints sin autorización:** script `scratchpad/f1/scan_controllers.py` sobre 125 controladores / 800 rutas: **0 rutas sin marcador** (667 `@HasPermission`, 88 `@AuthenticatedOnly(reason)`, 45 `@Public`). Las `@AuthenticatedOnly` revisadas (data-transfer, my-work, data-quality, inbound-mail) filtran por permiso dentro del servicio (`hasPermission(...)`), no quedan abiertas.

## 7. Camino mínimo a producción
1. USR-01: pasar actor + comprobación de jerarquía y/o confirmación por el nuevo correo (S-M).
2. USR-02: `assertActorOutranksTarget` central en toda mutación de usuario (M).
3. Test de integración "actor de bajo privilegio no puede tocar a un administrador" (S).
4. Auditar cada cambio de rol/permiso (S).

## 8. Camino a 100
| Ítem | +pts | Esfuerzo | Retocar/rehacer |
|---|---|---|---|
| USR-01 | +8 (eje 8) | S-M | Retocar |
| USR-02 jerarquía central | +4 | M | Retocar |
| Tests de jerarquía en CI | +2 | S | Retocar |
| Puertos roles↔users | +2 (eje 5) | M | Reorganizar |
| Jerarquía de roles / acceso por registro | +4 (eje 12) | L | Nuevo |

## 9. Competitividad
- **Básicas:** cubiertas (permisos en servidor, roles por tenant, anti-escalada).
- **Avanzadas faltantes:** jerarquía de roles y restricción por subsidiaria/registro (NetSuite, Dynamics 365 — confianza media); segregación de funciones (SoD) como NetSuite.
- **Diferenciadores:** permisos de plataforma separados de los de tenant, ABAC con policies inyectables, step-up por alcance en cambios de autorización.
- **Nota competitividad:** 65 (56–72, media).

## 10. Fortalezas a preservar
Guard único deny-by-default; `assertAssignablePermissions`/`assertCanAssignRole` (anti-escalada robusta y probada); whitelist de DTO que frena mass-assignment; aislamiento entre tenants consistente en la capa de aplicación; separación permisos de plataforma vs tenant; purga de caché de principal tras editar un rol (revocación casi inmediata).

## 11. No verificado
UI de settings (navegador); USR-02 end-to-end (bloquear a un admin); borrado de usuario con policy `IsOrganizationOwner`; invitaciones aceptación/declinación; N+1 y paginación de listados; comportamiento de `force-logout` sobre la víctima.

**Cobertura honesta:** ~60% del backend del módulo leído y ~40% de rutas ejecutadas por HTTP (crear rol restringido, invitar+activar usuario real, matriz de acceso de 9 endpoints, 6 intentos de escalada, IDOR, mass-assignment, email-change). Frontend no inspeccionado.

<!-- RESUMEN: modulo=usuarios-roles-permisos; madurez=50; prep=48; veredicto=No listo; eje_debil=8 Seguridad y aislamiento; criticos=1; altos=2; camino_min=M -->
