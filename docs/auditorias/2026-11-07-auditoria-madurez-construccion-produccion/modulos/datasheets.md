# Ficha de módulo: `datasheets` (libros/hojas de cálculo con permisos y versiones)

Familia: PLTB · Auditor: PLTB · Fecha: 2026-11-07 · QA_SESSION=pltb · tenant qa-do-plt

## 1. Identificación
- Backend: `apps/backend/api/src/app/datasheets/` (1.660 líneas).
  - `services/datasheet-variables.service.ts` (590, resolución de variables ERP), `services/datasheets.service.ts` (244, libros/permisos/versiones), `services/datasheet-import.service.ts` (243), `controllers/datasheets.controller.ts` (121), `services/variable-registry.ts` (110, allow-list de variables), entidades `datasheet-book`, `datasheet-sheet`, `datasheet-version`, `datasheet-permission` (roles owner/editor/commenter/reader + isPublic).
  - Endpoints (`/datasheets`): `GET import/modules`, `POST import/data`, `GET variables`, `POST resolve-variables`, `POST /`, `GET /`, `GET :id`, `PATCH :id`, `DELETE :id`, `POST :id/versions`, `GET :id/versions`.
  - Tablas: `datasheet_books`, `datasheet_sheets`, `datasheet_versions`, `datasheet_permissions`.
- Frontend: `features/datasheets` (no auditado por Playwright, presupuesto).
- Países: N/A. ¿Núcleo para vender? Diferenciador (hojas con datos ERP en vivo).

## 2. Estándar de referencia
Hojas tipo Google Sheets embebidas: fórmulas que referencian datos del ERP en vivo mediante una **allow-list** de variables (no ejecución de código arbitrario), permisos por libro/hoja (owner/editor/lector), versionado, y aislamiento por tenant con autorización por variable (un vendedor no debe leer EBITDA por una fórmula).

## 3. Resultado
- **Madurez (calibrada por el coordinador): **68 (62–74, confianza media-alta)**; el agente propuso 78–85.**
  - _Motivo de la calibración (Paso 9):_ Endpoints que aceptan `Partial<entidad>` sin DTO y devuelven 500 ante enum inválido o id malformado (PLTB-DS-01/02) incumplen la compuerta 4 (validación en servidor) y el eje 4; 0 specs en backend y frontend (inventario INVT-04). No sostiene la banda 76–89.
  - Preparación 66 · **Piloto controlado**.
- ~~Madurez original: 78–85 (confianza alta).** Módulo bien construido y, de nuevo, con comentarios que documentan vulnerabilidades pasadas ya corregidas (IDOR cross-tenant, check de acceso vacío, mass-assignment en update, permiso de variable no aplicado, variables "mock" que devolvían 0 o un millón). El estado actual es sólido y verificado en vivo.
- **Preparación comercial: Listo con reservas.** Críticas (authZ, aislamiento, mass-assignment) CUMPLEN y PROBADAS. Reservas: validación de entrada débil en create/update (DTO = entidad, sin class-validator) que produce **500** con datos inválidos, y `:id` sin pipe de UUID (500 con id malformado).
- **Eje más débil:** Validación de servidor / Robustez de errores.
- **Hallazgos críticos abiertos:** ninguno. **No hay inyección ni ejecución de código** por fórmulas (ver abajo).

## 4. Ejes (nota / evidencia / qué falta para 100)
1. Funcionalidad real (85, alta): `resolve-variables` devuelve datos REALES del tenant (probado: `COMPANY_NAME="QA-DO-A SRL"`, `TODAY_DATE="2026-11-07"`, `EBITDA=0` calculado). Sin mocks (las variables "mock" históricas fueron eliminadas, documentado en `variable-registry.ts`).
2. Integridad (80, alta): versionado (`datasheet_versions` con snapshot del estado); update scopea sheets al libro (`{id, bookId}`).
3. **AuthZ/aislamiento (88, alta) — PROBADO**: `findOne`/`findAll` scoped a `organizationId` en el LOOKUP; permiso por variable aplicado por `DatasheetVariablesService.assertPermission` (usa `hasPermission` con wildcards). Permisos por libro vía `datasheet_permissions` (owner/editor/commenter/reader, público intra-tenant).
4. **Validación servidor (58, alta) — DÉBIL**: `create`/`update` reciben `Partial<DatasheetBook>` (la ENTIDAD) sin DTO class-validator → enum inválido llega a BD → **500** (PLTB-DS-02). `:id` sin `UuidParamPipe` → id malformado → **500** `invalid input syntax for type uuid` (PLTB-DS-01).
5. Multi-país: N/A (variables fiscales dependen del país del tenant, p.ej. `TAX_RATE`).
6. Calidad (80, media): código claro y comentado; ver warnings globales de api.
7. Robustez (65, media): errores de BD afloran como 500 sin sanear (PLTB-DS-01/02). Cache de variables por tenant (`var:${orgId}:...`).
8. **Seguridad (86, alta) — PROBADA**: sin inyección (queries parametrizadas `:org`, `where:{sku,organizationId}`); sin ejecución de código (variables = enum fijo, sin `eval`/`Function`); mass-assignment bloqueado (update borra `organizationId`/`ownerId`, probado). Falta: rate limit de `resolve-variables` (puede ser costoso).
9. Pruebas (70, media): hay specs del módulo; no verifiqué cobertura de concurrencia de versiones.
10. Operabilidad (72, media): cache; falta auditoría de negocio de cambios de libro/permiso.
11. UX (no verificado): editor de hojas no auditado con Playwright.
12. Competitividad (76): hojas con datos ERP en vivo y allow-list segura es un buen diferenciador; falta colaboración en tiempo real, fórmulas avanzadas, gráficos.

## 5. Compuertas de producción
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | CUMPLE | variables reales (mocks eliminados) |
| 2 | Integridad | CUMPLE | versionado + scoping de sheets |
| 3 | AuthZ/aislamiento | CUMPLE | B→404 en A; perm por variable; mass-assignment bloqueado (probado) |
| 4 | Validación servidor | **NO CUMPLE** | DTO=entidad sin validación → 500 (PLTB-DS-02); `:id` sin UUID pipe (PLTB-DS-01) |
| 5 | Humo sin 500 | **NO CUMPLE** | create con enum inválido y GET con id malformado → 500 |
| 6 | País | N/A | |
| 7 | Pruebas CI | CUMPLE PARCIAL | |
| 8 | Auditoría negocio | VERIFICAR CON EQUIPO | no confirmada para cambios de permiso |
| 9 | Migraciones | CUMPLE | global |
| 10 | Observabilidad | CUMPLE PARCIAL | |
| 11 | UI sin bloqueos | NO VERIFICADO | |
| 12 | Documentación | CUMPLE PARCIAL | |

## 6. Hallazgos

**PLTB-DS-01** · datasheets · eje 4/7 · Categoría: validación/robustez · Severidad: **media**
- Ubicación: `controllers/datasheets.controller.ts` — `@Param('id') id: string` sin `UuidParamPipe` en `GET/PATCH/DELETE :id`, `:id/versions`.
- Qué está mal: un id no-UUID llega a `findOne({where:{id}})` y Postgres lanza `invalid input syntax for type uuid` → **500 INTERNAL_ERROR**. Ejecutado 2026-11-07: `GET /datasheets/not-a-uuid` → 500 (`QueryFailedError` en el log del API). Compárese con `workflows` y `workflow-engine`, que sí usan `UuidParamPipe`.
- Forma correcta: aplicar `UuidParamPipe` (ya existe en el repo) → 400/404 en vez de 500, y no aflorar el error de BD.
- Esfuerzo: S.

**PLTB-DS-02** · datasheets · eje 4/5 · Categoría: validación/arquitectura (DTO vs entidad) · Severidad: **media**
- Ubicación: `controllers/datasheets.controller.ts` `create`/`update` con `@Body() data: Partial<DatasheetBook>` (la ENTIDAD, sin DTO class-validator).
- Qué está mal: no hay validación de entrada. Un `mode` fuera del enum (`"GRID"`) llega al INSERT → **500**. Ejecutado: `POST /datasheets {mode:"GRID"}` → 500; con `mode:"live"` → 201. Además expone la entidad como contrato de API (anti-patrón de la rúbrica). La protección de mass-assignment existe pero es manual (`delete data.organizationId/ownerId` en update) — frágil ante nuevos campos sensibles.
- Forma correcta: `CreateDatasheetBookDto`/`UpdateDatasheetBookDto` con class-validator y whitelisting; no exponer la entidad.
- Impacto: errores 500 en flujo principal (compuerta 5), contrato de API frágil.
- Esfuerzo: M.

## Pruebas ejecutadas (2026-11-07)
- `POST /datasheets {name:QA-PLTB-book,mode:"live"}` (qa-do-a) → **201** (id `483a7aa5…`).
- Aislamiento: `GET /datasheets/483a7aa5…` (qa-do-b) → **404** `datasheet_with_id_not_found`; `PATCH` (qa-do-b) → **404**.
- Mass-assignment: `PATCH` (qa-do-a) con `organizationId:<org B>` y `ownerId:0000…` → **200**, pero el libro conserva `ownerId` real de A y sigue en la org de A (campos sensibles ignorados).
- AuthZ: `GET /datasheets` (qa-do-a-member, sin DATASHEETS_VIEW) → **403** `you_do_not_have_permission_perform`.
- Variables: `POST /datasheets/resolve-variables [EBITDA, COMPANY_NAME, TODAY_DATE]` (qa-do-a) → **201** con datos reales; sin `eval`/`Function`; queries parametrizadas.
- Robustez: `GET /datasheets/not-a-uuid` y `POST {mode:"GRID"}` → **500** (PLTB-DS-01/02).
- Cleanup: libro eliminado (200).

## 7. Camino mínimo a producción
1. (S) `UuidParamPipe` en todas las rutas `:id` (PLTB-DS-01).
2. (M) DTOs validados para create/update; dejar de exponer la entidad (PLTB-DS-02).
3. (S) Rate limit en `resolve-variables`.

## 8. Camino a 100
- +8 validación/robustez (DS-01+DS-02) S/M; +4 auditoría de negocio M; +3 colaboración/fórmulas avanzadas L; +2 UI verificada M.

## 9. Competitividad
- Básicas cubiertas (hojas, permisos por libro, versiones, variables ERP en vivo seguras). Avanzadas faltantes: colaboración en tiempo real, catálogo de fórmulas, gráficos, import/export rico. Fuente: código + pruebas (confianza alta).

## 10. Fortalezas a preservar
- Variables como **allow-list** enumerada con permiso por variable (no ejecución de código) — diseño seguro correcto.
- Aislamiento en el LOOKUP (no check posterior); «no encontrado» en vez de «prohibido» para no revelar existencia.
- Mass-assignment bloqueado; sheets scopeados al libro.
- Eliminación de variables "mock" (0 / meta de un millón) documentada: honestidad de datos.

## 11. Lo que no se pudo verificar
- UI del editor con Playwright (presupuesto).
- Denegación por variable con un usuario que tenga DATASHEETS_VIEW pero no ACCOUNTING_VIEW (no existe tal usuario QA; verificado por código `assertPermission`).
- Concurrencia de versiones y rendimiento de `resolve-variables` bajo carga.
