# Ficha — dimensions (dimensiones analíticas, valores jerárquicos, reglas de obligatoriedad)

Familia FIN-A · Auditor: FIN · Fecha: 2026-11-07

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/dimensions` — 755 líneas, 1 spec. `dimensions.service.ts` (368), DTOs, entidades `Dimension`, `DimensionValue` (closure `dimension_values_closure`), `DimensionRule`.
- **Endpoints**: `/dimensions` POST, GET, GET rules, GET :id, PATCH :id, DELETE :id, GET rules/:accountId, POST rules, DELETE rules/:accountId/:dimensionId — todos con `@HasPermission(DIMENSIONS_VIEW|MANAGE)`.
- **Uso**: `journal_entry_lines.dimensions` (JSONB clave = nombre de dimensión), filtros `dimension=Nombre=VALOR` en estados financieros, vista materializada analítica.
- **Frontend**: `features/accounting/dimensions` (ruta `accounting/dimensions`), botón "Dimensions" en el formulario de asiento.
- **Países**: genérico. **Núcleo**: no para vender en pymes; sí para medianas (centros de costo).

## 2. Estándar de referencia
(a) Básicas: centros de costo/proyectos, valores jerárquicos con consolidación, obligatoriedad por cuenta, filtros en reportes. Avanzadas: reglas condicionales, combinaciones válidas, distribución.
(b) Invariantes: valor existente y activo; jerarquía sin ciclos; reportes por nodo padre incluyen hijos; asientos de sistema exentos o saldados por dimensión.
(c) Líderes (confianza media): D365 "financial dimensions" con reglas de estructura de cuentas; NetSuite departments/classes/locations jerárquicos con roll-up; Odoo analytic plans.
(d) Construcción: FK a valores (no nombre en texto), roll-up vía closure.

## 3. Resultado
- **Madurez: 52 (45–60, confianza media)**. Preparación: 50. **Veredicto: Piloto controlado**.
- Eje más débil: 2 (roll-up y cierre anual).
- Críticos: ninguno.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
|1|Autenticidad|62 (55–70, media)|Crear dimensión con jerarquía (ADM→ADM-1) 201; ciclo A↔B → 400 `value_cycle`; regla en cuenta de grupo → 400; regla en 5300 → asiento sin dimensión 400, valor inexistente 400, válido 201.|—|
|2|Corrección (crítico)|45 (38–52, alta)|Filtro `QA FIN CC=ADM` en estado de resultados devuelve 10 (excluye ADM-1 = 10): sin roll-up jerárquico. La regla bloquea el cierre anual (FIN-AC-01).|Roll-up; exención/saldado por dimensión en asientos de sistema.|
|3|Multi-país|50 (40–58, baja)|`DIMENSION_NAME_PATTERN=/^[a-zA-Z0-9_ ]+$/` (`dto/dimension.dto.ts:31`): "Región" → 400; producto en español no admite tildes/ñ.|Unicode en nombres.|
|4|Arquitectura|45 (38–52, media)|Líneas guardan `{"<nombre>":"<valor>"}` en JSONB sin FK; por eso renombrar en uso → 409 y eliminar en uso → 409.|IDs de valor en las líneas (tabla puente).|
|5|Higiene|70 (62–76, media)|0 violaciones de frontera en el directorio.|—|
|6|Calidad|70 (62–76, media)|0 warnings lint en el directorio.|—|
|7|Robustez|60 (52–66, baja)|Conteo de uso por consultas JSONB; sin índice GIN verificado.|Índice GIN en `dimensions`.|
|8|Seguridad|68 (58–76, media)|Regla con cuenta/dimensión ajena → 404 por código (`createRule` busca por organización). No ejecuté ataque desde otro tenant (429).|Prueba ejecutada.|
|9|Pruebas|40 (32–48, media)|1 spec.|Roll-up, reglas, cierre.|
|10|Operabilidad|55 (45–62, baja)|Sin auditoría visible de cambios de dimensiones.|Auditoría.|
|11|UX|55 (45–62, baja)|Pantalla carga sin errores (Playwright).|Mensajes por regex más claros.|
|12|Competitividad|45 (38–52, baja)|Inferior a D365/NetSuite en reglas y roll-up.|Reglas condicionales, roll-up, distribución.|

## 5. Compuertas
1 Cumple · 2 No cumple (roll-up, cierre anual) · 3 Parcial · 4 Cumple · 5 Cumple · 6 N/A · 7 No cumple (CI global) · 8 Parcial · 9 Cumple · 10 Cumple · 11 Parcial (tildes) · 12 Parcial.

## 6. Hallazgos
**FIN-DIM-01** · dimensions/financial-reporting · Eje 2 · Bug · **Media** — Filtros por valor padre no incluyen hijos (ADM devuelve 10 de 20). Ubicación: filtro de dimensión en `financial-reporting.service.ts` (igualdad JSONB). Forma correcta: expandir con `dimension_values_closure`. Esfuerzo: S.

**FIN-DIM-02** · dimensions · Eje 4 · Arquitectura · **Media** — Dimensión referida por nombre en JSONB (`journal_entry_lines.dimensions`), sin integridad referencial; impide renombrar y obliga a contar uso por texto. Esfuerzo: M.

**FIN-DIM-03** · dimensions · Eje 11 · UX · **Baja** — Regex ASCII de nombre rechaza "Región", "Año". Esfuerzo: S.

(Ver también FIN-AC-01: la regla obligatoria bloquea el cierre anual.)

## 7. Camino mínimo
FIN-AC-01 (M) → FIN-DIM-01 (S) → FIN-DIM-03 (S). Retocar.

## 8. Camino a 100
Roll-up (+8, S); FK de valores (+8, M); reglas condicionales/combinaciones (+8, M); pruebas (+5, S); auditoría (+3, S).

## 9. Competitividad
Básicas presentes; faltan roll-up y reglas avanzadas que D365/NetSuite tienen (confianza media).

## 10. Fortalezas
Detección de ciclos; reglas solo sobre imputables; protección de valores en uso.

## 11. No verificado
Ataque cruzado ejecutado desde otro tenant; reglas condicionales (`conditions` en `DimensionRule`).

> Actualización 13:47 UTC: Miembro sin permisos (qa-do-a-member) verificado: 403 en GET/POST de journal-entries, chart-of-accounts, periods, journals, ledgers, recurrentes, plantillas, dimensions, balanza, balance, close-period, year-end-close y analytical query. Pendiente solo el ataque iniciado desde qa-do-b (se hizo en sentido inverso: desde qa-do-fin con IDs de qa-do-b y de otros tenants → 404/400).
