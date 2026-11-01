# Ficha M07 — Activos fijos (`fixed-assets`)

Auditor: F4. 2026-10-31/11-01. Tenant qa-mx.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/fixed-assets` (13 .ts, 2 specs —`depreciation-schedule.spec.ts`, `fixed-asset-register.spec.ts`—, ~1.700 LOC, 9 endpoints: CRUD, calendario, preview/corrida de depreciación, baja/venta). Tablas `fixed_assets`, `fixed_asset_depreciations` (única por activo+mes). Numeración `AF-AAAA-NNNNNN` con el contador común.
- **Frontend**: `features/accounting/fixed-assets` (5 .ts).
- **Países**: genérico; sin reglas fiscales por país.
- **¿Núcleo?** Básico para pymes con activos; no bloqueante para la primera venta.

## 2. Estándar de referencia
- **Básicas**: registro con cuentas, métodos (línea recta, saldo decreciente, suma de dígitos, unidades), vida útil, valor residual, depreciación mensual contabilizada e idempotente por período, baja/venta con ganancia/pérdida, revalorización/deterioro, reportes de registro.
- **Avanzadas**: libro contable vs fiscal (tasas máximas por país: MX LISR art. 34; CO Estatuto Tributario art. 137; etc.), prorrateo por fecha de alta, cambio de estimaciones, componentes, traslados entre sucursales, adquisición desde factura de proveedor.
- **Líderes** (confianza media): D365/BC tienen "depreciation books" múltiples (contable/fiscal); NetSuite Fixed Assets Management con múltiples libros; Odoo una tabla por modelo de activo; CONTPAQi/Siigo con depreciación fiscal local.

## 3. Resultado
- **Madurez: 48** (40–56, confianza media). **Preparación: 45 — No listo** (la baja/venta falla en un tenant recién creado; sin libro fiscal).
- **Eje más débil**: 3 Multi-país. **Críticos**: 0. **Altos**: 2.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | Autenticidad | 55 (45–62, media) | Alta, calendario, corrida y baja reales; la baja exige el diario `ACT-FIJOS`, que no se siembra | Sembrar diario; adquisición desde factura (no verificado) |
| 2 | Corrección | 62 (55–70, alta) | Rehecho a mano: LR 12.000/12 = 1.000; DDB 10.000×2/60 = 333,33 y (10.000−333,33)×2/60 = 322,22; baja: 11.500 − (12.000 − 1.000) = ganancia 500 → `ACT-FIJOS-2026-000001` D1110 11.500 / D1220 1.000 / C1210 12.000 / C4900 500 | Prorrateo; cambio a LR en DDB; IVA en venta |
| 3 | Multi-país | 25 (15–35, media) | Un solo libro; grep `fiscal|tax|country` en fixed-assets → nada de dominio | Libro fiscal con tasas por país (verificar con contador) |
| 4 | Arquitectura | 62 (55–70, media) | `DepreciationPort`, cálculo puro en `depreciation-schedule.ts`, contabiliza vía puerto | — |
| 5 | Higiene | 60 (50–68, media) | Depende solo del puerto contable y de journals | — |
| 6 | Calidad | 62 (55–70, media) | Código claro; cálculo testeable | — |
| 7 | Robustez | 65 (55–72, media) | `pg_advisory_xact_lock` por tenant (`depreciation.service.ts:300`); `pessimistic_write` en la baja | — |
| 8 | Seguridad | 68 (60–75, media) | GET de activo de qa-mx desde qa-b → 404 | Probar PATCH/dispose cruzados |
| 9 | Pruebas | 50 (40–58, media) | 2 specs unitarios del cálculo y del registro | Integración con BD de corrida y baja |
| 10 | Operabilidad | 50 (40–58, baja) | Mensaje `fixed_assets_journal_act_fijos_not` poco accionable | — |
| 11 | UX | N/V 50 | — | — |
| 12 | Competitividad | 40 (30–50, media) | Sin libro fiscal ni deterioro | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Básicas | **No cumple** | Baja/venta 400 en tenant nuevo |
| 2 | Integridad | Cumple | Corrida idempotente: segunda corrida de nov. (otra Idempotency-Key) → total 0, sin asiento |
| 3 | Aislamiento | Cumple (GET probado) | 404 |
| 4 | Validación | Cumple | Baja anterior a la última depreciación o a la adquisición → rechazada (código) |
| 6 | País | **No cumple** | Sin vida útil/tasa fiscal por país |
| 7 | Pruebas CI | Parcial | Solo unitarios |

## 6. Hallazgos
**FA-01** · Funcionalidad · **Alta** · `fixed-assets.service.ts:334` busca el diario `ACT-FIJOS`, que la siembra no crea (los diarios sembrados son BANCOS, CAJA, CIERRE, COBROS, COMPRAS, CONCIL, DEPREC, GENERAL, NOMINA, PAGOS y VENTAS). `POST /fixed-assets/:id/dispose` → 400. Tras crear el diario a mano funciona. Esfuerzo S.

**FA-02** · Multi-país · **Alta** · Sin libro fiscal ni tasas máximas por país; la depreciación contable es la única. Verificar con contador local (MX, CO, PE). Esfuerzo L.

**FA-03** · Corrección · **Media** · Sin prorrateo: un activo dado de alta el 15-nov se deprecia el mes completo (`firstChargeableMonth` = fin del mes de alta). En MX la depreciación fiscal empieza el mes siguiente al inicio de uso (verificar con contador). Esfuerzo S.

**FA-04** · Corrección/fiscal · **Media** · La venta del activo no genera IVA trasladado (líneas solo de caja/AD/activo/ganancia). Esfuerzo M (integrar con impuestos).

**FA-05** · Corrección · **Baja** · DDB no cambia a línea recta (el último mes absorbe el remanente); SYD con vida no múltiplo de 12 usa `ceil(life/12)` años. Aceptable, pero no configurable.

**FA-06** · Idempotencia · **Media** · La corrida y la baja contabilizan sin `idempotencyKey` (ver GL-09); la idempotencia se apoya en `depreciatedThrough` + fila única + lock consultivo, que funcionó en la prueba.

## 7. Camino mínimo
FA-01 (S) → FA-03 (S) → FA-04 (M) → FA-02 en los países objetivo (L).

## 8. Camino a 100
Libros múltiples (+20) → deterioro/revaluación (+8) → adquisición desde CxP y traslados (+8) → tests de integración (+5).

## 9. Competitividad
Por debajo de D365/NetSuite (multi-libro) y de los locales con depreciación fiscal; a la par de Xero en lo básico.

## 10. Fortalezas
Cálculo puro y correcto a mano; idempotencia robusta (lock consultivo + fila única por mes); la baja deprecia hasta el mes anterior antes de calcular el resultado.

## 11. No verificado
UI; PATCH/DELETE; activos con saldos iniciales (`openingAccumulatedDepreciation`); adquisición desde factura de proveedor. Cobertura ~55 % de archivos y 6/9 endpoints.

<!-- RESUMEN: modulo=activos-fijos; madurez=48; prep=45; veredicto=No listo; eje_debil=3 Multi-país; criticos=0; altos=2; camino_min=M -->
