# Hojas de datos (M29) — datasheets

## 1. Identificación
Backend `datasheets/` (11 archivos, 1 660 LOC, **0 specs**): 12 endpoints (`import/modules`, `import/data`, `variables`, `resolve-variables`, CRUD de libros, `:id/versions` POST/GET). Entidades `datasheet_books`, `datasheet_sheets`, `datasheet_versions`, `datasheet_permissions`. Frontend `features/datasheets` (811 LOC), rutas `analisis.manifest.ts:113-136`. Países N/A. Núcleo: no.

## 2. Estándar de referencia
Hojas tipo Excel conectadas al ERP (NetSuite Saved Search + Excel add-in, Dynamics "Edit in Excel", Zoho Sheet): extraer datos vivos con los permisos del usuario, compartir con roles (lector/editor), versiones, y — en los líderes — publicar cambios de vuelta al ERP con validación. Confianza media.

## 3. Resultado
Madurez **42** (35–50, media) · Preparación **40 — No listo** (compuerta 7: 0 pruebas) · Eje débil: Pruebas · Críticos 0 · Altos 1.

## 4. Ejes
| Eje | Nota | Evidencia | Falta |
|---|---|---|---|
| 1 | 50 | "Importación a módulos" es en realidad **extracción** de datos de módulos hacia la hoja (4 datasets: productos, facturas, clientes, CxP, `datasheet-import.service.ts:63-132`); no hay escritura de la hoja hacia los módulos. Variables con registro (`variable-registry.ts`). | Publicar al ERP con validación; más datasets. |
| 2 | 50 | Versionado por `versionNumber` (`datasheets.service.ts:216`). | Concurrencia de versiones (sin lock visible). |
| 3 | N/A | — | — |
| 4 | 55 | Servicios separados (libros, import, variables). | — |
| 5 | 45 | Lee de dominios ajenos. | Puertos. |
| 6 | 58 | Comentarios documentan correcciones previas (permisos antes no verificados; verificado hoy: `holds()` usa el matcher del guard, `datasheet-import.service.ts:232`). | — |
| 7 | 50 | — | Límites de tamaño de hoja (no verificado). |
| 8 | 58 (50–65, media) | Acceso por dueño o compartido (`datasheets.service.ts:59,96`), permiso por dataset y por variable. Sólo el dueño versiona (`:207`). `import/data` y `resolve-variables` son POST con `DATASHEETS_VIEW` (lectura). | IDOR no probado por API. |
| 9 | **15** | 0 specs en el módulo (find `*.spec.ts`). | Pruebas de permisos compartidos e IDOR. |
| 10 | 40 | — | — |
| 11 | 45 (baja) | No ejecutado. | — |
| 12 | 40 | — | Edición en Excel bidireccional. |

## 5. Compuertas
1 Cumple con reservas · 2 Parcial (versiones sin control de concurrencia, no verificado) · 3 Cumple (estático) · 4 Cumple (DTO de variables) · 5 No verificado · 6 N/A · **7 No cumple** · 8 No verificado · 9 Cumple · 10 Parcial · 11 No verificado · 12 Parcial.

## 6. Hallazgos
- **DS-01** · datasheets · Eje 9 · Pruebas · **Alta** · `datasheets/` · Módulo con permisos compartidos y lectura transversal sin una sola prueba. · Specs de acceso dueño/compartido/ajeno y de permisos por dataset. · M.
- **DS-02** · datasheets · Eje 1 · Funcionalidad/nomenclatura · **Media** · `datasheet-import.service.ts` · "Import" sólo extrae; no hay carga de vuelta. · Renombrar o implementar publicación validada vía `data-transfer`. · M.
- **DS-03** · datasheets · Eje 2 · Concurrencia · **Baja** (no verificado) · `datasheets.service.ts:216` · Siguiente versión por `findOne DESC` + insert: dos guardados simultáneos pueden chocar (depende de índice único). · S.

## 7–8. Caminos
Mínimo: DS-01 (M). A 100: publicación al ERP (+10, L), más datasets/fórmulas (+6, M), colaboración en tiempo real (+6, L).
## 9–10. Competitividad / Fortalezas
Nota 40. Fortalezas: permisos por dataset y variable aplicados con el matcher único.
## 11. No verificado
Nada ejecutado por API (presupuesto). Cobertura ~35 % lectura.

<!-- RESUMEN: modulo=hojas-de-datos; madurez=42; prep=40; veredicto=No listo; eje_debil=Pruebas; criticos=0; altos=1; camino_min=M -->
