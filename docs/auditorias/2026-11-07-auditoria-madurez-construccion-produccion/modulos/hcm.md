# Ficha — `hcm` (empleados, departamentos, compensaciones) · Familia NOM

> Auditoría diagnóstica 2026-11-07. Evidencia ejecutada con `qa-do-nom` (propio), `qa-do-a`/`qa-do-b` (aislamiento) y `qa-do-a-member` (autorización). Sin hallazgos CRÍTICOS confirmados; NOM-20 (cédula en claro en `audit_logs`) es ALTA.

## 1. Identificación

| Campo | Valor |
|---|---|
| Backend | `apps/backend/api/src/app/hcm` (12 archivos, 1.380 líneas): `hcm.controller.ts` (267), `hcm.service.ts` (464), entidades `employee` (250), `employee-compensation`, `department` |
| Endpoints | 15: tipos de documento / identificadores legales; empleados (lista paginada, ver, `/sensitive`, crear, editar, borrar); compensaciones (listar, crear); departamentos CRUD |
| Tablas | `employees` (cédula y cuenta bancaria cifradas; hash ciego único por tenant), `employee_compensations` (vigencia, única por empleado+fecha), `departments`; triggers `tg_same_tenant_*` en `employees` y `employee_compensations` |
| Frontend | `features/hcm` (1.945 líneas): lista, formulario (alta/edición con salario inicial), departamentos; menú en `rrhh.manifest.ts` |
| Pruebas | `hcm/hire-with-salary.spec.ts`, `features/hcm/employees/form/form.page.spec.ts` (289 líneas); pasan |
| Países | Neutro; documento de identidad y patrones por país vía catálogo de localización (DO: cédula requerida con módulo 10; NSS 7-11 dígitos de la estrategia DO) |
| ¿Núcleo? | Sí, prerrequisito de nómina |

## 2. Estándar de referencia

(a) Básicas: ficha de empleado con datos personales/fiscales/bancarios cifrados, historial de puestos y salarios con vigencia, departamentos y centros de costo, contratos, altas/bajas con motivo, vacaciones y ausencias, documentos del empleado, organigrama, autoservicio. Avanzadas: evaluación de desempeño, reclutamiento, capacitación, beneficios, flujos de aprobación de cambios salariales. (b) Invariantes: un empleado por documento por tenant; fechas coherentes (salida ≥ ingreso, estado coherente con salida); salario ≥ mínimo legal salvo excepción documentada; PII cifrada y accesible solo con permiso y traza; referencias (departamento, usuario) del mismo tenant. (c) Líderes: Odoo Employees/Time Off (alta), BambooHR, SAP SuccessFactors Employee Central, Dynamics 365 Human Resources (alta, documentación pública de producto); locales: Alegra Nómina RD (media). (d) Construcción: entidades con historial efectivo (effective dating) para puesto/salario, PII separada y cifrada, lecturas sensibles auditadas, validaciones de dominio en servicio.

## 3. Resultado

| | |
|---|---|
| **Madurez** | **45 (38–52, confianza media-alta)** |
| **Preparación comercial** | **38** |
| **Veredicto** | **No listo** |
| Eje más débil | 1 (completitud: sin vacaciones/ausencias/historial de puestos/documentos) |
| Críticos abiertos | 0 |

## 4. Tabla de 12 ejes

| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad/completitud (crítico) | 38 (30–45, alta) | Alta/edición/baja reales con salario inicial en la misma transacción (`hcm.service.ts:77-118`). Ausentes (grep `vacation|leave|absence|time_off` sin módulo propio en `hcm/`): vacaciones, ausencias, historial de puestos, documentos, organigrama, motivos de baja | Vacaciones/ausencias, historial de puesto, documentos, autoservicio |
| 2 Corrección (crítico) | 50 (42–58, alta) | Unicidad cédula por tenant (hash ciego, índice parcial); borrar empleado con nómina → 409 `hcm.employee_with_payroll_terminate_first`; borrar departamento en uso → 409. Pero: `terminationDate` 2020-01-01 < `hireDate` 2025-01-01 aceptado y estado sigue `ACTIVE` (PATCH, 200); salario 15.000 (< mínimo) y 9.999.999.999,99 aceptados sin aviso | Validaciones cruzadas de fechas/estado, salario mínimo por sector, límites razonables |
| 3 Multi-país | 62 (55–68, media) | Documento por catálogo de país (`resolveIdentityDocument`), sin regla DO impuesta a otros (comentarios + `identity-document-types` de DO devuelve CEDULA/PASSPORT); identificadores legales vienen de la estrategia del país | Catálogos completos para 19 países (no verificado fuera de DO) |
| 4 Arquitectura | 58 (50–64, media) | Servicio razonable; redacción de PII en el controlador (`redact`, `hcm.controller.ts:258-266`) en vez de serializador; `...fields` del DTO se vuelca a la entidad (`hcm.service.ts:85`) sin validar `departmentId`/`userId` en servicio (depende del trigger de BD para departamento y de nada para usuario) | DTO de respuesta, validación de referencias en servicio |
| 5 Higiene | 60 (52–66, media) | `boundaries-report.log`: rrhh→configuración 9 private-imports (`hcm/entities/employee.entity.ts:3` importa entidad de localización; auditoría); reportes→rrhh: `datasheets` importa `Employee` | Puertos de localización/auditoría |
| 6 Calidad | 72 (65–78, media) | 3 warnings de lint (`UseGuards` sin uso, `_omit`) | Limpieza menor |
| 7 Robustez | 58 (50–64, media) | Empleados paginados; departamentos y compensaciones sin paginación (volúmenes pequeños) | Paginación uniforme |
| 8 Seguridad (crítico) | 52 (45–60, alta) | qa-do-b → GET/PATCH/DELETE empleado y departamento de qa-do-a: 404; compensación ajena: 404; alta en B con `departmentId` de A: 400 `FOREIGN_KEY_VIOLATION` (lo frena el trigger, no la app); member → 403. Fallos: NOM-20, NOM-21, NOM-22 | Ver hallazgos |
| 9 Pruebas | 45 (38–52, media) | Pocas pruebas de servicio; sin pruebas de aislamiento/redacción | Pruebas de PII, fechas, referencias |
| 10 Operabilidad | 50 (42–58, media) | `audit_logs` employees CREATE/UPDATE con antes/después, lectura de compensación auditada (`employee_compensation READ`); pero guarda PII en claro (NOM-20) | Enmascarar PII en auditoría |
| 11 UX | 62 (55–70, media) | Playwright: lista y formulario completos en español (secciones identidad, NSS, cuenta, vínculo, salario inicial), sin claves crudas | Validación de fechas en UI, aviso de salario bajo mínimo |
| 12 Competitividad | 30 (22–38, media) | Frente a Odoo/BambooHR faltan ausencias, documentos, desempeño, organigrama | §9 |

## 5. Compuertas

| # | Estado | Evidencia |
|---|---|---|
| 1 | No cumple | Sin vacaciones/ausencias |
| 2 | Parcial | Alta+salario transaccional; fechas incoherentes aceptadas |
| 3 | Cumple con reservas | Aislamiento OK; `userId` ajeno aceptado (NOM-22) |
| 4 | No cumple | Fechas/estado/salario sin validar |
| 5 | Cumple | Sin 500 |
| 6 | N/A parcial | Catálogo por país (DO verificado) |
| 7 | No cumple | Pocas pruebas, CI rojo global |
| 8 | Parcial | Auditoría con PII en claro |
| 9 | Cumple | Migraciones globales OK |
| 10 | Parcial | — |
| 11 | Cumple (es) | Playwright |
| 12 | No cumple | Sin guía |

## 6. Hallazgos

**NOM-20 — La cédula y el NSS se guardan EN CLARO en `audit_logs` aunque la tabla los cifra** · eje 8/10 · Seguridad · **Alta**

> **Corrección del coordinador (Paso 9, verificado en BD):** la tabla `employees` cifra `identity_document` (valores con prefijo `v1.`), pero **`employees.social_security_number` está en claro en la propia tabla**, no solo en `audit_logs`. El NSS no está cifrado en ningún sitio. La severidad se mantiene en alta y el alcance se amplía: hay que cifrar el NSS en reposo, además de enmascararlo en la auditoría.
- Ubicación: subscriber de auditoría (FinancialAuditSubscriber) sobre `employees`; evidencia SQL: `select new_value from audit_logs where entity='employees'` → `"identityDocument": "40200001010", "socialSecurityNumber": "1000001"` (mientras `employees.identity_document` = `v1.bikz8i…` cifrado). Solo el hash se redacta (`"identityDocumentHash": "[redactado]"`).
- Por qué: anula el cifrado en reposo; cualquiera con lectura de auditoría ve documentos de identidad; las cuentas bancarias seguirán el mismo camino.
- Forma correcta: lista de campos sensibles enmascarados en el subscriber (como ya hace con el hash). Impacto: riesgo regulatorio (Ley 172-13 DO, protección de datos). Esfuerzo: S.

**NOM-21 — Quien tiene `*` o `hcm:view_sensitive` recibe cédula y cuenta bancaria en el LISTADO sin step-up ni auditoría** · eje 8 · **Media**
- `hcm.controller.ts:103-112, 258-266`: GET `/hcm/employees` devolvió `"identityDocument":"40200001044"` sin step-up; el endpoint `/employees/:id/sensitive` exige step-up + `@AuditAccess`, que así queda sin efecto. `socialSecurityNumber` nunca se redacta. Forma correcta: el listado siempre enmascara; el claro solo por `/sensitive`. Esfuerzo: S.

**NOM-22 — Un tenant puede vincular un empleado a un usuario de OTRO tenant** · eje 8 · **Media**
- Pasos: qa-do-b `POST /hcm/employees` con `userId` = id de `qa-do-a-member` → 201 (empleado «QA-NOM CrossUser» en org 3f0137a5 con `userId 1bf72449…`). `employees.user_id` no tiene FK ni guarda de mismo tenant (`\d` constraints). Hoy «mis volantes» filtra por la organización activa, así que no se filtran volantes; pero el vínculo cruzado es un dato corrupto y si ese usuario obtiene membresía en B verá volantes ajenos asignados por B. Forma correcta: `assertTenantMember` como en `customer-portal-accounts.service.ts`. Esfuerzo: S.

**NOM-23 — Fechas y estado incoherentes; salario sin control de mínimo legal** · eje 2/4 · **Media**
- PATCH con `terminationDate` anterior al ingreso → 200, `employmentStatus` sigue `ACTIVE`; compensación 9.999.999.999,99 → 201; salario 15.000 aceptado (mínimos sectoriales DO superiores; verificar con contador). Esfuerzo: S.

**NOM-24 — `departmentId` se valida solo por trigger de BD (error genérico `FOREIGN_KEY_VIOLATION`)** · eje 4 · Baja · `hcm.service.ts:85` (`...fields`). Funciona como defensa pero da un mensaje opaco. Esfuerzo: S.

**NOM-25 — Capacidades básicas de RR.HH. ausentes** (vacaciones, ausencias, historial de puestos, documentos, organigrama) · eje 1/12 · **Alta** · Esfuerzo: L.

## 7. Camino mínimo a producción

1. NOM-20 enmascarar PII en auditoría y purgar registros existentes (S).
2. NOM-21 listado siempre enmascarado (S).
3. NOM-22/NOM-24 validación de referencias en servicio (S).
4. NOM-23 validaciones de fechas/estado/salario (S).
5. NOM-25 vacaciones y ausencias (L, dependencia para nómina DO).
Retocar; no rehacer.

## 8. Camino a 100

| Ítem | +pts | Esfuerzo |
|---|---|---|
| Vacaciones/ausencias con saldo y aprobación | +15 | L |
| Historial de puesto/departamento con vigencia, organigrama | +8 | M |
| PII (NOM-20/21) + pruebas | +7 | S |
| Documentos del empleado y autoservicio | +8 | M |
| Validaciones y pruebas de dominio | +6 | S |
| Desempeño/capacitación | +6 | L |

## 9. Competitividad

Básicas faltantes: vacaciones/ausencias (Odoo Time Off, BambooHR — alta). Avanzadas: desempeño, reclutamiento, beneficios. Diferenciador: cifrado de PII con hash ciego para unicidad y validación de documento por país.

## 10. Fortalezas

Cifrado de documento/cuenta con índice ciego; validación de documento por catálogo de país (no impone DO); alta con salario en una transacción; triggers de mismo tenant en BD; bloqueo de borrado con nómina.

## 11. No verificado

Catálogos de documentos de los 18 países restantes; flujo de edición en UI; rendimiento con miles de empleados; RLS (superusuario en este entorno).
