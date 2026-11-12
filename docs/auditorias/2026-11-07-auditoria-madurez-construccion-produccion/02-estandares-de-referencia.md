# 02 — Estándares de referencia (Paso 3)

Cada ficha de `modulos/` abre con su propio estándar de referencia, en la sección 2. Esa sección se escribió **antes** de leer el código del módulo: capacidades básicas y avanzadas, invariantes, cómo lo resuelven los líderes y construcción de referencia. Este documento recoge la vara común por dominio y declara la calidad de las fuentes.

## Calidad de las fuentes (léase primero)

- Las comparaciones con líderes (SAP, NetSuite, Dynamics 365, Odoo, Sage, QuickBooks, Xero, Zoho; Alegra, Siigo, CONTPAQi, Defontana, Bsale) se apoyan **sobre todo en conocimiento previo de los auditores**. La búsqueda web fue escasa: solo 4 de 70 fichas citan URL, entre ellas `dgii.gov.do`, `tss.gob.do`, `blog.alegra.com` y fuentes de prensa económica dominicana y ecuatoriana. La cuota de uso se agotó tres veces durante la sesión, y se priorizó la verificación ejecutada del producto sobre la investigación de mercado.
- Por eso **el eje 12 (competitividad) tiene confianza media-baja en todas las fichas**. Las brechas de capacidades básicas usadas como evidencia son de dominio público y de alta confianza: comparativos, pedidos de venta, lotes, conversiones de unidades, PUC/PCGE/código agrupador SAT, CFDI. Las afirmaciones finas sobre funciones avanzadas de un líder concreto deben tratarse como **no verificadas**.
- Todo lo normativo (tasas, topes TSS, escalas ISR, formatos 606/607, CFDI 4.0, retenciones, obligatoriedad de factura electrónica por país) queda marcado **"verificar con contador/abogado local"**. El contraste puntual con fuentes oficiales está en `05-matriz-pais-modulo-insumo-LOC.md`, con nivel de confianza por fila.

## Invariantes no negociables usados como vara

### Contabilidad y finanzas (accounting, journal-entries, chart-of-accounts, dimensions, financial-reporting, currencies, fixed-assets, budgets, consolidation, intercompany)
- La partida doble cuadra siempre, también por moneda y por libro.
- Los asientos contabilizados son inmutables: se corrigen por reversión y nunca por UPDATE, protegidos por trigger en la base de datos.
- Hay períodos y ejercicios con apertura, cierre y reapertura auditada. Ninguna escritura entra en un período cerrado, venga del módulo que venga.
- Multimoneda con tasas históricas por fecha, contravalor calculado en el servidor y revaluación al cierre de las partidas monetarias.
- La numeración es correlativa sin huecos bajo concurrencia, y los asientos automáticos son idempotentes.
- Precisión decimal fija (`numeric`) y redondeo explícito por línea y por total.
- Los estados financieros se reproducen desde el mayor al centavo y son comparativos (período anterior y presupuesto).
- La consolidación elimina inversión contra patrimonio y saldos y resultados intragrupo, y convierte según la NIC 21.
- Fusionar o reclasificar cuentas nunca reescribe la historia.

### Ventas, facturación y cumplimiento (invoices, einvoicing, compliance, taxes, sales, price-lists, pos)
- Numeración fiscal por serie y país, sin huecos, que se consume solo al emitir.
- El impuesto se determina en el servidor por jurisdicción y con la vigencia de la fecha del documento.
- Documento fiscal con su ciclo completo: emisión, rechazo, anulación, nota de crédito y nota de débito.
- Cobros aplicados en la moneda del documento.
- Formatos oficiales generados desde los mismos datos que el mayor.
- Ningún país sin régimen emite en silencio un documento que parece fiscal.
- Los efectos externos (autoridad fiscal) están apagados fuera de producción.

### Compras y CxP (procurement, accounts-payable, suppliers, supply-chain)
- Ciclo OC → recepción → factura → pago con conciliación a tres vías y tolerancias.
- Unicidad del documento del proveedor por identificador fiscal y número.
- Retenciones calculadas por el servidor según el régimen del país.
- CxP del mayor igual a la suma de los saldos abiertos.
- Pagos sin doble aplicación bajo concurrencia.

### Inventario y operaciones (inventory, units-of-measure, manufacturing, wms)
- El kardex y las existencias son siempre iguales a la suma de movimientos, y el costeo es consistente (promedio o FIFO).
- Política explícita de stock negativo, con reservas, lotes, series y vencimientos.
- Conversiones de unidad de medida.
- Ajustes y transferencias atómicos, con rastro y asiento contable.
- Una orden de producción consume componentes y valora el terminado.

### Nómina y RR.HH. (payroll, hcm)
- Cálculo por jurisdicción con tasas, topes y escalas versionadas por vigencia, tomadas de fuente oficial.
- Aportes del empleador separados de los del empleado.
- Una nómina aprobada es inmutable, sin carreras entre cálculo y aprobación.
- Formatos oficiales de reporte (SUIR/TSS, IR-3, IR-17 en DO).
- Los datos personales sensibles se cifran en reposo y se enmascaran en logs y auditoría.

### Plataforma (auth, users, roles, multi-tenencia, organizations, saas, audit, i18n, data-transfer, observabilidad, CI/CD)
- Aislamiento total entre inquilinos, a prueba de olvido: una tabla nueva o un endpoint nuevo no pueden escapar del modelo.
- Un único mecanismo de autorización en el servidor, con denegación por defecto.
- Auditoría de toda acción sensible (quién, cuándo, qué, antes y después), inmutable.
- Fuente única de traducciones, sin terminología de un país en el catálogo base.
- Importación masiva asíncrona, idempotente y con informe de errores por fila.
- Métricas, alertas y correlación de logs.
- CI verde obligatorio para fusionar, releases versionadas y respaldo con restauración probada.

## Construcción de referencia (común)

Monolito modular con un módulo por dominio. La forma de referencia:

- **Fronteras**: cada módulo expone una fachada o puerto público. Ninguno importa internos de otro ni registra entidades ajenas. Las transacciones que cruzan módulos son explícitas y acotadas (unidad de trabajo o eventos de dominio con outbox).
- **Responsabilidades**: controladores delgados, DTOs de entrada y de salida (nunca entidades expuestas) y servicios de dominio que calculan todo importe derivado.
- **Reglas de país**: un paquete de datos con vigencia por jurisdicción.
- **Transiciones de estado**: protegidas con un lock o con un UPDATE condicionado al estado esperado.
- **Datos**: índices únicos de negocio en la base de datos. Las tablas con datos de inquilino llevan `organization_id`, una política RLS y una FK compuesta de mismo inquilino.
- **Trabajos**: los pesados van a la cola.

En el producto existen muchas de estas piezas: guard global, RLS, trigger de FK de mismo inquilino, `Idempotency-Key`, `@ExclusiveJob`, BullMQ, verificadores en CI. El patrón de fallo dominante no es su ausencia, sino que **no se aplican en todas partes** (`07-patrones-sistemicos.md`).
