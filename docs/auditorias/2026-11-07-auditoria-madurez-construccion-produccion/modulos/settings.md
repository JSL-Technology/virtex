# Ficha — settings (configuración de cuenta, empresa, contabilidad, administración)

Familia FE · 2026-11-07/08. Cambios hechos solo en el tenant propio qa-do-xflow y revertidos (website/phone del perfil → null; prefijo de secuencia CREDIT_NOTE QAFE- → NC-; idioma preferido en/pt → es).

## 1. Identificación
- Alcance frontend: `apps/core/client-web/src/app/features/settings` (48 archivos .ts sin specs + html/scss; 16 specs), registro de 27 secciones en 6 grupos (`shell/settings-registry.ts:98-264`), modal `modal/settings-modal.component.ts`. Archivos mayores: `user-management/user-management.page.ts` 619 l., `my-profile/my-profile.page.ts` 449 l., `components/security-settings/security-settings.component.ts` 426 l.
- Backend consumido: `/organizations/profile`, `/organizations/settings/{accounting|currencies|taxes|fiscal|closing|intercompany|inventory}`, `/organizations/security-settings`, `/organizations/mail-settings`, `/organizations/subsidiaries`, `/document-sequences/:type`, `/localization/*` (fiscal-coverage, withholding-regimes, tax-jurisdictions, fiscal-document-types), `/einvoicing/{settings,ranges}`, `/workflows/policies`, `/users/*`, `/roles/*`, `/auth/2fa/*`, `/auth/sso/admin/*`, `/audit`.
- Países: secciones condicionadas (`fiscal` solo DO; `einvoicing-regime` excepto DO; `tax-jurisdictions` US/BR). Núcleo: sí.

## 2. Estándar de referencia
(a) Básico: perfil legal de empresa, formato regional, numeración de documentos, impuestos/régimen fiscal, cuentas por defecto, usuarios/roles, política de seguridad (MFA, sesiones), correo saliente, plan/facturación; cada ajuste persiste, se valida en servidor, se audita (quién/cuándo/antes/después) y tiene efecto. Avanzado: SSO, integraciones, IA, extensiones, búsqueda de ajustes. (b) Invariantes: numeración no retrocede; cuentas por defecto del tipo correcto y del mismo tenant; país fiscal no cambia una vez hay libros. (c) Referencia: Odoo "Settings" por app, NetSuite "Setup > Company > Accounting Preferences", Dynamics "Number sequences" con control de retroceso (confianza media). (d) Ajustes como datos por tenant con DTO por sección.

## 3. Resultado
- **Madurez: 60 (53–66, confianza media)**. Preparación: 60. **Veredicto: Piloto controlado.**
- Eje más débil: 10 (auditoría de cambios de perfil de empresa ausente) y 2 (deep link roto).
- Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Completitud | 66 (58–72, media) | 27/27 secciones abren con contenido (texto 700–4.400 caracteres) sin errores JS ni 404; SSO/integraciones/IA 403 por plan | Upsell claro en secciones fuera de plan |
| 2 Corrección | 62 (55–68, media) | `PATCH /organizations/settings/accounting` con cuenta REVENUE como CxC → 400 `account_wrong_type`; con cuenta de otro tenant (qa-do-a 1130) → 400 `account_not_usable`; `PATCH /document-sequences/CREDIT_NOTE {"nextNumber":1}` → 400 `document_sequence_cannot_go_back`; `countryCode`/`timezone`/`subscriptionStatus`/`id` en perfil → 400 whitelist. Deep link `/settings/<id>` → `#settings/e` | Corregir guard; permitir cambio de zona horaria controlado |
| 3 Multi-país | 58 (50–64, baja) | Secciones por país en registro; país bloqueado (`countryLocked: true`) | Probar con tenants no DO |
| 4 Arquitectura | 62 (55–68, media) | Registro único de secciones con permisos de ver/editar y país (`settings-registry.ts:56-63`); servicio por sección | — |
| 5 Higiene | 50 (42–58, media) | Settings contiene `data/users.service.ts` duplicado con `core/api/users.service.ts`; `core/services/regional-format.service.ts:7` importa de settings | Un solo dueño |
| 6 Calidad | 55 (48–60, baja) | Componentes 400–620 l.; warnings no desglosados | — |
| 7 Robustez | 55 (45–60, baja) | — | — |
| 8 Seguridad | 66 (58–72, media) | Miembro: `PATCH /organizations/profile` → 403 (`IsOrganizationOwnerPolicy`, `organizations.controller.ts:161-162`); secciones con `viewPermission` bloqueadas al miembro (fiscal/users/roles); perfil visible en solo lectura a todos (`settings-registry.ts:124`, sin viewPermission, decisión explícita «Company: everyone in it»). Clave de Google Maps literal en `src/environments/environment.ts:16` y `environment.development.ts:16` (`AIzaSyCn****`) | Mover clave a configuración de despliegue y restringirla por referrer |
| 9 Pruebas | 50 (42–58, media) | 16 specs en settings; ninguno cubre el guard de redirección con `/e/:org` | — |
| 10 Operabilidad/auditoría | 40 (32–48, media) | Secuencias: `audit_logs` UPDATE registrado (2 filas a las 00:39:55/56). Perfil de empresa: tras `PATCH /organizations/profile` (19:53) **0 filas nuevas** en `audit_logs` para la org; en toda la BD solo hay `organization_settings CREATE` (22), ningún UPDATE de organización | Auditar cambios de perfil/seguridad/MFA/SMTP con antes/después |
| 11 UX/i18n | 62 (55–68, media) | 0 claves crudas; en/pt OK; buscador de secciones; modal con foco gestionado (`settings-modal.component.ts:200-201`) | Deep links; estados de plan |
| 12 Competitividad | 60 (50–66, baja) | Cobertura comparable a Odoo/Alegra en lo básico; SSO/IA/extensiones como avanzados | — |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | Cumple | 27 secciones con backend real |
| 2 Integridad | Cumple en lo probado | secuencia no retrocede; tipos de cuenta |
| 3 AuthZ/aislamiento | Cumple en lo probado | member 403; cuenta de otro tenant rechazada |
| 4 Validación servidor | Cumple | whitelist + reglas |
| 5 Humo | Cumple con reservas | 403 de plan en 3 secciones |
| 6 País | No verificado fuera de DO | — |
| 7 CI | No cumple (global) | main rojo |
| 8 Auditoría | **No cumple** | perfil de empresa sin auditoría |
| 11 UI | Cumple con reservas | deep link |
| 12 Doc | Parcial | sin guía de configuración inicial por país |

## 6. Hallazgos
- **FE-SET-01** · eje 10 · operabilidad/auditoría · **Alta** · `PATCH /organizations/profile` (organizations.controller.ts:161). El cambio de datos legales de la empresa (razón social, RNC, dirección, teléfono, web) no deja rastro en `audit_logs` (verificado: 0 filas nuevas tras el PATCH en qa-do-xflow). Esos datos aparecen en facturas fiscales: un cambio no auditado no se puede reconstruir ante la autoridad. Forma: interceptor/suscriptor de auditoría con antes/después en organización, política de seguridad, SMTP y SSO. S–M.
- **FE-SET-02** · eje 2 · bug · **Media** · `core/guards/settings-modal-redirect.guard.ts:12-13`. Todo enlace `/settings/<sección>` abre la sección «e». (= FE-SH-02). S.
- **FE-SET-03** · eje 8 · seguridad · **Media** · `apps/core/client-web/src/environments/environment.ts:16`, `environment.development.ts:16`. Clave de Google Maps (tipo API key de navegador, `AIzaSyCn****`) versionada en el repo; producción usa marcador `__GOOGLE_MAPS_API_KEY__` (`environment.production.ts:21`). Riesgo de abuso de cuota si no está restringida por referrer (no verificable desde aquí). Rotar y sacar del repo. S.
- **FE-SET-04** · eje 11 · UX · **Baja** · secciones `sso`, `integrations`, `ai`: llaman endpoints fuera de plan (403 `saas.feature_disabled`) en lugar de consultar el plan antes. S.
- **FE-SET-05** · eje 1 · funcionalidad · **Baja** · zona horaria de la empresa no editable por `PATCH /organizations/profile` (400 whitelist) y no localicé otra sección que la edite (grep `timezone` en features/settings: solo `billing/billing.page.ts` y un spec de regional-format; ningún formulario lo edita). Verificar con el equipo si es intencional. S.

## 7. Camino mínimo a producción
FE-SET-01 auditoría (S–M) → FE-SET-02 (S) → FE-SET-03 rotar clave (S) → probar secciones por país con tenants MX/US/CO (M).

## 8. Camino a 100
Auditoría completa de ajustes (+10), asistente de configuración inicial por país (+8), pruebas E2E de persistencia/efecto por sección (+8), estados de plan (+4), historial de cambios visible en cada sección (+5).

## 9. Competitividad
Odoo/NetSuite muestran historial de cambios de configuración y asistentes de puesta en marcha; aquí hay pista de auditoría general pero no cubre la empresa (confianza media).

## 10. Fortalezas
Validaciones de servidor reales (tipo de cuenta, tenant, numeración que no retrocede, whitelist de campos sensibles); registro único de secciones con permisos y país; secuencias auditadas.

## 11. No verificado
Efecto real de cada ajuste en documentos (p.ej. prefijo nuevo en la siguiente nota de crédito: no se emitió documento para no tocar e-CF); SMTP (efecto externo); SSO (plan); MFA obligatorio (afectaría a otros agentes en tenants compartidos).
