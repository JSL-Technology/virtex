# Ficha de módulo — roles-permisos (mecanismo de autorización)

Familia IAM · Auditor AppSec/arquitectura · 2026-11-07 · Diagnóstico (no se modificó código del repo).

## 1. Identificación
- Backend: `apps/backend/api/src/app/roles` (10 archivos, ~735 líneas, 1 controlador, 6 endpoints) + el mecanismo de autorización transversal en `apps/backend/api/src/app/security` (decoradores `@HasPermission`, `@Public`, `@AuthenticatedOnly`, `@CheckPermissions`, `@PlatformPermission`; guards `PermissionsGuard`, `PlatformPermissionsGuard`) y el catálogo `shared/permissions.ts` + util compartido `@virteex/shared/util-auth` (`hasPermission`).
- Tablas: `roles` (por organización, con `isSystemRole`), asignación en `user_roles`/membresías.
- Países: N/A (transversal).
- ¿Núcleo para vender? Sí — es el control de acceso de todo el ERP.

## 2. Estándar de referencia
(a) RBAC con catálogo cerrado de permisos, deny-by-default, autorización en servidor por operación, delegación (no puedes conceder lo que no tienes), roles de sistema inmutables, separación de deberes, re-autenticación (step-up) para operaciones sensibles. (b) Invariantes: el servidor decide; ocultar un botón no autoriza; un usuario no escala asignándose/clonando roles. (c) Líderes: SAP/NetSuite/D365 usan RBAC + ABAC con catálogos de privilegios y segregación de funciones (fuente: documentación de producto, confianza media). (d) Construcción: guard global que falla cerrado, decorador declarativo por handler, políticas ABAC inyectables.

## 3. Resultado
- Madurez: **82 (76–86, confianza alta)**. Mecanismo único, global, deny-by-default, verificado estática y dinámicamente.
- Preparación comercial: **80**; Veredicto: **Listo con reservas** (reservas: rama en rojo en CI por otros módulos; warnings de lint).
- Eje más débil: 6 (calidad: 522 warnings de lint en api, 175 `any`).
- Hallazgos críticos abiertos: **ninguno**.

## 4. Doce ejes
| Eje | Nota (rango, conf.) | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Funcional | 85 (80–90, alta) | 6 endpoints reales (crear/clonar/editar/borrar/listar/permisos-disponibles), persisten en `roles`; roles de sistema sembrados (ADMINISTRATOR, ACCOUNTANT, SELLER…) | catálogo de permisos documentado para el cliente |
| 2 Integridad | 83 (77–88, alta) | `assertAssignablePermissions(actor,...)` con `actor` REQUERIDO (compile-time), impide escalar; `cloneRole` prohíbe clonar roles de sistema (`roles.system_roles_cannot_cloned`) | pruebas de concurrencia en edición de rol |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 84 (alta) | `PermissionsGuard` como `APP_GUARD` (app.module.ts:459); políticas ABAC resueltas por DI (`moduleRef.get`, nunca `new`); puerto `RoleDelegationPort` | — |
| 5 Higiene | 72 (media) | roles depende de `auth/ports/role-delegation.port`; boundaries-report marca ciclo identidad↔otros | romper ciclos de módulo |
| 6 Calidad | 68 (media) | lint 0 errores pero 522 warnings api (GLOBAL-RESULTS) | reducir `any`/unused |
| 7 Robustez | 78 (media) | listados de roles acotados por org | paginación explícita en /roles |
| 8 Seguridad | **88 (83–92, alta)** | **Barrido estático: 808 handlers en 126 controladores, 0 sin `@HasPermission`/`@Public`/`@AuthenticatedOnly`** (ver §6 IAM-R1). Deny-by-default probado: member→403 en GET/POST /roles, POST /users/invite, PATCH /users/:id | ABAC más fino por recurso |
| 9 Pruebas | 80 (alta) | `verify:role-assignment` ✓ (toda asignación pasa la delegación); `global-guards.spec` verifica registro APP_GUARD | — |
| 10 Operabilidad | 80 (alta) | `PermissionsGuard` loguea `error` cuando un handler no declara nada (fail-closed y ruidoso); deniega sin filtrar el permiso al cliente (H-09) | — |
| 11 UX | N/A (ver frontend en organizations/users) | — | — |
| 12 Competitividad | 72 (media) | RBAC sólido; sin segregación de funciones declarativa ni catálogo visual avanzado como NetSuite | SoD, matrices de permisos |

## 5. Compuertas de producción
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | Cumple | endpoints reales |
| 2 | Integridad escrituras | Cumple | delegación obligatoria |
| 3 | AuthZ + aislamiento en TODOS los endpoints | **Cumple** | barrido 0/808 sin declarar; deny-by-default global |
| 4 | Validación servidor | Cumple | ValidationPipe whitelist global |
| 5 | Humo sin 500 | Cumple | sin 500 en pruebas IAM |
| 7 | Pruebas en CI | **No cumple** | rama en rojo (typecheck+test api, GLOBAL-RESULTS) — causado por otros módulos pero bloquea el gate |
| 8 | Auditoría negocio | Parcial | cambios de rol no siempre registran antes/después |

## 6. Hallazgos
- **IAM-R1** · roles-permisos/eje 8 · Categoría: seguridad (positivo/verificación) · Severidad: informativo · Ubicación: `app.module.ts:449-461`, `security/guards/permissions.guard.ts`. **Hallazgo clave (positivo):** la autorización es **un solo mecanismo** aplicado en servidor como `APP_GUARD` con **deny-by-default**: un handler que no declara `@HasPermission` ni `@Public` ni `@AuthenticatedOnly(reason)` es DENEGADO y logueado como error. Barrido estático propio (`agents/iam/sweep2.mjs`) sobre los 126 controladores/808 handlers: **0 handlers sin declaración** (674 `@HasPermission`, 52 `@Public`, 82 `@AuthenticatedOnly`). Verificado en runtime con qa-do-a-member (solo invoices:view,products:view): `GET /users`→403, `GET /roles`→403, `POST /roles`→403, `POST /users/invite`→403, `PATCH /users/:id`→403. Forma correcta: así está. Impacto: fortaleza a preservar.
- **IAM-R2** · roles-permisos/eje 2 · Categoría: seguridad (positivo) · Sev: informativo · `roles/roles.service.ts:200-240`. El `actor` de `assertAssignablePermissions` es obligatorio (no opcional) para que "olvidarlo" sea error de compilación; `cloneRole` bloquea clonar roles de sistema. No se puede clonar ADMINISTRATOR ni escalar vía creación de rol.
- **IAM-R3** · roles-permisos/eje 6 · Categoría: calidad · Sev: media · Ubicación: proyecto api (lint). 522 warnings (175 `no-explicit-any`). Qué está mal: deuda que erosiona el type-safety del control de acceso. Forma correcta: tipar permisos/roles sin `any`. Impacto: deuda técnica. Esfuerzo: M.

## 7. Camino mínimo a producción
1. Arreglar la rama roja (typecheck+test api) para que el gate 7 pueda cumplir — dep. de otros módulos — **M**.
2. Registrar antes/después en cambios de rol (auditoría de negocio) — **S**.

## 8. Camino a 100
- Reducir `any` en el catálogo de permisos (+3, M). SoD declarativa + matriz de permisos en UI (+5, L). Paginación en /roles (+1, S).

## 9. Competitividad
Básicas cubiertas (RBAC, delegación, roles de sistema). Falta avanzado: segregación de funciones, aprobaciones por permiso sensible (NetSuite, SAP GRC; confianza media).

## 10. Fortalezas a preservar
Deny-by-default global; mecanismo único; delegación compile-safe; `verify:role-assignment` en CI; no se filtra el permiso denegado al cliente.

## 11. No verificado
No cargué el catálogo completo de permisos vs UI. No probé concurrencia en edición de rol. IDOR cross-tenant en /roles no se pudo ejecutar con qa-do-b (throttle de login compartido en localhost, 5/min/IP saturado por agentes hermanos); cubierto por revisión de código + `verify:rls`/`verify:tenancy` (pasan) + prueba de cabecera `x-virtex-organization` (403, ver multi-tenencia.md).
