# Proyectos (M30) — projects

## 1. Identificación
Backend `projects/` (12 archivos, 578 LOC, 1 spec `projects-lifecycle.spec.ts` 59 LOC): 13 endpoints (proyectos CRUD+lista paginada; tareas lista/crear/editar/borrar; timesheets lista/crear/editar/borrar), permisos `PROJECTS_VIEW`/`PROJECTS_MANAGE`. Tablas `projects`, `project_tasks`, `timesheets`. Frontend: sólo `features/projects/pages/dashboard.component.ts` (panel "próximamente", 28 LOC) **no enrutado** (grep `ProjectsDashboard|features/projects` en manifests: sin resultados). Países N/A. Núcleo: no para ERP general; sí para servicios profesionales.

## 2. Estándar de referencia
Odoo Project/Timesheets, NetSuite SRP: tareas con jerarquía y dependencias, hojas de horas con aprobación, tarifa costo/venta por recurso, costeo real vs presupuesto (horas, compras, gastos imputados), facturación por hitos/T&M, rentabilidad, Gantt. Invariantes: horas aprobadas inmutables, imputación de costo a contabilidad analítica, referencias dentro del tenant. Confianza media.

## 3. Resultado
Madurez **22** (15–30, alta) · Preparación **15 — No listo** · Eje débil: Autenticidad (sin UI, sin costeo/facturación) · Críticos 0 · Altos 2.

## 4. Ejes
| Eje | Nota | Evidencia | Falta |
|---|---|---|---|
| 1 | 20 (15–28, alta) | CRUD real; timesheets sin aprobación, sin tarifas, sin costeo ni facturación (grep `rate|cost|billable|invoice` en `projects/`: sin resultados). Sin UI. | Todo lo anterior + UI. |
| 2 | 35 | Borrado protegido por dependientes (`projects.service.ts:233`). **Timesheet acepta `taskId` de otro tenant** (probado) y de otro proyecto; 30 h en un día aceptadas; cualquier `PROJECTS_MANAGE` edita horas de otros. | Validar task∈proyecto∈tenant, ≤24 h/día/usuario, aprobación. |
| 3 | N/A | — | — |
| 4 | 50 | Servicio delgado correcto. | — |
| 5 | 55 | Sin imports ajenos salvo base. | `customerId` sin contrato con clientes. |
| 6 | 60 | DTOs con validación. | — |
| 7 | 45 | Listas de tareas/timesheets **sin paginación** (`projects.service.ts:240,283`). | Paginar. |
| 8 | 45 (40–55, alta) | IDOR probado: qa-co → GET/PATCH proyecto de qa-b = 404; DELETE tarea de qa-b = 404. Pero referencia cruzada aceptada (PRJ-01). `customerId`, `assignedToUserId` sin validar tenant. | Validar todas las FK contra el tenant. |
| 9 | 25 | 1 spec de 59 LOC. | — |
| 10 | 30 | Sin auditoría. | — |
| 11 | N/A→**10** | Sin interfaz enrutada (el panel existe pero no tiene ruta). | UI completa. |
| 12 | 15 | — | — |

## 5. Compuertas
**1 No cumple** (sin capacidades básicas: costeo, facturación, aprobación; sin UI) · **2 No cumple** (FK cruzadas sin validar) · 3 Cumple parcial (lectura/escritura aislada; referencias no) · 4 Parcial · 5 N/A sin UI · 6 N/A · 7 No cumple · 8 No cumple · 9 Cumple · 10 Parcial · 11 No cumple · 12 No cumple.

## 6. Hallazgos
- **PRJ-01** · projects · Eje 2/8 · Integridad/aislamiento · **Alta** · `projects.service.ts:300-307` (`createTimesheet` valida `projectId` pero no `taskId`); también `createProject` (`customerId`), `createTask` (`assignedToUserId`) · Probado: `POST /projects/timesheets` en qa-co con `taskId` de una tarea de qa-b → **201** (`taskId 552cd769…` guardado en org `b3486e66…`). Crea vínculos entre tenants y un oráculo de existencia de UUIDs; cualquier consulta futura con join a `task` expondría datos ajenos. · Validar `taskId` con `{id, organizationId, projectId}`. · Riesgo de seguridad · S.
- **PRJ-02** · projects · Eje 1 · Funcionalidad · **Alta** · módulo completo · Sin costeo, tarifas, facturación por proyecto, aprobación de horas ni UI: no utilizable por un cliente. · Decidir: ocultar del catálogo comercial o construir (L/XL).
- **PRJ-03** · projects · Eje 2 · **Media** · `dto/create-timesheet.dto.ts` · `hours` sin máximo diario (30 h aceptadas); 1000 → 400 sólo por la precisión de la columna. · S.
- **PRJ-04** · projects · Eje 7 · **Media** · `projects.service.ts:240,283` · Listas sin paginación. · S.

## 7. Camino mínimo
PRJ-01 (S) → ocultar del producto hasta completar (S) → si se vende: timesheets con aprobación y tarifa + costo a analítica + facturación T&M + UI (XL).
## 8. Camino a 100
Rehacer funcionalmente sobre el esqueleto: UI (+20, L), costeo (+15, L), facturación (+15, L), aprobación de horas (+8, M), Gantt/dependencias (+8, L).
## 9. Competitividad
Muy por debajo de Odoo Project / NetSuite SRP. Nota 15 (alta).
## 10. Fortalezas
Aislamiento de lectura/escritura directa; borrado protegido por dependientes; autor de timesheet tomado del token, no del body.
## 11. No verificado
Spec no ejecutada. Cobertura ~95 % backend, 6 endpoints ejecutados. Datos creados: `QA-F10-ProjB` (qa-b), `QA-F10-ProjCO` y 2 timesheets (qa-co).

<!-- RESUMEN: modulo=proyectos; madurez=22; prep=15; veredicto=No listo; eje_debil=Autenticidad; criticos=1; altos=1; camino_min=XL -->


## Ajuste de calibración del coordinador (Paso 9)

**PRJ-01 se eleva a crítica** (referencias a recursos de otro tenant aceptadas: `taskId`, `customerId`, `assignedToUserId`), patrón sistémico MT-03. Notas sin cambio.
