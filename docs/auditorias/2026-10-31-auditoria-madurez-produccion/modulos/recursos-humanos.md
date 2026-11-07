# M26 — Recursos Humanos (`hcm`) — Familia F9

> Sin hallazgos críticos de seguridad. Las pruebas IDOR desde qa-a contra un empleado de qa-b (GET, `/compensation`, `/sensitive`, PATCH) devolvieron **404**.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/hcm` (≈12 archivos, ~1.300 LOC). 15 endpoints (`hcm.controller.ts`).
- **Entidades**: Employee, Department, EmployeeCompensation. No hay entidades de contrato, ausencias, vacaciones ni evaluaciones.
- **Frontend**: `features/hcm/{employees,departments}`.
- **Pruebas**: 1 spec (`hire-with-salary.spec.ts`).
- **Países**: validación de identificadores por país a través de `JurisdictionRegistry.statutoryIdentifiers` (solo DO declara reglas) y el catálogo de documentos de identidad.
- **Dependencias**: identity (users), jurisdictions, localization.
- **¿Núcleo?** Sí, como prerequisito de nómina.

## 2. Estándar de referencia
- **Básico**: expediente del empleado; contratos con historial; puestos y departamentos; organigrama; compensación fechada; ausencias, licencias y vacaciones con saldo; documentos adjuntos; autoservicio; PII cifrada y con acceso restringido.
- **Avanzado**: workflows de alta y baja, evaluación, reclutamiento, beneficios.
- **Líderes**: Workday, Rippling, BambooHR, Buk y Runa (LatAm). Confianza media.
- **Invariantes**: un empleado pertenece a un solo tenant; el historial salarial es inmutable y fechado; la PII es visible solo con permiso; queda auditoría de cambios de salario y cuenta bancaria.

## 3. Resultado
- **Madurez 40** (34–48, confianza media) · **Preparación 38 · NO LISTO**: le faltan capacidades básicas.
- Eje más débil: completitud (1).
- Críticos: 0. Altos: 3.

**Por país**
- **DO: 42, Piloto no recomendado.**
- **MX, CO, US: 38.** Es un registro genérico sin identificadores estatutarios (RFC/CURP/NSS IMSS, EPS/AFP CO, SSN/W-4) validados.

## 4. Doce ejes
| Eje | Nota | Evidencia | Falta para 100 |
|---|---|---|---|
| 1 Completitud | 35 (28–42, alta) | Solo empleados, departamentos y compensación. Busqué `absence\|leave\|vacation\|contract` en entidades de hcm: solo hay un enum `contractType` en Employee. | Contratos, ausencias, vacaciones con saldo, organigrama, documentos |
| 2 Corrección | 60 (52–68, media) | Compensación fechada por `effectiveFrom`. `blindIndex` para unicidad del documento sin texto claro (`hcm.service.ts:82`). Cédula DO obligatoria (422 `hcm.identity_document_required`). | Historial de contratos y bajas con causa |
| 3 Multi-país | 40 (30–50, media) | Identificadores estatutarios solo para DO (`dominican-republic.strategy.ts` en `statutoryIdentifiers`). `default 'DOP'` en `employee-compensation.entity.ts:56`. | Especificaciones de MX, CO, US |
| 4 Arquitectura | 62 (55–70, media) | Uso limpio de `JurisdictionsModule` como módulo hoja. | Agregados de contrato y ausencias |
| 5 Higiene | 62 (55–68, media) | HCM y payroll comparten el archivo de permisos `payroll/payroll.permissions.ts` (HCM_VIEW/MANAGE viven en payroll). | Permisos propios |
| 6 Calidad | 68 (60–74, media) | DTOs validados, i18n. | — |
| 7 Robustez | 58 (50–65, baja) | Listado paginado (no verificado a fondo). | — |
| 8 Seguridad | 72 (65–78, media-alta) | PII (documento, cuenta bancaria) cifrada en reposo (`employee.entity.ts:120-179`, `encryptedColumnTransformer`). Se elimina de la respuesta si falta `hcm:view_sensitive` (`hcm.controller.ts:252-261`). Step-up para salario, cuenta y vista sensible (`:131,150,162,185,198`). IDOR negativo. El salario en `employee_compensations` **no** está cifrado (no verificado si se requiere). Roles restringidos no probados. | Prueba de roles; cifrar o enmascarar salario según política |
| 9 Pruebas | 35 (28–45, media) | Una sola spec. | Integración y autorización |
| 10 Operabilidad | 55 (45–62, baja) | FinancialAuditSubscriber sobre compensaciones (comentario `hcm.controller.ts:195`, no verificado en BD). | — |
| 11 UX | 50 (40–60, baja) | No verificada. | — |
| 12 Competitividad | 25 (18–32, media) | Por debajo de cualquier HRIS básico. | — |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Capacidades básicas | **No cumple** | Sin ausencias, vacaciones ni contratos |
| 2 Integridad | Cumple | Alta con salario inicial en una sola operación (spec `hire-with-salary`) |
| 3 Aislamiento | Cumple | IDOR 404 en 4 endpoints |
| 4 Validación servidor | Cumple | 422 por documento obligatorio |
| 5 E2E sin 500 | Cumple (API) | — |
| 6 Cumplimiento país | Parcial | Solo DO declara identificadores |
| 7 Pruebas CI | No cumple | — |
| 8 Auditoría | Cumple (parcial) | Subscriber financiero, step-up |
| 9–10 | Cumple / parcial | — |
| 11 UI | No verificado | — |
| 12 Doc | Parcial | — |

## 6. Hallazgos
- **HCM-01 · Completitud · Alta.** No hay ausencias, licencias ni vacaciones con saldo, ni contratos con historial, ni organigrama. Tampoco documentos del empleado. Las vacaciones solo aparecen en la liquidación de nómina. Impacto: bloquea la venta frente a cualquier HRIS. L.
- **HCM-02 · Multi-país · Alta.** Solo DO valida identificadores estatutarios. Faltan RFC/CURP/NSS (MX), EPS/AFP/ARL (CO) y SSN/W-4 (US). Además `default 'DOP'` en la compensación. M.
- **HCM-03 · Pruebas · Alta.** Una única spec; no hay pruebas de autorización por rol ni de cifrado. M.
- **HCM-04 · Higiene · Media.** Los permisos de HCM están definidos en `payroll/payroll.permissions.ts`, que mezcla los dos contextos. S.
- **HCM-05 · Seguridad · Media (verificar con el equipo).** El salario base no está cifrado en reposo. Lo protegen el permiso y el step-up. Validar contra la política de datos personales (Ley 172-13 DO); **verificar con abogado local**. S.

## 7. Camino mínimo a producción
1. Ausencias y vacaciones con saldo integradas a nómina. L.
2. Contratos con historial. M.
3. Pruebas de autorización por rol. M.
4. Identificadores por país para los mercados donde se venda nómina. M.

## 8. Camino a 100
Ausencias y vacaciones (+15, L) → contratos y organigrama (+10, M) → autoservicio y documentos (+8, M) → workflows y evaluaciones (+10, L) → multi-país (+10, M).

## 9. Competitividad
Muy por detrás de Buk, Runa, BambooHR y Rippling. El diferenciador es la PII cifrada con step-up, que pocos ERP medianos tienen. Nota 25.

## 10. Fortalezas
- PII cifrada con blind index.
- Respuesta filtrada por permiso sensible.
- Step-up en salario y cuenta bancaria.
- Identificadores estatutarios definidos por la estrategia de cada país en lugar de reglas DO fijas.

## 11. No verificado
- UI.
- Roles restringidos.
- Contenido real del audit log de compensaciones.
- Paginación con volumen.

**Cobertura**: ~35 % de los archivos leídos (controller y entidades por grep); 6 endpoints ejecutados; 0 % de la UI.

<!-- RESUMEN: modulo=recursos-humanos; madurez=40; prep=38; veredicto=No listo; eje_debil=completitud; criticos=0; altos=3; camino_min=L -->
