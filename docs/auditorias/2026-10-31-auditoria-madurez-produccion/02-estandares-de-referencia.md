# 02 — Estándares de referencia

Cada ficha de `modulos/` contiene, en su sección 2, el estándar completo de su módulo, escrito **antes** de leer el código a fondo: capacidades básicas y avanzadas, invariantes, cómo lo resuelven los líderes (con fuente y confianza) y la construcción de referencia. Este documento resume la vara común por familia. Lo normativo debe verificarse con un contador o abogado local.

## Construcción de referencia común (monolito modular)
- **Capas:** controlador fino (validación de DTO y autorización declarativa) → servicio de aplicación (orquesta la transacción) → dominio (reglas, máquinas de estado, cálculos puros) → repositorio con ámbito de tenant obligatorio. La lógica de negocio nunca vive en controladores ni componentes.
- **Fronteras:** cada módulo es dueño de sus tablas y expone un puerto público; otros módulos no importan sus entidades ni escriben sus tablas. La integración se hace por eventos de dominio con *outbox* (exactamente una vez) o por llamadas al puerto dentro de una transacción explícita y acotada.
- **Tenencia:** contexto de tenant fijado por petición dentro de la transacción (`SET LOCAL`), RLS con `FORCE` como red de seguridad, FK compuestas con `organization_id` y validación de pertenencia de todo id entrante.
- **Dinero:** decimal exacto y redondeo por regla del país (por línea o por documento), en un único módulo. Tasas de cambio con 6+ decimales e históricas por fecha.
- **Documentos con saldo:** máquina de estados explícita; bloqueo pesimista del documento en cada cambio de estado o saldo; idempotencia por clave en cada POST que crea efectos; correcciones por reversión, nunca por UPDATE.
- **Reglas por país:** datos versionados por jurisdicción y vigencia (impuestos, catálogos, plan de cuentas, nómina, reportes), sin `if (country === …)` en el dominio y sin país por defecto.
- **Operación:** logs estructurados con `requestId`, `organizationId` y `userId`; sondas de salud; métricas; límites de tasa por usuario y tenant; trabajos idempotentes con lock distribuido; respaldo probado; auditoría *append-only*.
- **API:** contrato único de paginación, filtros y errores; DTO de salida distintos de las entidades; versionado.

## Invariantes por familia

| Familia | Invariantes no negociables |
|---|---|
| Contabilidad (M01–M07) | Partida doble cuadrada por asiento y por libro; asientos contabilizados inmutables (se corrige por reversión); períodos con apertura y cierre que bloquean de verdad; numeración sin huecos ni duplicados; saldos derivados de una única fuente de movimientos vigentes; idempotencia de asientos automáticos; multimoneda con tasa histórica; cuadre entre auxiliares (CxC, CxP, inventario, bancos) y mayor. |
| Ventas (M08–M14) | Numeración fiscal por serie sin huecos ni duplicados, también con concurrencia; impuestos por jurisdicción con el redondeo legal del país; ciclo emisión → anulación o NC sin duplicar créditos; cobros aplicados sin exceder el saldo; asiento de venta y de costo en la misma transacción; e-factura validada (XSD), firmada y con acuse antes de considerarla emitida; POS con comprobante fiscal y asiento. |
| Compras (M15–M18) | OC → recepción → factura → pago con *three-way match* y tolerancias; recepción ≤ pedido, también con concurrencia; retenciones según el régimen del proveedor y la naturaleza de la compra; unicidad de factura de proveedor; CxP = mayor. |
| Inventario (M19–M22) | Kardex = existencias = valor contable; costeo consistente (promedio, FIFO o estándar declarado); política explícita de stock negativo; lotes, series y vencimientos; reservas; ajustes con motivo y rastro; producción que consume y genera inventario con su costeo. |
| Tesorería (M23–M24) | Saldo bancario conciliado = saldo del extracto; lo conciliado queda bloqueado; deshacer revierte efectos; importación de formatos estándar (CSV, OFX, CAMT.053, MT940). |
| Nómina (M25–M26) | Tasas y topes versionados por vigencia y jurisdicción; separación de aportes del empleado y del empleador; nómina cerrada inmutable; formatos oficiales; datos personales cifrados y con acceso mínimo. |
| Plataforma (T01–T23) | Aislamiento total entre tenants (lectura, escritura y referencia); autorización en el servidor por operación; auditoría de acciones sensibles con autor; configuración validada al arrancar; observabilidad con correlación; CI como compuerta. |

## Líderes de referencia usados

| Ámbito | Globales | Regionales y locales |
|---|---|---|
| ERP y contabilidad | SAP S/4HANA y Business One, Oracle NetSuite, Microsoft Dynamics 365 Finance y Business Central, Odoo, Sage Intacct, QuickBooks Online, Xero, Zoho Books | Alegra (DO, CO, MX…), Siigo (CO), CONTPAQi y Aspel (MX), Defontana y Bsale (CL), Contífico (EC), Tango (AR), Bling y Omie (BR) |
| Facturación electrónica | Avalara, Sovos, Pagero | PAC autorizados (Facturama, Finkok en MX), proveedores DIAN, proveedores e-CF autorizados por la DGII |
| Nómina | ADP, Workday, Rippling, Gusto | Buk, Runa, CONTPAQi Nóminas, Siigo/Alegra Nómina, soluciones TSS locales en DO |
| Identidad y SaaS | Okta, Auth0, Microsoft Entra; Stripe Billing, Chargebee | — |
| Tesorería | Kyriba (gama alta), conciliación de Xero y QuickBooks | Agregadores bancarios Belvo, Fintoc y Plaid |
| Plataforma y operación | AWS SaaS Lens, prácticas SRE de Google, OWASP ASVS y SAMM, SLSA, OpenSSF Scorecard | — |

**Confianza de las comparaciones:** media en general. Las capacidades de los líderes proceden de documentación pública y del conocimiento del sector; las fichas citan las fuentes concretas cuando fue posible consultarlas. Varios dominios oficiales (dgii.gov.do, tss.gob.do) no resolvían desde el entorno, así que las cifras normativas se marcan «verificar con contador local».
