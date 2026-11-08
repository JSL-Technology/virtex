# Ficha de módulo — organizations

Familia IAM · AppSec/arquitectura · 2026-11-07 · Diagnóstico.

## 1. Identificación
- Backend: `apps/backend/api/src/app/organizations` (41 archivos, ~4.193 líneas, 6 controladores): `organizations` (memberships, switch, profile, security-settings, subsidiaries), `branches`, `branding`, `mail-settings`, `organization-settings`, `regional-format`. Invitaciones entre organizaciones en `users/invitations` (received/accept/decline/sent/delete).
- Tablas: `organizations`, `branches`, settings/branding/mail, `organization_invitations`, membresías multi-org.
- Frontend: `features/settings` (organización, sucursales, seguridad). Núcleo para vender: **sí**.

## 2. Estándar de referencia
Perfil fiscal de la empresa, sucursales/establecimientos, subsidiarias, membresía de una persona en varias empresas con cambio de empresa activa autorizado por pertenencia, invitaciones con aceptación del destinatario, política de seguridad por empresa (MFA obligatoria). Líderes: NetSuite OneWorld (subsidiarias), Odoo multi-company (confianza media).

## 3. Resultado
- Madurez (calibrada por el coordinador): **72 (65–78, confianza media)**; el agente propuso 78.
- Preparación comercial: **70**; Veredicto: **Listo con reservas**.
  - _Motivo de la calibración (Paso 9):_ FE verificó en `qa-do-xflow` que `PATCH /organizations/profile` (datos legales de la empresa) **no deja ninguna fila en `audit_logs`** (FE-SET-01). PLTA midió 0 filas UPDATE de membresías y usuarios (PLT-AUD-02).
  - La compuerta 8 (auditoría de operaciones sensibles) no se cumple en las operaciones más sensibles de este módulo, y eso pesa sobre el eje 10.
- Eje más débil: 9 (pruebas/CI rojo) y 1 (subsidiarias sin consolidación verificada aquí).
- Críticos abiertos: **ninguno**.

## 4. Doce ejes
| Eje | Nota | Evidencia | Falta 100 |
|---|---|---|---|
| 1 Funcional | 78 (media) | sucursales con código fiscal de establecimiento/punto de emisión; branding; mail-settings; formato regional; subsidiarias (lista vacía en qa-do-a); política MFA por empresa | consolidación de subsidiarias de punta a punta (otro módulo) |
| 2 Integridad | 78 (media) | org de la sucursal sale del contexto autenticado, no del body | prueba de concurrencia en settings |
| 3 Multi-país | 72 (media) | `countryCode`, `currency`, `timezone`, `booksLanguage` por empresa; códigos de establecimiento genéricos | verificar formatos fiscales por país con contador local |
| 4 Arquitectura | 78 (media) | controladores finos, settings separados por subdominio | — |
| 5 Higiene | 68 (media) | ciclos configuración↔identidad/plataforma en boundaries-report | romper ciclos |
| 6 Calidad | 68 (media) | parte de los 522 warnings de api | — |
| 7 Robustez | 75 (media) | listados de sucursales acotados por org | paginación |
| 8 Seguridad | **86 (80–90, alta)** | Ver §6 | — |
| 9 Pruebas | 70 (media) | `verify:tenancy` ✓ membresía multi-org; CI rojo global | e2e de switch/invitación |
| 10 Operabilidad | 76 (media) | eventos estructurados en invitaciones (`invite_existing_member`, `organization_invitation_email_not_queued`) | auditoría antes/después en settings |
| 11 UX | 70 (baja) | no recorrido en navegador | prueba de UI |
| 12 Competitividad | 68 (media) | multi-empresa básica; sin intercompany/consolidación aquí | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | Cumple | endpoints persisten |
| 3 | AuthZ + aislamiento | **Cumple** | switch a org ajena → 403; header ajeno → 403; IDOR de branch por código |
| 4 | Validación servidor | Cumple | `organizationId` en body → 400 |
| 5 | Humo sin 500 | Cumple | sin 500 en mis pruebas |
| 7 | Pruebas en CI | No cumple | rama roja |
| 8 | Auditoría | Parcial | — |

## 6. Hallazgos
- **IAM-O1** · organizations/eje 8 · seguridad (positivo) · informativo. **Pruebas runtime propias:** `POST /organizations/switch {organizationId:<org B>}` con qa-do-a → **403 `organizations.you_do_not_have_access_organization`**; cabecera `x-virtex-organization:<org B>` → **403 `auth.organization_not_accessible`**; `POST /organizations/branches` con `organizationId` de B en el body → **400 whitelist**; crear sucursal QA-IAM-branchA (id `217c7e1c…`) → 201 con la org del contexto; aceptar una invitación con id inexistente/ajeno → **404 `users.invitation_not_found_or_expired`** (no distingue "ajena" de "inexistente", sin enumeración). Las invitaciones se buscan por `(organizationId, userId, status)` (organization-invitations service:103), atadas al destinatario.
- **IAM-O2** · organizations/eje 8 · pruebas · **media** · El ataque cross-tenant de sucursal (GET/PATCH/DELETE `/organizations/branches/217c7e1c…` desde qa-do-b) **no se pudo ejecutar** porque el throttle de login de localhost (5/min/IP, compartido) estaba saturado. Sí se confirmó que la sucursal siguió intacta para A. Forma correcta: prueba e2e HTTP con dos tenants en CI. Esfuerzo: S.
- **IAM-O3** · organizations/eje 5 · higiene · media · `logs/boundaries-report.log`: ciclos configuración↔identidad y configuración↔plataforma. Impacto: deuda técnica. Esfuerzo: M.

## 7. Camino mínimo a producción
1. e2e HTTP de aislamiento de sucursales/settings/invitaciones con dos tenants (IAM-O2), **S**. 2. Auditoría antes/después en security-settings y profile, **S**. 3. Verde en CI, **S/M**.

## 8. Camino a 100
Consolidación de subsidiarias e intercompany verificadas de punta a punta (+5, L). Ruptura de ciclos de módulo (+3, M). Paginación (+1, S).

## 9. Competitividad
Multi-empresa con cambio de empresa activa por pestaña es buena. Frente a NetSuite OneWorld le falta jerarquía de subsidiarias con consolidación y eliminaciones visibles en este módulo (confianza media).

## 10. Fortalezas a preservar
Cambio de empresa autorizado por pertenencia en servidor; la org nunca sale del body; invitaciones atadas al destinatario.

## 11. No verificado
IDOR de sucursales desde qa-do-b vía HTTP (throttle). UI de settings no recorrida. Consolidación de subsidiarias (otra familia).
