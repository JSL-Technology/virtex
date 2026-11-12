# Ficha — `projects` (proyectos, tareas, partes de horas) · Familia NOM

> Auditoría diagnóstica 2026-11-07. Evidencia con `qa-do-a` (crea) y `qa-do-b` (ataca), `qa-do-a-member` (403). Sin hallazgos CRÍTICOS de seguridad; el módulo es un **esqueleto CRUD sin interfaz**.

## 1. Identificación

| Campo | Valor |
|---|---|
| Backend | `apps/backend/api/src/app/projects` (13 archivos, 679 líneas): `projects.controller.ts` (151), `projects.service.ts` (217), entidades `project`, `project-task`, `timesheet` |
| Endpoints | 15: proyectos CRUD (lista paginada), tareas CRUD (`tasks/list` sin paginar), partes de horas CRUD (`timesheets/list` sin paginar) |
| Tablas | `projects` (sin FK en `customer_id`, sin índice por `organization_id`), `project_tasks`, `timesheets` (triggers de mismo tenant sí) |
| Frontend | `features/projects/pages/dashboard.component.ts` (28 líneas) + scss: panel «Próximamente» (`roadmap.projects.title`, `roadmap.coming_soon`). **No está enrutado**: grep `dashboard.component|ProjectsDashboard` en `client-web/src/app` sin referencias fuera del propio archivo; `/e/qa-do-nom-srl/projects` → «Página no encontrada» (Playwright) |
| Pruebas | `projects/projects-lifecycle.spec.ts` (59 líneas, BD real) pasa |
| ¿Núcleo? | No para la venta base; sí para servicios profesionales |

## 2. Estándar de referencia

(a) Básicas: proyecto con cliente, presupuesto, fechas, estado; tareas con responsables y fases; partes de horas por usuario con aprobación; costeo (horas × tarifa) y facturación por horas/hitos al cliente; avance y rentabilidad. Avanzadas: Gantt/dependencias, recursos y capacidad, gastos imputados, presupuesto vs real, integración contable (WIP, reconocimiento de ingresos). (b) Invariantes: fin ≥ inicio; horas por día ≤ 24 por persona; horas aprobadas inmutables; parte de horas solo del propio usuario salvo rol; cliente/tarea/proyecto del mismo tenant. (c) Líderes: Odoo Project + Timesheets + facturación por horas (alta), NetSuite SuiteProjects, Dynamics 365 Project Operations (alta, documentación pública), Zoho Projects. (d) Construcción: agregados proyecto/tarea, parte de horas con estado y aprobación, puente a ventas (factura) y contabilidad (costo).

## 3. Resultado

| | |
|---|---|
| **Madurez** | **18 (12–25, confianza alta)** |
| **Preparación comercial** | **10** |
| **Veredicto** | **No listo** (esqueleto/prototipo: solo API CRUD) |
| Eje más débil | 1 y 11 (sin interfaz) |
| Críticos abiertos | 0 |

## 4. Tabla de 12 ejes

| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad (crítico) | 15 (10–22, alta) | CRUD persiste de verdad; sin UI, sin aprobación de horas, sin costeo/facturación (grep `invoice|billing|rate|cost` en `projects/`: solo `budget` en la entidad) | UI, aprobación, costeo, facturación |
| 2 Corrección (crítico) | 30 (22–38, alta) | Proyecto con `endDate` 2026-01-01 < `startDate` 2026-12-01 → 201; parte de horas de 999,5 h en un día → 201 (`create-timesheet.dto.ts:24-26` solo `@Min(0)`); `budget` devuelto como string `"100000.00"` | Validaciones de dominio, decimales tipados |
| 3 Multi-país | N/A | Sin reglas por país | — |
| 4 Arquitectura | 40 (32–48, media) | Servicio CRUD plano; `projects.customer_id` sin FK (constraints SQL); comprobación de cliente por SQL crudo a tabla ajena (`projects.service.ts` `assertCustomer`) | FK + guarda de tenant, puerto a clientes |
| 5 Higiene | 55 (48–62, media) | Sin violaciones de frontera reportadas para `projects/`; frontend con componente muerto | Borrar o enrutar el componente |
| 6 Calidad | 65 (58–72, media) | 1 warning de lint | — |
| 7 Robustez | 35 (28–42, media) | `tasks/list` y `timesheets/list` sin paginación; sin índice `organization_id` en `projects`/`timesheets` (pg_indexes: solo PK) | Paginación e índices |
| 8 Seguridad (crítico) | 62 (55–68, alta) | qa-do-b → GET/PATCH proyecto de A: 404; parte de horas en proyecto de A: 404; lista de horas de A: `[]`; cliente de otro tenant al crear proyecto: 404 `projects.customer_not_found`; member → 403. Débil: cualquiera con `projects:manage` edita/borra partes de horas de otros usuarios (`updateTimesheet` no compara `userId`) | Propiedad del parte de horas, auditoría |
| 9 Pruebas | 35 (28–42, media) | 1 spec de ciclo de vida | Pruebas de validaciones/aislamiento |
| 10 Operabilidad | 30 (22–38, media) | Sin auditoría de negocio en proyectos/horas (no aparecen en `audit_logs`) | Auditoría |
| 11 UX | 5 (3–10, alta) | Ruta inexistente; componente «Próximamente» no enrutado | Interfaz completa |
| 12 Competitividad | 8 (5–12, alta) | Frente a Odoo/D365 Project Operations falta casi todo | §9 |

## 5. Compuertas

1 No cumple (sin UI, sin básicas) · 2 No cumple (validaciones) · 3 Cumple con reservas (propiedad de partes de horas) · 4 No cumple · 5 N/A sin UI · 6 N/A · 7 No cumple · 8 No cumple · 9 Cumple · 10 No cumple · 11 No cumple · 12 No cumple.

## 6. Hallazgos

**NOM-30 — Módulo sin interfaz; el componente «Próximamente» es código muerto** · eje 1/11 · funcionalidad ausente · **Alta** · `features/projects/pages/dashboard.component.ts`; Playwright `/e/qa-do-nom-srl/projects` → 404 de la app. Impacto: bloquea la venta del módulo. Esfuerzo: L.

**NOM-31 — Validaciones de dominio ausentes (fechas invertidas, 999,5 h/día, partes de horas ajenos editables)** · eje 2/8 · **Media** · `dto/create-project.dto.ts`, `dto/create-timesheet.dto.ts:24-26`, `projects.service.ts` `updateTimesheet`. Esfuerzo: S.

**NOM-32 — Sin costeo, aprobación ni facturación de horas; sin vínculo contable** · eje 1/12 · **Alta** · grep en `projects/`. Esfuerzo: XL — rehacer como dominio (no basta retocar CRUD).

**NOM-33 — Sin FK en `projects.customer_id`, sin índices por tenant, listados sin paginación** · eje 4/7 · Media · Esfuerzo: S.

## 7. Camino mínimo a producción

Rediseñar el dominio (partes de horas con estado/aprobación, tarifas, facturación a ventas, costo a contabilidad) — XL, rehacer; UI completa — L; validaciones/índices — S. Para todos los países por igual.

## 8. Camino a 100

UI + aprobación de horas (+25, L); costeo y facturación por horas/hitos (+25, XL); presupuesto vs real, rentabilidad (+15, M); Gantt/dependencias/recursos (+15, L); validaciones, índices, pruebas, auditoría (+10, S-M).

## 9. Competitividad

Básicas faltantes: todas las de servicios profesionales (Odoo Timesheets → facturación; D365 Project Operations) — confianza alta. Sin diferenciadores.

## 10. Fortalezas

Aislamiento por tenant correcto y comprobación de referencias (cliente, tarea↔proyecto, responsable miembro del tenant).

## 11. No verificado

Tareas (el DTO rechazó `title`; no se creó tarea con el nombre de campo correcto); rendimiento.
