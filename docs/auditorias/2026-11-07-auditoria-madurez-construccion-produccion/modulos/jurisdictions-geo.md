# Ficha — `jurisdictions` + `geo`

Familia LOC · 2026-11-07

## 1. Identificación
- **`jurisdictions/`**: 6 archivos, unas 560 líneas. Contiene `JurisdictionRegistry`, `PayrollJurisdictionStrategy`, la estrategia DO (212 líneas) y los enums `ContributionRegime`. No expone endpoints ni tiene tablas propias: las tasas versionadas viven en `payroll_statutory_contributions`, `payroll_income_tax_brackets` y `payroll_statutory_references`, todas con `effective_from/to`. Lo consumen `payroll-run.service.ts:101` y `hcm.service.ts:48`.
- **`geo/`**: 3 archivos, 156 líneas. Expone `GET /geo/location` (`@Public`), resuelve la IP con `geoip-lite` y calcula distancias para la detección de viaje imposible.
- **Divisiones administrativas**: no están aquí. Viven en `country-profiles.ts` (DIVISIONS por país, como constantes de código) y se resuelven con `divisionName()`.
- **Países**: solo DO tiene estrategia de nómina.
- **¿Es núcleo para vender?** Sí, para nómina.

## 2. Estándar de referencia
- (a) **Básico**: motor de nómina por país, con tasas y topes versionados por vigencia, y conceptos estatutarios del país (DO: AFP/SFS/SRL/INFOTEP/ISR; MX: IMSS/INFONAVIT/ISR; CO: EPS/AFP/ARL/parafiscales). Las divisiones administrativas deben venir de un catálogo oficial y versionado (INEGI, DANE, IBGE, ONE).
- (b) **Invariantes**: un país sin reglas se rechaza; la interfaz no asume las instituciones de un país concreto.
- (c) **Líderes**: SAP HCM y Dynamics usan «country versions» con esquemas propios (confianza media). Odoo usa `l10n_xx_hr_payroll` por país (confianza alta).
- (d) **Construcción**: una interfaz neutra (conceptos, bases, contribuciones como lista) y una implementación por país.

## 3. Resultado
- **Madurez: 40 (32–48, confianza media).**
- **Preparación comercial: 35.**
- **Veredicto: No listo** fuera de DO. Para DO, ver la ficha de nómina (NOM).
- **Eje más débil**: 3 (multi-país).
- **Críticos**: 0.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Completitud | 35 (28–42, media) | `jurisdiction-registry.ts:19`: registra únicamente `DominicanRepublicStrategy`. En otro país lanza `payroll.payroll_jurisdiction_p1_not_supported`. | Estrategias MX, CO, US… |
| 2 | Corrección | 60 (50–68, baja) | Las tasas están versionadas en BD (bien). El cálculo DO lo evalúa NOM, no esta ficha. | — |
| 3 | Multi-país | 25 (18–32, media) | La interfaz «genérica» está hecha a la medida de DO: `StatutoryResult` tiene `afpEmployee`, `sfsEmployee`, `srlEmployer` e `infotepEmployer` (`jurisdiction-strategy.interface.ts` ~l.95-104); `ContributionRegime` solo admite AFP, SFS, SRL e INFOTEP (`contribution-regime.ts:13-22`); `BonusResult.infotepEmployee` y `ResolvedParameters.minWageCotizable` también son conceptos DO. Un segundo país no puede implementar la interfaz sin cambiarla. | Contribuciones como lista con código abierto y regímenes por país en datos. |
| 4 | Arquitectura | 55 (48–62, media) | El módulo hoja que rompe el ciclo con payroll está bien planteado. El registro se rellena en el constructor y no admite inyección por país. | Registro con multi-provider. |
| 5 | Higiene | 50 (42–58, baja) | Hay vocabulario dominicano en un módulo que se llama «jurisdictions». Las divisiones administrativas están en `localization`, no aquí. | Mover las divisiones a un catálogo de datos. |
| 6 | Calidad | 60 (52–68, baja) | El código es pequeño y tipado. | — |
| 7 | Robustez | 55 (45–62, baja) | `geoip-lite` es una base local sin actualizar (no verifiqué la fecha). | Actualización de la base GeoIP. |
| 8 | Seguridad | 45 (38–55, media) | `geo.controller.ts:14` lee `x-forwarded-for` directamente de la cabecera, sin `TRUST_PROXY`, así que cualquiera puede falsear su ubicación. Ese dato alimenta las sesiones y el viaje imposible (GEO-01). El endpoint es público y devuelve la IP del cliente, lo cual es aceptable. | Usar `request.ip` con proxies de confianza. |
| 9 | Pruebas | 50 (40–58, baja) | Existe `dominican-republic.strategy.spec.ts`. Geo no tiene spec (lo busqué con `find geo -name '*.spec.ts'`: vacío). | Specs de geo y de otros países. |
| 10 | Operabilidad | 50 (40–55, baja) | Hay un log debug de la búsqueda geográfica que incluye la IP. | — |
| 11 | UX | N/A | Sin UI propia. | — |
| 12 | Competitividad | 25 (18–35, media) | Nómina en un solo país, frente a Odoo, Siigo y CONTPAQi Nóminas, que cubren varios países o su país local con profundidad. | — |

Promedio ≈ 47. La madurez (40) queda por debajo porque el eje 3 bloquea la extensión a cualquier otro país.

## 5. Compuertas
| # | Compuerta | Estado |
|---|---|---|
| 1 | Capacidades básicas | No cumple (solo DO) |
| 2 | Integridad | N/A aquí (la evalúa NOM) |
| 3 | AuthZ | N/A (sin endpoints de escritura) |
| 4 | Validación | Cumple (rechaza un país no soportado) |
| 6 | Cumplimiento por país | No cumple (18 países sin nómina; se declara con un error, no en la cobertura) |
| 7 | Pruebas | Parcial |
| 8 | Auditoría | N/A |
| 9 | Migraciones | Cumple |
| 10 | Observabilidad | Parcial |
| 11 | UI | N/A |
| 12 | Documentación | Parcial |

## 6. Hallazgos
- **JUR-01** · jurisdictions/payroll · eje 3 · arquitectura/multi-país · **Alta**. La interfaz de estrategia está modelada sobre la TSS dominicana (campos `afp*`, `sfs*`, `srl*`, `infotep*`; enum de 4 regímenes DO). Un segundo país obliga a reescribir la interfaz, el cálculo y el snapshot. Forma correcta: `contributions: ContributionResult[]` con `code` libre más un catálogo de conceptos por país. Esfuerzo L, y hay que rehacer la interfaz, no retocarla.
- **JUR-02** · payroll/fiscal-coverage · eje 3 · documentación/producto · **Media**. `fiscal-coverage.ts` no declara la capacidad «payroll», así que la falta de nómina fuera de DO no aparece en la divulgación previa al pago. Solo se descubre con el error al ejecutar una nómina. Esfuerzo S.
- **GEO-01** · geo · eje 8 · seguridad · **Media**. `x-forwarded-for` es controlable por el cliente (`geo.controller.ts:14-19`). Sirve para falsear la ubicación de la sesión y evadir el viaje imposible. Forma correcta: `request.ip` de Fastify con `trustProxy` configurado. Esfuerzo S.
- **GEO-02** · localization · eje 3 · datos · **Baja**. Las divisiones administrativas de los 19 países son constantes de código sin versión ni fuente citada. Verifiqué que están en `country-profiles.ts` (MX en las l.244-259). Esfuerzo M.

## 7. Camino mínimo
1. JUR-02: declarar la nómina en la cobertura (S).
2. GEO-01 (S).
3. JUR-01: rediseñar la interfaz antes del segundo país (L).

## 8. Camino a 100
- JUR-01: +15.
- Estrategias MX y CO: +20 cada una (XL).
- GEO-01: +5.
- Catálogo de divisiones en datos: +5.

## 9. Competitividad
Nómina en un solo país. Es una brecha básica en los 18 restantes.

## 10. Fortalezas
- Tasas de nómina en BD con vigencia.
- Error explícito ante un país no soportado (no cae en las reglas DO).
- El geo ya no inventa «Santo Domingo» para las IP privadas (`geo.service.ts:41-45`).

## 11. No verificado
- La corrección del cálculo DO (la evalúa NOM).
- La antigüedad de la base de geoip-lite.
