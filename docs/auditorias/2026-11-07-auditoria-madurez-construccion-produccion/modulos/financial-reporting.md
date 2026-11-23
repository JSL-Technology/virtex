# Ficha — financial-reporting (balance, resultados, balanza, flujo de efectivo) + analytical-reporting (vista materializada)

Familia FIN-A · Auditor: FIN · Fecha: 2026-11-07. Dos secciones: A) financial-reporting, B) analytical-reporting.

## 1. Identificación
- **A. financial-reporting**: `apps/backend/api/src/app/financial-reporting` — 1.467 líneas, 1 spec. `financial-reporting.service.ts` (1.000), `comparative-reporting.service.ts` (115, **no registrado** en `financial-reporting.module.ts:21` ni referenciado: código muerto), `guards/temporal-validity.guard.ts`, `financial-reporting.copilot-tools.ts`. Endpoints GET `balance-sheet`, `income-statement`, `trial-balance`, `cash-flow-statement` (con `ledgerId`, `dimension=Nombre=VALOR`), todos con `@HasPermission`.
  Frontend: `features/reports/financial-statements/{balance-sheet,income-statement,trial-balance,cash-flow}`, `core/export/statement-export.service.ts`.
- **B. analytical-reporting**: 569 líneas, **0 specs**. `POST /analytical-reporting/query` (ANALYTICS_QUERY), `refresh-view` y `synchronize-view` (permiso de plataforma + step-up). Vista materializada `analytical_report_data`. **Sin frontend** (grep `analytical-reporting` en `client-web/src`: 0 coincidencias).
- Países: todos (genérico). Núcleo: A sí; B no.

## 2. Estándar de referencia
(a) Básicas: balance, resultados, balanza de comprobación (saldos iniciales, movimientos, finales), flujo de efectivo (indirecto), comparativos con período anterior, exportación, filtros por libro/dimensión, formatos oficiales por país (p.ej. DGII IR-2 anexos en DO, estados NIF en MX — verificar con contador). Avanzadas: consolidación, diseñador de reportes, drill-down al asiento.
(b) Invariantes: los reportes cuadran con el mayor; A = P + PN (+ resultado no cerrado); el IS del ejercicio excluye el asiento de cierre; flujo explica la variación de caja.
(c) Líderes (confianza media): QuickBooks/Xero comparativos y drill-down nativos; NetSuite/D365 diseñadores financieros; Alegra/Siigo formatos locales.
(d) Construcción: consultas agregadas en BD sobre el mayor, una sola fuente de saldos (`account-balances`), DTO de salida.

## 3. Resultado
- **A. financial-reporting — Madurez 62 (55–68, confianza alta en cifras / media en el resto)**. Preparación 58. **Veredicto: Piloto controlado.** Eje más débil: 12 (sin comparativos ni formatos locales).
- **B. analytical-reporting — Madurez 30 (22–38, confianza media)**. Preparación 25. **Veredicto: No listo.** Eje más débil: 8/9.
- Críticos: ninguno confirmado; 1 alto en B por revisión de código (no explotado).

## 4. Ejes — A. financial-reporting
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
|1|Autenticidad|65 (58–72, alta)|4 reportes reales; pantallas cargan sin errores (Playwright, balanza "agrees"). `ComparativeReportingService` sin endpoint.|Comparativos expuestos.|
|2|Corrección (crítico)|78 (72–84, alta)|Balanza 2026 recalculada con SQL sobre `journal_entry_lines` (estado ≠ Draft): 1110 −19.073,11; 1120 22.500; 1130 20.000,33; 3100 −927; 4100 −50.000,33; 5100 20.000,11; 5300 7.500 — **idéntica**. IS: 50.000,33−20.000,11−7.500 = 22.500,22 ✓. Balance cuadra (23.427,22, `unclosedResult` 22.500,22). Flujo: operación 2.499,89 + financiación 927 = 3.426,89 = caja final ✓. Tras cierre anual: IS 2026 = 22.570,23 (excluye asiento de cierre) ✓; balanza 2027 con saldos iniciales 54.512,60 cuadrada ✓. Filtro por dimensión sin roll-up (FIN-DIM-01).|Roll-up; prueba con varias monedas/libros.|
|3|Multi-país|40 (30–50, media)|Estructura IFRS única; sin formatos oficiales (grep `country|DGII|NIF|IFRS` en el servicio: 0).|Formatos por país como datos.|
|4|Arquitectura|60 (52–66, media)|Servicio de 1.000 líneas; respuestas con `name` JSONB crudo (`{"es":…}`) delegando i18n al cliente.|Partir por reporte; DTO localizado.|
|5|Higiene|65 (58–72, media)|2 violaciones de frontera; código muerto comparativo.|Eliminar o cablear.|
|6|Calidad|66 (60–72, media)|5 warnings lint.|—|
|7|Robustez|58 (50–66, baja)|Agregación en BD; sin prueba de volumen.|Prueba con 1M líneas; caché/snapshots por período cerrado.|
|8|Seguridad (crítico)|72 (62–80, media)|`ledgerId` ajeno en trial-balance → 404. qa-do-a-member → 403 (ejecutado).|—|
|9|Pruebas|45 (38–52, media)|1 spec para 1.467 líneas.|Pruebas de cuadre por reporte.|
|10|Operabilidad|58 (50–65, baja)|Logs con request-id.|—|
|11|UX|60 (50–68, baja)|Balanza con banner de cuadre, exportar; UI en inglés y fecha MM/DD/AAAA en tenant DO (verificar locale).|Locale por tenant.|
|12|Competitividad|45 (38–52, media)|Sin comparativos, sin drill-down verificado, sin formatos locales.|Ver §9.|

## 4b. Ejes — B. analytical-reporting (resumen)
1: 30 (sin UI; consulta genérica sobre vista que debe sincronizarse manualmente). 2: 40 (no verificado con datos; `REFRESH … CONCURRENTLY` y cron). 3: N/A. 4: 35 (DDL dinámico con una columna por nombre de dimensión de **toda la instalación** — `synchronizeView` lee `Dimension` sin filtro de tenant por diseño; nombres de dimensiones de un cliente se vuelven columnas visibles en el esquema compartido). 5: 55. 6: 50 (2 warnings, `Promise<any>`). 7: 40 (vista global para todos los tenants; refresco completo). 8: 40 (FIN-AR-01 reclasificado a baja tras verificación; persiste la vista global con nombres de dimensiones de todos los tenants, FIN-AR-02). 9: 10 (0 specs). 10: 45. 11: N/A (sin UI). 12: 30.

## 5. Compuertas (A / B)
|#|A|B|
|---|---|---|
|1 Sin fachadas|Cumple (comparativo muerto)|No cumple (sin UI)|
|2 Integridad|Cumple (cuadre verificado)|No verificado|
|3 AuthZ/aislamiento|Cumple (miembro 403 e IDOR negativo verificados)|Parcial: filtro `organization_id` presente; FIN-AR-01 (verificado: no hay inyección)|
|4 Validación|Cumple|No cumple (campos libres)|
|5 E2E|Cumple|N/A|
|6 País|No cumple (sin formatos locales) — genérico|N/A|
|7 CI|No cumple (global)|No cumple (0 pruebas)|
|8 Auditoría|N/A (lectura)|N/A|
|9 Migraciones|Cumple|Vista fuera de migraciones (DDL en runtime)|
|10 Observabilidad|Cumple|Cumple|
|11 UI|Parcial|N/A|
|12 Docs|Parcial|Parcial|

## 6. Hallazgos
**FIN-AR-01** · analytical-reporting · Eje 8 · Seguridad · ~~Alta~~ → **Baja (reclasificado en la verificación del Paso 9: FALSO POSITIVO como inyección)**
- Ubicación: `analytical-reporting/dto/analytical-query.dto.ts` (`FilterDto.field` solo `@IsString @IsNotEmpty`), `analytical-reporting.service.ts:158-185`.
- Verificación del coordinador: `sanitizeColumnName` (`analytical-reporting.service.ts:232-237`) **rechaza** cualquier nombre que no cumpla `^[a-zA-Z0-9_ ]+$` (lanza `BadRequestError`) antes de interpolarlo entre comillas dobles; no hay forma de cerrar el identificador ni de inyectar. La afirmación original ("solo cambia espacios por `_`") era incorrecta. Las medidas sí están en lista blanca (`@IsIn(['debit','credit','net_change'])`).
- Lo que queda: no hay lista blanca de columnas REALES de la vista: un nombre inexistente produce un error de PostgreSQL en vez de un 400 de validación. Forma correcta: validar `field`/`dimensions` contra las columnas de la vista en el DTO/servicio.
- Impacto: deuda técnica. Esfuerzo: S.

**FIN-AR-02** · analytical-reporting · Eje 4/7 · Arquitectura · **Media** — Vista materializada única para todos los tenants creada por DDL en runtime (`synchronizeView`), con columnas derivadas de nombres de dimensiones de todos los clientes; fuera del control de migraciones y del drift check. Forma correcta: tabla de hechos con dimensión normalizada (clave-valor) y particionado por tenant. Esfuerzo: M.

**FIN-FR-01** · financial-reporting · Eje 1/12 · Competitividad · **Alta** — Sin estados comparativos (período anterior/presupuesto): `comparative-reporting.service.ts` existe pero no está en `providers` ni tiene ruta. Capacidad básica en QuickBooks/Xero/Alegra. Esfuerzo: S–M.

**FIN-FR-02** · financial-reporting · Eje 2/11 · Presentación · **Baja** — Flujo de efectivo repite la misma cuenta (1130) en dos filas (−50.000,33 y +30.000) en lugar de su variación neta. Esfuerzo: S.

**FIN-FR-03** · financial-reporting · Eje 3 · Multi-país · **Media** — Un solo formato IFRS para los 19 países; sin estados en formato oficial (DO, MX, CO…). Esfuerzo: L.

## 7. Camino mínimo a producción
A: FIN-FR-01 (S–M), FIN-DIM-01 (S), pruebas de cuadre automatizadas (M). B: FIN-AR-01 (S), pruebas (M), decidir si se expone (UI) o se retira. Retocar A; rehacer B (modelo de datos).

## 8. Camino a 100
A: comparativos (+8), formatos por país como datos (+10, L), drill-down al asiento (+4), pruebas de cuadre (+5), rendimiento con snapshots (+4). B: lista blanca (+15), modelo normalizado (+15), UI (+10), pruebas (+10).

## 9. Competitividad
Cifras correctas y cuadradas (nivel de mercado). Brechas básicas: comparativos, formatos locales. Avanzadas: diseñador de reportes, consolidación (NetSuite/D365). Confianza media.

## 10. Fortalezas
Cuadre exacto con el mayor verificado por SQL; balance con `unclosedResult` y `outOfBalanceBy`; IS excluye cierre; flujo con `unexplainedDifference`=0; filtros por libro y dimensión.

## 11. No verificado
Reportes multi-libro (ledger secundario), en moneda distinta, con volumen; exportaciones; analytical query/refresh ejecutados (no se probó para no tocar la vista global compartida); miembro sin permisos.

> Actualización 13:47 UTC: Miembro sin permisos (qa-do-a-member) verificado: 403 en GET/POST de journal-entries, chart-of-accounts, periods, journals, ledgers, recurrentes, plantillas, dimensions, balanza, balance, close-period, year-end-close y analytical query. Pendiente solo el ataque iniciado desde qa-do-b (se hizo en sentido inverso: desde qa-do-fin con IDs de qa-do-b y de otros tenants → 404/400).
