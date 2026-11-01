# Multitenencia y organizaciones (T03) — familia F2

> Auditoría 2026-10-31. Diagnóstico sin cambios en el repo. Tenant principal qa-a (`f7a44626-…`), víctima qa-b (`8af5fff0-…`). La API de este entorno conecta como `postgres` (superusuario): **RLS no aplica en las pruebas por API**, por lo que las pruebas IDOR miden el filtro de la capa de aplicación.

**Sin hallazgo crítico de seguridad abierto** en este módulo tras 20 pruebas IDOR de lectura/escritura en 9 recursos de 7 módulos (todas 404/401). Ver hallazgos altos MT-01 (filtro no a prueba de olvido en dev/CI salvo `verify:rls-runtime`) y MT-02 (tablas sin RLS con datos de inquilino).

## 1. Identificación
- **Backend**: `organizations/` (39 archivos, ~4.1k LOC, 5 specs; ~30 endpoints `/organizations/*`: perfil, branding, settings por sección, sucursales, subsidiarias, switch, memberships, mail-settings, security-settings, regional-format), `shared/tenancy/` (13 archivos + 5 specs: interceptor de conexión, parche de TypeORM, AsyncLocalStorage, guarda de tenant activo, clasificación de tablas, comprobación de arranque, jobs por tenant), `database/base.repository.ts`, `database/tenant-deletion.spec.ts`, ~20 migraciones RLS (`1789002100000-TenantRowLevelSecurity`, `1789006600000-ForceTenantRowLevelSecurity`, `1789006700000-CompleteTenantIsolationCoverage`, …).
- **BD**: 221 tablas; 174 con `relrowsecurity` y las 174 con `relforcerowsecurity` (FORCE); 176 políticas `tenant_isolation` con `USING` y `WITH CHECK` sobre `NULLIF(current_setting('app.current_organization', true),'')::uuid` (fail-closed: sin variable → 0 filas); tablas hijas protegidas vía `EXISTS` sobre el padre.
- **Frontend**: `core/tenancy/` (active-organization.service/interceptor, organization-route.guard, branches.service), `features/settings` (empresa).
- **Países**: transversal (N/A fiscal). **Núcleo para vender**: sí, bloqueante.

## 2. Estándar de referencia (antes de leer el código)
- (a) Básico: aislamiento total de datos por tenant en toda lectura/escritura, también en jobs, caché, búsqueda, archivos, colas y websockets; multiempresa (un usuario en varias empresas con cambio de contexto validado); offboarding/eliminación de tenant y exportación; subsidiarias/consolidación. Avanzado: aislamiento defensivo en profundidad (RLS + capa app), pruebas automáticas de aislamiento en CI con el rol real, noisy-neighbour controls (cuotas por tenant), tenant-tiering.
- (b) Invariantes: ningún camino de código lee/escribe filas de otro tenant aunque el desarrollador olvide el filtro; el contexto de tenant no puede filtrarse entre requests que comparten conexión del pool; el tenant del token se revalida contra la membresía.
- (c) Referencias: AWS SaaS Lens / "SaaS Tenant Isolation Strategies" (pool model con RLS de Postgres y `SET app.current_tenant` por sesión — confianza alta, whitepaper público de AWS); Salesforce: `OrgId` obligatorio en cada consulta impuesto por el runtime multitenant (confianza alta, "Force.com Multitenant Architecture" whitepaper); Odoo: `company_id` + record rules (confianza alta, docs Odoo multi-company); NetSuite: cuentas aisladas por cuenta + subsidiarias OneWorld (confianza media).
- (d) Construcción: tenant id derivado del principal en servidor, propagado por contexto ambiente (AsyncLocalStorage), política en la BD con rol de aplicación sin BYPASSRLS ni ownership, FORCE RLS, verificador de arranque y de CI.

## 3. Resultado
- **Madurez: 70 (62–76, confianza media)** — diseño de aislamiento por encima de la media del mercado (RLS+FORCE+arranque fatal+CI como `virtex_app`); baja por tablas de inquilino fuera de RLS, filtro de aplicación manual, código muerto engañoso y dependencia de que producción use el rol correcto.
- **Preparación comercial: 72 — Listo con reservas.**
- Eje más débil: Pruebas/verificabilidad en el entorno local (la API se prueba como superusuario) y Higiene (TenantedRepository muerto).
- Hallazgos críticos abiertos: 0. Altos: 2.

## 4. Ejes
| Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad/completitud | 72 (65–78, media) | Switch de empresa validado (POST `/organizations/switch` a org ajena → 403 `organizations.you_do_not_have_access_organization`); subsidiarias, sucursales, branding, settings reales; eliminación de tenant probada en `database/tenant-deletion.spec.ts` (pasa con BD real, `logs/api-test-db.log` 266/266 suites) | Exportación completa de datos del tenant para offboarding; UI de eliminación/retención; cuotas por tenant generales |
| 2 Corrección/integridad | 72 (65–78, media) | Políticas fail-closed; RESET en `finalize` y descarte de conexión si no se puede verificar (`shared/tenancy/tenant-connection.interceptor.ts:129-168`); transacciones colgadas se revierten | Usar `SET LOCAL` por transacción o `set_config(...,true)` para eliminar la clase de error "variable de sesión heredada"; hoy es `set_config(...,false)` (sesión) |
| 3 Multi-país | N/A | Transversal | — |
| 4 Arquitectura | 74 (68–80, media) | AsyncLocalStorage + parche de `Repository.manager`, `DataSource.transaction`, `createQueryRunner` (`shared/tenancy/tenant-repository.patch.ts:52-110`); clasificación exhaustiva de tablas que rompe el build (`tenant-table-classification.ts`) | Parchear el prototipo de TypeORM es frágil ante upgrades; un `TenantAwareDataSource` explícito sería más mantenible |
| 5 Higiene | 55 (48–62, media) | `database/base.repository.ts` (`TenantedRepository`, ~180 LOC) sin ningún uso (grep `TenantedRepository` → solo su definición) y depende de `nestjs-request-context`, cuyo módulo NUNCA se registra (grep `RequestContextModule` → 0) | Borrar código muerto; un único mecanismo |
| 6 Calidad código | 68 (60–74, media) | Comentarios extensos y precisos; `as any` en save | — |
| 7 Robustez/escala | 62 (55–70, media) | Una conexión fija por request (`tenant-connection.interceptor.ts:6-27`): el pool = límite de concurrencia; `ShortLivedConnections` para rutas largas | Métrica/alerta de saturación del pool; prueba de carga |
| 8 Seguridad/aislamiento | 72 (64–78, media) | 20 pruebas IDOR → 0 fugas (§6 pruebas); RLS con FORCE en 174 tablas; arranque FATAL fuera de dev si el rol es superusuario/BYPASSRLS o falta FORCE (`tenant-isolation.check.ts:120-270`); `virtex_app` existe, NOSUPERUSER, NOBYPASSRLS, sin ownership | 10 tablas con `organization_id` sin RLS (MT-02); filtro de app manual (MT-01) |
| 9 Pruebas | 66 (58–72, media) | `verify:rls` y `verify:rls-runtime` en CI como `virtex_app` (`.github/workflows/ci.yml:247-281`); specs de interceptor, guardas, colas | Las 65 suites con BD se omiten sin `DB_HOST` en `nx test`; sin prueba IDOR por API sistemática en CI |
| 10 Operabilidad | 60 (52–68, baja) | Logs `tenant_isolation_enforcing`/`not_enforcing` en arranque | Métricas por tenant; panel de tenants; runbook de offboarding |
| 11 UX | 62 (55–70, baja) | Selector de empresa y guardas de ruta por organización en `core/tenancy` | No recorrido completo por UI (ver ficha shell) |
| 12 Competitividad | 66 (58–72, baja) | Multiempresa + subsidiarias + consolidación; equivalente a Odoo multi-company | Sandbox por tenant (NetSuite/Salesforce), copias de tenant, data residency |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | Cumple | Endpoints reales, datos en BD |
| 2 | Integridad escrituras | Cumple (reservas) | WITH CHECK en políticas; save sin org ajena |
| 3 | Aislamiento verificado | Cumple con reservas | IDOR por API 0/20; RLS+FORCE; reservas MT-01/MT-02 |
| 4 | Validación servidor | Cumple | `UuidParamPipe`, whitelist DTO |
| 5 | E2E sin 500 | No verificado por UI | — |
| 6 | Cumplimiento país | N/A | — |
| 7 | Pruebas en CI | Cumple | `verify:rls`, `verify:rls-runtime` en CI |
| 8 | Auditoría | Parcial | Ver ficha auditoria-rastro (autor nulo) |
| 9 | Migraciones | Cumple | 163 migraciones desde cero OK |
| 10 | Observabilidad | Parcial | Sin organizationId en logs de request |
| 11 | UI | No verificado | — |
| 12 | Documentación | Parcial | Comentarios ricos; sin runbook de rol `virtex_app` fuera del código |

## 6. Hallazgos

**Pruebas ejecutadas (IDOR, sesión qa-a contra ids de qa-b)** — cookies + CSRF según ENTORNO.md, helper `$SP/f2/api.sh`:
- GET `/customers/89f6e37f…` → 404; GET `/customers/…/statement` → 404; PATCH y DELETE `/customers/…` → 404.
- POST `/inventory` (qa-b crea `QA-F2-Producto B` id `99ab1bfc…`); qa-a GET/PATCH/DELETE `/inventory/99ab1bfc…` → 404.
- qa-b sube `qa-f2-b.txt` (doc `4866cc09…`); qa-a GET `/documents/:id`, `/download`, PATCH `/rename`, DELETE → 404.
- GET `/users/9ebde454…` y `/users/…/activity` → 404 `users.user_id_not_found_your_organization`; PATCH user, PATCH role `82087c9e…`, POST force-logout → 401 step-up (no se llegó a evaluar el filtro por organización; no verificado).
- GET `/chart-of-accounts/05e79353…` → 404; GET `/taxes/1e69033d…` → 404.
- POST `/organizations/switch` con org de qa-b → 403.
- GET `/search?q=QA-F2-Producto B` (producto de qa-b) → `[]`.
- Verificación en BD tras las escrituras: el cliente/producto/documento de qa-b sin cambios.

**MT-01** — Multitenencia / Seguridad, Pruebas — **Alta** — Categoría: seguridad/arquitectura.
Ubicación: patrón general (p. ej. `inventory/inventory.service.ts:158`, `customers/customers.service.ts:182`, `documents/documents.controller.ts`), `database/base.repository.ts`.
Qué está mal: en la capa de aplicación el filtro de organización es manual (`where: { id, organizationId }` escrito por cada desarrollador; `verify:security` es un lint heurístico que hoy FALLA en `legal/legal.service.ts:59` — falso positivo sobre la tabla global `market_waitlist`, lo que además deja la compuerta roja y acostumbra a ignorarla). La garantía "a prueba de olvido" es RLS, y sólo existe si la API conecta como `virtex_app`; en desarrollo y en este entorno conecta como `postgres` y el arranque sólo avisa (`tenant-isolation.check.ts:236-250`). El `TenantedRepository` que aparenta automatizar el filtro está muerto y no funcionaría (usa `RequestContext` sin módulo registrado). Respuesta: en producción con el rol correcto el filtro SÍ es a prueba de olvido para las 174 tablas; en dev/QA no.
Forma correcta: conectar también dev/QA como `virtex_app` (contenedor de dev con el rol creado por migración), borrar `base.repository.ts`, arreglar el falso positivo de `verify:security`.
Impacto: riesgo operativo (fugas no detectadas en QA manual). Esfuerzo: S.

**MT-02** — Seguridad — **Alta** — tablas con `organization_id` y sin RLS: `audit_logs, legal_acceptances, mcp_oauth_codes, mcp_oauth_tokens, notification, organization_invitations, pending_registrations, roles, user_organizations, users`, más `intercompany_transactions`, `organization_subsidiaries`, `push_subscription`, `user_roles` (consulta `pg_class.relrowsecurity` vs columnas). Están clasificadas a propósito como CROSS_TENANT en `shared/tenancy/tenant-table-classification.ts:160-200` con motivo (se leen antes de existir tenant). Consecuencia: para usuarios, roles, auditoría, notificaciones y tokens OAuth MCP el aislamiento depende 100 % del filtro manual. Probado: GET `/users/:id` ajeno → 404 (filtra). No probado PATCH de roles/usuarios ajenos (step-up). Además `virtex_app` tiene `UPDATE/DELETE` sobre `audit_logs` (ver AUD-02).
Forma correcta: políticas RLS con predicado compuesto (p. ej. `organization_id = current OR user_id = current_user_id` con una segunda variable `app.current_user`), o vistas de seguridad para la ruta pre-tenant.
Impacto: riesgo operativo en tablas de identidad/permisos. Esfuerzo: M.

**MT-03** — Robustez — **Media** — `set_config('app.current_organization', $1, false)` a nivel de sesión (`tenant-connection.interceptor.ts:79`, `tenant-repository.patch.ts:118`, `tenant-job.ts:40`): seguro sólo mientras TODO camino haga RESET; está bien cubierto (finalize + descarte si falla), pero un `set_config(..., true)` dentro de transacción (SET LOCAL) elimina la clase de error. Esfuerzo: M.

**MT-04** — Rendimiento — **Media** — una conexión del pool fija por request autenticada durante toda la vida de la request (`tenant-connection.interceptor.ts`); sin métrica de saturación del pool ni prueba de carga. Esfuerzo: S (métrica) / M (prueba de carga).

**MT-05** — Higiene — **Media** — `database/base.repository.ts` código muerto con dependencia (`nestjs-request-context`) cuyo módulo no se registra; induce a error a auditores/desarrolladores. Esfuerzo: S.

**MT-06** — Operabilidad — **Baja** — Logs de request sin `organizationId`/`userId` (ver ficha observabilidad): no se puede responder "qué hizo el tenant X" desde logs.

## 7. Camino mínimo a producción
1. Desplegar con `DB_USERNAME=virtex_app` y `DB_MIGRATION_USERNAME` privilegiado (ya soportado, `database/data-source.ts:50`) y verificar el log `tenant_isolation_enforcing` (S).
2. RLS (o predicado compuesto) para `users`, `roles`, `user_roles`, `notification`, `audit_logs` (M).
3. Dev/QA como `virtex_app` y borrar `TenantedRepository` (S).

## 8. Camino a 100
1. RLS en tablas cross-tenant con predicado compuesto (+6, M). 2. `SET LOCAL`/transacción por request (+3, M). 3. Prueba IDOR automática por API sobre todos los `:id` en CI (+5, M). 4. Métricas por tenant y pool (+3, S). 5. Exportación/offboarding self-service (+4, M). 6. Sandbox/copia de tenant (+4, L).

## 9. Competitividad
Brecha básica: exportación completa del tenant. Avanzado: sandbox, data residency por región, cuotas por tenant generales (sólo existen para IA: `shared/rate-limit/tenant-rate-limit.guard.ts:68-75`). Diferenciador: RLS con FORCE + verificación de arranque fatal + CI con rol real (más estricto que Odoo, que confía en record rules de ORM; confianza media).

## 10. Fortalezas a preservar
Políticas fail-closed con FORCE; `TenantIsolationCheck` fatal fuera de dev; clasificación exhaustiva de tablas que rompe el build; `runAsTenantJob`/`forEachTenant` para jobs; validación de membresía en switch; websockets por room de organización.

## 11. No verificado
Comportamiento real con `virtex_app` por API (la API corre como superusuario; se confía en `verify:rls-runtime` de CI, no ejecutado aquí); PATCH de usuarios/roles ajenos (bloqueado por step-up); UI de settings de empresa; eliminación de tenant por UI.
Cobertura honesta: ~35 % de archivos de `organizations` + `shared/tenancy` leídos; 9 recursos/20 llamadas IDOR; 0 pantallas.

<!-- RESUMEN: modulo=multitenencia-y-organizaciones; madurez=52; prep=50; veredicto=No listo (ajustado por el coordinador; original 70/72); eje_debil=8 Seguridad y aislamiento; criticos=1; altos=2; camino_min=M -->


## Ajuste de calibración del coordinador (Paso 9)

La nota original del auditor (madurez 70, preparación 72, «Listo con reservas») **se rebaja a madurez 52 (45–58, confianza media) y preparación 50, veredicto «No listo»**. Motivo: las familias F4, F5, F7 y F10 reprodujeron por API **escrituras y lecturas entre tenants mediante referencias por id no validadas** —`parentId` del plan de cuentas (COA-01, con lectura de datos ajenos), `accountId` en `POST /accounting/lock-account-in-period`, `productId` en listas de precios (PL-01, devuelve el producto ajeno completo), `glAccountId` en landed costs (SCM-02), componentes y productos de BOM/órdenes (MFG-02), `taskId`/`customerId` en proyectos (PRJ-01)—. Es la prueba empírica de MT-01: el filtro de organización depende de que cada desarrollador lo escriba, y RLS (la defensa a prueba de olvido) no protege mientras la aplicación pueda conectarse con un rol que la evita y mientras 30+ tablas con datos de inquilino estén clasificadas sin RLS (MT-02). Se añade el hallazgo **MT-03 (crítica, seguridad): referencias foráneas entrantes no validadas contra la organización en ≥6 módulos**; forma correcta: un validador de pertenencia común (p. ej. `assertOwnedBy(manager, Entity, ids, organizationId)`) invocado por cada servicio que acepte ids ajenos al recurso, claves foráneas compuestas `(organization_id, id)` en BD para que la propia base rechace la referencia cruzada, conexión de la API siempre como `virtex_app` (arranque bloqueado si el rol tiene BYPASSRLS fuera de dev) y pruebas automáticas que intenten referenciar ids de otro tenant en todos los DTO con `*Id`. Esfuerzo M–L. Con un crítico abierto: madurez ≤59 y preparación ≤69; compuerta 3 incumplida → «No listo».
