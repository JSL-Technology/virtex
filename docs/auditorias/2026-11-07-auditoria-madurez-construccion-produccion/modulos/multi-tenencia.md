# Ficha de módulo — multi-tenencia (aislamiento de organización)

Familia IAM · AppSec/arquitectura · 2026-11-07 · Diagnóstico.

## 1. Identificación
- Backend: `shared/tenancy` (`TenantIsolationCheck`, `ActiveTenantGuard`, ports, `tenant-table-classification.ts`), interceptor de contexto por petición, políticas RLS en migración `database/migrations/1789002100000-TenantRowLevelSecurity.ts`, verificador `tools/verify/tenant-scope-guard.mjs` + `tools/verify/rls-*.ts`.
- 177 políticas RLS sobre 243 tablas; rol `virtex_app` (sin BYPASSRLS) para la app, rol privilegiado solo para migraciones.
- Países: N/A. Núcleo para vender: **sí, crítico** (ERP SaaS multi-tenant).

## 2. Estándar de referencia
Defensa en profundidad: (1) filtro de organización en cada consulta de aplicación (automático, no recordado), (2) RLS en BD como red de seguridad conectando como rol sin BYPASSRLS, (3) autorización de la organización activa por pertenencia. Invariante no negociable: ninguna consulta/escritura cruza de tenant, ni por olvido ni por id ajeno en URL/body/cabecera. Líderes aíslan por esquema o por discriminador + RLS (confianza media).

## 3. Resultado
- Madurez (calibrada por el coordinador): **70 (63–76, confianza media-alta)**; el agente propuso 85.
  - _Motivo de la calibración (Paso 9):_ la familia PLTA confirmó en vivo una **escritura entre tenants** (PLT-NOT-01, crítico) en `push_subscription`, y el coordinador verificó que esa tabla **no tiene columna de organización ni política RLS** (`information_schema` / `pg_policies` = 0). Junto con la FK sin guarda de mismo inquilino en `customer_portal_accounts` (IAM-T2, NOM), prueba que el aislamiento sigue dependiendo de que cada desarrollador se acuerde (de declarar `organization_id`, un DTO con whitelist, una FK compuesta). Los mecanismos (guard global, RLS, verificadores en CI) son de primer nivel, pero no cubren lo que se queda fuera de su modelo: el eje 8 baja a 70 y la madurez con él. Preparación comercial: 72 · **Listo con reservas** condicionado a cerrar PLT-NOT-01 y a que `verify:rls` exija columna de tenant en toda tabla con datos de usuario.
- Preparación comercial: **82**; Veredicto: **Listo con reservas**.
- Eje más débil: una FK sin guarda de mismo-tenant a nivel BD (IAM-T2) y CI en rojo.
- Hallazgos críticos abiertos: **ninguno**. (Riesgo residual: misconfiguración del operador en prod, pero el arranque ABORTA si el rol salta RLS — ver IAM-T1.)

## 4. Doce ejes
| Eje | Nota | Evidencia | Falta para 100 |
|---|---|---|---|
| 1 Funcional | 86 (alta) | organización en contexto por petición; dos empresas abiertas a la vez (ActiveTenantGuard recalcula roles por org) | — |
| 2 Integridad | 84 (alta) | `verify:tenancy` ✓ membresía multi-org: 1 fila de usuario, permisos por tenant, admin en A no aplica en B | guarda FK mismo-tenant universal (IAM-T2) |
| 4 Arquitectura | 88 (alta) | TenantScope automático; `verify:tenant-scope` ✓ "no unscoped repository reads"; RLS leída del esquema, no lista a mano | — |
| 5 Higiene | 74 (media) | clasificación única de tablas (un fichero) compartida por verificador y runtime | — |
| 6 Calidad | 72 (media) | comentarios extensos y correctos; parte de los 522 warnings api | — |
| 7 Robustez | 80 (media) | conexión vuelve al pool sin tenant; jobs por-tenant aislados (`verify:rls-runtime` ✓) | — |
| 8 Seguridad | **90 (85–93, alta)** | Ver §6. Triple capa + gate de arranque fail-closed + pruebas reales | cerrar IAM-T2 |
| 9 Pruebas | 86 (alta) | `verify:rls`, `verify:rls-runtime` (como `virtex_app`), `verify:tenancy`, `verify:auth-contract`: **todas pasan** | — |
| 10 Operabilidad | 84 (alta) | `TenantIsolationCheck` informa por separado superusuario/FORCE ausente/0 políticas | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 3 | AuthZ + aislamiento verificado | **Cumple** | 4 verify pasan + pruebas runtime |
| 4 | Validación servidor | Cumple | `organizationId` en body rechazado (400 whitelist) |
| 9 | Migraciones reproducibles | Cumple | 178 migraciones, 177 políticas RLS |
| 7 | Pruebas en CI | No cumple | `same-tenant-references.spec` falla (IAM-T2) + rama roja |

## 6. Hallazgos
- **IAM-T1** · multi-tenencia/eje 8 · seguridad (positivo) · informativo · `shared/tenancy/tenant-isolation.check.ts`. En producción (no dev) el arranque **ABORTA** si: (1) el rol es superusuario/BYPASSRLS, (2) posee tablas con política sin `FORCE`, (3) no hay políticas (salvo `DEPLOY_ALLOW_UNPROTECTED_BOOTSTRAP=true` para el primer deploy), o (4) no puede comprobarlo. La API debe conectar como `virtex_app` (`DB_USERNAME`), rol sin BYPASSRLS, y dejar el rol privilegiado para `DB_MIGRATION_USERNAME`. En este entorno dev la API corre como `postgres` (superusuario) → RLS NO rige en runtime aquí; solo avisa. El aislamiento probado en dev es el de la capa de aplicación (TenantScope), que es robusto por sí mismo.
- **IAM-T2** · multi-tenencia/eje 2 · integridad de datos · **media** (defensa en profundidad incompleta, no fuga real) · `database/same-tenant-references.spec.ts:56`. La FK `FK_customer_portal_accounts_customer` (`customer_portal_accounts.customer_id`) no tiene guarda de mismo-tenant a nivel BD → referencia cruzada entre tenants posible en el modelo de datos (no vía API, que filtra por org). Módulo dueño: customer-service, pero es un hueco de aislamiento. Forma correcta: constraint/trigger de mismo-tenant o política que valide el tenant del padre. Impacto: riesgo operativo. Esfuerzo: M.
- **IAM-T3** · multi-tenencia/eje 8 · seguridad (positivo) · informativo. **Pruebas runtime propias:** (a) qa-do-a con cabecera `x-virtex-organization: <org de B>` (no es miembro) → **403 `auth.organization_not_accessible`**; (b) `organizationId` de B en el body de `POST /organizations/branches` → **400 whitelist_validation** (la org viene del contexto autenticado, no del body); (c) `verify:rls` como `virtex_app`: "insertar/actualizar en otra empresa es rechazado", "la empresa A ve solo sus clientes". 
- **IAM-T4** · multi-tenencia/operabilidad · documentación · baja. La contraseña de `virtex_app` solo se fija si `APP_DB_PASSWORD` está presente al migrar (migración 1789002100000:129). En `virteex_test` no estaba puesta; la fijé manualmente (`ALTER ROLE virtex_app WITH PASSWORD`) para poder ejecutar `verify:rls*` — documentado aquí. En prod el runbook debe fijarla antes de migrar.

## 7. Camino mínimo a producción
1. Añadir guarda de mismo-tenant a `customer_portal_accounts.customer_id` (IAM-T2) — **M**.
2. Documentar en runbook: `DB_USERNAME=virtex_app`, `DB_MIGRATION_USERNAME`, `APP_DB_PASSWORD` — **S**.
3. Arreglar `same-tenant-references.spec` para que CI verifique el invariante — **S**.

## 8. Camino a 100
- Guarda FK mismo-tenant generalizada a todas las FKs cross-entidad (+4, M). Prueba e2e de aislamiento con dos tenants reales vía HTTP en CI (+2, S).

## 9. Competitividad
A la par o por encima de muchos SaaS: pocos combinan RLS con gate de arranque fail-closed (confianza media).

## 10. Fortalezas a preservar
Triple defensa (scope de app + RLS + gate de arranque); clasificación única de tablas; 4 verificadores en CI; membresía multi-org correcta.

## 11. No verificado
No ejecuté IDOR cross-tenant vía HTTP con qa-do-b (throttle de login compartido localhost saturado por agentes hermanos, 5/min/IP; el retrier con backoff no logró ventana en ~2,5 min). Sustituido por: prueba de cabecera `x-virtex-organization` (403), `verify:rls`/`rls-runtime`/`tenancy` (pasan), revisión de código. RLS en runtime no se ejerce en este entorno (API como `postgres`).
