# Ficha de módulo: `workflows` (motor de aprobaciones por política)

Familia: PLTB · Auditor: PLTB · Fecha: 2026-11-07 · QA_SESSION=pltb · tenant qa-do-plt
Ver también `workflow-engine.md` — hallazgo de arquitectura PLTB-WF-01 (dos motores de flujo).

## 1. Identificación
- Backend: `apps/backend/api/src/app/workflows/` (1.739 líneas).
  - `workflows.service.ts` (529), `workflows.controller.ts` (125), `workflow-approval.source.ts` (93), `approval-handler.registry.ts` (86), `dto/approval-policy.dto.ts` (80), entidades `approval-request` (76), `approval-step-action` (68), `approval-policy-step` (53), `approval-policy` (33), `events/approval.events.ts` (41). Pruebas: `approval-flow.spec.ts` (524).
  - Endpoints (`/workflows`): `GET approvals/pending`, `GET approvals/:requestId/history`, `POST approve/:requestId`, `POST reject/:requestId`, `POST policies`, `GET policies`, `PATCH policies/:policyId`, `DELETE policies/:policyId`.
  - Tablas: `approval_policies`, `approval_policy_steps`, `approval_requests`, `approval_step_actions`.
- Tipos de documento aprobables: `VENDOR_BILL`, `PAYMENT_BATCH`, `JOURNAL_ENTRY`, `PERIOD_REOPENING`, `AUDIT_ADJUSTMENT`.
- Frontend: `apps/core/client-web/src/app/features/approvals` (451 líneas, 1 spec) + `features/settings/operations/approvals`.
- Consumidores (quién crea solicitudes): `procurement`, `accounting/closing-checklist`, `einvoicing/ecf-lifecycle` (vía `startApprovalProcess`).
- ¿Núcleo para vender? Sí (controles financieros = requisito de compra en segmento medio).

## 2. Estándar de referencia
Aprobaciones multinivel por umbral y rol, con segregación de funciones (SoD), auditoría de cada decisión (quién/cuándo/paso), posteo del documento solo tras aprobación final en la misma transacción, aislamiento por tenant, e idempotencia/concurrencia correcta ante aprobadores simultáneos.

## 3. Resultado
- **Madurez (calibrada por el coordinador): **55 (48–62, confianza media)**; el agente propuso 72–80.**
  - _Motivo de la calibración (Paso 9):_ PLTB-WF-02 verificado por el coordinador: `loadDecidable` (`workflows.service.ts:476-480`) lee con `findOne` sin bloqueo ni `@VersionColumn` y comprueba `status === PENDING` bajo READ COMMITTED; dos aprobadores concurrentes pueden ejecutar `onApproved` dos veces (doble posteo). Invariante de integridad roto en un caso plausible → eje 2 ≈ 55, y la madurez no puede superar el eje 2.
  - Preparación 55 · **Piloto controlado** (no apto para flujos de aprobación que contabilizan hasta cerrar PLTB-WF-02).
- ~~Madurez original: 72–80 (confianza media-alta).** Diseño correcto y bien comentado (SoD por defecto, tenant-scoping, auditoría transaccional, posteo dentro de la transacción vía `ApprovalHandlerRegistry`). El historial de comentarios del código documenta vulnerabilidades pasadas ya corregidas (IDOR cross-tenant, reject sin razón, SoD ausente).
- **Preparación comercial: Listo con reservas.** Críticas (authZ, aislamiento) cumplen y PROBADAS; reserva fuerte: **concurrencia sin bloqueo** (PLTB-WF-02), que puede permitir doble decisión/doble posteo.
- **Eje más débil:** Robustez/Integridad bajo concurrencia.
- **Hallazgos críticos abiertos:** PLTB-WF-02 (alta, posible crítica si se confirma doble posteo).

## 4. Ejes (nota / evidencia / qué falta para 100)
1. Funcionalidad real (82, alta): políticas reales creadas/listadas/borradas en vivo; SoD y role-step reales en `loadDecidable`. Sin mocks.
2. **Integridad (62, media) — RIESGO**: `approve()`/`reject()` son transaccionales y postean el documento dentro de la transacción (bien), PERO `loadDecidable` lee con `findOne` **sin `FOR UPDATE` ni `@VersionColumn`** y solo valida `status===PENDING`. Ver PLTB-WF-02.
3. **AuthZ/aislamiento (88, alta) — PROBADO**: `loadDecidable` scoped a `actor.organizationId`; permisos `WORKFLOWS_DECIDE`/`WORKFLOWS_MANAGE`. Roles tomados del principal (`actor()` en controller), nunca del body.
4. Validación servidor (85, alta): DTOs con class-validator; `assertStepsAreCoherent` (orden y umbrales); `RejectApprovalDto` exige razón (corrige bug histórico de `@Body('reason')` sin validación).
5. Multi-país: N/A (umbrales en monto; conversión a minor units con `toMinorUnits`).
6. Calidad (80, media): código claro, comentarios que explican decisiones de seguridad.
7. Robustez (62, media): sin bloqueo optimista/pesimista en la decisión (PLTB-WF-02).
8. Seguridad (86, alta): SoD cerrada por defecto (`you_cannot_approve_request_you_raised`); no IDOR cross-tenant (probado). Falta: rate limit de decisiones.
9. Pruebas (72, media): `approval-flow.spec.ts` (524 líneas) cubre flujo y SoD; **no cubre concurrencia** de dos aprobadores simultáneos.
10. Operabilidad (80, alta): auditoría de negocio real (`recordWithManager` en create/approve/reject con newValue antes/después) — buena práctica. Anuncios post-commit (no notifica sobre algo que hizo rollback).
11. UX (no verificado): bandeja de aprobaciones (451 líneas, 1 spec); no auditada con Playwright.
12. Competitividad (76): aprobaciones multinivel por umbral/rol a la par de líderes; falta delegación, vencimiento/escalado automático, aprobación móvil.

## 5. Compuertas de producción
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | CUMPLE | políticas/decisiones reales |
| 2 | Integridad escrituras | **NO CUMPLE (reserva)** | sin lock: posible doble decisión (PLTB-WF-02) |
| 3 | AuthZ/aislamiento | CUMPLE | B→404 en A (probado); SoD; tenant-scoped |
| 4 | Validación servidor | CUMPLE | DTOs + coherencia de pasos |
| 5 | Humo sin 500 | CUMPLE | CRUD de políticas 200/201/404 |
| 6 | País | N/A | |
| 7 | Pruebas CI | CUMPLE PARCIAL | flujo+SoD sí; concurrencia no |
| 8 | Auditoría negocio | CUMPLE | audit trail transaccional |
| 9 | Migraciones | CUMPLE | global |
| 10 | Observabilidad | CUMPLE PARCIAL | logs; correlación no verificada |
| 11 | UI sin bloqueos | NO VERIFICADO | |
| 12 | Documentación | CUMPLE PARCIAL | |

## 6. Hallazgos

**PLTB-WF-02** · workflows · eje 2/7 · Categoría: integridad de datos / robustez · Severidad: **alta** (potencial crítica)
- Ubicación: `workflows.service.ts` `loadDecidable()` (~líneas 471–511) y `approve()` (~326–399). Entidad `approval-request.entity.ts`: sin `@VersionColumn`.
- Qué está mal: la decisión se toma dentro de `dataSource.transaction(...)` pero la carga de la solicitud es `manager.findOne(ApprovalRequest, { where:{id, organizationId} })` **sin `setLock('pessimistic_write')`** y la entidad **no tiene columna de versión** (optimistic). El único guard es `request.status !== PENDING`. Bajo el aislamiento por defecto de Postgres (READ COMMITTED), dos aprobadores del **mismo paso** que actúan a la vez pueden ambos leer `status=PENDING`, ambos superar el check y ambos avanzar: en una política de **un solo paso** ambos pondrían `status=APPROVED` y ambos invocarían `handler.onApproved(...)` → **doble posteo del documento** y dos `approval_step_actions` para el mismo paso. En multi-paso, doble avance.
- Evidencia: grep confirma ausencia de `setLock`/`FOR UPDATE`/`Version` en la ruta (ver sección pruebas). No ejecutado en vivo (crear una `approval_request` requiere un documento de negocio sobre umbral vía `startApprovalProcess`, cross-module; omitido por presupuesto). Confianza alta desde código.
- Forma correcta: `manager.findOne(..., { lock: { mode: 'pessimistic_write' } })` sobre la solicitud al inicio de la transacción, o `@VersionColumn` + reintento; así la segunda transacción se bloquea/relee y encuentra `status != PENDING`.
- Impacto: doble aprobación y, peor, doble posteo contable/pago. Riesgo operativo y de integridad financiera. Bloquea "listo para producción" de la compuerta 2 hasta corregir o demostrar que no ocurre.
- Esfuerzo: S.

**PLTB-WF-05** · workflows · eje 9 · Categoría: pruebas · Severidad: media
- `approval-flow.spec.ts` no incluye una prueba de concurrencia (dos aprobadores simultáneos). Añadir una prueba que ejecute dos `approve()` en paralelo sobre la misma request y exija exactamente una decisión efectiva.
- Esfuerzo: S.

## Pruebas ejecutadas (2026-11-07)
- Crear política en A: `POST /workflows/policies {name:QA-PLTB-vendorbill,documentType:VENDOR_BILL,steps:[{order:0,minAmount:1000,roleId:<ADMIN A>}]}` → **201** (id `8ba04443…`).
- Aislamiento: `GET /workflows/policies` (qa-do-b) → **200 `[]`** (no ve la de A).
- `PATCH /workflows/policies/8ba04443…` (qa-do-b) → **404** `approval_policy_not_found`.
- `DELETE /workflows/policies/8ba04443…` (qa-do-b) → **404**.
- `POST /workflows/approve/8ba04443…` (qa-do-b, id ajeno) → **404** `approval_request_not_found` (loadDecidable tenant-scoped; sin IDOR).
- AuthZ: `GET /workflows/policies` (qa-do-a-member) → **403** `you_do_not_have_permission_perform`.
- A conserva su política y la elimina (cleanup) → **200**.
- Lock: `grep -nE "lock|FOR UPDATE|pessimistic|Version"` en `workflows.service.ts` y la entidad → sin coincidencias en la ruta de decisión.

## 7. Camino mínimo a producción
1. (S) Añadir bloqueo pesimista o versión optimista en `loadDecidable`/`approve`/`reject` (PLTB-WF-02). **Bloqueante.**
2. (S) Prueba de concurrencia (PLTB-WF-05).
3. (L, compartido) Converger con workflow-engine (PLTB-WF-01).

## 8. Camino a 100
- +10 integridad concurrencia (PLTB-WF-02) S; +4 pruebas concurrencia S; +3 escalado/vencimiento M; +3 UI verificada M.

## 9. Competitividad
- Básicas cubiertas (multinivel por umbral/rol, SoD, auditoría, posteo transaccional). Avanzadas faltantes: delegación, escalado por vencimiento, aprobación móvil/correo, condiciones por dimensión. Fuente: código (confianza alta).

## 10. Fortalezas a preservar
- SoD cerrada por defecto; roles desde el principal.
- Posteo del documento dentro de la transacción de aprobación (vía `ApprovalHandlerRegistry`), evitando aprobaciones que no surten efecto.
- Auditoría de negocio transaccional con valor anterior/posterior.
- Aislamiento por tenant verificado en lectura, mutación y decisión.

## 11. Lo que no se pudo verificar
- Flujo E2E real: factura de proveedor sobre umbral → solicitud → aprobar/rechazar → posteo (requiere crear VENDOR_BILL; presupuesto). Baja confianza del camino de posteo real.
- Concurrencia real de dos aprobadores (PLTB-WF-02 confirmado por código, no ejecutado).
- UI de bandeja de aprobaciones con Playwright.
