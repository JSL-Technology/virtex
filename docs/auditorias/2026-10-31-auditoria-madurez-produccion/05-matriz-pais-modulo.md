# 05 — Matriz país × módulo

## Qué países soporta realmente el producto

El producto declara 19 mercados (`country-profiles.ts`) y marca 8 como `marketStatus: 'available'`. La evidencia de las fichas muestra que:
- **República Dominicana (DO)** es el único país con cadena fiscal de punta a punta: comprobantes B/E y e-CF construido, validado y firmado con transmisión a la DGII, retenciones, formatos 606–609 y nómina TSS/ISR. Es el país piloto.
- **Estados Unidos (US)** tiene contabilidad y un motor de sales tax por jurisdicciones que el cliente configura a mano (verificado 8,25 % en TX), sin taxability, certificados de exención ni declaraciones. No tiene nómina.
- **MX, CO, CL, PE, AR, BR y EC** tienen tasas generales de impuesto, catálogos de documentos incompletos y *builders* de e-factura **sin conectar**: el registro de regímenes no tiene consumidores y el transporte es un POST genérico. Ninguno emite un comprobante electrónico válido.
- **UY, PY, VE, GT, BO, PA, CR, SV, HN y NI**: solo contabilidad genérica con la tasa general de IVA. La emisión de facturas no se bloquea en esos países (F5), lo que contradice la promesa de declararlos no soportados.
- **Transversal a todos:** el plan de cuentas sembrado es **el dominicano** (cuentas TSS, INFOTEP, Propina Legal) para todos los países (COA-03), sin código agrupador SAT, PUC ni PCGE. El redondeo en coma flotante (IMP-01) afecta a todos.

Normativa: todo lo marcado debe verificarse con un contador o abogado local. Varias fuentes oficiales (dgii.gov.do, tss.gob.do) no resolvían desde el entorno de auditoría.

## Preparación comercial por módulo y país

Escala 1–100 / veredicto. **NL** = No listo · **PC** = Piloto controlado · **—** = no aplica / no existe.

| Módulo | DO | MX | US | CO | CL | PE | AR | BR | EC | Resto (10) |
|---|---|---|---|---|---|---|---|---|---|---|
| Impuestos (T08) | 50 NL (redondeo) | 30 NL (sin IEPS ni retenciones) | 40 NL (sin exenciones) | 30 NL (sin INC/ICA/retenciones) | 30 NL (IVA por línea) | 25 NL (sin detracciones) | 30 NL (sin percepciones) | 10 NL (sin tasas) | 35 NL | 20 NL (tasa general) |
| Localización (T07) | 50 NL | 25 NL (RFC genérico rechazado) | 40 NL | 25 NL | 25 NL | 25 NL | 25 NL | 15 NL | 25 NL | 15 NL |
| Plan de cuentas (M01) | 35 NL (fuga MT-03) | 10 NL (plan DO) | 20 NL (plan DO) | 10 NL (sin PUC) | 15 NL | 10 NL (sin PCGE) | 15 NL | 15 NL | 15 NL | 15 NL |
| Asientos y cierre (M02) | 45 NL (GL-01) | 35 NL | 40 NL | 35 NL (sin tercero por línea) | 40 NL | 40 NL | 35 NL (sin ajuste por inflación verificado) | 35 NL | 40 NL | 35 NL |
| Facturación de ventas (M08) | 45 NL | 15 NL | 35 NL (no verificado) | 20 NL | 15 NL | 15 NL | 15 NL | 15 NL | 15 NL | 10 NL |
| Facturación electrónica (M09) | 50 NL (CA falsa aceptada; ambiente global) | 10 NL | — | 10 NL | 10 NL | 10 NL | 10 NL | 10 NL | 10 NL | 5 NL |
| Reportes fiscales (T10) | 30 NL (607 mal construido; sin IT-1/IR-17) | 10 NL (Anexo 24 bloqueado; sin DIOT) | 5 NL (sin 1099) | 5 NL | 5 NL | 5 NL | 5 NL | 5 NL | 5 NL | 5 NL |
| Cuentas por pagar (M16) | 30 NL (retención como servicio por defecto) | 30 NL | 35 NL | 35 NL (sin ReteICA ni base UVT) | 30 NL | 30 NL | 30 NL | 30 NL | 30 NL | 30 NL |
| Nómina (M25) | 35 NL (tope por salario mínimo de 2020; regalía) | 5 NL (sin motor; puede forzar reglas DO) | 5 NL (FICA sembrado sin uso) | 5 NL | 5 NL | 5 NL | 5 NL | 5 NL | 5 NL | 5 NL |
| RR.HH. (M26) | 42 NL | 38 NL | 38 NL | 38 NL | 38 NL | 38 NL | 38 NL | 38 NL | 38 NL | 38 NL |
| POS (M14) | 25 NL (sin comprobante fiscal ni asiento) | 15 NL | 20 NL | 15 NL | 15 NL | 15 NL | 15 NL | 15 NL | 15 NL | 10 NL |
| Monedas (T09) | 46 NL | 46 NL | 46 NL | 46 NL | 46 NL | 46 NL | 40 NL (sin fuente oficial) | 46 NL | 50 NL (dolarizado) | 40 NL (VE sin IGTF) |
| Internacionalización (T06) | 60 PC | 60 PC | 60 PC | 60 PC | 60 PC | 60 PC | 60 PC | 45 NL (pt a medias, pt-PT) | 60 PC | 60 PC |

Los módulos sin componente por país (inventario, compras, tesorería, conciliación, presupuestos, activos fijos, etc.) tienen la misma nota en todos los países; ver el panel en `00-resumen-ejecutivo.md`. Activos fijos tiene un solo libro de depreciación, sin libro fiscal ni tasas por país (FA-02), lo que lo deja No listo en todos.

## Preparación del producto por país (núcleo mínimo para vender un ERP)

Núcleo considerado: plan de cuentas, asientos y cierre, estados financieros, impuestos, facturación de ventas (+ e-factura donde es obligatoria), clientes y cobranza, compras y CxP, inventario, tesorería y conciliación, usuarios y permisos, multitenencia y autenticación.

| País | Preparación del núcleo | Veredicto | Lo que bloquea |
|---|---|---|---|
| DO | **35** | No listo | Críticos transversales (MT-03, redondeo, GL-01, carreras en cobros, recepciones y NCF, AUTH-01/USR-01, CI en rojo, sin respaldo), 607 mal construido, CxP con retención errónea, POS sin asiento. Es el país más cercano: su camino mínimo es L. |
| US | 25 | No listo | Lo mismo que DO menos lo fiscal DO, más plan de cuentas DO, sales tax sin exenciones ni declaraciones y sin nómina. |
| MX | 15 | No listo | Sin CFDI operativo (obligatorio), plan sin código agrupador, Anexo 24 bloqueado, RFC genérico rechazado, sin REP. |
| CO | 15 | No listo | Sin factura electrónica DIAN operativa (obligatoria), sin PUC, sin retenciones ni tercero por línea. |
| CL, PE, EC, AR, BR | 10–15 | No listo | E-factura obligatoria sin implementar, catálogos y plan de cuentas locales ausentes. |
| Resto (10) | 10 | No listo | Solo contabilidad genérica, y la emisión no se bloquea. |

**Recomendación de alcance comercial:** declarar a DO (y como mucho a US para contabilidad sin nómina) como los únicos mercados en los que se trabaja hacia producción, y bloquear en el alta y en la emisión los demás países hasta tener su paquete fiscal real. Hoy el producto los ofrece como «disponibles» (LOC-01).
