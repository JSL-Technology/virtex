# 08 — Hoja de ruta

Orden recomendado: primero lo que **desbloquea la venta**, luego lo que **reduce riesgo** y al final lo que **diferencia**. Esfuerzo relativo S / M / L / XL, sin horas. No se propone infraestructura nueva: todo es reorganización dentro del monolito modular actual.

## Fase 0 — Proceso (antes que cualquier código; desbloquea todo lo demás)

| # | Cambio | Esfuerzo | Por qué primero |
|---|---|---|---|
| 0.1 | Volver a poner `main` en verde: corregir el error de tipos de `certificate-trust.spec.ts:25`, el arnés de `customer-portal.spec.ts` y la guarda de mismo inquilino de `FK_customer_portal_accounts_customer` | S | Lleva en rojo desde el 2026-10-13. Las dos pruebas rotas protegen los dos últimos arreglos de seguridad |
| 0.2 | Protección de rama con CI y CodeQL obligatorios para fusionar | S | Se fusionó con CI rojo (PR #174, #162). Sin esto, todo lo demás retrocede |
| 0.3 | Un interruptor único de efectos externos por entorno, apagado fuera de producción, con dobles de transporte. Afecta a DGII y demás autoridades, Stripe, SMTP, push e IA. Hay que sacar de CI el contacto con `ecf.dgii.gov.do` de `verify:invoicing` y condicionar los crons de e-CF al entorno | M | Hoy CI y cualquier entorno de desarrollo hablan con la DGII real |
| 0.4 | Releases versionadas y procedimiento de respaldo y restauración probado | M | No hay ninguno de los dos (FE-CI-04) |

## Fase 1 — Desbloquear la venta en DO (piloto) y no mentir en el resto

Críticos y altos que rompen el núcleo. Casi todos se arreglan retocando, no rehaciendo.

| # | Cambio | Módulos | Esfuerzo | Dependencias |
|---|---|---|---|---|
| 1.1 | Escritura entre tenants en push: DTO con whitelist, `organization_id` + política RLS en `push_subscription` y validación de `endpoint` (PLT-NOT-01) | notifications, multi-tenencia | S | — |
| 1.2 | `verify:rls` debe exigir columna de inquilino y política en toda tabla con datos de usuario. Hay que prohibir `@Body()` sin clase DTO | multi-tenencia, todos | S | 1.1 |
| 1.3 | 607/608: corregir `created_at` → `"createdAt"` y añadir prueba de integración con ventas POS reales (FAC-CMP-01) | compliance, pos | S | — |
| 1.4 | Cupo SaaS fuera de la transacción del documento. Las NC y las anulaciones no deben consumir cupo de facturas, y los límites se devuelven como error de dominio (FAC-INV-01, PLT-DT-01) | saas, invoices, data-transfer | M | — |
| 1.5 | Cobros multimoneda: rechazar o convertir cuando la moneda del recibo ≠ la de la factura, y guardar el importe en divisa en la línea de banco (TES-01/02) | customers, treasury | M | — |
| 1.6 | Revaluación cambiaria: permitir moneda de cuenta, aprovisionar cuentas en divisa y no marcar el cierre como hecho sin ejecutarla (FINB-01, FIN-AC-03) | currencies, chart-of-accounts, accounting | M | — |
| 1.7 | Proveedores: índice único (org, identificador fiscal) y unicidad de NCF de proveedor en BD (CMP-03/04) | suppliers, accounts-payable | S | — |
| 1.8 | Recalcular en el servidor todo importe derivado: ITBIS de compra, contravalor por línea, tipo de impuesto "Fijo", retenciones, deducciones negativas y tasa de novedad (SP-04) | accounts-payable, journal-entries, taxes, payroll | M | — |
| 1.9 | Match a tres vías con tolerancias y sin entrada de stock sin recepción (CMP-01) | accounts-payable, procurement, inventory | M | — |
| 1.10 | Transiciones de estado bajo lock o UPDATE condicionado: aprobaciones (PLTB-WF-02), cálculo/aprobación de nómina (NOM-04), anticipos (TES-18) | workflows, payroll, customers | M | — |
| 1.11 | Nómina DO: piso de cotización (NOM-01), histórico del mínimo cotizable con fuente oficial (NOM-02) y formato SUIR oficial (NOM-06), con validación de un contador DO | payroll | M | contador local |
| 1.12 | POS sin comprobante: bloquear o avisar cuando no hay secuencia B02, y contabilizar el descuadre del arqueo (INV-02/03) | pos | S | — |
| 1.13 | Declaración honesta por país. Brasil bloqueado hasta tener reglas ICMS/ISS (LOC-01). Los países sin régimen deben avisar "documento no fiscal" (LOC-03, FAC-INV-03). `needs-credentials` solo donde el adaptador esté conectado (FAC-EINV-01) | localization, invoices, onboarding | S | — |
| 1.14 | NSS cifrado en reposo y enmascarado en auditoría (NOM-20, ampliado) | hcm, audit | S | — |
| 1.15 | Auditoría de dominio en lugar de ORM, con cobertura de usuarios, roles, membresías, perfil de empresa y transiciones (SP-09) | audit, todos | M | — |
| 1.16 | Retirar del menú o declarar como "no disponible" lo que no existe o no está en el plan: manufactura, WMS, proyectos, customer-service, funciones fuera de plan (SP-01, SP-11) | frontend-shell, saas | S | — |

**Resultado esperado de la Fase 1**: el núcleo en DO pasa a **piloto controlado** (preparación ~60–68) y el resto de países queda declarado con honestidad.

## Fase 2 — Reducir riesgo y abrir los países con régimen construido

| # | Cambio | Esfuerzo | Retocar / rehacer |
|---|---|---|---|
| 2.1 | **Motor de reglas por país como datos versionados**: tasas, bases, topes, retenciones y vigencias, con su fuente oficial. Se elimina `country-tax-schemes.ts` como fuente | L | **Rehacer** (el modelo actual de constantes no admite vigencia) |
| 2.2 | Catálogo base neutro. DO pasa a ser un paquete de país como los demás. Planes de cuentas estatutarios: PUC (CO), PCGE (PE), código agrupador SAT (MX) | L | Rehacer el aprovisionamiento del plan de cuentas |
| 2.3 | Conectar los adaptadores CFDI, DIAN, SUNAT, SRI, SII y AFIP al flujo de emisión, con modo de homologación | XL | Retocar la orquestación (los adaptadores existen) |
| 2.4 | Importación masiva asíncrona en cola, idempotente, con upsert e informe por fila; también para extractos bancarios (PLT-DT-01/02, TES-03/05) | M | Retocar |
| 2.5 | Unificar los dos motores de flujo (PLTB-WF-01) | L | Rehacer uno sobre el otro |
| 2.6 | Fronteras de módulo: primero los 14 ciclos y las 108 transacciones cruzadas, después los imports privados, con metas por agrupación (SP-08) | L | Reorganizar |
| 2.7 | Métricas (HTTP, colas, jobs fallidos), `/metrics` accesible para el scraper y alertas (PLT-OBS-01, PLT-JOB-01) | M | Retocar |
| 2.8 | Migraciones seguras para tablas grandes: `CONCURRENTLY` y `lock_timeout` (PLT-DB-01) | S | Retocar |
| 2.9 | Almacenamiento compartido obligatorio en producción y validación de tipo y contenido de los archivos (PLT-STO-01) | S | Retocar |
| 2.10 | Paginación obligatoria con tope en todos los listados (CMP-07, conciliación) | S | Retocar |
| 2.11 | Pruebas de concurrencia y de flujo cruzado como compuerta de CI (venta → cobro → conciliación, compra → pago, nómina → pago, anulaciones, cierre) | M | — |
| 2.12 | Electron actualizado, binarios firmados y auto-actualización. node-forge actualizado (vulnerabilidad en la verificación de firmas RSA) | M | — |

## Fase 3 — Capacidades básicas que faltan frente al mercado

| Capacidad | Módulo | Esfuerzo |
|---|---|---|
| Estados comparativos (el servicio existe y no está conectado) | financial-reporting | S |
| Pedido de venta, entregas y facturación parcial; nota de débito de venta | sales, invoices | L |
| Listas de precios aplicadas en factura, cotización y POS | price-lists | M |
| Lotes, series, vencimientos, reservas y conversiones de unidad de medida | inventory, units-of-measure | L |
| Devoluciones POS posteriores al cierre, descuentos y cliente identificado (B01/E31) | pos | M |
| Retenciones locales (retefuente, IIBB, detracciones…) | accounts-payable, localization | L |
| Activos fijos: categorías, libro fiscal, deterioro, baja parcial; corregir el último mes de SYD/DDB | fixed-assets | M |
| Presupuestos con versiones y modo aviso | budgets | M |
| Cobranza básica fuera del plan de IA, con recordatorios automáticos | collections | M |
| Ajuste por inflación usable (AR, VE) | accounting | L |
| Consolidación con eliminaciones correctas y pantalla | consolidation, intercompany | L — **rehacer** las eliminaciones |
| Manufactura real (consumo, producción, costeo) | manufacturing | XL — **rehacer** |
| Proyectos y servicio al cliente | projects, customer-service | XL — **rehacer** (hoy son esqueletos) |
| Nómina en un segundo país | payroll, jurisdictions | XL (requiere 2.1) |
| Formatos fiscales periódicos fuera de DO | compliance | L por país |

## Fase 4 — Diferenciación

Sobre una base correcta, el producto ya tiene diferenciadores reales que conviene preservar y explotar:

- La autorización única con denegación por defecto.
- El sandbox de extensiones firmado y probado.
- La IA con aprobación humana y procedencia.
- El servidor MCP con OAuth y PKCE.
- El motor de pronóstico con RLS propio.
- Los verificadores ejecutables en CI.

Mejoras propuestas:

- Ampliar la búsqueda global (hoy son 3 entidades).
- Copiloto en todos los módulos.
- Mapa de relaciones con todos los documentos.
- Evaluación de IA (inyección de prompts) como compuerta de PR con casos dinámicos.

## Dependencias clave

- La Fase 0 bloquea todo lo demás.
- 1.2 depende de 1.1.
- 2.1 es requisito de 2.2, 2.3, la nómina multipaís y las retenciones locales.
- 2.4 es requisito de cualquier venta a un cliente con histórico que migrar.
- 1.15 (auditoría de dominio) se aprovecha en todas las correcciones de transiciones (1.10).
