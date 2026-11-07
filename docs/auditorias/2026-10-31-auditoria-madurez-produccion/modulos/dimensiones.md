# Ficha M03 — Dimensiones (`dimensions`)

Auditor: F4. 2026-11-01. Tenant qa-mx.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/dimensions` (10 .ts, 1 spec, ~755 LOC, 9 endpoints: CRUD de dimensiones con valores jerárquicos (`parent`), reglas de obligatoriedad por cuenta). Las etiquetas se guardan como JSON `{nombreDimensión: valor}` en `journal_entry_lines.dimensions` y en presupuestos; se normalizan con `normaliseDimensionTags`.
- **Frontend**: `features/accounting/dimensions` (3 .ts).
- **Países**: N/A.

## 2. Estándar de referencia
Centros de costo/proyectos/sucursales con valores activos/inactivos y jerarquía, reglas por cuenta (obligatoria/prohibida/valor por defecto), validación en todos los asientos (también los de subledgers), reportes y presupuestos por dimensión. Líderes (confianza media): BC "Default dimensions" (Code Mandatory / Same Code / No Code); D365 "financial dimensions" con estructuras de cuenta; NetSuite clase/departamento/ubicación.

## 3. Resultado
- **Madurez: 55** (45–62, confianza media). **Preparación: 55 — Piloto controlado**.
- **Eje más débil**: 9 Pruebas. **Críticos**: 0. **Altos**: 1.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | Autenticidad | 62 (55–70, media) | Creé la dimensión "QA F4 Centro" (VENTAS/ADMIN) y la regla obligatoria en 5700. Asiento sin etiqueta → 400 `requires_mandatory_dimension`; valor inexistente → 400 `unknown_dimension`; valor válido → 201; resultados con `dimension=QA F4 Centro=VENTAS` → solo esa línea (−50) | Reglas "prohibida/valor por defecto" |
| 2 | Corrección | 58 (50–65, media) | Etiquetas por NOMBRE: el renombrado está bloqueado si la dimensión está en uso (`assertDimensionUnused`), lo que evita la incoherencia pero limita | Referenciar por id |
| 3 | País | N/A | — | — |
| 4 | Arquitectura | 58 (50–65, media) | `validateDimensionRules` en `JournalEntriesService.prepare`: se valida en TODOS los asientos (también subledgers), salvo reversiones | — |
| 5 | Higiene | 55 | journal-entries importa entidades de dimensions | — |
| 6 | Calidad | 60 | — | — |
| 7 | Robustez | 55 (45–62, baja) | `DimensionRule` se consulta por `accountId IN (…)` sin filtro de organización (las cuentas son por tenant, aceptable) | — |
| 8 | Seguridad | 65 (55–72, media) | `createRule` comprueba que cuenta y dimensión son del tenant; `deleteRule` compara `account.organizationId` (código). IDOR no ejecutado | Ejecutar IDOR |
| 9 | Pruebas | 40 (30–50, media) | 1 spec | Integración |
| 10 | Operabilidad | 55 | — | — |
| 11 | UX | N/V 50 | Patrón de nombre restrictivo: "QA-F4 CC" rechazado (`dimension_name`) | — |
| 12 | Competitividad | 50 (40–58, media) | Equivale a lo básico de BC; sin estructuras de cuenta ni reglas avanzadas | — |

## 5. Compuertas
1 Cumple · 2 Cumple (validación en el servicio de asientos) · 3 Cumple por código / no ejecutado · 4 Cumple · 5 Cumple en lo probado · 6 N/A · 7 Parcial · 8 No verificado.

## 6. Hallazgos
**DIM-01** · Diseño · **Alta** · Las etiquetas se guardan por nombre de dimensión en JSON (`journal_entry_lines.dimensions`), y el trigger de inmutabilidad de líneas protege ese JSON. Una dimensión usada no se puede renombrar nunca, y los reportes filtran por texto. Forma correcta: id de dimensión/valor. Esfuerzo M.

**DIM-02** · Funcionalidad · **Media** · Solo existe la regla "obligatoria" (`isRequired: true` fijo en `createRule`); no hay "prohibida", "valor fijo" ni "por defecto". Esfuerzo S/M.

**DIM-03** · UX · **Baja** · El patrón de nombre rechaza guiones (`DIMENSION_NAME_PATTERN`).

## 7–8. Camino mínimo / a 100
Tests de integración (S) → DIM-02 (S/M) → DIM-01 (M) → estructuras de cuenta y combinaciones válidas (+10, L).

## 9. Competitividad
Superior a Alegra/Siigo (que usan centros de costo simples); inferior a D365.

## 10. Fortalezas
Validación centralizada en el servicio de asientos (aplica a subledgers); filtros por dimensión en estados y presupuestos.

## 11. No verificado
UI, jerarquía de valores, IDOR por API, presupuesto por dimensión. Cobertura ~45 %.

<!-- RESUMEN: modulo=dimensiones; madurez=55; prep=55; veredicto=Piloto controlado; eje_debil=9 Pruebas; criticos=0; altos=1; camino_min=S -->
