# Lista de cotejo de hallazgos (2026-11-09)

Todos los hallazgos de los MD de la auditoría, con su estado en [`10-verificacion-de-cierre.md`](10-verificacion-de-cierre.md). ✅ = resuelto y verificado · ❌ = parcial o pendiente (en los parciales se indica lo que falta).

**64 de 376 resueltos; 312 por corregir** (9 parciales). Aparte, 26 identificadores no son hallazgos (informativos o referencias) y se listan al final.

Generado con `herramientas/lista-cotejo.mjs`; la descripción es un extracto de la ficha citada.

| Severidad | ✅ | ❌ |
|---|---|---|
| Crítica | 13 | 0 |
| Alta | 33 | 77 |
| Media | 17 | 151 |
| Baja | 1 | 68 |
| — | 0 | 16 |

## Severidad crítica (13)

| | ID | Hallazgo | Ficha |
|---|---|---|---|
| ✅ | FAC-CMP-01 | compliance/compliance.service.ts:432-437 (tillFiscalSales): SELECT … to_char(created_at …) FROM pos_sales … ORDER BY created_at sobre una tabla cuya columna es "createdAt". Toda llamada a 6… | `modulos/compliance.md:60` |
| ✅ | FAC-EINV-01 | Siete regímenes (CFDI, DIAN, SUNAT, SRI, SII, NF-e, AFIP) con builders/adaptadores/transporte que nadie invoca. Una factura MX/CO/… emitida tras subir certificado o rango obtiene número y n… | `modulos/einvoicing.md:62` |
| ✅ | FAC-INV-01 | con el cupo del plan agotado, el UPDATE condicionado no devuelve fila, se intenta INSERT, falla con 23505 dentro de la transacción y el reintento corre sobre una transacción abortada → Quer… | `modulos/invoices.md:69` |
| ✅ | FAC-PL-01 | se crean listas con precios y vigencia, pero ningún documento de venta las consulta; el precio de la factura es dto.unitPrice ?? product.price. Un usuario que configura "Mayorista" seguirá… | `modulos/price-lists.md:55` |
| ✅ | FINB-01 | accounting/services/currency-revaluation.service.ts:112-133, chart-of-accounts/dto/create-account.dto.ts:43-80, closing-automation.service.ts:89-90. La revaluación sólo procesa cuentas con… | `modulos/currencies.md:43` |
| ✅ | FINB-30 | consolidation.service.ts:442-452, 480, 772-825. eliminateInvestment calcula arising = acquisitionCost − parte de activos netos y solo empuja una entrada informativa a eliminations; nunca re… | `modulos/consolidation.md:42` |
| ✅ | IA-B01 | ebitda = netIncome; no suma depreciación, amortización, intereses ni impuestos. En qa-do-fac EBITDA 14.871,72 = utilidad neta. Con activos fijos o deuda el número es falso. Correcto: utilid… | `modulos/bi-dashboard-overview-reports.md:65` |
| ✅ | INV-01 | la consulta usa created_at, pero la columna real es "createdAt" (\d pos_sales). Pasos: | `modulos/pos.md:89` |
| ✅ | LOC-01 | Brasil usa el motor de sales tax de EE. UU. (estado/condado/ciudad sumados). Si el tenant no tiene jurisdicciones, la factura sale al 0 %. | `modulos/localization.md:61` |
| ✅ | PLT-NOT-01 | create({...subscriptionDto, userId}) + save() con id del cuerpo hace UPSERT sobre la fila de otro usuario. Pasos: (1) qa-do-plt POST /push/subscribe {"endpoint":"http://127.0.0.1:6379/QA-PL… | `modulos/notificaciones-push-websockets.md:37` |
| ✅ | SP-02 | La República Dominicana como regla implícita | `04-plataforma-transversal.md:15` |
| ✅ | SP-03 | Reglas fiscales y laborales como código, sin vigencia | `11-traspaso-para-continuar.md:120` |
| ✅ | TES-01 | Pasos: cuenta USD (97c041de…), factura FAC-00000006 DOP 200, POST /customer-payments {currencyCode:"USD", bankAccountId:USD, amountReceived:200, lines:[{invoiceId, amount:200}]} → 201; fact… | `modulos/customers.md:62` |

## Severidad alta (110)

| | ID | Hallazgo | Ficha |
|---|---|---|---|
| ❌ | FAC-CMP-02 | reports/dr-reports.spec.ts prueba el formato con dobles; ninguna prueba ejecuta el SQL. M. | `modulos/compliance.md:61` |
| ❌ | FAC-CMP-03 | sin formatos fiscales de CO, PE, CL, AR, EC, etc.; correcto que respondan 400, pero la UI de "declaraciones" debe declararlo. M por país. | `modulos/compliance.md:62` |
| ❌ | FAC-INV-03 | UY (y US, PY, BO, VE, PA, CR, GT, SV, HN, NI) emiten facturas Pending sin documento fiscal ni aviso; probado UY 201 fiscalNumber:null. En UY, CR, GT, PY, etc. la factura electrónica es obli… **Parcial — falta:** La factura emitida no queda marcada como documento no fiscal en su detalle ni en el PDF, y no hay bloqueo configurable donde la ley exige e-factura. | `modulos/invoices.md:71` |
| ❌ | FAC-INV-05 | no existe nota de débito de venta ni anulación sin NC desde facturas (grep -rn "debit" invoices/invoices.controller.ts → nada). DGII e-CF 33 y B03 existen en el catálogo pero no son emitibl… | `modulos/invoices.md:73` |
| ❌ | FAC-SAL-01 | no existe pedido de venta ni entrega/facturación parcial (grep arriba). Bloquea distribución y manufactura bajo pedido. L. | `modulos/sales.md:58` |
| ❌ | FE-CI-01 | .github/workflows/ci.yml / rama main. main está en rojo: 15/24 últimos runs de CI en main fallan; el último verde es del 2026-10-13 (run 315). El run 42324878666 (commit 36f10d7, 2026-11-07… **Parcial — falta:** `main` sigue en rojo hasta que se fusione la rama; falta confirmar el CI verde del último commit y la protección de rama, que se configura en GitHub y no desde el repositorio. | `modulos/ci-cd-infra.md:51` |
| ❌ | FE-CI-02 | GitHub. Se fusiona con CI roja: PR #174 (merged 2026-11-07T01:35:23Z, head 8c74910: main=failure), PR #162 (merged 2026-10-30, head 8afbca7: main=failure, CodeQL=failure). gh api …/branches… | `modulos/ci-cd-infra.md:52` |
| ❌ | FE-CI-04 | docs/DEPLOYMENT.md, tools/. Sin respaldo ni recuperación: no hay política, script, PITR ni ensayo de restore (grep vacío). Para un ERP con libros contables es un bloqueo de venta. Esfuerzo… | `modulos/ci-cd-infra.md:54` |
| ❌ | FE-DOC-01 | docs/DEPLOYMENT.md. No documenta respaldo, restauración, rollback de migraciones, entornos (staging), monitorización ni respuesta a incidentes; para un ERP es requisito de venta (ver FE-CI-… | `modulos/documentacion-gobernanza.md:36` |
| ❌ | FE-NAV-01 | backend apps/backend/api/src/app/{consolidation,intercompany,manufacturing,projects,…} sin pantallas. Siete dominios con API (y en algunos casos fichas de auditoría propias) no son usables… | `modulos/navegacion-y-cobertura-ux.md:43` |
| ❌ | FE-SET-01 | PATCH /organizations/profile (organizations.controller.ts:161). El cambio de datos legales de la empresa (razón social, RNC, dirección, teléfono, web) no deja rastro en audit_logs (verifica… | `modulos/settings.md:49` |
| ❌ | FE-SH-01 | core/api/*.service.ts (40), core/services/{invoices,journal-entries,einvoicing,accounts-payable,chart-of-accounts,customer-receipts}.ts. El acceso a datos de casi todos los dominios vive en… | `modulos/frontend-shell.md:50` |
| ❌ | FIN-AC-01 | con una regla de dimensión obligatoria en una cuenta de resultados (5300), readiness responde canClose:true pero POST /accounting/year-end-close → 400 journal_entries.account_code_p2_requir… | `modulos/accounting.md:56` |
| ❌ | FIN-AC-03 | accounting/journal-entries/chart-of-accounts: currency-revaluation.service.ts:113 revalúa solo cuentas isMultiCurrency=true; el plan aprovisionado no tiene ninguna (count=0) y JournalEntrie… **Parcial — falta:** No se rechaza aún un asiento en divisa sobre una cuenta no multimoneda, ni hay alerta en el checklist de saldos sin revaluar. | `modulos/accounting.md:65` |
| ❌ | FIN-AC-04 | Funcionalidad no operable: inflation-adjustment.service.ts:43-104: requiere índice mensual por organización (inflation_indices, 0 filas, sin endpoint ni servicio de carga), diario AJU-INF i… | `modulos/accounting.md:70` |
| ❌ | FIN-COA-01 | chart-of-accounts · Eje 2 · Bug · Alta | `modulos/chart-of-accounts.md:64` |
| ❌ | FIN-COA-02 | Funcionalidad rota: account-jobs.processor.ts:85-95 reescribe journal_entry_lines.account_id; los triggers de inmutabilidad lo impiden. Ejecutado: cuenta 6200 con asiento GENERAL-2027-00000… | `modulos/chart-of-accounts.md:67` |
| ❌ | FIN-FR-01 | Sin estados comparativos (período anterior/presupuesto): comparative-reporting.service.ts existe pero no está en providers ni tiene ruta. Capacidad básica en QuickBooks/Xero/Alegra. Esfuerz… | `modulos/financial-reporting.md:66` |
| ❌ | FINB-03 | exchange-rates.service.ts:88-95, 420-468. Única fuente automática: XE (mercado, cuenta de plataforma); tasas oficiales DGII/BCRD, DOF, TRM, BNA, SBS solo manuales. Alta de documentos en ME… | `modulos/currencies.md:47` |
| ❌ | FINB-10 | fixed-assets.service.ts:334. La baja exige el diario ACT-FIJOS, que ningún aprovisionamiento crea (grep -rn "ACT-FIJOS" apps/backend/api/src → solo este consumidor; diarios del tenant: VENT… | `modulos/fixed-assets.md:55` |
| ❌ | FINB-13 | fixed-assets.controller.ts:44-49, depreciation.service.ts:138-153. No hay guarda de período ≤ hoy: el 07-11-2026 POST /depreciation-runs {"period":"2026-11"} contabilizó 21.000 con fecha 30… | `modulos/fixed-assets.md:57` |
| ❌ | FINB-16 | módulo completo. Sin categorías/clases, libro fiscal ni libros múltiples (solo isDefault ledger, depreciation.service.ts:195), mejoras, deterioro/revaluación, baja parcial, transferencias e… | `modulos/fixed-assets.md:67` |
| ❌ | FINB-20 | budget-control.service.ts:147-153, journal-entries.service.ts:~893-930. El control trata ingresos igual que gastos: con presupuesto 4100 = 10.000, POST /journal-entries (Bancos D 20.000 / 4… | `modulos/budgets.md:41` |
| ❌ | FINB-21 | budgets.service.ts:187-241. GET /budgets/variance?fromPeriod=2026-01&toPeriod=2026-12 con solo noviembre presupuestado: 5500 presupuesto 2.500 vs real 34.098,13 (todo ene–nov: 12.917,75+80,… | `modulos/budgets.md:43` |
| ❌ | FINB-22 | entities/budget.entity.ts:29 (UQ_budgets_org_period), budgets.service.ts:281-284. Segundo presupuesto para 2026-11 → 409 budgets.period_already_budgeted. No hay escenarios, versiones, presu… | `modulos/budgets.md:45` |
| ❌ | FINB-40 | intercompany.service.ts:447-458: findOneBy(Journal, { organizationId, type: 'GENERAL' }); un tenant DO nace con 4 diarios GENERAL (NOMINA, GENERAL, DEPREC, CIERRE | `modulos/intercompany.md:36` |
| ❌ | FINB-41 | servicio completo: solo transferencias de efectivo; sin venta/compra IC espejo, liquidación, compensación, anulación espejo ni conciliación de saldos; y FINB-31 (consolidación elimina las c… | `modulos/intercompany.md:38` |
| ❌ | FINB-44 | cero specs en el módulo. M. | `modulos/intercompany.md:44` |
| ❌ | FINB-45 | intercompany: sin pantalla ni menú. M. | `modulos/intercompany.md:46` |
| ❌ | IA-03 | La resistencia a inyección se mide con 6 casos y fixtures, solo manual/semanal y sin bloquear PRs; cubre canario y "no proponer borrador", no exfiltración por enlaces/markdown, texto en adj… | `modulos/ai.md:69` |
| ❌ | IA-B02 | 500 siempre que hay facturas pendientes (relación payment.journalEntry inexistente). La UI usa /customer-payments/aging (200 ✓), así que es un endpoint duplicado roto expuesto en la API púb… | `modulos/bi-dashboard-overview-reports.md:66` |
| ❌ | IA-B04 | Margen neto, ROE, ROA, EBITDA usan saldos acumulados "a hoy" sin período (dependen de si hubo cierre anual), FCF usa año en curso; la UI rotula "vs año anterior/presupuesto/trimestre anteri… **Parcial — falta:** El ROE sigue usando activos − pasivos (`dashboard.service.ts`, `getROE`) en lugar del patrimonio contable, y la UI conserva rótulos comparativos sin dato (`kpi-fcf.ts`: `vs_budget`). | `modulos/bi-dashboard-overview-reports.md:68` |
| ❌ | IA-B05 | El cubo de ventas no existe en BD y dim_time está vacía: GET /bi/sales → 500. Ningún consumidor en frontend (grep bi/sales en apps/core/client-web sin resultados). Correcto: retirar el módu… | `modulos/bi-dashboard-overview-reports.md:69` |
| ❌ | IAM-A4 | api:typecheck falla (einvoicing/.../certificate-trust.spec.ts:25 TS2345) y 3 suites api rojas → CI en rojo (bloquea el gate 7 para TODO el backend, auth incluido). Causa en otro módulo pero… | `modulos/auth.md:48` |
| ❌ | IAM-R1 | Barrido estático: 808 handlers en 126 controladores, 0 sin @HasPermission/@Public/@AuthenticatedOnly . Deny-by-default probado: member→403 en GET/POST /roles, POST /users/invite, PATCH /use… | `modulos/roles-permisos.md:30` |
| ❌ | INV-02 | si el tenant DO no tiene una secuencia B02 vigente (o le falta el RNC), la venta se completa sin comprobante fiscal y sin advertencia al cajero ni al servidor. Ejecutado: venta a1272cdb… co… | `modulos/pos.md:98` |
| ❌ | INV-03 | el descuadre del arqueo no se contabiliza. Cierre con 1150 contados frente a 1172 esperados → closingVariance: -22, pero 0 asientos de faltante. La cuenta de caja 1110 queda 22 por encima d… | `modulos/pos.md:104` |
| ❌ | INV-04 | no hay devoluciones ni notas de crédito después del cierre del turno (voidSale → pos.sale_shift_closed), ni descuentos, ni identificación del cliente para B01/E31 (crédito fiscal). | `modulos/pos.md:108` |
| ❌ | INV-06 | no hay lotes, series ni vencimientos (grep de entidades → 0; stock_levels no tiene columna de lote). | `modulos/inventory.md:89` |
| ❌ | INV-07 | no hay reservas ni comprometido (grep reserv en inventory/supply-chain → solo comentarios). Un pedido de venta no aparta existencia, y el POS muestra el total de la empresa (/pos/catalog →… | `modulos/inventory.md:93` |
| ❌ | INV-14 | no existen conversiones ni unidades alternativas. No se puede comprar por caja y vender por unidad, y el BOM no puede consumir en gramos lo que se compra en kilos. | `modulos/units-of-measure.md:74` |
| ❌ | INV-20 | una orden puede marcarse COMPLETED con cantidad producida sin consumir componentes ni dar entrada al terminado; el inventario y el mayor no se enteran. Ejecutado (orden 619639c8…). | `modulos/manufacturing.md:75` |
| ❌ | INV-23 | los endpoints de bin-locations y landed-costs persisten registros que ningún proceso usa. Ni las existencias ni el costo cambian. Un integrador de la API creería que hay gestión por ubicaci… | `modulos/wms.md:57` |
| ❌ | INV-OP-1 | Ejecutado: BOM del terminado QA-INV-FG con 2×P1 + 0,5×P4 → 201; centro de trabajo → 201; orden QA-INV-OP-1 por 3 → 201; PATCH {status: COMPLETED, quantityProduced: 3} → 200. Stock de FG: 0;… | `modulos/manufacturing.md:43` |
| ❌ | INVT-01 | INVT-01 — Backend sin pantalla ni menú: manufacturing (15 endpoints, 4 tablas), projects (13 endpoints, 3 tablas), supply-chain (13 endpoints, 6 tablas), customer-service (8 endpoints, 3 ta… | `01-inventario-de-modulos.md:140` |
| ❌ | INVT-04 | INVT-04 — analytical-reporting, intercompany, price-lists, datasheets, legal, push-notifications, storage, geo, metrics, queues sin un solo *.spec.ts; features/payroll, features/workflow (8… | `01-inventario-de-modulos.md:143` |
| ❌ | LOC-05 | validateTaxId('MX','XAXX010101000') devuelve false con y sin tipo de contribuyente. Es el RFC genérico «público en general» que exige el CFDI 4.0 para ventas a consumidor final. En cambio X… | `modulos/localization.md:92` |
| ❌ | NOM-01 | empleado «QA-NOM Bajo», salario 15.000: AFP empleado 666,50 (=23.223×2,87 %) en vez de 430,50; SFS 705,98 en vez de 456,00; descuentos 1.372,48 (9,15 % del salario). El volante y el archivo… | `modulos/payroll.md:91` |
| ❌ | NOM-06 | salida real (GET /payroll/runs/{id}/tss/suir): cabecera # y filas NSS\|Nombre\|SalarioCotizable\|… separadas por \|; sin RNC del empleador, cédula, tipo de documento, salario ISR, otros ingreso… | `modulos/payroll.md:121` |
| ❌ | NOM-12 | Sin pruebas de integración del ciclo aprobar/pagar/asiento ni de concurrencia; prueba que consagra el dato erróneo | `modulos/payroll.md:139` |
| ❌ | NOM-20 | La cédula y el NSS se guardan EN CLARO en audit_logs aunque la tabla los cifra | `modulos/hcm.md:67` |
| ❌ | NOM-25 | Capacidades básicas de RR.HH. ausentes (vacaciones, ausencias, historial de puestos, documentos, organigrama) | `modulos/hcm.md:85` |
| ❌ | NOM-30 | features/projects/pages/dashboard.component.ts; Playwright /e/qa-do-nom-srl/projects → 404 de la app. Impacto: bloquea la venta del módulo. Esfuerzo: L. | `modulos/projects.md:53` |
| ❌ | NOM-32 | Sin costeo, aprobación ni facturación de horas; sin vínculo contable | `modulos/projects.md:57` |
| ❌ | NOM-40 | cases.controller.ts, knowledge-base.service.ts. Esfuerzo: L (rehacer como dominio). | `modulos/customer-service.md:54` |
| ❌ | NOM-42 | Modelo de portal = usuario interno; ningún rol con customer_portal:access; sin UI | `modulos/customer-service.md:58` |
| ❌ | NOM-50 | auth/auth-registration.controller.ts:314-337 (set-password-from-invitation sin consentimiento); legal-acceptance.entity.ts:55 («a re-acceptance flow would add its own»). Impacto: riesgo leg… | `modulos/legal.md:52` |
| ❌ | PLT-AUD-01 | El subscriber descarta eventos sin id en la entidad (subscriber l.106-110), y update() de TypeORM emite afterUpdate solo con los valores SET. Evidencia en BD: la cotización 5f557826… está e… | `modulos/audit.md:48` |
| ❌ | PLT-AUD-02 | Cambio de rol asignado, desactivación o cambio de organización de un usuario no quedan registrados con antes/después (BD: 0 filas UPDATE de usuarios). | `modulos/audit.md:49` |
| ❌ | PLT-DB-01 | Migraciones futuras sobre tablas grandes de clientes (journal_entry_lines, audit_logs, bank_transactions) bloquearán escrituras; sin lock_timeout una migración puede colgar el despliegue de… | `modulos/config-database.md:37` |
| ❌ | PLT-DT-01 | Pasos: qa-do-plt POST /data-transfer/imports?dataset=customers&mode=commit con c4k.csv → 500; select count(*) from customers where organization_id='99b47813…' → 100 (99 importados + consumi… **Parcial — falta:** No se valida el cupo antes del commit ni se persiste una ejecución PARTIAL; la importación sigue siendo fila a fila. | `modulos/data-transfer.md:33` |
| ❌ | PLT-DT-02 | 5.000 filas máx. y 5 MB: una migración típica (10–50k clientes/productos) exige partir en 10+ archivos a mano; sin upsert. | `modulos/data-transfer.md:34` |
| ❌ | PLT-JOB-01 | Un job de depreciación o de asientos recurrentes que falla sus 3 intentos queda en failed sin métrica ni alerta; nadie se entera hasta el cierre. | `modulos/queues-cache-jobs.md:37` |
| ❌ | PLT-MAIL-01 | No hay registro persistente de correos enviados (factura X enviada a Y, estado, rebote); tras 1 h el job desaparece de Redis. Un cliente no puede probar que envió una factura o un recordato… | `modulos/mail-inbound-mail.md:35` |
| ❌ | PLT-NOT-02 | Sin adaptador Redis: en despliegue multi-réplica sendToUser (progreso de importaciones, avisos) falla silenciosamente para la mitad de los usuarios. | `modulos/notificaciones-push-websockets.md:38` |
| ❌ | PLT-OBS-01 | /metrics responde 401/403 a todos (incluido administrador): la API es "deny by default" y la ruta de Prometheus no declara acceso → no hay forma de raspar métricas. Aun si se pudiera, no ha… | `modulos/observabilidad.md:33` |
| ❌ | PLT-SH-01 | El "núcleo compartido" depende de identidad, organizaciones, localización y 6 dominios: cualquier módulo que importe CommonModule arrastra Users/Organizations/Localization, y es la raíz de… | `modulos/shared-backend.md:36` |
| ❌ | PLT-SRCH-01 | search: Búsqueda "global" cubre 3 entidades. | `modulos/search.md:33` |
| ❌ | PLT-STO-01 | Producción arranca con STORAGE_DRIVER=local por defecto: en un despliegue con varias réplicas o contenedores efímeros los adjuntos (facturas de proveedor, evidencias, documentos) se pierden… | `modulos/storage-documents.md:35` |
| ❌ | PLTB-WF-01 | existen dos motores de flujo con responsabilidades solapadas. workflow-engine es un motor BPMN-like genérico que incluye tareas humanas y una fuente de aprobaciones; workflows es un motor d… | `modulos/workflow-engine.md:59` |
| ❌ | PLTB-WF-02 | la decisión se toma dentro de dataSource.transaction(...) pero la carga de la solicitud es manager.findOne(ApprovalRequest, { where:{id, organizationId} }) sin setLock('pessimistic_write')… | `modulos/workflows.md:60` |
| ❌ | PLTB-WF-03 | el editor de flujos (la cara comercial del motor) no tiene ninguna prueba unitaria/componente. Un cambio puede romper el editor sin señal en CI. | `modulos/workflow-engine.md:66` |
| ❌ | TES-03 | Extracto de 20.000 líneas (≈970 KB, bajo el límite de 5 MB) falla con error de Postgres; 5k tarda 11 s en la request. | `modulos/reconciliation.md:43` |
| ❌ | TES-04 | applyRules (exact único → writeMatch AUTOMATIC) llamado siempre desde importStatement | `modulos/reconciliation.md:44` |
| ❌ | TES-05 | N+1 de availableLedgerLines por transacción + 1 fila de auditoría por línea. | `modulos/reconciliation.md:45` |
| ❌ | TES-08 | No se puede anular/revertir una transferencia errónea (p.ej. la de 99.999.999). | `modulos/treasury.md:45` |
| ❌ | TES-13 | La cobranza básica no existe para el plan starter; no hay recordatorios automáticos en ningún plan. | `modulos/collections.md:44` |
| ✅ | CMP-01 | AP/procurement · accounts-payable.service.ts:766-800 (matchAgainstReceipts), POST /accounts-payable/:id/submit-for-approval. | `modulos/accounts-payable.md:57` |
| ✅ | CMP-02 | accounts-payable.service.ts:253 (taxAmount = dto.taxAmount ?? 0). | `modulos/accounts-payable.md:61` |
| ✅ | CMP-03 | accounts-payable.service.ts:516-530 (la unicidad del NCF va por vendor_id); suppliers sin unicidad de RNC. | `modulos/accounts-payable.md:65` |
| ✅ | CMP-15 | Faltan capacidades básicas del mercado medio: | `modulos/procurement.md:94` |
| ✅ | CMP-17 | Faltan básicas: No hay términos de pago, moneda, cuentas bancarias, cuenta de gasto por defecto ni estado activo/bloqueado. | `modulos/suppliers.md:76` |
| ✅ | CMP-21 | el "costo de importación" se reduce a un catálogo con método de prorrateo que nunca se aplica. Ninguna recepción ni factura de flete o aduana revaloriza el inventario. Un importador no pued… | `modulos/supply-chain.md:53` |
| ✅ | CS-01 | Portal de cliente solo por su cliente — No explotable por API, pero la FK sin guarda hace fallar same-tenant-references.spec.ts | `09-cobertura-y-verificacion.md:194` |
| ✅ | FAC-EINV-02 | No hay modo "sin transmisión": en NODE_ENV=test/development el destino por defecto es CerteCF (processValue ?? 'CerteCF') y la prueba de CI llama a ecf.dgii.gov.do (log: 3× "Fallo al valida… | `modulos/einvoicing.md:63` |
| ✅ | FAC-EINV-03 | dependencia node-forge ≤1.4.0 (npm audit high: verificación RSA PKCS#1 v1.5 acepta DigestAlgorithm anidado) usada por certificate-inspector/trust; además certificate-trust.spec.ts:25 no com… | `modulos/einvoicing.md:64` |
| ✅ | FAC-EINV-04 | endpoint y credencial por proceso, no por tenant (un SaaS con varios emisores en MX/CO no puede tener credenciales distintas). M. | `modulos/einvoicing.md:65` |
| ✅ | FAC-INV-02 | en ráfaga concurrente cerca del límite, las solicitudes que debían recibir 403 reciben 500 (10/19 en la prueba). Numeración intacta (rollback correcto). S. | `modulos/invoices.md:70` |
| ✅ | FAC-PL-04 | sin specs. M.: ## 7. Camino mínimo a producción | `modulos/price-lists.md:58` |
| ✅ | FAC-TX-01 | Un impuesto type:"Fijo" (monto) entra como tasa porcentual en la lista de tasas permitidas; probado: ITBIS 50 % aceptado en una factura DO. Forma correcta: filtrar type='Porcentaje' y, para… | `modulos/taxes.md:68` |
| ✅ | FAC-TX-02 | la tasa estándar es MAX(rate) del catálogo: cualquier tasa mayor registrada (selectivo, lujo) se convierte en tasa por defecto de productos gravados. Forma correcta: bandera isStandard o to… | `modulos/taxes.md:69` |
| ✅ | FAC-TX-03 | tasas fijas en código sin vigencia; un cambio legal (EC subió 12→15 % en 2024) exige release y no permite emitir/recalcular documentos de fechas anteriores. Forma correcta: tasas como datos… | `modulos/taxes.md:70` |
| ✅ | FE-CI-03 | ci.yml:403-405 (npm run verify:invoicing). Según el aviso del coordinador, ese verificador contacta ecf.dgii.gov.do aunque NODE_ENV=test; CI lo ejecuta en cada push y PR → tráfico real haci… | `modulos/ci-cd-infra.md:53` |
| ✅ | FIN-COA-03 | chart-of-accounts/localization · Multi-país: localization/fiscal/coa-builder.ts:370-393: para todo país no US/BR se usan "AFP por Pagar (TSS)", "SFS por Pagar (TSS)", "SRL e INFOTEP por Pag… | `modulos/chart-of-accounts.md:71` |
| ✅ | FIN-JE-01 | en modo "moneda por línea" el servidor guarda foreignCurrencyDebit/Credit y exchangeRate tal como llegan, sin resolver la tasa ni comprobar debit ≈ foreign×rate. Ejecutado: POST con línea {… | `modulos/journal-entries.md:57` |
| ✅ | FINB-31 | consolidation.service.ts:852-913 + intercompany.service.ts:180-195, 314-329. La eliminación intragrupo reduce fromAccountId en activos y toAccountId en pasivos, pero en intercompañía esas s… | `modulos/consolidation.md:44` |
| ✅ | FINB-32 | consolidation.service.ts:935-940 (void revenueLines; void expenseLines): ingresos/gastos intragrupo nunca se eliminan (NIIF 10.B86(c)). M. | `modulos/consolidation.md:46` |
| ✅ | FINB-33 | sin pantalla/menú (grep en client-web). M. | `modulos/consolidation.md:48` |
| ✅ | IA-B03 | salesToday/sales_yesterday filtran solo status <> Draft: cuentan facturas Void y suman CreditNote en positivo (la tendencia sí resta NC, :90-96). Correcto: excluir Void, restar NC; prueba.… | `modulos/bi-dashboard-overview-reports.md:67` |
| ✅ | JUR-01 | jurisdictions-geo: jurisdictions/payroll · arquitectura/multi-país | `modulos/jurisdictions-geo.md:59` |
| ✅ | LOC-02 | todo tenant hispano (MX, CO, CL, PE, AR, UY, GT…) recibe «AFP por Pagar (TSS)», «SFS por Pagar (TSS)», «SRL e INFOTEP por Pagar» y «Aportes Patronales (TSS/INFOTEP)», que son instituciones… | `modulos/localization.md:69` |
| ✅ | LOC-03 | el formulario de factura de BR (pt-BR) exige «uma faixa de comprovantes vigente, tradicional (série B) ou eletrônica (série E)», que es el modelo NCF de la DGII. BR también muestra el aviso… | `modulos/localization.md:76` |
| ✅ | LOC-06 | las tasas del IVA, ITBIS, IGV, etc. están en constantes TS (country-tax-schemes.ts:61-145) y la tabla taxes no tiene effective_from/to (comprobado en information_schema). Un cambio de tasa… | `modulos/localization.md:98` |
| ✅ | NOM-02 | valores reales 19.351,50 (02/2024), 21.674,80 (04/2025). Corrida «QA-NOM retro enero» 01/2026 (luego anulada): AFP empleado de «Tope» = 5.740 (tope 200.000) cuando correspondía ~12.441 (top… | `modulos/payroll.md:98` |
| ✅ | NOM-03 | Deducciones (y novedades) con monto negativo aumentan el neto sin pasar por ISR ni TSS | `modulos/payroll.md:104` |
| ✅ | NOM-04 | Carrera calcular↔aprobar: se reescriben los volantes de una corrida ya aprobada | `modulos/payroll.md:110` |
| ✅ | PLTB-DT-01 | npm audit reporta Electron high en rango 44.0.0-alpha.1 - 44.9.0 — mitigación de certificados intermedios eMudhra comprometidos (high) y atribución de permiso pointer-lock a marco equivocad… | `modulos/desktop.md:58` |
| ✅ | PLTB-DT-02 | los binarios se empaquetan sin firma de código (ni identidad/notarización mac ni certificado win) y no hay mecanismo de actualización. Distribuir así provoca advertencias de Gatekeeper/Smar… | `modulos/desktop.md:65` |
| ✅ | TES-02 | Tras cobrar USD 200 en cuenta USD, GET /treasury/cash-position → balanceInAccountCurrency: 1000 (debería 1.200) con base 72.400. Las transferencias sí guardan divisa. Rompe conciliación y r… | `modulos/customers.md:63` |
| ✅ | XF-09 | la factura resuelve la tasa del día (60,1234), la pasa al servicio de asientos como tasa «declarada», este la redondea a 2 decimales (60,12) y la compara con la resuelta usando la toleranci… | `06-flujos-cruzados.md:189` |

## Severidad media (168)

| | ID | Hallazgo | Ficha |
|---|---|---|---|
| ❌ | CMP-05 | accounts-payable: AP/localización · Multi-país · localization/fiscal/withholding-regimes.ts:112-170. **Parcial — falta:** Faltan regímenes frecuentes que la ficha cita (ITBIS 30 % entre personas jurídicas para ciertos servicios, pagos al exterior); hoy el inquilino los configura. Verificar con contador local. | `modulos/accounts-payable.md:71` |
| ❌ | CMP-06 | POST /procurement/orders/:id/receive con quantity: 0.0000001 → 500 (TypeError ... isNumber ... reading 'length', class-validator IsNumber maxDecimalPlaces con notación científica; logs/api.… | `modulos/accounts-payable.md:74` |
| ❌ | CMP-07 | GET /accounts-payable (findAll, línea 1507) sin paginación ni límite: devuelve todas las facturas con sus relaciones. Las OC sí paginan. Esfuerzo: S. | `modulos/accounts-payable.md:76` |
| ❌ | CMP-08 | Un borrador no admite editar líneas (lines_existing_invoice_must_changed_through) ni borrarse (DELETE siempre rechazado): un error de captura en borrador solo se corrige anulando y recaptur… | `modulos/accounts-payable.md:78` |
| ❌ | CMP-11 | La captura IA envía el PDF o imagen completo a Anthropic (ai-gateway.service.ts:147, ANTHROPIC_API_KEY). En este entorno no hay clave: 503, sin datos enviados. No vi consentimiento por inqu… | `modulos/accounts-payable.md:84` |
| ❌ | CMP-12 | Probado en vivo: dos sesiones con step-up pagaron a la vez los 4.673 pendientes de la factura 37fb0300. Resultado: una 201 (PAY-2026-000002) y una 400 bill_id_status_cannot_take_payment. La… | `modulos/accounts-payable.md:86` |
| ❌ | CMP-13 | purchase-orders.service.ts:328.: La separación de funciones depende de cuántos usuarios hay y no de una política. | `modulos/procurement.md:80` |
| ❌ | CMP-14 | purchase_order_receipts.lines es JSONB.: No hay FK a purchase_order_lines ni a productos. | `modulos/procurement.md:87` |
| ❌ | CMP-18 | Auditoría: Los cambios de RNC, email o banco no dejan rastro. | `modulos/suppliers.md:80` |
| ❌ | CMP-19 | Media · Rendimiento: No hay índice en organization_id. | `modulos/suppliers.md:83` |
| ❌ | CMP-22 | entidades de stock declaradas en supply-chain, y nombre de módulo distinto de su ruta. | `modulos/supply-chain.md:59` |
| ❌ | CMP-24 | En qa-us-a y en qa-mx-a, una factura con taxWithheld: 100 sin motivo se guardó (201) con la retención en 0, sin error ni aviso. En US el código (withholding-resolver.service.ts:195-205) dic… | `modulos/accounts-payable.md:88` |
| ❌ | FAC-CMP-04 | compliance: informes síncronos sin paginación/streaming. M. | `modulos/compliance.md:63` |
| ❌ | FAC-CMP-05 | registrar un rango nuevo desactiva el activo con números restantes (compliance.service.ts:283); sin confirmación ni rastro en API. Verificar con el equipo. S. | `modulos/compliance.md:64` |
| ❌ | FAC-EINV-05 | dos modelos de rango (ncf_sequences vs fiscal_document_ranges) con validaciones duplicadas (compliance.service.ts:200-300 vs fiscal-range.service.ts). M. | `modulos/einvoicing.md:66` |
| ❌ | FAC-INV-04 | PlanLimitCheckGuard corre antes de IdempotencyInterceptor: reintento con clave ya usada → 403 en lugar de la respuesta original (probado fac-k1). Además el guard bloquea crear borradores al… | `modulos/invoices.md:72` |
| ❌ | FAC-INV-06 | US: ready:true y factura con impuesto 0 sin jurisdicciones configuradas, pese a configurationRequired:true en country-tax-schemes.ts (probado). Debería exigir nexo configurado o confirmar e… | `modulos/invoices.md:74` |
| ❌ | FAC-INV-07 | invoices.service.ts 1.924 líneas, 30+ métodos; comentario de resolveLine contradice el código. M. | `modulos/invoices.md:75` |
| ❌ | FAC-SAL-02 | quotes.service.ts:274-321 conversión con compensación manual fuera de transacción; un fallo entre reclamo y creación deja la cotización INVOICED sin factura. Forma correcta: una transacción… | `modulos/sales.md:59` |
| ❌ | FAC-SAL-03 | quotes.service.ts:300-306 no traslada taxTreatment/taxRate de la línea cotizada; si el catálogo cambia entre cotización y factura, el total facturado difiere del aceptado sin aviso. S. | `modulos/sales.md:60` |
| ❌ | FAC-SAL-05 | listado de cotizaciones sin paginación. S. | `modulos/sales.md:62` |
| ❌ | FAC-TX-04 | reducidas ausentes (PE 10 % restaurantes, EC 5 %, CR 1/2/4 %, PA 10/15 %, VE 8 %, HN 18 %); el validador de factura rechaza esas tasas salvo que el tenant las cree a mano (y entonces cualqu… | `modulos/taxes.md:71` |
| ❌ | FAC-TX-05 | borrado físico sin control de uso ni auditoría; probado borrar "ITBIS 18 %" → 200 (restaurado después por API). S. | `modulos/taxes.md:72` |
| ❌ | FE-CI-05 | repo. Solo existe apps/ai-engine/Dockerfile; api, client-web y pos no tienen imagen ni pipeline de despliegue (README describe deploy manual en Render solo para el cliente). Esfuerzo M. | `modulos/ci-cd-infra.md:55` |
| ❌ | FE-CI-06 | GitHub. 0 tags, 0 releases, sin CHANGELOG.md: imposible decir a un cliente qué versión corre ni hacer rollback a una versión. Esfuerzo S. | `modulos/ci-cd-infra.md:56` |
| ❌ | FE-CI-07 | CI. npm audit (128 vulns, 15 high: node-forge ≤1.4.0, @angular/router, electron…) no es gate; CodeQL falla sin bloquear. Esfuerzo S. **Parcial — falta:** `npm audit` no es una puerta para el monorepo completo; @angular/router y el resto siguen sin revisar. | `modulos/ci-cd-infra.md:57` |
| ❌ | FE-DOC-02 | raíz del repo. Sin ADRs, CONTRIBUTING, CHANGELOG ni SECURITY.md: las decisiones (empresa en la URL, manifiestos, DO como piloto) solo constan en comentarios de código y mensajes de commit;… | `modulos/documentacion-gobernanza.md:37` |
| ❌ | FE-DOC-03 | docs/ESTADO_MVP_REPUBLICA_DOMINICANA.md (fecha 2026-09-11, rama feat/merge-enigma-improvements). Documento de estado obsoleto que contradice el código actual (nómina). Sin marca de vigencia… | `modulos/documentacion-gobernanza.md:38` |
| ❌ | FE-DOC-04 | README.md:3. «~55 módulos ERP» sin aclarar que varios dominios solo existen como API (FE-NAV-01) ni qué se soporta por país. S. | `modulos/documentacion-gobernanza.md:39` |
| ❌ | FE-LIB-01 | libs/shared/types/src/lib/accounting/account-classification.contract.ts:10-25. Invariante del plan de cuentas en una librería compartida por todas las apps: cualquier cambio contable obliga… | `modulos/libs-shared.md:37` |
| ❌ | FE-NAV-02 | navegacion-y-cobertura-ux: core/guards/settings-modal-redirect.guard.ts:12-13 (= FE-SH-02). S. | `modulos/navegacion-y-cobertura-ux.md:44` |
| ❌ | FE-NAV-03 | rutas autenticadas con prefijo de idioma pierden destino (= FE-SH-03). S–M. | `modulos/navegacion-y-cobertura-ux.md:45` |
| ❌ | FE-NAV-04 | menú muestra funciones fuera de plan (cobranza IA, predicciones, informe del gerente, anomalías, flujo de caja proyectado, SSO) con mensaje técnico (= FE-SH-05). S. | `modulos/navegacion-y-cobertura-ux.md:46` |
| ❌ | FE-NAV-06 | no hay humo de navegación en CI pese a que el manifiesto lo hace trivial. S. | `modulos/navegacion-y-cobertura-ux.md:48` |
| ❌ | FE-SET-02 | core/guards/settings-modal-redirect.guard.ts:12-13. Todo enlace /settings/<sección> abre la sección «e». (= FE-SH-02). S. | `modulos/settings.md:50` |
| ❌ | FE-SET-03 | apps/core/client-web/src/environments/environment.ts:16, environment.development.ts:16. Clave de Google Maps (tipo API key de navegador, AIzaSyCn) versionada en el repo; producción usa marc… | `modulos/settings.md:51` |
| ❌ | FE-SH-02 | core/guards/settings-modal-redirect.guard.ts:12-13. Cualquier enlace a /settings/<sección> (marcadores, correos, notificaciones con ruta) abre #settings/e, porque el guard asume que la URL… | `modulos/frontend-shell.md:51` |
| ❌ | FE-SH-03 | matcher de idioma / organizationRouteGuard. /es/invoices, /en/e/<org>/invoices → overview, y /en/ no cambia idioma: los enlaces localizados (los que usan las páginas públicas y los correos… | `modulos/frontend-shell.md:52` |
| ❌ | FE-SH-04 | apps/core/client-web/project.json:79-80. Bundle inicial 2,00 MB > 1,60 MB; el budget es solo aviso (error a 4 MB) → CI no lo frena. exceljs se importa estáticamente en features/invoices/det… | `modulos/frontend-shell.md:53` |
| ❌ | FE-SH-05 | páginas collections, inventory/predictions, reports/manager-report, reports/anomalies, accounting/treasury/cash-flow, settings sso/integrations/ai. Funciones no incluidas en el plan aparece… | `modulos/frontend-shell.md:54` |
| ❌ | FE-SH-06 | overview/dashboard. La página de inicio no conoce los permisos: para un miembro hace 13 peticiones 403 (/dashboard/kpi/*, /dashboard/alerts, /accounting/current-period) y registra ERROR Htt… | `modulos/frontend-shell.md:55` |
| ❌ | FIN-AC-02 | accounting · Eje 2 · Integridad · Media | `modulos/accounting.md:62` |
| ❌ | FIN-AC-06 | accounting · Eje 4 · Arquitectura · Media | `modulos/accounting.md:77` |
| ❌ | FIN-AR-02 | Vista materializada única para todos los tenants creada por DDL en runtime (synchronizeView), con columnas derivadas de nombres de dimensiones de todos los clientes; fuera del control de mi… | `modulos/financial-reporting.md:64` |
| ❌ | FIN-COA-04 | chart-of-accounts · Eje 1/4 · Bug · Media | `modulos/chart-of-accounts.md:75` |
| ❌ | FIN-COA-05 | chart-of-accounts · Eje 2 · Integridad · Media | `modulos/chart-of-accounts.md:78` |
| ❌ | FIN-DIM-01 | Filtros por valor padre no incluyen hijos (ADM devuelve 10 de 20). Ubicación: filtro de dimensión en financial-reporting.service.ts (igualdad JSONB). Forma correcta: expandir con dimension_… | `modulos/dimensions.md:43` |
| ❌ | FIN-DIM-02 | Dimensión referida por nombre en JSONB (journal_entry_lines.dimensions), sin integridad referencial; impide renombrar y obliga a contar uso por texto. Esfuerzo: M. | `modulos/dimensions.md:45` |
| ❌ | FIN-FR-03 | Un solo formato IFRS para los 19 países; sin estados en formato oficial (DO, MX, CO…). Esfuerzo: L. | `modulos/financial-reporting.md:70` |
| ❌ | FIN-JE-02 | POST con fecha 2027-03-01 (hoy 2026-11-07) → 201 y crea silenciosamente el ejercicio 2027 y sus 12 períodos (fiscal_years 2027 OPEN). Sin límite ni advertencia de fecha futura; un error de… | `modulos/journal-entries.md:63` |
| ❌ | FINB-05 | exchange-rates.service.ts:246, 287-297, 369 (upsert/delete por criterio no disparan el subscriber). Alta, import y borrado de tasas no dejan rastro en audit_logs. S. | `modulos/currencies.md:51` |
| ❌ | FINB-11 | depreciation-schedule.ts:201-216. SYD con vida 18 meses: 12×100, 5×50 y 350 en el último mes (años = ceil(18/12) reparte el año 2 en 12 meses). DDB 12 meses: último mes 134,58 frente a 26,9… | `modulos/fixed-assets.md:59` |
| ❌ | FINB-12 | depreciation-schedule.ts:148-152, fixed-assets.service.ts:318. Convención fija de mes completo: alta el 31-01 deprecia enero completo (166,67); el mes de la baja nunca se deprecia. Sin opci… | `modulos/fixed-assets.md:61` |
| ❌ | FINB-14 | dto/fixed-asset.dto.ts:44 (solo regex). acquisitionDate":"2026-02-30" → HTTP 500 (QueryFailedError: date/time field value out of range, api.log). Usar validador de fecha real (IsIsoDate). S. | `modulos/fixed-assets.md:63` |
| ❌ | FINB-15 | fixed-assets.service.ts:57 ("registering posts nothing"). Registro 122.800 de costo frente a 1210 = 0 en el mayor; no hay informe de conciliación registro↔mayor ni vínculo obligatorio con l… | `modulos/fixed-assets.md:65` |
| ❌ | FINB-23 | budget-control.service.ts:123-137, budgets.service.ts:200-241. Línea sin dimensiones solo cuenta reales con dimensions = {}: el gasto etiquetado con centro de costo queda fuera del presupue… | `modulos/budgets.md:47` |
| ❌ | FINB-24 | budgets.service.ts:121-133, 139 (update/delete por criterio). Cambios y borrados de presupuesto sin rastro. S. | `modulos/budgets.md:49` |
| ❌ | FINB-42 | cuentas IC por defecto no aprovisionadas (organization_settings.default_intercompany_* NULL) → 400 intercompany.default_intercompany_accounts_not_configured_one en todo tenant nuevo (por có… | `modulos/intercompany.md:40` |
| ❌ | FINB-43 | intercompany.controller.ts:35-37 PeriodLockGuard solo para el origen; el destino con período cerrado agota 5 reintentos y queda FAILED con asiento de origen ya contabilizado (espejo roto, v… | `modulos/intercompany.md:42` |
| ❌ | GEO-01 | geo · eje 8 · seguridad · Media. x-forwarded-for es controlable por el cliente (geo.controller.ts:14-19). Sirve para falsear la ubicación de la sesión y evadir el viaje imposible. Forma cor… | `modulos/jurisdictions-geo.md:61` |
| ❌ | I18N-01 | i18n · UX/multi-país: I18N-02 · i18n · eje 3 · multi-país · Media (también LOC-04). Términos DO en la base es; detalle en la ficha localization. Esfuerzo S. | `modulos/i18n.md:56` |
| ❌ | IA-01 | Con plan sin ai_assistant cada página dispara un 403 y error de consola (Playwright, qa-do-fac: overview, reports, data-quality…). Correcto: consultar /ai/status/plan antes; no montar el pa… | `modulos/ai.md:67` |
| ❌ | IA-02 | El menú y el hub ofrecen funciones fuera del plan; Informe del gerente muestra estado vacío ante 403; anomalías/predicciones muestran la clave ai_anomalies. Correcto: gating por feature en… | `modulos/ai.md:68` |
| ❌ | IA-04 | Nombre idéntico tras normalizar da similarity*0.75 = 0.75 < MIN_SCORE 0.8: dos clientes con el mismo nombre y sin otro dato común nunca se sugieren (probado: scan found:0). Correcto: nombre… | `modulos/ai.md:70` |
| ❌ | IA-05 | Enmascarado por regex de clave omite cpf, cnpj, cuit, cuil, ruc, curp, rut, dui, nis; además search_customers/search_suppliers están exentos: identificadores fiscales y correos van al prove… | `modulos/ai.md:71` |
| ❌ | IA-07 | El presupuesto en USD se comprueba antes de la llamada y el gasto se registra después: N peticiones concurrentes en el umbral pasan todas (sobregiro acotado por créditos del plan). Correcto… | `modulos/ai.md:73` |
| ❌ | IA-08 | El permiso de cada herramienta se declara a mano en paralelo al @HasPermission del controlador equivalente (hoy coinciden: list_quotes=INVOICES_VIEW como quotes.controller.ts:45); no hay pr… | `modulos/ai.md:74` |
| ❌ | IA-B06 | Quick ratio trae todos los productos (inventoryService.findAll) y resta cost*stock operativo de activos corrientes contables (mezcla de fuentes). Correcto: saldo de cuentas de inventario. S. | `modulos/bi-dashboard-overview-reports.md:70` |
| ❌ | IA-B09 | Valor truncado ("RD$14,871….") y rótulos comparativos sin cifra. S. | `modulos/bi-dashboard-overview-reports.md:73` |
| ❌ | IA-E01 | La calidad del pronóstico solo se mide con series sintéticas; no hay umbral de precisión que falle CI ni reporte sobre datos reales. Correcto: conjunto de backtest anonimizado y umbral MASE… | `modulos/ai-engine.md:60` |
| ❌ | IAM-A2 | auth.controller.ts:244,370,381,404. @UsePipes(new ValidationPipe()) (sin opciones) en change-password, forgot-password, reset-password, unlock-account anula el pipe global (pierde whitelist… | `modulos/auth.md:46` |
| ❌ | IAM-A3 | headers CSP. script-src 'self' 'unsafe-inline' debilita la defensa XSS; sin Strict-Transport-Security en respuestas (probablemente añadido en el borde TLS en prod | `modulos/auth.md:47` |
| ❌ | IAM-O2 | El ataque cross-tenant de sucursal (GET/PATCH/DELETE /organizations/branches/217c7e1c… desde qa-do-b) no se pudo ejecutar porque el throttle de login de localhost (5/min/IP, compartido) est… | `modulos/organizations.md:49` |
| ❌ | IAM-O3 | logs/boundaries-report.log: ciclos configuración↔identidad y configuración↔plataforma. Impacto: deuda técnica. Esfuerzo: M. | `modulos/organizations.md:50` |
| ❌ | IAM-P2 | payment-provider.ts:28-29, env.validation.ts:485-495. Si no hay STRIPE_SECRET_KEY, el proveedor por defecto es simulated, que "completa checkouts sin cobrar". Está bloqueado fuera de dev/te… | `modulos/saas-payment.md:51` |
| ❌ | IAM-P3 | stripe-payment.adapter.ts:653-700. La idempotencia es un findOne y luego save dentro de la transacción (READ COMMITTED). Dos entregas simultáneas del mismo evento pasan el findOne; la segun… | `modulos/saas-payment.md:52` |
| ❌ | IAM-P4 | GET /saas/usage: qa-do-a está en users 2/2 (plan starter). No verifiqué si POST /users/invite rechaza en servidor al superar el límite (requería step-up más una invitación real). saas.confi… | `modulos/saas-payment.md:53` |
| ❌ | IAM-R3 | deuda que erosiona el type-safety del control de acceso. Forma correcta: tipar permisos/roles sin any. Impacto: deuda técnica. Esfuerzo: M. | `modulos/roles-permisos.md:50` |
| ❌ | IAM-S1 | config/env.validation.ts:445-452. RECAPTCHA_DISABLED vale false por defecto en producción, pero un true explícito se acepta en producción, y entonces RECAPTCHA_V3_SECRET_KEY deja de ser obl… | `modulos/security-onboarding.md:46` |
| ❌ | IAM-S2 | apps/core/client-web/src/environments/environment.ts:16 y environment.development.ts:16: clave de API de Google Maps escrita en el código (AIzaSy…J6yQ, valor enmascarado). Es una clave de n… | `modulos/security-onboarding.md:47` |
| ❌ | IAM-U3 | lint api (parte de 522 warnings). Esfuerzo: M. | `modulos/users.md:41` |
| ❌ | INV-05 | el enum CostingMethod incluye FIFO, LIFO y STANDARD. Si un producto los tuviera, receiveGoods no recalcularía el costo, mientras que los ajustes promedian igualmente. Ningún DTO permite ele… | `modulos/inventory.md:83` |
| ❌ | INV-08 | el libro stock_movements no es append-only (no tiene trigger, a diferencia de audit_logs); no hay CHECK de no negatividad en stock_levels (verificado con \d stock_levels); organization_id a… | `modulos/inventory.md:96` |
| ❌ | INV-09 | las entidades de existencias viven en supply-chain pero las escribe inventory; inventory-posting importa 20 internos de journal-entries y organizations; Product se usa como entidad comparti… | `modulos/inventory.md:100` |
| ❌ | INV-10 | crear y contabilizar una transferencia no deja rastro en audit_logs (consulta por entidad: no aparece stock_transfers). | `modulos/inventory.md:104` |
| ❌ | INV-11 | la transferencia es instantánea (salida y entrada en el mismo acto); no hay estado en tránsito, recepción parcial ni diferencias de recepción. | `modulos/inventory.md:107` |
| ❌ | INV-12 | el costo es uno por empresa y no por almacén (inventory.service.ts:345, comentario «because the cost is one per product»). Transferir entre sucursales con costos logísticos distintos no se… | `modulos/inventory.md:110` |
| ❌ | INV-15 | no hay mapeo a los catálogos oficiales de unidad para la factura electrónica (MX ClaveUnidad, CO, PE). Verificar con la familia FAC cómo resuelve hoy la FE la unidad. | `modulos/units-of-measure.md:80` |
| ❌ | INV-17 | pos_sales."shiftId" no tiene FK (\d pos_sales), no hay correlativo de ticket por caja y la Z no tiene número correlativo. | `modulos/pos.md:112` |
| ❌ | INV-18 | el catálogo POS muestra el stock total de la empresa (/pos/catalog), mientras la venta descuenta del almacén de la sucursal o del almacén por defecto (stock-ledger.service.ts en resolveWare… | `modulos/pos.md:115` |
| ❌ | INV-21 | no hay máquina de estados (COMPLETED→PLANNED aceptado), product_id no tiene FK y los decimales se devuelven como string. | `modulos/manufacturing.md:81` |
| ❌ | INVT-02 | INVT-02 — Pantallas "roadmap" sin funcionalidad: features/manufacturing, features/wms, features/projects contienen solo pages/dashboard.component.ts con un panel de hoja de ruta (clases .ro… | `01-inventario-de-modulos.md:141` |
| ❌ | LOC-07 | las reglas de un país están repartidas en al menos 8 archivos de código: | `modulos/localization.md:104` |
| ❌ | LOC-09 | La cobertura de UY, PY y los demás «genéricos» dice taxDetermination: not-implemented, pero se aprovisionan IVA 22/10/0 y se validan. | `modulos/localization.md:118` |
| ❌ | LOC-10 | completePendingRegistration no vuelve a validar el identificador fiscal y marca tax_id_verified_at = now() (registration.service.ts:286-290). Los tenants QA de GT y UY se crearon con el RNC… | `modulos/localization.md:125` |
| ❌ | NOM-07 | INFOTEP del trabajador modelado sobre la regalía pascual | `modulos/payroll.md:126` |
| ❌ | NOM-08 | Regalía pascual por «meses tocados», no por salario devengado | `modulos/payroll.md:129` |
| ❌ | NOM-09 | «Parámetros de empresa» (US/otros) que ningún cálculo usa | `modulos/payroll.md:132` |
| ❌ | NOM-10 | payroll-concept.entity.ts:90 accountId vs payroll-accounting.service.ts (todas las deducciones y beneficios a accountsPayable). Esfuerzo: S. | `modulos/payroll.md:135` |
| ❌ | NOM-11 | Cálculo N+1 síncrono en una sola transacción | `modulos/payroll.md:137` |
| ❌ | NOM-13 | entities/payslip.entity.ts (afp/sfs/srl/infotep), payroll-accounting.service.ts (cuentas AFP/SFS/INFOTEP); cada país nuevo exige migrar la tabla. Rehacer como líneas por régimen. Esfuerzo:… | `modulos/payroll.md:141` |
| ❌ | NOM-21 | Quien tiene * o hcm:view_sensitive recibe cédula y cuenta bancaria en el LISTADO sin step-up ni auditoría | `modulos/hcm.md:74` |
| ❌ | NOM-22 | Un tenant puede vincular un empleado a un usuario de OTRO tenant | `modulos/hcm.md:77` |
| ❌ | NOM-23 | Fechas y estado incoherentes; salario sin control de mínimo legal | `modulos/hcm.md:80` |
| ❌ | NOM-31 | dto/create-project.dto.ts, dto/create-timesheet.dto.ts:24-26, projects.service.ts updateTimesheet. Esfuerzo: S. | `modulos/projects.md:55` |
| ❌ | NOM-33 | Sin FK en projects.customer_id, sin índices por tenant, listados sin paginación | `modulos/projects.md:59` |
| ❌ | NOM-43 | afterAll llama dos veces a dropTestOrganization (que destruye el DataSource, common/database/testing/integration-db.ts:46-50) y luego dataSource.destroy() → CannotExecuteNotConnectedError (… | `modulos/customer-service.md:60` |
| ❌ | NOM-44 | Concesiones de portal sin auditoría; GET /cases sin paginación ni índice | `modulos/customer-service.md:62` |
| ❌ | NOM-51 | verificar con abogado local (Ley 172-13 DO, LFPDPPP MX, LGPD BR…). Esfuerzo: M. | `modulos/legal.md:54` |
| ❌ | NOM-53 | legal: Sin pruebas · Esfuerzo: S. | `modulos/legal.md:58` |
| ❌ | PLT-AUD-03 | Si el INSERT del trail falla, la operación sigue y solo hay logger.error; no hay métrica ni conciliación implementada (el comentario dice que "la conciliación es el control", grep reconcil… | `modulos/audit.md:50` |
| ❌ | PLT-AUD-04 | Sin índice compuesto (organization_id, created_at) ni retención/particionado; tabla de crecimiento ilimitado. | `modulos/audit.md:51` |
| ❌ | PLT-AUD-05 | Inmutabilidad depende de trigger y privilegios; un superusuario/propietario la desactiva sin rastro y TRUNCATE no lo cubre el trigger (sí lo cubre el privilegio). Sin hash encadenado. | `modulos/audit.md:52` |
| ❌ | PLT-CFG-01 | env.validation.ts (DB_SSL default false; STORAGE_DRIVER default local; DB_SSL_REJECT_UNAUTHORIZED true) | `modulos/config-database.md:39` |
| ❌ | PLT-DB-02 | 66 migraciones con UPDATE/INSERT masivos en una transacción. | `modulos/config-database.md:38` |
| ❌ | PLT-DT-03 | export síncrono hasta 100.000 filas en memoria dentro de la request (l.51-52,126). | `modulos/data-transfer.md:35` |
| ❌ | PLT-DT-04 | plantilla de clientes (GET /data-transfer/datasets/customers/template con qa-us-a) con ejemplo DO (RNC, Santo Domingo). | `modulos/data-transfer.md:36` |
| ❌ | PLT-JOB-02 | El advisory lock se libera al terminar: dos réplicas con relojes desfasados ejecutan el mismo job en serie. Mitigado donde se usa SchedulerLockService.runOnce; no en los demás. | `modulos/queues-cache-jobs.md:38` |
| ❌ | PLT-JOB-03 | Muestra solo los trabajos del tenant dentro de los últimos 60 globales por cola. | `modulos/queues-cache-jobs.md:39` |
| ❌ | PLT-MAIL-02 | Sin jobId/deduplicación ni outbox: doble envío por reintento, o envío de un documento cuya transacción luego hace rollback. | `modulos/mail-inbound-mail.md:36` |
| ❌ | PLT-MAIL-03 | Tokens de reset/invitación y PDFs en claro en Redis (1 h completados; indefinido fallidos). | `modulos/mail-inbound-mail.md:37` |
| ❌ | PLT-MW-01 | sin límite: un aprobador con miles de pendientes recibe todo. | `modulos/my-work.md:33` |
| ❌ | PLT-MW-02 | fuente caída se oculta como "no hay pendientes"; el aprobador cree que no tiene trabajo. | `modulos/my-work.md:34` |
| ❌ | PLT-NOT-03 | Push web enviado en serie dentro de la request que crea el aviso; un endpoint lento bloquea la operación de negocio. | `modulos/notificaciones-push-websockets.md:39` |
| ❌ | PLT-OBS-03 | Cardinalidad ilimitada (una serie por tenant) y dato de tenant en sistema de métricas. | `modulos/observabilidad.md:35` |
| ❌ | PLT-OBS-04 | Los logs de jobs no llevan request-id de origen ni tenant de forma uniforme (ej. MailProcessor loguea template, recipientHash, no organización). | `modulos/observabilidad.md:36` |
| ❌ | PLT-SH-02 | shared/document-sequences/* (controlador, servicio, entidad), shared/statements/partner-statement.ts, shared/numbering/document-numbers.ts | `modulos/shared-backend.md:37` |
| ❌ | PLT-SRCH-02 | search: ILIKE secuencial en tablas grandes. | `modulos/search.md:34` |
| ❌ | PLT-SRCH-03 | imports directos de servicios de 3 dominios. | `modulos/search.md:35` |
| ❌ | PLT-STO-02 | Sin lista de tipos permitidos, sin verificación de contenido y sin antivirus; MIME del cliente persistido y reenviado. Probado: .html (text/html), .svg, .exe → 201. | `modulos/storage-documents.md:36` |
| ❌ | PLT-STO-03 | El guard de traversal (resolve) no tiene prueba. | `modulos/storage-documents.md:37` |
| ❌ | PLTB-EXT-01 | con una extensión firmada que agota memoria (for(;;){a.push(new Array(1e6).fill(7))}, límite 128 MB), el isolate se dispone y el catch invoca getHeapStatisticsSync() sobre un isolate ya dis… | `modulos/extensions.md:59` |
| ❌ | PLTB-EXT-02 | operaciones sensibles de catálogo (publicar versión, revocar, otorgar consentimiento/capacidades) no escriben auditoría de negocio (quién/cuándo/antes/después). Hay log [SECURITY] solo en d… | `modulos/extensions.md:66` |
| ❌ | PLTB-WF-04 | endpoints que listan personas/asignables; no verifiqué que el conjunto esté estrictamente limitado al tenant ni que no filtre datos sensibles (correo). Requiere confirmación. | `modulos/workflow-engine.md:72` |
| ❌ | PLTB-WF-05 | workflows · eje 9 · Categoría: pruebas · Severidad: media | `modulos/workflows.md:68` |
| ❌ | TES-06 | client-web/.../data/reconciliation.service.ts:303-304 envía {}; backend ReopenStatementDto.reason obligatorio (MinLength 5) | `modulos/reconciliation.md:46` |
| ❌ | TES-07 | Regla CREATE_ENTRY con targetAccountId = 1130 CxC (cuenta control) → 201; contabilizaría sin subledger y descuadra antigüedad vs mayor. | `modulos/reconciliation.md:47` |
| ❌ | TES-09 | Política de saldo negativo por tipo de cuenta (CASH nunca); fecha ≥ inicio de operaciones. | `modulos/treasury.md:46` |
| ❌ | TES-10 | dto/bank-account.dto.ts:60-62 (currencyCode solo IsString) y createBankAccount | `modulos/treasury.md:47` |
| ❌ | TES-11 | customers: create-customer.dto.ts:126-129 (totalBilled), country solo @IsString | `modulos/customers.md:64` |
| ❌ | TES-12 | Default por tipo de persona; normalización de formatos oficiales. | `modulos/customers.md:65` |
| ❌ | TES-14 | customer-payments.service.ts:361,639 escriben invoices; import de accounts-payable.service | `modulos/customers.md:66` |
| ❌ | TES-17 | customers.service.ts findAll / customer-payments.service.ts findAll sin límite por defecto. | `modulos/customers.md:67` |
| ❌ | TES-18 | 2 consumos simultáneos del mismo anticipo → 1×201, 1×400 (correcto hoy), pero solo porque nextReceiptNumber serializa por la fila de secuencia antes de leer el anticipo. Un cambio de orden… | `modulos/customers.md:68` |
| ❌ | TES-20 | manifiesto ventas.manifest.ts:81-90 muestra «Cobranza» y la página recibe 403. | `modulos/collections.md:45` |
| ❌ | TES-21 | Recordatorio con datos de la factura a cualquier dirección (no ejecutado). | `modulos/collections.md:46` |
| ❌ | XF-01 | el importador trata debitColumn como entrada de dinero (perspectiva del libro), lo contrario de cómo los bancos rotulan el extracto (Débito = cargo/salida). Con el CSV en convención bancari… | `06-flujos-cruzados.md:207` |
| ❌ | XF-02 | se aceptaron dos extractos de la misma cuenta y el mismo rango (2026-11-07 a 2026-11-07, bb031719… y e3b5c857…); solo se rechaza un archivo con el mismo hash. Quedan dos extractos abiertos… | `06-flujos-cruzados.md:213` |
| ❌ | XF-05 | el 2026-11-08 se cerró «Noviembre 2026» (fin 2026-11-30) con la lista de verificación incompleta (unreconciled-bank-transactions = 4, isCompleted:false). El servicio solo exige el cierre se… | `06-flujos-cruzados.md:195` |
| ❌ | XF-07 | taxId:"XAXX010101000" (RFC genérico de público en general del SAT) → 422 contacts.customer_form.document_invalid. El SAT exige usar el RFC genérico en ventas a público en general y XEXX0101… | `06-flujos-cruzados.md:219` |
| ❌ | XF-08 | PATCH /taxes/:ITBIS18 {rate:19} → 200, pero el preview de un documento nuevo sigue a 18 %, porque la tasa está copiada en cada producto y el producto no referencia el impuesto. Un cambio le… | `06-flujos-cruzados.md:201` |
| ✅ | CMP-04 | El NCF no tiene restricción en BD (solo UQ_vendor_bills_supplier_invoice para el número interno); la unicidad depende de pg_advisory_xact_lock. Cualquier escritura fuera del servicio (impor… | `modulos/accounts-payable.md:69` |
| ✅ | CMP-16 | UX/validación: taxId de 9 dígitos sin tipo se interpreta como Cédula y da 422 document_invalid {document: "Cédula"}, con un RNC válido (dígito verificador comprobado a mano). | `modulos/suppliers.md:71` |
| ✅ | FAC-PL-02 | roundAmount(item.price) trunca a 2 decimales; probado 900.123456→900.12. Forma correcta: precisión de precio unitario igual a la del documento (6). Riesgo operativo. S. | `modulos/price-lists.md:56` |
| ✅ | FAC-PL-03 | "no-currency!!" aceptado (201). Validar contra catálogo de monedas del tenant. S. | `modulos/price-lists.md:57` |
| ✅ | FINB-02 | organization_settings.fx_rate_tolerance = 0.000000 en tenant nuevo (consulta SQL): cualquier tasa bancaria declarada distinta a la oficial se rechaza (exchange-rate-resolver.service.ts:278-… | `modulos/currencies.md:45` |
| ✅ | FINB-34 | consolidation.service.ts:365-372, 592-595: todo el patrimonio a tasa histórica de adquisición (incluye resultados posteriores), promedio = media simple de cierres mensuales; CTA no persisti… | `modulos/consolidation.md:50` |
| ✅ | FINB-35 | organizations.service.ts:200-288: solo se pueden crear subsidiarias nuevas; no se puede vincular una organización existente (adquisición). M. | `modulos/consolidation.md:52` |
| ✅ | I18N-02 | i18n · multi-país: I18N-03 · ui-i18n · eje 11 · UX · Baja/Media. El idioma ignora el prefijo /es\|en\|pt/ una vez dentro de la aplicación y no hay preferencia de usuario por defecto. Un usuar… | `modulos/i18n.md:57` |
| ✅ | IAM-T2 | database/same-tenant-references.spec.ts:56. La FK FK_customer_portal_accounts_customer (customer_portal_accounts.customer_id) no tiene guarda de mismo-tenant a nivel BD → referencia cruzada… | `modulos/multi-tenencia.md:43` |
| ✅ | JUR-02 | jurisdictions-geo: payroll/fiscal-coverage · documentación/producto | `modulos/jurisdictions-geo.md:60` |
| ✅ | LOC-04 | el catálogo base en español dice «ITBIS» en claves genéricas. | `modulos/localization.md:83` |
| ✅ | NOM-05 | La tasa de la novedad sobrescribe la del concepto sin el límite que el DTO de concepto sí impone | `modulos/payroll.md:116` |
| ✅ | NOM-41 | Evidencia: pg_trigger sin tg_same_tenant para la tabla; same-tenant-references.spec.ts:56 falla. Explotabilidad: no explotable por API (guarda en grant vía assertTenantOwns('customers', …);… | `modulos/customer-service.md:56` |
| ✅ | PLT-NOT-05 | sin unique (userId, endpoint) → duplicados y envíos repetidos. | `modulos/notificaciones-push-websockets.md:41` |
| ✅ | PLTB-DS-01 | un id no-UUID llega a findOne({where:{id}}) y Postgres lanza invalid input syntax for type uuid → 500 INTERNAL_ERROR. Ejecutado 2026-11-07: GET /datasheets/not-a-uuid → 500 (QueryFailedErro… | `modulos/datasheets.md:57` |
| ✅ | PLTB-DS-02 | no hay validación de entrada. Un mode fuera del enum ("GRID") llega al INSERT → 500. Ejecutado: POST /datasheets {mode:"GRID"} → 500; con mode:"live" → 201. Además expone la entidad como co… | `modulos/datasheets.md:63` |
| ✅ | PLTB-DT-03 | el shell no fuerza una CSP; depende de que el portal remoto envíe sus cabeceras. Un shell de escritorio debería imponer una CSP de defensa en profundidad. | `modulos/desktop.md:72` |

## Severidad baja (69)

| | ID | Hallazgo | Ficha |
|---|---|---|---|
| ❌ | CMP-09 | GET /accounts-payable/attachments/:id/download: un archivo que empieza por < se acepta como application/xml (declarándolo pdf) y se sirve inline en el origen de la API. Mitigado por nosniff… | `modulos/accounts-payable.md:80` |
| ❌ | CMP-10 | Se pagó 3.000 desde "Caja general" con saldo 0, sin advertencia (saldo negativo). Esfuerzo: S. | `modulos/accounts-payable.md:82` |
| ❌ | CMP-20 | Borrado físico: Se protege solo con vendor_bills y purchase_orders como dependientes. | `modulos/suppliers.md:87` |
| ❌ | CMP-23 | las ubicaciones existen en el backend pero no tienen pantalla. | `modulos/supply-chain.md:64` |
| ❌ | CMP-25 | POST /accounts-payable desde qa-do-b con expenseAccountId de qa-do-cmp (5600 Honorarios) → 201: el borrador guarda el id ajeno. submit-for-approval lo rechaza con 400 journal_entries.one_mo… | `modulos/accounts-payable.md:90` |
| ❌ | FAC-EINV-06 | GET /einvoicing/invoices/:id/status de otro tenant → 200 null en lugar de 404. S. | `modulos/einvoicing.md:67` |
| ❌ | FAC-INV-08 | invoice_line_item mezcla "invoiceId"/"taxRate" con credited_quantity. S (migración). | `modulos/invoices.md:76` |
| ❌ | FAC-SAL-04 | cotizaciones usan permisos invoices:*; ruta de edición en el menú con invoices:view. S. | `modulos/sales.md:61` |
| ❌ | FE-CI-08 | CI. 1.002 warnings de lint aceptados sin presupuesto; presupuesto de bundle solo como warning (maximumWarning 1.6mb, maximumError 4mb en apps/core/client-web/project.json:79-80), por eso 2,… | `modulos/ci-cd-infra.md:58` |
| ❌ | FE-DOC-05 | mezcla es/en en docs y comentarios. S. | `modulos/documentacion-gobernanza.md:40` |
| ❌ | FE-LIB-02 | legal-documents.contract.ts:29. La edición vigente de términos/privacidad es una constante de compilación: publicar una edición nueva exige desplegar las tres apps (lo dice el propio coment… | `modulos/libs-shared.md:38` |
| ❌ | FE-LIB-03 | document-lifecycle.contract.ts:57-80: motor de transiciones genérico en shared (aceptable como util), pero los ciclos concretos deben quedar en cada módulo | `modulos/libs-shared.md:39` |
| ❌ | FE-NAV-05 | payroll/my-payslips requiere permiso de nómina: un empleado sin rol de nómina no ve sus recibos (comprobado con member → /unauthorized). Verificar con el equipo si el autoservicio debe tene… | `modulos/navegacion-y-cobertura-ux.md:47` |
| ❌ | FE-SET-04 | secciones sso, integrations, ai: llaman endpoints fuera de plan (403 saas.feature_disabled) en lugar de consultar el plan antes. S. | `modulos/settings.md:52` |
| ❌ | FE-SET-05 | zona horaria de la empresa no editable por PATCH /organizations/profile (400 whitelist) y no localicé otra sección que la edite (grep timezone en features/settings: solo billing/billing.pag… | `modulos/settings.md:53` |
| ❌ | FE-SH-07 | componentes >800 l. (workflow-designer 1.397, auth.ts 1.015, AP form 893, invoice new 884, invoice detail 846) y 480 warnings. M. | `modulos/frontend-shell.md:56` |
| ❌ | FE-SH-08 | features/accounts-payable/form/form.page.ts:129 y core/services/accounts-payable.ts:221-245: catálogos DGII 606 en el cliente y fallback a etiqueta NCF cuando el pack no llegó. S. | `modulos/frontend-shell.md:57` |
| ❌ | FIN-AC-05 | Seguridad (defensa en profundidad): ledger-mapping.service.ts:60-70 inserta sourceAccountId/targetAccountId sin verificar que sean del tenant; lo detiene el trigger BD tg_same_tenant_* (400… | `modulos/accounting.md:74` |
| ❌ | FIN-COA-06 | i18n: Tenant US: name = {"es":"Assets"} — texto inglés en la clave es. Esfuerzo: S. | `modulos/chart-of-accounts.md:81` |
| ❌ | FIN-DIM-03 | Regex ASCII de nombre rechaza "Región", "Año". Esfuerzo: S. | `modulos/dimensions.md:47` |
| ❌ | FIN-FR-02 | Flujo de efectivo repite la misma cuenta (1130) en dos filas (−50.000,33 y +30.000) en lugar de su variación neta. Esfuerzo: S. | `modulos/financial-reporting.md:68` |
| ❌ | FIN-JE-03 | journal-entries · Eje 4 · Arquitectura · Baja | `modulos/journal-entries.md:69` |
| ❌ | FIN-JE-04 | Contrato API: Reglas de negocio (período cerrado, cuenta no vigente) responden 403 (accounting.transaction_date_falls_accounting_period_name), que el cliente confunde con falta de permiso.… | `modulos/journal-entries.md:72` |
| ❌ | FIN-JE-05 | Validación: Importes como texto ("debit":"100") se aceptan (201, GENERAL-2026-000002) pese a @IsNumber: hay coerción implícita. No es incorrecto contablemente, pero el contrato no es estric… | `modulos/journal-entries.md:75` |
| ❌ | FINB-04 | exchange-rates.service.ts:298: messageKey sin messageParams → respuesta literal {{imported}}. S. | `modulos/currencies.md:49` |
| ❌ | FINB-06 | exchange-rate-resolver.service.ts:195-203: sin tasa OFFICIAL cae a MARKET con solo logger.warn (queda rateType en el asiento, lo cual mitiga). Exponer advertencia al usuario. S. | `modulos/currencies.md:53` |
| ❌ | FINB-17 | asientos de baja con system_reason NULL; depreciación previa a la baja genera un asiento por activo (DEPREC-2026-000005/6 el mismo día). S. | `modulos/fixed-assets.md:69` |
| ❌ | FINB-25 | budgets.service.ts:86: total del listado suma ingresos + gastos (13.125) | `modulos/budgets.md:51` |
| ❌ | GEO-02 | localization · eje 3 · datos · Baja. Las divisiones administrativas de los 19 países son constantes de código sin versión ni fuente citada. Verifiqué que están en country-profiles.ts (MX en… | `modulos/jurisdictions-geo.md:62` |
| ❌ | I18N-03 | ui-i18n: I18N-04 · i18n · eje 2 · calidad · Baja. 21 claves con es==en en frases en inglés (mensajes de auth y OAuth). Esfuerzo S. | `modulos/i18n.md:58` |
| ❌ | I18N-04 | i18n: I18N-05 · i18n · eje 3 · Baja. Las cuentas se guardan como {"es": "…"} aunque el texto esté en portugués o en inglés. Se vio en BD: qa-br-a 1150 = {"es":"Impuesto a Recuperar"}, que a… | `modulos/i18n.md:59` |
| ❌ | IA-06 | Guarda la imagen (storeImage) antes de que el gateway compruebe disponibilidad/presupuesto; sin clave queda una imagen huérfana por intento. Correcto: assertCallAllowed/isAvailable primero.… | `modulos/ai.md:72` |
| ❌ | IA-09 | Registro dinámico público (10/h por IP) sin caducidad de clientes no usados ni límite global: crecimiento indefinido de mcp_oauth_clients. Correcto: purga de clientes sin grants tras N días… | `modulos/ai.md:75` |
| ❌ | IA-B07 | bi-dashboard-overview-reports: dashboard.service.ts cacheManager.set(...,3600) × 9, dashboard.module.ts:17 | `modulos/bi-dashboard-overview-reports.md:71` |
| ❌ | IA-B08 | Devuelve 200 con mensaje fijo en español en vez de lista vacía; Promise<any>. S. | `modulos/bi-dashboard-overview-reports.md:72` |
| ❌ | IA-E02 | Lee audit_logs con privilegios del dueño; el aislamiento depende solo del WHERE organization_id = current_setting(...) del propio SQL, no de RLS. Hoy correcto (verificado: 0 filas sin conte… | `modulos/ai-engine.md:61` |
| ❌ | IA-E03 | Sin tiempo máximo por trabajo; un inquilino grande puede ocupar el worker; la API lo marca fallido a los 30 min pero el proceso sigue. Correcto: timeout cooperativo y cancelación. S. | `modulos/ai-engine.md:62` |
| ❌ | IA-E04 | ai-engine (eje 6) · ci.yml · Sin lint/typecheck Python. S. | `modulos/ai-engine.md:63` |
| ❌ | IAM-S4 | crypto.util.ts:89: hay un camino de derivación con la sal literal 'salt' (scryptSync(secret, 'salt', 32)), que parece compatibilidad con datos antiguos. Verificar con el equipo que solo sir… | `modulos/security-onboarding.md:49` |
| ❌ | IAM-S6 | security/eje 7 · robustez/operabilidad: ## 7. Camino mínimo a producción | `modulos/security-onboarding.md:51` |
| ❌ | IAM-T4 | documentado aquí. En prod el runbook debe fijarla antes de migrar. | `modulos/multi-tenencia.md:45` |
| ❌ | INV-13 | faltan las claves i18n charts.* y common.skip_to_content (consola en /inventory/adjustments/new y /categories). «Predicciones de demanda» aparece visible sin estar en el plan y muestra la c… | `modulos/inventory.md:113` |
| ❌ | INV-16 | el producto referencia la unidad por símbolo y sin FK. | `modulos/units-of-measure.md:83` |
| ❌ | INV-19 | el registro de idempotencia queda in_progress sin TTL si el proceso cae después del commit (idempotency.interceptor.ts:86-97). | `modulos/pos.md:118` |
| ❌ | INV-22 | son componentes de hoja de ruta no enrutados (código muerto) cuyo comentario afirma que «es alcanzable desde el menú». El comentario contradice el código. | `modulos/manufacturing.md:84` |
| ❌ | INVT-03 | INVT-03 — El README afirma "los ~55 módulos ERP"; el backend tiene 76 carpetas de las cuales ~20 son infraestructura, y varias "funcionales" no llegan al usuario (INVT-01). La cifra no es v… | `01-inventario-de-modulos.md:142` |
| ❌ | LOC-08 | las entidades TaxScheme, CoaTemplate, TaxTemplate, LocalizationTemplate y ReportDefinition tienen tablas vacías y nadie las lee. EinvoiceProviderConfig no tiene referencias. | `modulos/localization.md:114` |
| ❌ | LOC-11 | *multi-país (datos)*: PA usa moneda PAB. En la práctica la contabilidad y la banca operan en USD (verificar con contador). | `modulos/localization.md:130` |
| ❌ | NOM-14 | payroll-run.service.ts:229 currencyCode:'DOP'; nombres de líneas en español en el motor (un volante en inglés sale en español). Esfuerzo: S. | `modulos/payroll.md:143` |
| ❌ | NOM-24 | hcm.service.ts:85 (...fields). Funciona como defensa pero da un mensaje opaco. Esfuerzo: S. | `modulos/hcm.md:83` |
| ❌ | NOM-52 | IP de visitantes en market_waitlist sin retención ni aviso | `modulos/legal.md:56` |
| ❌ | PLT-CFG-02 | AI_MODEL_* y URLs de proveedores con defaults en el esquema de entorno (acoplamiento de config de IA en el núcleo). | `modulos/config-database.md:40` |
| ❌ | PLT-JOB-04 | removeOnFail:false sin purga → crecimiento indefinido de Redis. | `modulos/queues-cache-jobs.md:40` |
| ❌ | PLT-MAIL-04 | removeOnFail:false también en QueuesModule.defaultJobOptions → crecimiento sin límite de Redis. | `modulos/mail-inbound-mail.md:38` |
| ❌ | PLT-NOT-04 | Endpoint de prueba con texto literal en español en producción (organizationId: null). | `modulos/notificaciones-push-websockets.md:40` |
| ❌ | PLT-OBS-02 | /health/queues a cualquier autenticado (member 200) con conteos de cola de toda la plataforma. | `modulos/observabilidad.md:34` |
| ❌ | PLT-SH-03 | shared-backend: core/models/general-ledger.model.ts usado solo por accounting/ledgers.service.ts | `modulos/shared-backend.md:38` |
| ❌ | PLT-STO-04 | app.module.ts:203-206 ServeStaticModule sirve public/ en /; hoy no expone uploads porque dirname/../public ≠ cwd/apps/backend/api/public (curl /uploads/... → 404), pero coincidencia de ruta… | `modulos/storage-documents.md:38` |
| ❌ | PLTB-DT-04 | desktop · eje 9 · Categoría: pruebas · Severidad: baja | `modulos/desktop.md:78` |
| ❌ | PLTB-EXT-03 | extensions · eje 1/9 · Categoría: pruebas · Severidad: baja | `modulos/extensions.md:72` |
| ❌ | PLTB-RM-01 | con cadenas muy grandes el grafo puede ser costoso; hay límites (FLOW_LIMITS) y aviso slow, pero no se midió con volumen real. Confirmar el comportamiento de truncado (capFanOut) y que la U… | `modulos/relationship-map.md:56` |
| ❌ | TES-15 | dateFormat: "DD/MM/YYYY" → mensaje de date-fns con URL; reimportar archivo tras un intento FAILED → 409 UNIQUE_VIOLATION genérico en vez de file_has_already_imported. | `modulos/reconciliation.md:48` |
| ❌ | TES-16 | customers (eje 10) · customer_payments sin voided_by_user_id. · Columna explícita. · S. | `modulos/customers.md:69` |
| ❌ | TES-19 | treasury.service.ts (push de transferencia) narrativas en español fijo. | `modulos/treasury.md:48` |
| ❌ | XF-03 | el movimiento PURCHASE_RECEIPT de 10 × 617,29 se guarda con value = NULL. Cualquier valoración debe recalcular quantity × cost, y la conciliación entre inventario y mayor no puede sumar una… | `06-flujos-cruzados.md:237` |
| ❌ | XF-04 | invoices (NC): Qué está mal: la NC debita 4100 Ingresos por ventas en lugar de 4300 Descuentos y devoluciones (la cuenta existe con system_role SALES_DISCOUNTS). Las ventas netas cuadran, p… | `06-flujos-cruzados.md:231` |
| ❌ | XF-06 | el tenant US numera sus facturas FAC-00000002 (abreviatura española) y guarda los nombres ingleses del plan de cuentas bajo la clave es ({"es":"Accounts Receivable"}). | `06-flujos-cruzados.md:243` |
| ❌ | XF-10 | GET /customers devuelve defaultSalesAccountId, pero PATCH {defaultSalesAccountId} → 400 whitelist_validation. No se puede configurar por API, así que no se pudo probar la cuenta por defecto… | `06-flujos-cruzados.md:225` |
| ✅ | I18N-05 | i18n: i18n: ## 7. Camino mínimo | `modulos/i18n.md:60` |

## Severidad no indicada (patrones y transversales) (16)

| | ID | Hallazgo | Ficha |
|---|---|---|---|
| ❌ | IAM-T1 | shared/tenancy/tenant-isolation.check.ts. En producción (no dev) el arranque ABORTA si: (1) el rol es superusuario/BYPASSRLS, (2) posee tablas con política sin FORCE, (3) no hay políticas (… | `modulos/multi-tenencia.md:42` |
| ❌ | INVT-05 | INVT-05 — Diez mercados (UY…NI) se aprovisionan con un IVA de tasa única fija en código y configurationRequired: false, mientras la tabla de cobertura no los nombra (solo "contabilidad"). D… | `01-inventario-de-modulos.md:144` |
| ❌ | MFG-02 | Aislamiento por referencias — 6 endpoints con ids de otro tenant — FIN-A, CMP, INV, NOM y FAC: ids ajenos en URL y cuerpo → 404/400 | `09-cobertura-y-verificacion.md:184` |
| ❌ | OBS-01 | Salud pública y correlación de logs — Ausentes — Logs con request-id, tenant y usuario: verificado | `09-cobertura-y-verificacion.md:197` |
| ❌ | PRJ-01 | Aislamiento por referencias — 6 endpoints con ids de otro tenant — FIN-A, CMP, INV, NOM y FAC: ids ajenos en URL y cuerpo → 404/400 | `09-cobertura-y-verificacion.md:184` |
| ❌ | SP-01 | Construido pero no conectado (la causa más frecuente de "funcionalidad falsa") **Parcial — falta:** Siguen «construidos pero no conectados»: estados comparativos, consolidación, landed cost, manufactura, regímenes de e-factura (en curso). | `00-resumen-ejecutivo.md:22` |
| ❌ | SP-04 | El servidor confía en valores calculables que envía el cliente | `00-resumen-ejecutivo.md:23` |
| ❌ | SP-05 | Validación de entrada sin DTO o con DTO laxo, y errores de dominio que salen como 500 | `00-resumen-ejecutivo.md:23` |
| ❌ | SP-06 | Aislamiento entre inquilinos que depende de la memoria del desarrollador | `00-resumen-ejecutivo.md:142` |
| ❌ | SP-07 | Concurrencia tratada caso por caso | `07-patrones-sistemicos.md:86` |
| ❌ | SP-08 | Fronteras de módulo erosionadas | `04-plataforma-transversal.md:26` |
| ❌ | SP-09 | Auditoría de negocio con agujeros sistemáticos | `04-plataforma-transversal.md:17` |
| ❌ | SP-10 | Procesos pesados síncronos y listados sin límite | `07-patrones-sistemicos.md:126` |
| ❌ | SP-11 | Capacidades básicas detrás de funciones de pago, y menú que ofrece lo que el plan no incluye **Parcial — falta:** El resto del módulo saas-payment (IAM-P2/P3/P4) sigue pendiente. | `04-plataforma-transversal.md:12` |
| ❌ | SP-12 | Proceso de entrega: se fusiona con la rama en rojo | `00-resumen-ejecutivo.md:141` |
| ❌ | SP-13 | Comentarios como fuente de verdad | `07-patrones-sistemicos.md:161` |

## No son hallazgos (26)

Identificadores informativos o de referencia (flujos, insumos): no llevan corrección.

| ID | Tipo | Ficha |
|---|---|---|
| IAM-A1 | informativo | `modulos/auth.md:45` |
| FIN-AR-01 | informativo | `modulos/financial-reporting.md:58` |
| IAM-T3 | informativo | `modulos/multi-tenencia.md:44` |
| IAM-O1 | informativo | `modulos/organizations.md:48` |
| IAM-R2 | informativo | `modulos/roles-permisos.md:49` |
| IAM-P1 | informativo | `modulos/saas-payment.md:50` |
| IAM-S3 | informativo | `modulos/security-onboarding.md:48` |
| IAM-S5 | informativo | `modulos/security-onboarding.md:50` |
| IAM-U1 | informativo | `modulos/users.md:39` |
| IAM-U2 | informativo | `modulos/users.md:40` |
| XF-W1 | no es hallazgo | `06-flujos-cruzados.md:14` |
| XF-1 | no es hallazgo | `06-flujos-cruzados.md:36` |
| XF-3 | no es hallazgo | `06-flujos-cruzados.md:41` |
| XF-4 | no es hallazgo | `06-flujos-cruzados.md:55` |
| XF-5 | no es hallazgo | `06-flujos-cruzados.md:57` |
| XF-6 | no es hallazgo | `06-flujos-cruzados.md:76` |
| XF-7 | no es hallazgo | `06-flujos-cruzados.md:87` |
| FAC-2 | no es hallazgo | `06-flujos-cruzados.md:110` |
| XF-US-W1 | no es hallazgo | `06-flujos-cruzados.md:129` |
| XF-41 | no es hallazgo | `06-flujos-cruzados.md:130` |
| XF-42 | no es hallazgo | `06-flujos-cruzados.md:132` |
| XF-62 | no es hallazgo | `06-flujos-cruzados.md:159` |
| FAC-1 | no es hallazgo | `06-flujos-cruzados.md:256` |
| FAC-3 | no es hallazgo | `06-flujos-cruzados.md:256` |
| XF-29 | no es hallazgo | `06-flujos-cruzados.md:259` |
| XF-31 | no es hallazgo | `06-flujos-cruzados.md:259` |
