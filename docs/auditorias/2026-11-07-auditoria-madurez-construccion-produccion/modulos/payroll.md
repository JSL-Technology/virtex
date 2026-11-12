# Ficha — `payroll` (nómina) · Familia NOM

> Auditoría diagnóstica 2026-11-07. Evidencia ejecutada en la API local (`http://localhost:3000/api/v1`) con el tenant propio `qa-do-nom@virtex.test` (org `62d1787e-…`), un segundo administrador invitado `qa-nom-approver@virtex.test` (separación de funciones), `qa-do-a`/`qa-do-b` (aislamiento), `qa-do-a-member` (autorización) y `qa-mx-a`/`qa-us-a`/`qa-co-a` (países). Scripts y salidas: `/tmp/claude-0/-home-user-virtex/18f6e197-474f-5038-b8e5-f1d402f375bd/scratchpad/agents/nom/`.
>
> Sin hallazgos CRÍTICOS confirmados. Hay tres hallazgos ALTOS de cálculo (NOM-01, NOM-02, NOM-03) que pasan a CRÍTICOS si el contador local confirma la interpretación normativa: ver cada uno.

## 1. Identificación

| Campo | Valor |
|---|---|
| Backend | `apps/backend/api/src/app/payroll` (37 archivos, 5.036 líneas) + `jurisdictions/` (estrategia DO, registro) |
| Endpoints | 26 en `payroll.controller.ts` (corridas: crear/listar/ver/calcular/aprobar/pagar/anular; novedades (inputs); volantes; mis volantes; conceptos CRUD; prestaciones (preview); parámetros de ley lectura/escritura (solo plataforma); parámetros de empresa; TSS novedades/autodeterminación/«SUIR») |
| Tablas | `payroll_runs`, `payslips`, `payslip_lines`, `payroll_inputs`, `payroll_concepts`, `payroll_statutory_contributions`, `payroll_statutory_references`, `payroll_income_tax_brackets`, `payroll_company_parameters` |
| Frontend | `apps/core/client-web/src/app/features/payroll` (3.180 líneas): corridas (lista/detalle), conceptos, parámetros, mis volantes; menú `core/modules/manifests/rrhh.manifest.ts` |
| Pruebas | 9 specs payroll + `jurisdictions/dominican-republic.strategy.spec.ts`; todas pasan (`npx jest … payroll jurisdictions` → 11 suites OK con BD `virteex_test`) |
| Países | Solo **DO** tiene motor (`jurisdiction-registry.ts:19` registra únicamente `DominicanRepublicStrategy`). |
| Dependencias | hcm (empleados, compensaciones), journal-entries/accounting (asiento), organizations (settings de cuentas), treasury (cuenta bancaria vía SQL) |
| ¿Núcleo para vender? | Sí en DO (nómina es requisito de compra para pymes dominicanas); no vendible hoy en los otros 18 mercados. |

## 2. Estándar de referencia (Paso 3)

**(a) Capacidades básicas**: maestro de empleados y salarios con vigencia; conceptos configurables; corrida mensual/quincenal con prorrateo; cálculo legal (seguridad social, retención ISR) con tasas/topes versionados; regalía pascual; vacaciones; prestaciones (preaviso, cesantía); asiento contable; recibos al empleado; **archivos oficiales** (TSS autodeterminación/novedades en formato SUIR; DGII IR-3 mensual, IR-13 anual; TSS planilla DGT-3/DGT-4 del Ministerio de Trabajo); pago bancario (archivo de dispersión). **Avanzadas**: nómina quincenal real, retroactivos, préstamos con saldo, embargos, simulación, portal del empleado, multi-país.

**(b) Invariantes**: (1) corrida aprobada inmutable; (2) una corrida ordinaria por período; (3) separación aporte empleador/empleado; (4) topes por régimen sobre el salario mínimo cotizable vigente en el período; (5) ISR sobre base neta de AFP+SFS del empleado, escala anual vigente; (6) neto ≥ 0 y sin ingresos no declarados; (7) asiento cuadra y coincide con volantes; (8) lo declarado a TSS = lo calculado.

**(c) Líderes**: Odoo Payroll (localizaciones por país con reglas salariales como datos; DO solo vía módulos de terceros — confianza media); SAP SuccessFactors Employee Central Payroll (motor de esquemas/reglas, >40 países — alta); Dynamics 365 HR + ISV de nómina (media). Locales DO: Alegra Nómina RD (TSS, ISR, regalía, archivo TSS — media, por blog oficial de Alegra), sistemas locales (Nómina Fácil, NomiPlus) que generan archivo de autodeterminación SUIR y IR-3 (media, no verificado en documentos de producto).

**Normativa verificada (marcar "verificar con contador/abogado local")**:
- AFP 2,87 % trabajador / 7,10 % empleador; SFS 3,04 % / 7,09 %; SRL 100 % empleador (≈1,10–1,30 % según riesgo); topes SFS 10×, AFP 20×, SRL 4× el salario mínimo cotizable — confianza **alta** ([acento.com.do sobre Resolución 01-2025 TSS](https://acento.com.do/economia/la-tss-presenta-los-nuevos-topes-para-la-cotizacion-de-seguridad-social-cuanto-es-como-se-calcula-y-cuanto-se-descuenta-9616330.html), [TSS reso01-2025](https://www.tss.gob.do/assets/reso01-2025.pdf)).
- Salario mínimo para topes: RD$19.351,50 desde 02/2024; RD$21.674,80 desde 04/2025; **RD$23.223 desde 01/02/2026** — confianza media-alta ([eldinero.com.do](https://eldinero.com.do/352789/tss-establece-nuevos-topes-de-cotizacion-del-regimen-contributivo-del-sdss/), [presidencia.gob.do](https://presidencia.gob.do/noticias/tss-informa-nuevos-topes-de-cotizacion-del-regimen-contributivo-del-sdss)).
- Escala ISR asalariados 2026: exento hasta RD$416.220; 15 % hasta 624.329; 31.216 + 20 % hasta 867.123; 79.776 + 25 % — confianza alta ([DGII Guía 11](https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/GuiasContribuyente/Impuestos%20y%20Contribuciones/2-Guia-11-Retenciones%20del%20Impuesto%20Sobre%20la%20Renta.pdf), [Alegra](https://blog.alegra.com/republica-dominicana/impuesto-sobre-la-renta-isr/)). Una fuente (siemprealdia) anuncia nueva escala desde 2027 (Ley 30-26) — **no verificado**.
- INFOTEP: 1 % empleador sobre nómina; 0,5 % trabajador sobre bonificaciones (participación en beneficios), no sobre regalía — confianza media.
- Regalía pascual: 1/12 del salario ordinario devengado en el año (CT art. 219), exenta de ISR (art. 222 y párrafo Ley 204-97), con debate sobre el límite de 5 salarios mínimos ([DGII editorial](https://dgii.gov.do/legislacion/editorialJuridico/Paginas/salario-navidad-y-exencion-fiscal.aspx), [phlaw](https://phlaw.com/es/salario-de-navidad-ii/)) — confianza media.

**(d) Construcción de referencia**: motor puro de cálculo + reglas por país como datos versionados (vigencia) + estrategia por país; corrida como agregado con máquina de estados y **bloqueo pesimista** de la fila en cada transición; instantánea de parámetros; asiento idempotente; exportadores de formatos oficiales probados contra especificación de la autoridad.

## 3. Resultado

| | |
|---|---|
| **Madurez** | **42 (35–50, confianza media-alta)** — cálculo DO recalculado a mano y correcto en el caso general; brechas de integridad y de cumplimiento formal |
| **Preparación comercial** | DO: **40**; resto de mercados: N/A (no hay motor; se niega con claridad) |
| **Veredicto** | **No listo** (compuertas críticas 2 y 6 incumplidas) |
| Eje más débil | 3 (multi-país) y 12 (competitividad); entre los críticos, eje 2 (corrección) |
| Críticos abiertos | 0 confirmados (3 altos con riesgo de escalar a crítico tras validación normativa) |

**Por país**
| Mercado | Nota | Veredicto | Situación |
|---|---|---|---|
| DO | 40 | No listo (piloto controlado tras NOM-01..05) | Motor real; sin IR-3/IR-17/DGT; archivo TSS no oficial; bugs NOM-01..05 |
| US, MX, CO, CL, PE, AR, BR, EC, UY, PY, BO, VE, PA, CR, GT, SV, HN, NI | N/A (≈5 como capacidad) | No disponible | `POST /payroll/runs` → 400 `payroll.payroll_jurisdiction_p1_not_supported` (probado MX, US, CO). Para US hay «parámetros de empresa» sembrados (FICA, FUTA…) que **ningún motor consume** (NOM-09). |

## 4. Tabla de 12 ejes

| Eje | Nota (rango, confianza) | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad y completitud (crítico) | 52 (45–58, alta) | Flujo real crear→calcular→aprobar (otro usuario + step-up)→pagar→asiento ejecutado. Ausentes: IR-3/IR-17 (`localization/fiscal/fiscal-coverage.ts:86` `notImplemented('periodicReturns','IT-1, IR-17 e IR-3')`), formato oficial SUIR (NOM-06), vacaciones, bonificación (participación en beneficios), nómina quincenal real, archivo de pago bancario, préstamos con saldo | Formatos oficiales TSS/DGII/MT, vacaciones, bonificación, quincenal, dispersión bancaria |
| 2 Corrección e integridad (crítico) | 45 (38–52, alta) | 6 empleados recalculados a mano (script `recalc.py`): 5/6 exactos al centavo (AFP, SFS, SRL, INFOTEP, ISR por escala, topes 464.460/232.230/92.892, prorrateo a mitad de mes). Fallos: piso de cotización (NOM-01), mínimo cotizable histórico 10.000 (NOM-02), deducción negativa (NOM-03), carrera calcular/aprobar (NOM-04), override de tasa sin límite (NOM-05), regalía sobrestimada (NOM-08), salario cotizable sin tope en archivo TSS (NOM-06). Asiento 853.809,55 = 853.809,55 y mayor cuadra (SQL). Idempotencia de creación (índice único parcial, 3 POST concurrentes → 1×201, 2×409) y de asiento (`idempotencyKey payroll:{id}`) OK. Inmutabilidad tras aprobar OK (409) | Bloqueo `FOR UPDATE` en transiciones, validación de signo, piso legal correcto, datos históricos correctos, pruebas de invariantes |
| 3 Multi-país (cumplimiento) | 22 (15–30, alta) | Reglas DO como datos versionados (bien) y negación clara fuera de DO (bien). Pero 1/19 mercados; `currencyCode: 'DOP'` literal (`payroll-run.service.ts:229`); etiquetas «Salario base», «AFP…», «Regalía pascual» literales en español en el motor (`payroll-calculation.service.ts:137,317`, `regimeName`); columnas DO (`afp_employee`, `sfs_employee`, `srl_employer`, `infotep_*`) en `payslips` compartida por todos los países | Esquema de volante genérico por régimen (líneas), motor por país, moneda del tenant, catálogo de formatos oficiales por país |
| 4 Arquitectura | 60 (52–66, media) | Bien: cálculo puro (`PayrollCalculationService`), estrategia por país, instantánea de parámetros (`parameterSnapshot`), puerto contable. Mal: estado leído fuera de la transacción y sin bloqueo (`calculate` líneas 283-302, `cancel` 510-517); `concept.accountId` se guarda y se ignora (`payroll-accounting.service.ts` acredita todo a una CxP); `payroll-run.service.ts` 838 líneas | Bloqueo pesimista, contabilización por concepto, separar servicio de ciclo de vida/lecturas |
| 5 Higiene y separación | 55 (48–62, media) | `boundaries-report.log`: rrhh→contabilidad 6 private-imports + 8 cross-module-transaction (`payroll-accounting.service.ts:62-217` usa el `EntityManager` de payroll en servicios contables); ciclo plataforma↔rrhh (`shared/permissions.ts:21`); reportes→rrhh (datasheets importa `Employee`); SQL directo a `bank_accounts`/`accounts` (`payroll-run.service.ts:473-507`) | Puertos explícitos con contratos; eventos o puerto de tesorería; romper ciclo de permisos |
| 6 Calidad de código | 70 (64–76, media) | 0 warnings de lint en `payroll/`; comentarios extensos y mayormente coherentes; algún comentario promete más de lo que hay (controlador: parámetros de empresa «cambian cómo se retiene» — no se usan) | Dividir servicios largos, corregir comentarios engañosos |
| 7 Robustez/rendimiento | 50 (42–58, media) | `calculate` hace por empleado `await compensationFor` + 2 `save` dentro de una transacción (N+1; 6 empleados ok, 2.000 empleados = miles de round-trips en una request síncrona); `payslipsOf` sin paginación; recalcular concurrente → 409 genérico `UNIQUE_VIOLATION` en vez de error de dominio | Carga de compensaciones en bloque, inserción por lotes, trabajo en cola para corridas grandes, paginación |
| 8 Seguridad y aislamiento (crítico) | 64 (56–70, alta) | qa-do-b → corridas/volantes/SUIR de qa-do-nom: 404; inputs con empleado ajeno: validados (`payroll-input.service.ts:70-95`); member → 403 en todo; «mis volantes» devuelve solo el propio y solo de corridas aprobadas (probado); SoD calculador≠aprobador (403) y step-up de un solo uso para aprobar/pagar (2.º uso → 401). Sin datos sensibles en `api.log`. Debilidades: parámetros legibles con `?country=` de cualquier país (inocuo); PII de HCM (ver ficha hcm) | Auditoría de lecturas en «mis volantes», RLS efectiva en producción (rol app sin BYPASSRLS) |
| 9 Pruebas | 42 (35–50, alta) | 11 suites/46 tests pasan; cálculo bien cubierto por unidad. Sin prueba de integración de aprobar→asiento→pagar, SoD, carrera, signos; `dominican-statutory-data.spec.ts:29` **consagra** el valor erróneo previo («keeps the old figure for earlier periods») | Pruebas de integración del ciclo con BD, propiedades de invariantes (neto, cuadre), concurrencia |
| 10 Operabilidad | 58 (50–64, media) | `audit_logs`: payroll_runs CREATE/UPDATE con antes/después (FinancialAuditSubscriber); `@AuditAccess` en volantes/TSS. Volantes y líneas no auditados; logs de servicio en texto libre español (`Corrida … calculada`) | Logs estructurados con tenant/run, auditoría de borrado/recalculo de volantes |
| 11 UX/idiomas | 60 (50–68, media) | Playwright: lista de nóminas, conceptos, parámetros, empleados, «Mis volantes» renderizan en español sin claves crudas; detalle pide step-up (diálogo «Verificación de seguridad»); sin errores de consola propios (403 de `/ai/copilot/charts/pinned` ajeno). No verificado: UI en tenant no-DO, móvil | Mensaje explícito «nómina no disponible en tu país» en el menú, estados vacíos por país, accesibilidad |
| 12 Competitividad | 30 (22–40, media) | Frente a Alegra Nómina RD / locales: faltan IR-3, archivo SUIR real, vacaciones, bonificación, quincenal, dispersión bancaria; frente a Odoo/SAP: 1 país | Ver §9 |

Madurez 42 < promedio simple (≈50): tope por eje crítico 2 (45) y hallazgos altos de cálculo abiertos.

## 5. Compuertas de producción

| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, básicas presentes | **No cumple** | Faltan formatos oficiales (IR-3, SUIR real), vacaciones, bonificación; parámetros US sin motor (NOM-09) |
| 2 | Integridad en escrituras críticas | **No cumple** | NOM-03, NOM-04, NOM-05 |
| 3 | AuthZ y aislamiento | Cumple | Pruebas qa-do-b, member, SoD, step-up |
| 4 | Validación en servidor | No cumple | Montos/tasas de novedades sin límites ni signo (NOM-03/05) |
| 5 | Flujo E2E sin 500 | Cumple | Sin 500 en `api.log` para payroll |
| 6 | Cumplimiento por país | **No cumple** | DO: NOM-01/02/06/07; no soportados: declarados como tales (bien) |
| 7 | Pruebas de flujos críticos en CI | No cumple | Sin integración de aprobación/pago; CI global en rojo |
| 8 | Auditoría de negocio | Cumple parcial | Runs auditados; volantes no |
| 9 | Migraciones sin deriva | Cumple | `check:schema-drift` OK (global) |
| 10 | Observabilidad mínima | Parcial | Sin correlación en logs de servicio |
| 11 | UI sin bloqueos, traducciones | Cumple (es) | Playwright |
| 12 | Documentación operativa | No cumple | No hay guía de configuración de cuentas/parámetros (solo comentarios de código) |

## 6. Hallazgos

**NOM-01 — Piso de cotización: al empleado bajo el mínimo se le descuenta AFP/SFS sobre RD$23.223 aunque gane menos** · payroll/jurisdictions · eje 2/3
- Categoría: bug / multi-país · **Severidad: Alta** (Crítica si el contador confirma que el trabajador no debe soportar la diferencia)
- Ubicación: `jurisdictions/dominican-republic.strategy.ts:149-166` (`boundedBase` con `floorMinWageMultiplier`); datos `payroll_statutory_contributions.floor_min_wage_multiplier = 1` para AFP y SFS (GET `/payroll/parameters` lo muestra).
- Qué: empleado «QA-NOM Bajo», salario 15.000: AFP empleado 666,50 (=23.223×2,87 %) en vez de 430,50; SFS 705,98 en vez de 456,00; descuentos 1.372,48 (9,15 % del salario). El volante y el archivo TSS reportan `tss_base`/`salarioCotizable` = 15.000 pero aportes calculados sobre 23.223 (incoherencia interna). SRL no tiene piso (incoherente con AFP/SFS). No encontré norma pública que traslade al trabajador el aporte sobre el mínimo (búsqueda en TSS/CNSS); el CNSS trata los salarios bajo el mínimo como irregularidad que requiere dispensa — **verificar con contador/abogado local**.
- Forma correcta: si la regla aplica, el exceso lo asume el empleador o se bloquea el alta con salario < mínimo sectorial salvo dispensa/tiempo parcial; reportar en TSS el salario cotizable efectivamente usado.
- Impacto: bloquea la venta (descuento indebido a trabajadores de menor ingreso / declaración incoherente). Esfuerzo: S.

**NOM-02 — Salario mínimo cotizable histórico erróneo (RD$10.000 de 2020-01-01 a 2026-01-31)** · eje 2/3
- Severidad: **Alta** · Ubicación: tabla `payroll_statutory_references` fila `MIN_WAGE_COTIZABLE 2020-01-01..2026-01-31 = 10000.00`; consagrado por `payroll/services/dominican-statutory-data.spec.ts:29`.
- Qué: valores reales 19.351,50 (02/2024), 21.674,80 (04/2025). Corrida «QA-NOM retro enero» 01/2026 (luego anulada): AFP empleado de «Tope» = 5.740 (tope 200.000) cuando correspondía ~12.441 (tope 433.496). Cualquier corrida o ajuste de un período anterior a 02/2026 calcula topes a menos de la mitad.
- Forma correcta: sembrar la serie histórica oficial por resolución TSS con fuente; prueba que la verifique.
- Impacto: riesgo operativo (retroactivos, migración de clientes con histórico). Esfuerzo: S.

**NOM-03 — Deducciones (y novedades) con monto negativo aumentan el neto sin pasar por ISR ni TSS** · eje 2/8
- Severidad: **Alta** · Ubicación: `payroll/dto/upsert-inputs.dto.ts:23-35` (`amount`, `rate`, `quantity` sin `@Min`); `payroll-calculation.service.ts:208-222`.
- Pasos: concepto `QAPRE` (DEDUCTION FIXED) → `PUT /payroll/runs/{nov}/inputs` con `amount:-20000` para «QA-NOM Exento» → calcular → `other_deductions = -20000`, neto 52.931,50 (vs 32.931,50). Un pago de 20.000 no gravado ni cotizado, contabilizado como débito a CxP.
- Forma correcta: montos ≥0 por tipo; los ingresos solo vía conceptos EARNING (que tributan); validación en servidor.
- Impacto: riesgo fiscal/fraude interno. Esfuerzo: S.

**NOM-04 — Carrera calcular↔aprobar: se reescriben los volantes de una corrida ya aprobada** · eje 2/7
- Severidad: **Alta** · Ubicación: `payroll-run.service.ts:283-302` (`findRun`/`assertEditable` fuera de la transacción, sin `FOR UPDATE`); `approve` (387-417) tampoco bloquea.
- Pasos: con step-up del aprobador, en paralelo `POST …/calculate` (qa-do-nom) y `POST …/approve` (qa-nom-approver) sobre la corrida 10/2026 → ambos **201**; estado final APPROVED con `calculated_at 13:48:29.531 > approved_at 13:48:29.527` y los volantes recreados (nuevos ids) tras la aprobación; el asiento se generó con los volantes anteriores. Aquí coinciden porque nada cambió; si entre medias cambia un salario o una novedad, el mayor y los volantes/TSS divergen sin aviso.
- Forma correcta: `SELECT … FOR UPDATE` de la corrida al inicio de toda transición, verificación de estado dentro de la transacción, versión optimista.
- Impacto: integridad contable/laboral. Esfuerzo: S.

**NOM-05 — La tasa de la novedad sobrescribe la del concepto sin el límite que el DTO de concepto sí impone** · eje 2/4
- Severidad: **Media-Alta** · Ubicación: `payroll-run.service.ts` `buildConceptInputs` (`rate: input.rate ?? concept.rate`); `create-concept.dto.ts:24-42` limita a 1 (porcentaje) y 10 (horas) solo en el concepto.
- Pasos: input `QACOM` rate 50 → comisión 3.000.000 sobre salario 60.000 (corrida 11/2026, total devengado RD$3.784.248,25 visible en UI).
- Forma correcta: misma regla de límite en novedades; alerta por variación anómala. Esfuerzo: S.

**NOM-06 — «SUIR — Autodeterminación TSS» no es el formato oficial y reporta salario cotizable sin tope** · eje 1/3
- Severidad: **Alta** · Ubicación: `payroll/services/payroll-tss.service.ts` `exportSuir`/`toSuirLine`.
- Qué: salida real (GET `/payroll/runs/{id}/tss/suir`): cabecera `#` y filas `NSS|Nombre|SalarioCotizable|…` separadas por `|`; sin RNC del empleador, cédula, tipo de documento, salario ISR, otros ingresos, aporte voluntario, ni registros de encabezado/sumario del layout de la TSS. «QA-NOM Tope» declara 500.000 de salario cotizable con aportes sobre 464.460/232.230. No se puede subir a SUIR. IR-3/IR-17/DGT: no existen (grep `IR-?3|IR-?17|DGT` en backend/frontend: solo un comentario y `fiscal-coverage.ts:86` que los declara no implementados).
- Forma correcta: implementar el layout oficial TSS (archivo de autodeterminación y novedades) y DGII IR-3 contra su especificación, con pruebas de oro. Esfuerzo: L.

**NOM-07 — INFOTEP del trabajador modelado sobre la regalía pascual** · eje 3 · Severidad: Media
- `payroll-calculation.service.ts:297-339`, `dominican-republic.strategy.ts:207-211`. El 0,5 % del trabajador corresponde a bonificaciones (participación en beneficios), no al salario de Navidad; hoy neutralizado con tasa 0 (`BONUS_EMPLOYEE_LEVY_RATE=0`), pero la bonificación no existe como tipo de corrida. Verificar con contador. Esfuerzo: M.

**NOM-08 — Regalía pascual por «meses tocados», no por salario devengado** · eje 2 · Severidad: Media
- `payroll-run.service.ts` `christmasBonusAmount`: «QA-NOM MedioMes» (ingreso 16/10, 50.000) → 12.500 (3 meses completos) vs 10.483,87 devengado real ((25.806,45+50.000+50.000)/12): +19 %. Tampoco considera aumentos de salario en el año ni el tope legal de 5 salarios mínimos del art. 219 (exigible vs pagado). Esfuerzo: M.

**NOM-09 — «Parámetros de empresa» (US/otros) que ningún cálculo usa** · eje 1/3 · Severidad: Media · Categoría: funcionalidad engañosa
- `company-payroll-parameters.service.ts` solo lo usa el controlador (grep `CompanyPayrollParametersService`); qa-us-a tiene `FEDERAL_INCOME_TAX_WITHHOLDING` etc. sembrados; la UI dice «Las tasas e importes con los que se calcula tu nómina…», pero en US no hay nómina (400). Forma correcta: ocultar o rotular «sin motor de cálculo». Esfuerzo: S.

**NOM-10 — Cuenta contable por concepto ignorada** · eje 4 · Severidad: Media · `payroll-concept.entity.ts:90` `accountId` vs `payroll-accounting.service.ts` (todas las deducciones y beneficios a `accountsPayable`). Esfuerzo: S.

**NOM-11 — Cálculo N+1 síncrono en una sola transacción** · eje 7 · Severidad: Media · `payroll-run.service.ts:302-376`. Esfuerzo: M.

**NOM-12 — Sin pruebas de integración del ciclo aprobar/pagar/asiento ni de concurrencia; prueba que consagra el dato erróneo** · eje 9 · Severidad: Alta · Esfuerzo: M.

**NOM-13 — Esquema de volante con columnas dominicanas** · eje 3/5 · Severidad: Media · `entities/payslip.entity.ts` (afp/sfs/srl/infotep), `payroll-accounting.service.ts` (cuentas AFP/SFS/INFOTEP); cada país nuevo exige migrar la tabla. Rehacer como líneas por régimen. Esfuerzo: L.

**NOM-14 — Moneda y textos literales en el motor** · eje 3/11 · Severidad: Baja · `payroll-run.service.ts:229` `currencyCode:'DOP'`; nombres de líneas en español en el motor (un volante en inglés sale en español). Esfuerzo: S.

## 7. Camino mínimo a producción (DO)

1. NOM-04 bloqueo pesimista en transiciones (S) — retocar.
2. NOM-03/NOM-05 validación de signo y límites en novedades (S) — retocar.
3. NOM-01/NOM-02 regla de piso validada con contador + serie histórica oficial (S) — retocar.
4. NOM-12 pruebas de integración del ciclo y de invariantes (M).
5. NOM-06 archivo oficial TSS + IR-3 (L) — rehacer el exportador.
6. NOM-08/NOM-07 regalía por devengado real; bonificación (M).
7. Vacaciones y archivo de pago bancario (L).
Total: L/XL. Solo para DO. Resto de mercados: NOM-13 + un motor por país (XL cada grupo).

## 8. Camino a 100

| Ítem | +pts | Esfuerzo | Tipo |
|---|---|---|---|
| Formatos oficiales DO (SUIR, IR-3, IR-13, DGT-3/4) | +10 | L | rehacer exportador |
| Bloqueos/validaciones (NOM-03/04/05) + pruebas | +8 | S-M | retocar |
| Corrección normativa (NOM-01/02/07/08) | +6 | S-M | retocar |
| Vacaciones, bonificación, quincenal, préstamos | +8 | L | nuevo |
| Volante genérico por líneas (NOM-13) + 2.º país (MX o CO) | +12 | XL | rehacer modelo |
| Dispersión bancaria, portal del empleado con descarga PDF | +5 | M | nuevo |
| Rendimiento por lotes (NOM-11) | +3 | M | retocar |

## 9. Competitividad

Básicas faltantes (bloquean venta en DO): archivo SUIR válido, IR-3, vacaciones, bonificación, dispersión bancaria. Avanzadas faltantes: multi-país, simulación, préstamos con amortización, embargos, PDF de volante. Diferenciadores reales: parámetros versionados con instantánea por corrida, SoD + step-up en aprobación, asiento idempotente integrado al mayor. Fuentes: blog Alegra RD (media), TSS/DGII (alta) citadas en §2.

## 10. Fortalezas a preservar

Motor de cálculo puro y estrategia por país; cálculo DO exacto al centavo en el caso general (incluye topes y prorrateo con gross-up de ISR); tablas de ley con vigencia y snapshot; negativa explícita en países no soportados (no cae en reglas DO); SoD y step-up de un solo uso; asiento cuadrado e idempotente; aislamiento entre tenants verificado.

## 11. No verificado

Interpretación legal del piso (NOM-01) y de INFOTEP sobre bonificación — verificar con contador; prestaciones (`severance/preview`) no recalculadas a mano; UI en tenants no-DO y móvil; rendimiento con >100 empleados; RLS (el entorno corre como superusuario). Baja la confianza del eje 2 y 3 a media.
