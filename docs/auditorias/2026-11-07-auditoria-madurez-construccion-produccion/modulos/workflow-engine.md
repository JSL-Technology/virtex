# Ficha de módulo: `workflow-engine` (motor de flujos BPMN-like)

Familia: PLTB · Auditor: PLTB · Fecha: 2026-11-07 · QA_SESSION=pltb · tenant qa-do-plt
Ver también `workflows.md` (segundo motor de aprobaciones) — hallazgo de arquitectura PLTB-WF-01.

## 1. Identificación
- Backend: `apps/backend/api/src/app/workflow-engine/` (6.159 líneas TS).
  - `workflow-engine.service.ts` (781), `validation/workflow-graph.validator.ts` (703), `workflow-definitions.service.ts` (528), `workflow-engine.controller.ts` (326), `events/workflow-event.catalogue.ts` (297), `dto/workflow.dto.ts` (274), `contracts/workflow-graph.ts` (251), `actions/builtin-actions.ts` (223), `workflow-instances.service.ts` (210), `workflow-directory.service.ts` (208), `security/safe-webhook.ts` (150).
  - Endpoints (prefijo `/workflow-engine`): definitions (catalogue, list, get, create, validate, patch, publish, unpublish, versions, duplicate, delete), `GET actions`, `GET events`, `GET assignees`, `GET people`, instances (list, get, start, cancel, retry), `POST events` (solo `custom.*`), tasks (inbox, get, complete).
- Frontend: `apps/core/client-web/src/app/features/workflow` — **8.251 líneas, 0 specs** (medido 2026-11-07).
- Pruebas backend: `workflow-engine.integration.spec.ts` (255), `workflow-graph.validator.spec.ts` (279), `workflow-runtime-helpers.spec.ts` (144).
- Países: N/A (transversal). Dependencias: EventEmitter interno, catálogo de eventos de negocio.
- ¿Núcleo para vender? Diferenciador fuerte (automatización no-code tipo Zapier/n8n embebido).

## 2. Estándar de referencia
Motor de orquestación tipo n8n / Camunda embebido: definiciones versionadas con publicación, validación de grafo (ciclos, nodos huérfanos, ramas), instancias con estado, tareas humanas con bandeja y SoD, disparo por eventos de negocio tipados, acciones integradas (webhook con SSRF-guard, crear documento, notificar), aislamiento por tenant y permisos por operación.

## 3. Resultado
- **Madurez (calibrada por el coordinador): **62 (55–68, confianza media)**; el agente propuso 70–80.**
  - _Motivo de la calibración (Paso 9):_ Dos motores de flujo con aprobaciones solapadas (PLTB-WF-01, duplicación de autorización), frontend de 8,2 k líneas sin una sola prueba (PLTB-WF-03) y el E2E evento→aprobación→posteo no se ejecutó. La arquitectura duplicada es un defecto de raíz que retocar no resuelve.
  - Preparación 60 · **Piloto controlado**.
- ~~Madurez original: 70–80 (confianza media-alta).** Motor amplio, bien estructurado por capas, con validador de grafo robusto (703 líneas) y catálogo de eventos rico. Seguridad de endpoints correcta (probada en vivo).
- **Preparación comercial: Listo con reservas.** Críticas (authN/Z, aislamiento) cumplen; reservas: duplicación arquitectónica con `workflows` (PLTB-WF-01), frontend sin pruebas (8.251 líneas / 0 specs), y concurrencia de tareas no verificada en vivo.
- **Eje más débil:** Arquitectura (duplicación de motor de flujo) y Pruebas (frontend sin cobertura).
- **Hallazgos críticos abiertos:** ninguno confirmado; PLTB-WF-01 (arquitectura) es alto.

## 4. Ejes (nota / evidencia / qué falta para 100)
1. Funcionalidad real (78, media): catálogo de eventos real servido (`GET /workflow-engine/events` → invoice.created, purchase-order.created, journal…), definiciones/instancias/tareas reales. Falta: demostrar en vivo un flujo publicado disparado por evento de negocio (requiere crear documento origen; no ejecutado por presupuesto).
2. Integridad (72, media): publicación versiona y archiva la anterior; instancias con retry/cancel. Falta: verificar idempotencia del disparo y concurrencia de `tasks/:id/complete`.
3. **AuthZ/aislamiento (85, alta) — PROBADO**: todos los endpoints tenant-scoped (`user.organizationId`), permisos `WORKFLOW_VIEW/DESIGN/RUN/TASK_ACT`. En vivo: `qa-do-a-member` → **403** en `/workflow-engine/definitions`. `getTask` exige involucramiento o `WORKFLOW_VIEW`.
4. Validación servidor (82, alta): DTOs + `workflow-graph.validator.ts` (703 líneas, con spec). `POST /events` rechaza eventos no `custom.*` → en vivo **400** `only_custom_events` (no se pueden forjar eventos de negocio por HTTP).
5. Multi-país: N/A.
6. Calidad (72, media): servicio de 781 líneas (grande pero cohesivo); ver warnings globales de api.
7. Robustez (68, media): webhook con guard SSRF (`security/safe-webhook.ts`); retry de instancias. Falta: límites de concurrencia, verificación de N+1 en inbox.
8. Seguridad (82, alta): ver eje 3; webhook saliente con guard. Falta: auditar `GET /people`/`assignees` (¿enumeración de usuarios de otro tenant?).
9. Pruebas (55, alta): backend con integración + validador; **frontend 0 specs sobre 8.251 líneas**.
10. Operabilidad (65, media): instancias con estado/retry. Falta: correlación de logs, auditoría de publish/unpublish verificada.
11. UX (no verificado): editor de flujos no auditado por Playwright (presupuesto).
12. Competitividad (74): motor no-code embebido es diferenciador frente a ERP locales; falta madurez de UI y marketplace de plantillas.

## 5. Compuertas de producción
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | CUMPLE | catálogo/definiciones reales |
| 2 | Integridad escrituras | VERIFICAR CON EQUIPO | versionado OK; concurrencia de complete no probada |
| 3 | AuthZ/aislamiento | CUMPLE | member 403; tenant-scoped (probado) |
| 4 | Validación servidor | CUMPLE | DTOs + validador de grafo + guard custom.* |
| 5 | Humo sin 500 | CUMPLE PARCIAL | GETs 200; flujo E2E no ejecutado |
| 6 | País | N/A | |
| 7 | Pruebas CI | CUMPLE PARCIAL | backend sí; frontend 0 specs |
| 8 | Auditoría negocio | VERIFICAR CON EQUIPO | no confirmada para publish |
| 9 | Migraciones | CUMPLE | global |
| 10 | Observabilidad | CUMPLE PARCIAL | |
| 11 | UI sin bloqueos | NO VERIFICADO | |
| 12 | Documentación | CUMPLE PARCIAL | |

## 6. Hallazgos

**PLTB-WF-01** · workflow-engine + workflows · eje 4/5 · Categoría: arquitectura · Severidad: **alta**
- Ubicación: `apps/backend/api/src/app/workflow-engine/` y `apps/backend/api/src/app/workflows/`; ambos registran un `ApprovalSource` (`workflow-engine/workflow-approval.source.ts` y `workflows/workflow-approval.source.ts`).
- Qué está mal: existen **dos motores de flujo** con responsabilidades solapadas. `workflow-engine` es un motor BPMN-like genérico que incluye tareas humanas y una fuente de aprobaciones; `workflows` es un motor de **políticas de aprobación** por tipo de documento/umbral. El concepto "aprobación" vive en ambos (dos `workflow-approval.source.ts`, acciones de documento en workflow-engine y handlers en workflows). Esto duplica el modelo mental, la autorización y el riesgo de divergencia (una corrección de SoD o de aislamiento debe hacerse en dos sitios).
- Forma correcta: converger. Las aprobaciones por política (umbral/rol/documento) deberían ser un caso del motor genérico, o el motor genérico debería delegar la decisión al motor de aprobaciones, no reimplementarla. Decisión de producto: cuál es el motor canónico.
- Impacto: deuda técnica que encarece evolución y multiplica superficie de seguridad. Retocar (unificar la fuente de aprobaciones) es viable; no requiere rehacer.
- Esfuerzo: L.

**PLTB-WF-03** · workflow-engine · eje 9 · Categoría: pruebas · Severidad: **alta**
- Ubicación: `apps/core/client-web/src/app/features/workflow` (8.251 líneas, 0 archivos `*.spec.ts`).
- Qué está mal: el editor de flujos (la cara comercial del motor) no tiene ninguna prueba unitaria/componente. Un cambio puede romper el editor sin señal en CI.
- Forma correcta: specs de los componentes críticos del editor (validación, guardado, publicación) y al menos un e2e.
- Esfuerzo: L.

**PLTB-WF-04** · workflow-engine · eje 8 · Categoría: seguridad · Severidad: **media (verificar)**
- Ubicación: `GET /workflow-engine/people` y `GET /workflow-engine/assignees`.
- Qué está mal: endpoints que listan personas/asignables; no verifiqué que el conjunto esté estrictamente limitado al tenant ni que no filtre datos sensibles (correo). Requiere confirmación.
- Esfuerzo: S (verificación) / M (corrección si aplica).

## Pruebas ejecutadas (2026-11-07)
- `GET /workflow-engine/definitions` (qa-do-plt) → 200 `[]`.
- `GET /workflow-engine/events` → 200, catálogo con eventos de negocio tipados (sales/customers/purchasing/…), `customPrefix: "custom."`.
- `GET /workflow-engine/definitions` (qa-do-a-member, solo invoices:view/products:view) → **403** `you_do_not_have_permission_perform`.
- `POST /workflow-engine/events {event:"invoice.created"}` → **400** `only_custom_events` (no se forjan eventos de negocio).

## 7. Camino mínimo a producción
1. (L) Converger los dos motores de aprobación (PLTB-WF-01) — decisión de producto + refactor.
2. (L) Cobertura de pruebas del editor frontend (PLTB-WF-03).
3. (S/M) Verificar `people`/`assignees` y concurrencia de `complete` (PLTB-WF-04).
4. (M) E2E real: publicar flujo disparado por evento de negocio y validar instancia/tarea.

## 8. Camino a 100
- +8 arquitectura (unificar motores) L; +6 pruebas FE L; +4 E2E evento→instancia M; +3 observabilidad/correlación S.

## 9. Competitividad
- Básicas cubiertas (definiciones versionadas, eventos, tareas, webhook). Avanzadas: plantillas, marketplace de flujos, simulación. Diferenciador claro frente a ERP locales (ninguno trae motor no-code). Fuente: código (confianza media-alta).

## 10. Fortalezas a preservar
- Validador de grafo robusto (703 líneas + spec).
- Guard SSRF en webhook saliente.
- Catálogo de eventos tipado y endpoint `/events` restringido a `custom.*`.
- Tenant-scoping consistente en todos los endpoints.

## 11. Lo que no se pudo verificar
- Flujo E2E publicado disparado por un evento de negocio real (requiere crear documento origen; presupuesto).
- Concurrencia de `tasks/:id/complete` y límites de inbox.
- UI del editor con Playwright.
- `people`/`assignees` como posible enumeración (PLTB-WF-04).
