# M25 — Nómina (`payroll`) — Familia F9

> **CRÍTICOS DESTACADOS**
> - **NOM-01 (cálculo laboral incorrecto):** el salario mínimo cotizable sembrado es **RD$10.000 desde 2020** (`payroll_statutory_references`, MIN_WAGE_COTIZABLE). Los topes salen de él: SFS 100.000, AFP 200.000, SRL 40.000, cuando los vigentes (fuentes secundarias, feb-2026) son unos 232.230, 464.460 y 92.892 sobre una base de RD$23.223. En cualquier salario por encima de 100.000 se retiene menos SFS, se calcula de más el ISR y el aporte patronal SFS/SRL sale por debajo. Lo demostré por API (abajo).
> - **NOM-02 (cumplimiento cruzado entre países):** un tenant **MX/CO/US** puede crear y **calcular** una corrida con `countryCode:"DO"`. Le aplica las tasas TSS, el ISR de la DGII y la moneda DOP. Se probó con qa-mx: la corrida quedó CALCULATED, DO, DOP.
> - **NOM-03 (cálculo laboral dudoso):** en la regalía pascual se retiene **1 %** de "INFOTEP empleado" (`BONUS_EMPLOYEE_LEVY_RATE=0.01`), pero la etiqueta del recibo dice "0.5% sobre regalía". El 0,5 % de la Ley 116-80 grava bonificaciones/utilidades y es dudoso que aplique a la regalía. Tampoco se aplica el tope de la regalía (Art. 219 CT, 5 salarios mínimos). **Verificar con contador local.**
> - No encontré fuga entre tenants (IDOR) en nómina ni en HCM.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/payroll` (≈35 archivos, ~4.900 LOC) y `jurisdictions/` (6 archivos, 585 LOC). Hay 33 endpoints en `payroll.controller.ts`.
- **Tablas**: payroll_runs, payslips, payslip_lines, payroll_concepts, payroll_inputs, payroll_statutory_contributions, payroll_income_tax_brackets, payroll_statutory_references, payroll_company_parameters.
- **Frontend**: `features/payroll/{runs,concepts,parameters,my-payslips}`.
- **Pruebas**: 6 specs de payroll y 1 de la estrategia DO, todas unitarias y puras.
- **Países**: solo DO tiene motor (`jurisdiction-registry.ts:19`, que registra únicamente `DominicanRepublicStrategy`). Los otros 18 declarados no tienen motor.
- **Dependencias**: hcm (empleados y compensación), journal-entries (`AccountingPostingPort`), accounting (`LedgerLookupService`), bank_accounts por SQL directo.
- **¿Núcleo para vender?** Sí, en DO. Fuera de DO es un módulo inexistente.

## 2. Estándar de referencia (Paso 3)
- **Básicas**: maestro de conceptos; tasas, topes y escalas versionados por vigencia; corrida mensual o quincenal; recibos; cierre inmutable con ajustes; asiento contable y pago; reportes oficiales del país (DO: TSS/SUIR Autodeterminación y Novedades, IR-3, IR-13; MX: CFDI de nómina, IMSS/SUA/IDSE, ISR art. 96; CO: PILA y nómina electrónica DIAN); regalía o aguinaldo; vacaciones; liquidación; horas extra; préstamos y embargos.
- **Avanzadas**: autoservicio del empleado, simulación, retroactivos, multi-frecuencia real, ausencias integradas, dispersión bancaria.
- **Invariantes**: tasas fechadas, aplicadas por la fecha del período e inmutables una vez usadas; separación empleado/empleador; topes por régimen; histórico inmutable; idempotencia del asiento; ningún país cae en las reglas de otro.
- **Líderes**:
  - ADP, Workday, Gusto/Rippling (US): motor fiscal federal y estatal mantenido por el proveedor.
  - CONTPAQi Nóminas y Nominax (MX): timbrado CFDI 4.0 de nómina, IMSS.
  - Siigo y Alegra Nómina (CO): nómina electrónica DIAN y PILA.
  - Buk y Runa: multipaís LatAm.
  - En DO hay soluciones locales que generan los archivos SUIR.
  - Confianza media: es conocimiento de mercado, no verificado con fuentes en esta sesión.

## 3. Resultado
- **Madurez 30** (25–38, confianza media-alta) · **Preparación comercial 25 · NO LISTO**.
- Eje más débil: Multi-país (3) y, dentro de DO, Corrección (2).
- Críticos abiertos: 3 (NOM-01, NOM-02, NOM-03). Altos: 6.
- La madurez (30) queda por debajo del promedio de los ejes (~50) porque el tope ≤ min(eje1, eje2, eje8) y los críticos abiertos la limitan. La arquitectura y el código son bastante mejores que el resultado legal.

**Por país**
- **DO: 35, No listo.** Hay motor, pero los topes son incorrectos y faltan IR-3/IR-13, vacaciones y préstamos.
- **MX, CO, US y los 15 restantes: 5, No soportado.** La corrida se rechaza con un error claro (`payroll.payroll_jurisdiction_p1_not_supported`), lo que está bien. Pero se puede forzar con DO (NOM-02). En US además se siembran parámetros FICA/FUTA que ningún motor usa (NOM-07).

## 4. Doce ejes
| Eje | Nota | Evidencia | Falta para 100 |
|---|---|---|---|
| 1 Autenticidad y completitud | 42 (35–50, alta) | Motor real, sin mocks: corrida, recibo, asiento y TSS (`payroll-tss.service.ts`). Faltan IR-3/IR-13, vacaciones como proceso, préstamos y embargos, quincenal real. | Reportes DGII, vacaciones, préstamos, frecuencias reales |
| 2 Corrección e integridad | 30 (25–40, alta) | Topes mal (NOM-01), INFOTEP en regalía (NOM-03) y regalía aproximada con el salario actual (`payroll-run.service.ts:706-716`). Lo bueno: transacción en el cálculo, inmutabilidad tras aprobar, ajustes por diferencia, segregación de funciones. | Datos estatutarios correctos y vigilados; regalía con lo devengado real |
| 3 Multi-país | 10 (5–15, alta) | Una sola estrategia. Moneda `'DOP'` fija en `payroll-run.service.ts:196`, `default 'DOP'` en entidades y `?? 'DOP'` en `parameters-admin:93` (coincide con F3). Corrida DO forzable desde MX (NOM-02). | Validar país = país del tenant; motor MX/CO/US o declarar "no soportado" en UI |
| 4 Arquitectura | 68 (60–74, media) | Strategy por país con cálculo puro y parámetros versionados con snapshot (`run.parameterSnapshot`). Puerto contable. | Tablas estatutarias con fuente/vigilancia; motor de reglas por concepto |
| 5 Higiene | 60 (52–66, media) | `jurisdictions` es un módulo hoja. La nómina lee `bank_accounts`/`accounts`/`organization_settings` por SQL directo (`payroll-run.service.ts:437-462`). Vocabulario TSS en el modelo neutral (`employeeTssNss`). | Puerto de tesorería; nombres neutrales |
| 6 Calidad de código | 70 (62–76, media) | Tipado, i18n de errores, redondeo central (`common/money.ts:77-84`). Etiquetas en español fijas en el backend (`payroll-calculation.service.ts:137,195,317,329`). | Etiquetas i18n; quitar la cadena "0.5%" contradictoria |
| 7 Robustez y rendimiento | 50 (42–58, media) | N+1: `compensationFor` por empleado dentro del bucle (`:290`). Cálculo síncrono en la request. `approve` sin bloqueo FOR UPDATE (lo amortigua la idempotencia del asiento). | Carga en lote y job en cola para plantillas grandes |
| 8 Seguridad y aislamiento | 58 (50–66, alta) | IDOR desde qa-a contra empleado y corrida de qa-b: 404 en run, payslips, calculate, severance, TSS. `GET runs/:id/inputs` responde 200 `[]` con id ajeno (sin fuga, pero no valida pertenencia). Step-up en aprobar, pagar y ver datos. Tablas estatutarias solo para plataforma. Restan puntos NOM-02 y NOM-01. | 404 uniforme; validar país; pruebas de autorización por rol |
| 9 Pruebas | 40 (32–48, alta) | Specs puras de cálculo y DO con tasas inventadas en el test: no detectarían NOM-01 ni NOM-03. Sin integración de corrida → aprobación → asiento con BD. | Golden tests con recibos reales validados por un contador; prueba de datos sembrados contra vigencia |
| 10 Operabilidad | 50 (40–58, baja) | `AuditAccessInterceptor`, logs y FinancialAuditSubscriber en compensación. Sin alertas de parámetros vencidos. | Alerta "parámetro sin revisar > N meses" |
| 11 UX | 50 (40–60, baja) | No verificada por UI en esta pasada. Las pantallas existen. | Verificación E2E |
| 12 Competitividad | 25 (20–35, media) | Frente a soluciones locales DO falta el IR-3 y los topes están mal. En MX/CO/US no compite. | Ver §9 |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, con capacidades básicas | **No cumple** | Faltan IR-3/IR-13, vacaciones y préstamos. Los parámetros US son decorativos (NOM-07) |
| 2 | Integridad en escrituras | Cumple con reservas | Transacciones en calculate/approve/pay, asiento idempotente, inmutabilidad |
| 3 | Autorización y aislamiento | Cumple (parcial) | IDOR negativo en 10 endpoints. `inputs` responde 200 vacío |
| 4 | Validación en servidor | Cumple con reservas | DTOs con class-validator. Falta validar `countryCode` contra el tenant |
| 5 | E2E sin 500 | Cumple (API) | Ninguna respuesta 500 en las pruebas. UI no verificada |
| 6 | Cumplimiento por país | **No cumple** | NOM-01, NOM-02, NOM-03 |
| 7 | Pruebas en CI | No cumple | No detectan los errores legales |
| 8 | Auditoría de negocio | Cumple | Interceptor y subscriber financiero; aprobación con segregación (confirmado en el flujo cruzado) |
| 9 | Migraciones | Cumple | Sin deriva (Paso 2) |
| 10 | Observabilidad | Parcial | Logs, sin métricas |
| 11 | UI | No verificado | — |
| 12 | Documentación | Parcial | Comentarios extensos, sin manual de parametrización |

## 6. Hallazgos

**NOM-01 · Corrección / multi-país · Crítica · bug de datos legales**
- **Ubicación**: tabla `payroll_statutory_references` (MIN_WAGE_COTIZABLE=10000.00, vigente desde 2020-01-01, sin fin) y el seed en las migraciones.
- **Prueba por API (qa-b)**: empleado QA-F9 Alto150k, salario 150.000/mes, corrida 08/2026 (id cb87d4fd…).
- **Resultado del sistema**: AFP 4.305 (base 150.000); SFS 3.040 (base **100.000**); SRL patronal 440 (base **40.000**); INFOTEP 1.500; ISR 24.246,69; neto 118.408,31; patronal 19.680.
- **Recálculo a mano con la base de RD$23.223** (topes SFS 232.230, AFP 464.460, SRL 92.892; tasas 2,87/3,04 empleado y 7,10/7,09/1,10/1,0 empleador):

  | Concepto | Correcto | Sistema | Diferencia |
  |---|---|---|---|
  | SFS empleado | 4.560,00 | 3.040,00 | −1.520 |
  | Base ISR | 150.000 − 4.305 − 4.560 = 141.135 | 142.655 | |
  | Renta anual | 1.693.620 | | |
  | ISR anual | 79.776 + 25 % × (1.693.620 − 867.123,01) = 286.400,25 | | |
  | ISR mensual | 23.866,69 | 24.246,69 | +380 |
  | Neto | 117.268,31 | 118.408,31 | +1.140 |
  | SFS patronal | 10.635 | 7.090 | |
  | SRL patronal | 1.021,81 | 440 | |
  | Total patronal | 23.806,81 | 19.680 | −4.126,81 al mes por empleado |

- Con salarios por debajo de 100.000 el cálculo cuadra. El flujo cruzado confirmó octubre DO: deducciones 3.943,76 y aportes patronales 7.378,62, ambos cuadran a mano. Por eso las pruebas no lo detectan.
- **Forma correcta**: cargar la serie histórica oficial de salarios mínimos cotizables de la TSS (resoluciones anuales), con alerta cuando la vigencia tenga más de 12 meses, y un golden test con un caso por encima del tope. **Verificar cifras con contador local y con la resolución TSS vigente**: no pude abrir tss.gob.do desde el entorno.
- **Impacto**: bloquea la venta. Declaraciones TSS incorrectas, recargos y deuda del empleador.
- **Esfuerzo**: S (datos) + S (prueba).

**NOM-02 · Multi-país / seguridad lógica · Crítica**
- **Ubicación**: `payroll-run.service.ts:147-151` toma `input.countryCode` del cliente y solo comprueba que haya estrategia.
- **Prueba**: qa-mx con `POST /payroll/runs {"countryCode":"DO",...}` → 201, y luego `calculate` → CALCULATED, countryCode DO, currencyCode DOP. Igual en qa-co y qa-us. Las corridas QA se cancelaron después.
- **Forma correcta**: ignorar o rechazar `countryCode` distinto de `TenantCountryResolver`, salvo entidades legales multi-país declaradas.
- **Impacto**: un cliente fuera de DO puede emitir recibos con ley dominicana.
- **Esfuerzo**: S.

**NOM-03 · Corrección · Crítica (pendiente de confirmación legal)**
- **Ubicación**: `dominican-republic.strategy.ts:204-208`, `payroll-calculation.service.ts:329` (etiqueta "0.5%") y la referencia BONUS_EMPLOYEE_LEVY_RATE=0.01.
- **Prueba**: regalía 12/2026 sobre 150.000 → retención 1.500 (1 %), neto 148.500.
- **Qué está mal**: la tasa contradice su propia etiqueta. Además, la base legal del 0,5 % (Ley 116-80, bonificaciones) probablemente no alcanza a la regalía, que la ley declara exenta. Tampoco se aplica el límite de 5 salarios mínimos (Art. 219 CT).
- **Forma correcta**: quitar la retención en la regalía, o dejarla en 0,5 % solo sobre bonificaciones; aplicar el tope de la regalía y gravar el excedente según el Código Tributario. **Verificar con contador/abogado local.**
- **Esfuerzo**: S.

**NOM-04 · Completitud · Alta**
- Faltan **IR-3, IR-13 y el TSS en formato de archivo validado**. Busqué `IR-3|IR3|IR-13|IR13` en payroll/hcm y no hay resultados.
- `payroll-tss.service.ts` genera Novedades, Autodeterminación y SUIR. El formato no se validó contra el layout oficial, y no lo envié por riesgo de efecto externo.
- **Esfuerzo**: M.

**NOM-05 · Corrección · Alta**
- La regalía se aproxima como salario vigente × meses / 12 (`payroll-run.service.ts:706-716`). Así infla el monto si hubo aumentos e ignora la variable ordinaria y los meses parciales.
- **Forma correcta**: sumar lo devengado ordinario del año desde los payslips.
- **Esfuerzo**: M.

**NOM-06 · Funcional · Alta**
- La frecuencia semanal o quincenal solo se convierte a mensual (`toMonthly`, `:726-736`). No hay corridas quincenales, que son la norma en DO.
- Las horas extra usan un multiplicador libre (`payroll-calculation.service.ts:451-456`). Los recargos legales del 35 %/100 % (Art. 203 CT) quedan a merced de la configuración.
- No hay vacaciones como proceso (solo en la liquidación, `severance.service.ts`), ni préstamos, ni embargos.
- **Esfuerzo**: L.

**NOM-07 · Funcionalidad engañosa · Alta**
- Los parámetros de US (FICA 6,2 % con wage base 184.500, Medicare, FUTA) se siembran en `payroll_company_parameters` y se pueden editar. Pero ningún código los consume: busqué `CompanyPayrollParameter` y solo aparece en su propio servicio y en el módulo. Las corridas US se rechazan.
- MX y CO no reciben nada, y `GET /payroll/parameters` responde 400.
- Esto da una apariencia de soporte que no existe.
- **Forma correcta**: marcar "nómina no disponible en su país" en el manifiesto y en el menú.
- **Esfuerzo**: S.

**NOM-08 · Pruebas · Alta**
- Las specs usan tasas inventadas. Ninguna prueba valida los datos sembrados contra su vigencia, ni cubre el ciclo completo con BD.
- **Esfuerzo**: M.

**NOM-09 · Robustez · Media**
- N+1 en `compensationFor` dentro del bucle de cálculo, y cálculo síncrono en la request.
- **Esfuerzo**: M.

**NOM-10 · Multi-país / higiene · Media**
- `currencyCode: 'DOP'` fijo (`payroll-run.service.ts:196`); `default 'DOP'` en `payroll-run.entity.ts:114`, `payslip.entity.ts:130`, `statutory-reference.entity.ts:60` y `employee-compensation.entity.ts:56`; `?? 'DOP'` en `payroll-parameters-admin.service.ts:93`. Coincide con F3.
- **Esfuerzo**: S.

**NOM-11 · Seguridad · Baja**
- `GET payroll/runs/:id/inputs` con id de otro tenant responde 200 `[]` en vez de 404 (`payroll-input.service.ts:30-33`).
- **Esfuerzo**: S.

**NOM-12 · Contabilidad (transversal) · Media**
- El asiento usa cuentas de `OrganizationSettings` sobre un plan de cuentas dominicano igual en todos los países (COA-03, F-contabilidad).
- `postPayment` no se pudo probar: la aprobación exige otro usuario, como confirmó el flujo cruzado.

## 7. Camino mínimo a producción (solo DO)
1. Corregir los datos TSS con su serie histórica y añadir un golden test por encima del tope (NOM-01). S.
2. Bloquear la corrida en un país distinto al del tenant (NOM-02). S.
3. Resolver la retención en la regalía y su tope, con un contador (NOM-03). S.
4. Generar IR-3/IR-13 y validar el layout SUIR (NOM-04). M.
5. Regalía con lo devengado real (NOM-05). M.
6. Ocultar nómina en países sin motor (NOM-07). S.
7. Prueba de integración corrida → aprobación → pago → asiento en CI (NOM-08). M.

Total: L para DO. Fuera de DO hay que construir motores nuevos: XL por país (MX CFDI de nómina + IMSS; CO nómina electrónica + PILA; US federal y estatal).

## 8. Camino a 100
1. NOM-01/02/03: +20 a corrección y multi-país. S.
2. Reportes DGII y SUIR validados: +10. M.
3. Quincenal, vacaciones, préstamos y embargos: +10. L.
4. Golden tests e integración: +8. M.
5. Ejecución en cola y carga en lote: +4. M.
6. Motores MX/CO/US con timbrado y reportes oficiales: +25 cuando haya cobertura multipaís. XL. Se retoca sobre la Strategy existente, sin rehacer.

## 9. Competitividad
- **Brechas básicas**: IR-3/IR-13, quincenal, préstamos, vacaciones, dispersión bancaria. Fuera de DO no hay nada, mientras CONTPAQi, Siigo, Alegra, Gusto y ADP lo cubren de serie.
- **Diferenciadores existentes**: inmutabilidad con corridas de ajuste por diferencia, segregación de funciones, snapshot de parámetros, step-up, asiento automático idempotente.
- **Nota**: 25 (20–35, confianza media).

## 10. Fortalezas a preservar
- Strategy pura por país.
- Tablas estatutarias versionadas por vigencia y editables solo por la plataforma.
- `parameterSnapshot` por corrida.
- Corridas de ajuste que solo contabilizan el delta.
- Segregación calcular ≠ aprobar.
- Prorrateo por días reales, ISR con gross-up en meses parciales y piso del base solo en mes completo.
- My-payslips: lo resuelve el servidor por `user.id`, sin parámetro de id, y solo muestra corridas aprobadas (`payroll-run.service.ts:525-549`). qa-a sin empleado vinculado recibe `[]`. No es explotable por IDOR.

## 11. No verificado
- UI de nómina (Playwright).
- Pago y asiento de pago.
- Layout de los archivos TSS.
- Liquidación (`severance.service.ts`, divisor 23,83) en profundidad.
- Cifras oficiales TSS 2026: no pude acceder a tss.gob.do ni a presidencia.gob.do desde el entorno. Las fuentes fueron acento.com.do, g-talent y siemprealdia (base 23.223, topes 92.892/232.230/464.460). La escala ISR 2017 (416.220 / 624.329 / 867.123; 31.216; 79.776) coincide con el aviso DGII 70-18 y sigue vigente según fuentes secundarias. **Verificar con contador local.**

**Cobertura**: ~55 % de los archivos backend leídos (servicios centrales completos); 12 de 33 endpoints ejecutados; 0 % de la UI.

<!-- RESUMEN: modulo=nomina; madurez=30; prep=25; veredicto=No listo; eje_debil=multi-pais/correccion; criticos=3; altos=5; camino_min=L -->
