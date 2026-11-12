# 05 — Matriz módulo × país (preparación comercial y veredicto)

Fuente: fichas de `modulos/` y el insumo por país `05-matriz-pais-modulo-insumo-LOC.md` (aprovisionamiento real en BD de los 19 mercados, `npm run verify:markets` EXIT 0, contraste de tasas con confianza). Todo lo normativo queda **"verificar con contador/abogado local"**.

Notación: **P** = preparación comercial (1–100) · veredicto: **L** listo · **LR** listo con reservas · **PC** piloto controlado · **NL** no listo. "—" = el módulo no tiene comportamiento por país (su nota es la global).

## Núcleo mínimo para vender un ERP, por grupo de países

Grupos (de `01-inventario`): **DO** (piloto) · **R7** = MX, CO, CL, PE, AR, EC (régimen fiscal construido, sin credenciales; BR va aparte por LOC-01) · **BR** · **US** · **G10** = UY, PY, BO, VE, PA, CR, GT, SV, HN, NI (solo contabilidad + IVA de tasa única).

| Módulo del núcleo | DO | R7 (MX, CO, CL, PE, AR, EC) | BR | US | G10 |
|---|---|---|---|---|---|
| journal-entries | 64 PC | 60 PC (plan de cuentas no estatutario) | 55 PC | 62 PC | 58 PC |
| accounting (períodos, cierre) | 55 PC | 50 PC; **AR: NL** (ajuste por inflación inoperante) | 50 PC | 55 PC | 50 PC; **VE: NL** (inflación) |
| chart-of-accounts | 50 PC | **NL** (sin PUC/PCGE/agrupador SAT; cuentas de nómina dominicanas — FIN-COA-03, LOC-02) | NL | 45 NL (cuentas en inglés OK, sin plan US GAAP de referencia) | NL (nombres DO) |
| financial-reporting | 58 PC | 50 PC (sin formatos locales) | 50 PC | 55 PC | 50 PC |
| currencies | **40 NL** (revaluación inoperante — FINB-01 crítico) | NL | NL | NL | NL |
| invoices | **NL** (FAC-INV-01 crítico: NC/anulación 500 con cupo agotado) | **NL** (tipos "electrónicos" sin régimen conectado — FAC-EINV-01) | **NL** (LOC-01: factura al 0 %) | 45 NL (sales tax 0 % sin jurisdicción, aviso presente) | **NL** (factura no fiscal sin aviso — FAC-INV-03, LOC-03) |
| einvoicing | PC condicionado (FAC-EINV-02/03; certificación DGII no verificada) | **NL** (adaptadores sin consumidor) | NL | N/A (no aplica sello) | NL (no construido) |
| compliance (formatos fiscales) | **NL** (607/608 → 500 — FAC-CMP-01 crítico) | NL (no existen formatos) | NL | NL (sin 1099) | NL |
| taxes | 30 NL (FAC-TX-01/02: tasa libre aceptada, tasa estándar = MAX) | NL (tasas en código sin vigencia; faltan reducidas en PE) | NL | NL | NL (faltan reducidas en VE, PA, CR, HN) |
| procurement | 60 PC | 55 PC | 50 PC | 55 PC | 55 PC |
| accounts-payable | 62 PC | 50 PC (sin retenciones locales) | 45 NL | 55 PC (CMP-24) | 50 PC |
| suppliers | **NL** (RNC duplicado → 606 duplicado, CMP-03) | NL | NL | NL | NL |
| inventory | 48 NL / PC comercio simple | igual | igual | igual | igual |
| treasury | 56 PC (solo moneda base) | 50 PC | 50 PC | 50 PC | 50 PC |
| reconciliation | 52 PC | 50 PC | 50 PC | 50 PC | 50 PC |
| customers (CxC, cobros) | **NL** (TES-01 crítico: cobro USD 1:1 contra factura DOP) | NL | NL | NL | NL |
| pos | **NL** (607/608; venta sin comprobante sin aviso — INV-02) | NL (sin CFDI/documento fiscal) | NL | 50 PC | NL |
| payroll | **NL** (NOM-01/02/03/04: cotización bajo mínimo, histórico de topes, deducción negativa, carrera calcular/aprobar) | N/A — se niega con 400 claro (correcto) | N/A | N/A | N/A |
| auth / users / roles / organizations | 76–82 LR | LR | LR | LR | LR |
| multi-tenencia | 72 LR (tras PLT-NOT-01) | LR | LR | LR | LR |
| i18n | 64 PC | 64 PC (portugués mezcla PT/BR; terminología DO en catálogo base) | 55 PC | 64 PC | 64 PC |

## Veredicto del producto por grupo de países

El producto **no es vendible hoy en ningún país**: en todos, al menos un módulo del núcleo tiene una compuerta crítica incumplida (facturación, CxC y monedas en todos; formatos fiscales y nómina en DO).

| Grupo | Veredicto del producto | Lo que bloquea (mínimo) | Preparación del núcleo (juicio, no promedio) |
|---|---|---|---|
| **DO** | **No listo** → piloto controlado tras ~8 correcciones S–M | FAC-INV-01, FAC-CMP-01 (607/608), TES-01, FINB-01, PLT-NOT-01, CMP-03, NOM-01..04 (si se vende nómina), CI en rojo | 48 (40–55) |
| **MX, CO, CL, PE, AR, EC** | **No listo** | Documento fiscal electrónico no conectado (FAC-EINV-01); plan de cuentas no estatutario y con nombres DO; sin retenciones locales; RFC genérico rechazado (MX); AR: inflación | 30 (22–38) |
| **BR** | **No listo** | LOC-01 (factura al 0 % sin bloqueo), formulario con series NCF, NF-e no conectada | 20 (12–28) |
| **US** | **No listo** → piloto para contabilidad/compras sin facturación con impuesto | Sales tax sin jurisdicción factura al 0 % (con aviso), sin 1099, mismos críticos transversales (TES-01, FINB-01, PLT-NOT-01) | 38 (30–45) |
| **UY, PY, BO, VE, PA, CR, GT, SV, HN, NI** | **No listo** — vendible como mucho como "contabilidad sin facturación" y así debe declararse | Factura que no es documento fiscal sin aviso al usuario (en GT, SV, CR, UY… la factura electrónica es obligatoria — verificar); registro sin revalidar el identificador fiscal (LOC-10) | 22 (15–30) |

## Coherencia de lo que se declara

| País | Lo que el producto declara | Lo que hace | Brecha |
|---|---|---|---|
| BR | `available`; impuestos "needs-credentials" | Factura con 0 % sin bloqueo | Declaración incorrecta: crítico |
| MX, CO, CL, PE, AR, EC | e-invoicing "needs-credentials" ("construido y probado; falta la credencial") | Los adaptadores no tienen consumidor en el flujo de emisión | La definición de `needs-credentials` en `fiscal-coverage.ts:18-21` no se cumple |
| UY…NI | Solo contabilidad (`coverageFor`) | Aprovisiona y valida IVA; emite facturas sin aviso de no fiscales | Incoherencia interna (LOC-09) y falta de aviso (LOC-03) |
| DO | IT-1, IR-17, IR-3 "not-implemented" (honesto) | Coincide | — |
| Todos (nómina) | La cobertura previa al pago no menciona nómina | Solo DO | JUR-02 |
