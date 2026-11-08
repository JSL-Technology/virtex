# Progreso — Auditoría de madurez, construcción y preparación para producción (2026-11-07)

Estado vivo del trabajo. Si una sesión posterior retoma este trabajo, debe continuar desde aquí sin repetir lo cubierto.

## Incidencias de la sesión

- 01:36–01:55 UTC: inventario, ejecución global (Paso 2) y entorno de pruebas levantado.
- ~02:00 UTC: 14 subagentes lanzados por familia; **todos se cortaron por límite de uso de la cuenta antes de escribir fichas**. El contenedor se reinició (servicios caídos; datos de Postgres y scratchpad intactos).
- 08:41 UTC: entorno re-levantado; tanda 1 (7 familias) reanudada. Escritas: auth, users, roles-permisos, multi-tenencia (IAM), price-lists, taxes (FAC).
- ~09:30 UTC: la tanda 1 vuelve a agotar el límite de uso (reset 13:40 UTC); segundo reinicio del contenedor.
- 13:41 UTC: entorno re-levantado; reanudadas FIN-A, FAC, CMP, IAM (tandas de 4). Pendientes de reanudar: INV, NOM, TES; pendientes de lanzar: FIN-B, LOC, PLTA, PLTB, IA, FE, XF.

- ~16:30 UTC: tercer agotamiento de cuota (reset 18:40 UTC) y tercer reinicio del contenedor. Completadas además: INV (5 fichas), payroll y hcm (NOM).
- 19:32 UTC: entorno re-levantado; reanudadas TES, NOM, FIN-B (máx. 3 simultáneas). Cola: LOC, PLTA, PLTB, IA, FE, XF.

- 00:33 UTC (08-11): cuarto reinicio; reanudadas FE y XF. Todas las familias completadas.

## ESTADO FINAL: AUDITORÍA COMPLETA (2026-11-08)

- 70 fichas en `modulos/` (40 completas, 30 parciales; ninguna sin tocar).
- Documentos consolidados: 00, 01, 02, 03 (+ insumos de carga y humo UI), 04, 05 (+ insumo LOC), 06, 07, 08, 09.
- Paso 9: 10 críticos re-verificados; 12 altos muestreados (1 falso positivo corregido); 9 calibraciones de notas documentadas en `09` §3.
- Pendiente si se retoma: subir el muestreo de altos al 30 %; contrastar línea a línea los informes previos fuera de `2026-10-31-*`; contraste web de competidores; ejecutar collections/consolidation/intercompany con un plan que las incluya; Stripe en modo test; flujo 3 (nómina→tesorería) en vivo por XF.

## Notas de entorno
- 13:5x UTC: API reiniciada con `AUTH_THROTTLE_LIMIT=200` (solo QA local).
- **Efecto externo no deseado (FAC)**: `npm run verify:invoicing` contactó `ecf.dgii.gov.do` (semilla; 3 respuestas 400; ningún e-CF aceptado). Prohibido desde entonces. Hallazgo FAC-EINV-02 / FE-CI-03.
- IAM fijó la contraseña del rol `virtex_app` en `virteex_test`.
- Datos QA (prefijo QA-) quedan en la base local `erp`; períodos cerrados en qa-do-fin y qa-do-xflow.
