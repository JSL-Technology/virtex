# Ficha de módulo — users

Familia IAM · AppSec/arquitectura · 2026-11-07 · Diagnóstico.

## 1. Identificación
- Backend: `apps/backend/api/src/app/users` (26 archivos, ~3.328 líneas, 4 controladores): `users.controller` (CRUD, perfil, invitación, avatar, status, reset-password, force-logout, block-and-logout, email-change, activity), `user-workspace.controller`, `user-navigation-favorites.controller`, `invitations/organization-invitations.controller`.
- Tablas: `users` (una fila por persona, membresía multi-org separada), `user_security` (passwordHash, 2FA), workspace, favorites, `organization_invitations`.
- Frontend: `features/settings` (usuarios). Núcleo para vender: **sí**.

## 2. Estándar de referencia
Perfil propio vs administración de terceros separados; sin mass-assignment (rol/estado/org nunca desde el body de perfil); IDOR imposible (todo por org); step-up para credenciales/estado; auditoría de cambios; invitaciones con token. Líderes: Workspace/M365 admin (confianza media).

## 3. Resultado
- Madurez: **81 (75–86, confianza alta)**.
- Preparación comercial: **80**; Veredicto: **Listo con reservas**.
- Eje más débil: 6 (lint) / 9 (CI rojo).
- Críticos abiertos: **ninguno**.

## 4. Doce ejes
| Eje | Nota | Evidencia | Falta 100 |
|---|---|---|---|
| 1 Funcional | 84 (alta) | CRUD + perfil + invitación + avatar + status + reset + force-logout + activity | — |
| 2 Integridad | 82 (alta) | escrituras de User centralizadas: `verify:identity-writes` ✓ "toda escritura de User pasa por los writers de identidad" | — |
| 4 Arquitectura | 83 (alta) | `findOneByOrg(id, organizationId)` para lecturas (anti-IDOR, H2 FIX); step-up por operación | — |
| 6 Calidad | 68 (media) | parte de 522 warnings api | — |
| 7 Robustez | 78 (media) | listado `/users` paginado (page/pageSize/total) | — |
| 8 Seguridad | **87 (82–91, alta)** | Ver §6 | — |
| 9 Pruebas | 74 (media) | specs de invitación/redención; CI rojo global | verde CI |
| 10 Operabilidad | 80 (alta) | `auditTrailService.record` en change-email; endpoint de activity log | antes/después en más ops |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 3 AuthZ+aislamiento | **Cumple** | `@HasPermission`+`findOneByOrg`; member→403 |
| 4 Validación servidor | **Cumple** | mass-assign 400 whitelist |
| 8 Auditoría | Parcial | presente en credenciales/email |

## 6. Hallazgos
- **IAM-U1** · users/eje 8 · seguridad (positivo) · informativo. **Pruebas runtime propias con qa-do-a-member (invoices:view,products:view):** `GET /users`→403, `GET /users/:id`→403, `PATCH /users/:id`→403, `POST /users/invite`→403. **Mass-assignment en `PATCH /users/profile`** enviando `{roleIds, permissions, organizationId, status, isSuperAdmin}` → **400 `VALIDATION_FAILED`** con `whitelist_validation` por `roleIds` y `isSuperAdmin`; la sesión del miembro siguió siendo MEMBER (sin escalada). Operaciones sensibles (`:id`, `:id/status`, `:id/force-logout`, `:id/block-and-logout`, email-change) exigen `@HasPermission` **y** step-up (`manage_users`/`manage_user_status`/`manage_user_credentials`).
- **IAM-U2** · users/eje 4 · seguridad (positivo) · informativo · `users.controller.ts:236,264`. Lecturas/borrados por id usan `findOneByOrg(id, user.organizationId)` → IDOR cross-tenant cerrado en la capa de app (un id de otra org devuelve 403/no encontrado por el filtro de org). `@Delete(':id')` combina `@HasPermission(USERS_DELETE, IsOrganizationOwner)` (permiso + política ABAC de propiedad) en una sola declaración (M-05 FIX).
- **IAM-U3** · users/eje 6 · calidad · media · lint api (parte de 522 warnings). Esfuerzo: M.

## 7. Camino mínimo a producción
1. Registrar antes/después en status/rol/borrado (auditoría) — **S**. 2. Verde CI — **S/M** (global).

## 8. Camino a 100
- Auditoría de negocio completa con diff (+3, M). Reducir `any` (+2, M).

## 9. Competitividad
Administración de usuarios sólida; falta aprovisionamiento SCIM y gestión de ciclo de vida avanzada (vs Okta; confianza media).

## 10. Fortalezas a preservar
`findOneByOrg` universal; escrituras de User centralizadas (`verify:identity-writes`); whitelist + step-up en operaciones sensibles.

## 11. No verificado
No ejecuté IDOR con id de usuario ajeno desde qa-do-b (throttle login compartido); cubierto por código + whitelist + `verify:tenancy`. No recorrí el flujo de invitación de punta a punta por HTTP (step-up `manage_users` + correo en `tmp/mail-outbox`).
