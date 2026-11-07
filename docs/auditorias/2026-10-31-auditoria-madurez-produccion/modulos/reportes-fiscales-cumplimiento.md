# Ficha T10: Reportes fiscales y cumplimiento (`compliance`, `legal`)

Familia F3 · 2026-10-31

> **CRÍTICO de cumplimiento, no de seguridad (`RFC-01`).** El Formato 607 de la DGII sale con 24 campos y las columnas desplazadas. El formato oficial tiene 23 casillas: "Fecha de Retención" es la casilla 7 y las formas de venta van en las casillas 17 a 23. Esto ocurre en el país piloto, y aun así la cobertura del producto lo declara "implementado".
>
> No hay hallazgos críticos de seguridad. `verify:security` marca `legal/legal.service.ts:59` (query builder que no filtra por tenant). Lo revisé: la lista de espera es un dato de plataforma, no de tenant. Es un **falso positivo**, pero hay que añadirlo a la allowlist con su justificación (`RFC-07`).

## 1. Identificación

**Backend**

- `compliance/` tiene 11 archivos, 2 140 LOC y 3 specs:
  - `reports/dr-reports.ts` (421 LOC): genera los formatos 606, 607, 608 y 609.
  - `reports/mx-electronic-accounting.ts` (391 LOC): genera el Anexo 24 v1.3 (Catálogo, Balanza y Pólizas).
  - `fiscal-report-filings.service.ts`: registra cada reporte como generado o presentado, con hash. No envía nada a la autoridad.
  - Secuencias NCF (`ncf_sequences`).
- `legal/` tiene 5 archivos, 180 LOC y 0 specs. Sirve la información legal pública y la lista de espera de mercados (`market_waitlist`).

**Endpoints**

- `GET /compliance/reports/:kind?year&month`: formatos 606/607/608/609, con `@AuditAccess`.
- `GET /compliance/mx/electronic-accounting/:document`.
- `/compliance/filings`: acciones `check`, `submission` y `DELETE submission`.
- CRUD de `/compliance/ncf-sequences`.
- `GET /legal/info` y `POST /legal/market-waitlist`: ambos públicos; el segundo con throttle de 5 por minuto.

**Frontend:** `features/accounting/fiscal-returns`, con tres mercados: DO, MX y OTHER.

**Países cubiertos:** solo DO y MX. **Los otros 17 países no tienen ningún reporte periódico.**

## 2. Estándar de referencia

**Capacidades básicas:** cada país necesita sus formatos oficiales, idénticos byte a byte y validados con el validador de la autoridad.

| País | Formatos exigibles |
|---|---|
| DO | 606, 607, 608, 609, IT-1, IR-17, Anexo A |
| MX | Contabilidad electrónica (Catálogo con código agrupador, Balanza, Pólizas, auxiliares), DIOT |
| CO | Exógena, formularios 300 y 350 |
| PE | PLE |
| CL | RCV y F29 |
| AR | Libro IVA Digital |
| EC | ATS |
| BR | SPED |

**Líderes del mercado** (confianza media): Alegra DO genera 606, 607 y 608; CONTPAQi y Aspel generan la contabilidad electrónica y la DIOT; Siigo genera la exógena; Contífico genera el ATS.

**Invariantes:**

- Lo generado es reproducible: misma entrada, mismo hash.
- Cada presentación queda registrada.
- Nada se envía a la autoridad sin una acción explícita del usuario.

## 3. Resultado

- **Madurez:** 35 (rango 28–45, confianza media-alta).
- **Preparación:** 30. **Veredicto: No listo.**
- **Eje más débil:** 3, Multi-país y cumplimiento.
- **Hallazgos:** 1 crítico y 3 altos.

## 4. Doce ejes

| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad y completitud | 38 (30–45, media) | El 606 tiene el orden y los 23 campos oficiales. El 607 está desalineado. 608 y 609 existen. No hay IT-1, IR-17 ni DIOT. Los otros 17 países no tienen nada | Formatos completos en cada país vendido |
| 2 | Corrección | 30 (22–40, media-alta) | `RFC-01`. El 608 filtra por `issueDate` (`dr-reports.ts:210-216`). La Balanza MX sin movimientos sale sin ningún `Ctas` (verificar contra el XSD) | Validadores oficiales |
| 3 | Multi-país | 25 (18–35, media) | Solo DO y MX | Reportes por país |
| 4 | Arquitectura | 55 (48–62, media) | Generadores puros, guardia de país `assertDominicanRepublic` y registro de presentaciones con hash | Registro de generadores por país y por versión de formato |
| 5 | Higiene | 55 (48–62, baja) | Lee las facturas con `Repository<Invoice>` directo, pero las compras a través del contrato `PurchaseFiscalRecordsSource` | Usar contratos en ambos casos |
| 6 | Calidad | 65 (58–72, media) | Código claro y documentado | — |
| 7 | Robustez | 55 (45–62, baja) | Generación síncrona y `find` de todo el mes sin paginar | Generación en segundo plano |
| 8 | Seguridad | 75 (68–82, media) | Permiso `REPORTS_VIEW_FINANCIAL` y `@AuditAccess`. Pedir el 607 como MX devuelve 400 (verificado) | — |
| 9 | Pruebas | 45 (38–55, media) | Las specs existen y pasan, pero no detectaron el desalineamiento del 607 porque comparan contra lo que escribe el propio código | Fixtures tomados del formato oficial |
| 10 | Operabilidad | 55 (45–62, baja) | Estados generado/presentado con hash | Calendario de vencimientos por país |
| 11 | UX | 50 (40–60, baja) | No la recorrí | — |
| 12 | Competitividad | 28 (20–38, media) | Por debajo de Alegra en DO y de CONTPAQi en MX | — |

## 5. Compuertas

| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | **No cumple** | El 607 es inválido y la cobertura dice "implementado" |
| 2 | Integridad | Cumple | Hash y filings |
| 3 | Aislamiento | Cumple | Filtro por organización |
| 4 | Validación | Cumple | Valida período y tipo de reporte |
| 5 | E2E | Cumple | Ningún 500 en lo probado |
| 6 | Cumplimiento por país | **No cumple** | `RFC-01` a `RFC-04` |
| 7 | CI | Parcial | Hay specs, pero sin fixtures oficiales |
| 8 | Auditoría | Cumple | `@AuditAccess` en la exportación |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | — |
| 11 | UI | No verificado | — |
| 12 | Documentación | No cumple | — |

## 6. Muestras generadas por API

**DO, sesión de qa-a.** Primero `POST /auth/refresh`, luego `GET /api/v1/compliance/reports/{607,606,608}?year=2026&month=10`. Las respuestas están en `scratchpad/f3/r60x.txt`.

```
607|101000012|202610|10|10201.73                       <- encabezado con 5 campos (incluye el total)
131000012|1|B0100000001||01|20261031|4749.99|0.00|4749.99|722.00|0.00|...|5471.99|0.00|0.00|0.00   <- 24 campos
||B0200000001||01|20261031|0.00|1.75|1.75|0.32|...      <- factura QA-F3
606|101000012|202610|0
608|101000012|202610|0
```

- `awk -F'|'` cuenta **24 campos** en el detalle del 607.
- El código (`dr-reports.ts:69-96`) escribe: id, tipo, NCF, NCF modificado, tipo de ingreso, fecha, **servicios, bienes**, monto facturado, ITBIS, retenido, percibido, ISR retenido, ISR percibido, selectivo, otros, propina y 7 formas de pago.
- Según el instructivo oficial de la DGII, la casilla 7 es "Fecha de Retención" (AAAAMMDD) y los tipos de venta van en las casillas 17 a 23. Lo confirmé con WebSearch sobre `5-InstructivoLlenadoyenvioFomato607.pdf`, pero no pude abrir el PDF porque `dgii.gov.do` no resuelve en el sandbox.
- El desglose servicios/bienes pertenece al 606, no al 607.
- **Verificar con un contador local y con la herramienta de prevalidación de la DGII.**

**MX, sesión de qa-mx.** `GET /compliance/mx/electronic-accounting/{catalogo,balanza,polizas}?year=2026&month=10`:

- `catalogo`: 400 `compliance.count_account_have_no_sat_grouping {count:56, example:"1000"}`.
- `balanza`: `<BCE:Balanza Version="1.3" … TipoEnvio="N"/>` **sin ningún `Ctas`**.
- `polizas`: `TipoSolicitud="AF"`, sin `NumOrden` y sin ningún `Poliza`.
- Los namespaces y `schemaLocation` corresponden a la v1.3 del SAT. Queda por verificar si el XSD admite cero elementos hijos; creo que no (`minOccurs=1`).

## 7. Hallazgos

**RFC-01 · El Formato 607 no sigue la estructura oficial · Crítica (DO)**

- Ejes 1, 2 y 3. Categoría: multi-país.
- **Ubicación:** `compliance/reports/dr-reports.ts:69-109`.
- **Qué está mal:** genera 24 campos en vez de 23. Añade un desglose servicios/bienes que el formato no tiene y omite la "Fecha de Retención" (casilla 7). A partir de ahí todo se desplaza: el monto facturado cae en la casilla 7 y las formas de pago en las casillas 18 a 24. El encabezado añade además el total como quinto campo (verificar si el formato vigente lo admite).
- **Forma correcta:** reproducir el layout del instructivo vigente (Norma 07-2018), cubrirlo con un fixture oficial y prevalidarlo con la herramienta de la DGII.
- **Impacto:** bloquea la venta en DO.
- **Esfuerzo:** S.

**RFC-02 · El Anexo 24 MX no se puede generar en un tenant nuevo · Alta**

- **Ubicación:** plantilla de cuentas MX (ver `LOC-05`).
- **Qué está mal:** ninguna de las 56 cuentas tiene código agrupador SAT, así que el Catálogo responde 400. La Balanza y las Pólizas salen vacías.
- **Forma correcta:** sembrar el código agrupador y no emitir XML vacíos.
- **Esfuerzo:** S–M.

**RFC-03 · El producto declara obligaciones que no genera · Alta**

- **Ubicación:** `requiredFiscalReports` en `country-profiles.ts`.
- **Qué está mal:** declara IT-1 para DO y DIOT para MX, pero no existe ningún generador para ellos ni para el IR-17. Busqué con grep: solo aparecen en comentarios.
- **Esfuerzo:** M por formato.

**RFC-04 · Los otros 17 países no tienen reportes · Alta**

- **Ubicación:** módulo `compliance`.
- **Qué está mal:** no hay exógena, PLE, RCV ni F29, Libro IVA Digital, ATS ni SPED. La cobertura lo dice con honestidad, pero 6 de esos mercados se ofrecen como "available".
- **Esfuerzo:** XL.

**RFC-05 · El 608 filtra por fecha de emisión y no de anulación · Media**

- **Ubicación:** `dr-reports.ts:210-216`.
- **Qué está mal:** una factura de septiembre anulada en octubre no aparece en el 608 de octubre. Además, solo incluye facturas de venta. Verificar el criterio con un contador.
- **Esfuerzo:** S.

**RFC-06 · El 609 tiene solo 5 campos · Media (verificar)**

- **Ubicación:** `dr-reports.ts:244-272`.
- **Qué está mal:** según recuerdo (confianza baja), el formato oficial incluye más casillas, como la fecha de retención y el país.
- **Esfuerzo:** S.

**RFC-07 · Falso positivo de `verify:security` en `legal` · Baja**

- **Ubicación:** `legal/legal.service.ts:59`.
- **Qué está mal:** el guard marca el insert de la lista de espera, que es un dato de plataforma. Hay que añadirlo a la allowlist con su justificación.
- **Esfuerzo:** S.

**RFC-08 · Documentos legales sin variante por país · Media (verificar con un abogado)**

- **Ubicación:** `libs/shared/types/src/lib/contracts/legal-documents.contract.ts:30-32`, que define una única versión global.
- **Qué está mal:** no hay variantes por país (LGPD, LFPDPPP, Ley 1581/RNBD, Ley 172-13, Ley 25.326). La lista de espera guarda el correo y la IP de visitantes sin plazo de retención visible.
- **Esfuerzo:** M.

## 8. Camino mínimo a producción

1. Corregir el 607 (`RFC-01`).
2. Corregir el filtro del 608 (`RFC-05`).
3. Sembrar el código agrupador para el Anexo 24 (`RFC-02`).
4. Validar los cuatro formatos DGII con la herramienta oficial y con un contador.
5. Generar IT-1 e IR-17 (M).
6. Generar la DIOT (M).
7. Mientras tanto, presentar al resto de países como "solo contabilidad".

## 9. Camino a 100

| Mejora | Puntos | Esfuerzo |
|---|---|---|
| Fixtures oficiales | +10 | M |
| DO completo | +10 | M |
| MX completo | +10 | M |
| CO, PE, CL, AR, EC y BR | +25 | XL |
| Calendario de obligaciones | +5 | M |

## 10. Competitividad

Nota 28 (rango 20–38, confianza media). Alegra DO y CONTPAQi cubren por completo su país; Virteex no completa ninguno.

## 11. Fortalezas

- La guardia de país funciona.
- El 606 sigue el orden oficial y rechaza las líneas con RNC inválido.
- Las presentaciones quedan registradas con hash, sin enviar nada a la autoridad.
- Las exportaciones pasan por `@AuditAccess`.
- Los namespaces del XML MX son los correctos.

## 12. No verificado

- La validación con las herramientas de la DGII y del SAT: los dominios no son accesibles desde el sandbox.
- 606 y 609 con datos reales: qa-a no tiene compras con NCF.
- Pólizas con movimientos.

**Cobertura:** alrededor del 80 % de `compliance` y el 100 % de `legal`; ejecuté 6 de 13 endpoints.

<!-- RESUMEN: modulo=reportes-fiscales-cumplimiento; madurez=35; prep=30; veredicto=No listo; eje_debil=Multi-país y cumplimiento; criticos=1; altos=3; camino_min=M -->
