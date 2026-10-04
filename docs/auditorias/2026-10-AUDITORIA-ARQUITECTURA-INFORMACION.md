# Auditoría de arquitectura de la información — Virtex ERP

**Fecha:** 2026-10-04 · **Alcance:** `apps/core/client-web` (navegación, páginas, modal de configuración) contrastado con `apps/backend/api` (qué existe en servidor sin pantalla).
**Método:** análisis estático. La fuente de verdad de la navegación es el manifiesto de módulos (`core/modules/manifests/*.manifest.ts`), del que se derivan rutas, ventanas y menú; la configuración vive aparte, en `features/settings/modal/settings-modal.component.ts` (`SECTION_MAP`). No se ejecutó la aplicación. El inventario de `docs/INVENTARIO_Y_RACIONALIZACION.md` (2026-09-06) quedó desactualizado tras la migración a manifiestos y no se usó como base, solo como contexto.

**Referentes de industria usados:** Odoo 17 (Community/Enterprise), Oracle NetSuite, SAP S/4HANA (Fiori + transacciones clásicas). Cuando cito una convención, digo de cuál de los tres sale. Cuando los tres difieren, lo digo también: hay conceptos donde *no* hay un estándar único, y fingir que lo hay sería el error que esta auditoría existe para evitar.

---

## 0. Estándar de referencia por concepto (antes de juzgar)

| Concepto | Odoo | NetSuite | SAP S/4HANA | ¿Estándar claro? |
|---|---|---|---|---|
| Libro mayor | Reporte bajo *Contabilidad › Informes › Libro mayor* (todas las cuentas, agrupado, desplegable) | Reporte *Reports › Financial › General Ledger* | App *Display Line Items in General Ledger* / FAGLL03H; reporte, no documento | **Sí, alta.** Es un **reporte bajo demanda** dentro de Contabilidad, no una entidad que se crea. |
| Balance de comprobación | *Contabilidad › Informes › Balance de comprobación* | *Reports › Financial › Trial Balance* | App *Trial Balance* (FI) | **Sí, alta.** Reporte de **Contabilidad**. |
| Catálogo de cuentas | *Contabilidad › Configuración › Plan de cuentas* | *Lists › Accounting › Accounts* | Maestro de cuentas de mayor (FS00), configuración | **Sí, alta.** Dato maestro/configuración de Contabilidad. |
| Antigüedad CxC / CxP | *Contabilidad › Informes › Antigüedad de cuentas por cobrar/pagar* | *Reports › Customers/Receivables › A/R Aging*; *Vendors/Payables › A/P Aging* | Apps *Aging Analysis* en AR y AP | **Media.** Siempre es reporte; el módulo-hogar varía: Odoo lo pone en el hub contable, NetSuite y SAP del lado cliente/proveedor. Ambas ubicaciones son legítimas. |
| Conciliación bancaria | *Contabilidad › Banco › Conciliar* (widget por diario de banco) | *Transactions › Bank › Match Bank Data / Reconcile Statement* | *Reconcile Bank Statements* / Cash Management | **Sí, alta.** Página de trabajo propia, en Banco/Tesorería. |
| Estado de resultados y balance general | *Contabilidad › Informes* | *Reports › Financial* | Apps *Financial Statements* | **Sí, alta.** Reportes de Contabilidad. |
| Kardex de inventario | *Inventario › Informes › Historial de movimientos* + *Existencias* + valoración | *Inventory Activity Detail*, *Inventory Valuation* | MB51 (documentos de material), MMBE (stock), MB5B | **Sí, alta.** Existe siempre, bajo **Inventario**, como reporte navegable de movimientos. |
| Ajuste de inventario | *Inventario › Operaciones › Inventario físico* | Transacción *Adjust Inventory* | MIGO mov. 701/702, MI01 (inventario físico) | **Sí, alta.** **Transacción propia**, nunca un campo editable del artículo. |
| Recepción de mercancía | *Inventario › Recepciones* (documento), desde la OC | Transacción *Item Receipt* | MIGO mov. 101 (documento de material) | **Sí, alta.** Documento propio con lista propia. |
| Cierre de período | Fechas de bloqueo en ajustes + asistente de cierre de ejercicio | *Manage Accounting Periods* + *Period Close Checklist* (uno por período) | OB52 (configuración) + *Financial Closing Cockpit* | **Sí, alta** en lo esencial: **una** lista de tareas de cierre por período; la apertura/cierre de períodos es configuración. |
| Libro diario | *Contabilidad › Asientos* (lista) + *Apuntes contables* (líneas) + reporte *Diario/Auditoría de diario* | Listas de transacciones + reportes | Lista de documentos + reporte de diario | **Media.** El «Libro diario» como **reporte legal** es exigencia LatAm/España; la lista de asientos es otra cosa. Ambos suelen coexistir. |
| Libros auxiliares | *Libro de empresas* (Partner Ledger) en Informes | *Customer/Vendor Statement*, *A/R Register* | FBL5N / FBL1N (partidas de cliente/proveedor) | **Sí, alta.** Reporte por tercero dentro de CxC/CxP o del hub de informes. |
| Libros paralelos (multi-book) | No nativo | *Setup › Accounting › Accounting Books* | Ledgers en configuración (SPRO) | **Alta** en que, donde existe, es **configuración**, no navegación diaria. |
| Presupuestos | *Contabilidad › Presupuestos* (Enterprise) | *Transactions › Financial › Set Up Budgets* | Planificación (FI/CO) | **Sí, alta.** Entidad propia; el reporte de desviación cuelga de ella. |
| Activos fijos | *Contabilidad › Activos* (Enterprise) | Fixed Assets Management (SuiteApp) | FI-AA | **Sí, alta.** Módulo/área propia de Contabilidad. |
| Centros de costo / dimensiones | Cuentas analíticas | Departamentos / Clases / Ubicaciones | CO: centros de coste, CeBe | **Sí, alta.** Maestro propio de Contabilidad/Controlling. |
| Tipos de cambio | Dentro de la moneda (*Contabilidad › Configuración › Monedas*) | *Lists › Accounting › Currency Exchange Rates* | OB08 | **Sí, alta.** Vista mantenible, junto a monedas. |
| Impuestos (códigos/tasas) | *Contabilidad › Configuración › Impuestos* | *Setup › Accounting › Tax Codes* | Códigos de IVA (FTXP) | **Sí, alta.** Configuración de **Contabilidad**, no un módulo «Administración». |
| Reportes fiscales (606/607 DGII) | *Contabilidad › Informes › Informe de impuestos* (+ localización) | *Reports › Tax* | Advanced Compliance Reporting | **Alta.** Son **reportes** de Contabilidad, no configuración. |
| Notas de crédito | Menú propio *Clientes › Notas de crédito* | Transacción *Credit Memo* | Documento de abono | **Media-alta.** Tipo de documento propio con lista; se emite desde la factura pero no vive solo como acción. |
| Pagos a proveedores | *Proveedores › Pagos* (lista) | *Pay Bills* + lista *Bill Payments* | F110 / Manage Outgoing Payments | **Sí, alta.** Lista de pagos, simétrica a cobros. |
| Orden de venta / entrega | Pedido de venta + entrega en Inventario | *Sales Order* + *Item Fulfillment* | VA01 + entrega | **Media.** Estándar en ERP de mercado medio; productos PyME (QuickBooks, Alegra) van de cotización a factura. |
| Inicio / dashboard | Menú de apps + app *Dashboards* | **Una** página Home con portlets (KPIs, recordatorios) | Launchpad + *My Inbox* | **Media.** Hay variación, pero **ninguno** tiene cinco páginas de «inicio» distintas. |
| Bandeja de aprobaciones | Actividades (systray) | Recordatorios en Home + listas «pendiente de aprobación» | *My Inbox* (única) | **Alta** en que es **una** bandeja. |
| Notificaciones | Discuss / campanita | Campanita / recordatorios | Panel de notificaciones del shell | **Alta** en que es un **panel del shell**, no un módulo. |
| Marketplace de extensiones | App *Aplicaciones* (nivel superior) | *Customization › SuiteApps* | No aplica (BTP) | **Media.** Siempre en administración/personalización, nunca como «dato maestro». |

---

## 1. Hallazgos

Orden: severidad, luego confianza.

### Críticos

#### H-01 · Inventario no tiene existencias, movimientos (kardex), ajustes ni transferencias
- **Categoría:** debería existir independiente y no existe
- **Severidad:** crítica
- **Ubicación:** `core/modules/manifests/inventario.manifest.ts` — el módulo entero son 4 pantallas de catálogo: `inventory/products`, `inventory/categories`, `masters/warehouses`, `masters/units-of-measure`. En servidor existe `supply-chain/entities/stock-movement.entity.ts` (su comentario lo llama literalmente «the stock ledger (kardex)») y `stock-item.entity.ts`, sin ningún controlador que los exponga.
- **Estándar:** los tres ERPs separan *maestro de artículo* de *existencias* (stock por almacén), *movimientos* (kardex: MB51 / Historial de movimientos / Inventory Activity Detail) y *operaciones* (ajuste, transferencia, inventario físico). Un módulo de inventario sin ninguna de las tres no tiene paralelo.
- **Confianza:** alta
- **Qué cambiaría:** agregar al módulo Inventario, como mínimo: *Existencias* (por artículo × almacén), *Movimientos / Kardex* (lista filtrable por artículo, almacén y fechas, con documento origen y saldo corrido, valorizado), *Ajustes de inventario* (documento con motivo y asiento) y *Transferencias entre almacenes*. Grupo «documents» para ajustes/transferencias, «analysis» para kardex y valoración.

#### H-02 · El ajuste de inventario se hace editando el campo «stock» del producto
- **Categoría:** mal ubicada (debería ser transacción independiente)
- **Severidad:** crítica
- **Ubicación:** `features/inventory/product-form/product-form.page.ts:83-181` — el formulario del artículo trae `stock` editable y, si cambia, lo trata como ajuste con motivo. `products.stock` es una sola columna en `inventory/entities/product.entity.ts:126` (no por almacén).
- **Estándar:** en ningún ERP líder la cantidad en existencia es un campo del maestro de artículo. Es un saldo derivado de movimientos; se modifica solo con una transacción (Odoo *Inventario físico*, NetSuite *Inventory Adjustment*, SAP MIGO 701/MI01), que tiene número, fecha, almacén, aprobador y asiento propio.
- **Confianza:** alta
- **Qué cambiaría:** quitar `stock` (y `cost`) del formulario de producto — mostrarlos solo lectura con enlace al kardex — y mover el ajuste a la transacción de H-01.

### Altos

#### H-03 · La recepción de mercancía no es un documento: es una acción dentro de la orden de compra
- **Categoría:** debería existir independiente y no existe
- **Severidad:** alta
- **Ubicación:** `features/purchasing/orders/form/form.page.ts:157-296` (cantidades recibidas dentro del formulario de la OC); servidor `POST procurement/orders/:id/receive` y `GET procurement/orders/:id/receipts`. No hay lista de recepciones.
- **Estándar:** Odoo *Recepciones* (en Inventario), NetSuite *Item Receipt*, SAP MIGO 101. Siempre documento propio con lista propia, porque es lo que concilia la factura del proveedor (*three-way match*) y lo que genera el movimiento de inventario.
- **Confianza:** alta
- **Qué cambiaría:** página *Recepciones* (lista + documento) bajo Inventario o Compras — Odoo la pone en Inventario, NetSuite en Compras; cualquiera es válida —, creada desde la OC.

#### H-04 · Los estados financieros viven en un módulo «Análisis» separado de Contabilidad, y los reportes contables quedan repartidos en cuatro sitios
- **Categoría:** mal ubicada
- **Severidad:** alta
- **Ubicación:** `analisis.manifest.ts` (balance general, estado de resultados, **balance de comprobación**, flujo de efectivo, rentabilidades) vs `contabilidad.manifest.ts` (libro mayor, libro diario, auxiliares y análisis de variaciones, metidos en el grupo `documents`) vs `ventas.manifest.ts`/`compras.manifest.ts` (antigüedad) vs `settings/fiscal` (606/607, ver H-08).
- **Estándar:** Odoo agrupa *todos* bajo *Contabilidad › Informes*; NetSuite bajo *Reports › Financial*; SAP en las apps de FI. El balance de comprobación en particular es el reporte de trabajo del contador, no un reporte gerencial.
- **Confianza:** alta (balance de comprobación, estados, mayor y diario); media (antigüedad — ver tabla §0).
- **Qué cambiaría:** mover BS, P&L, balance de comprobación, flujo de efectivo, mayor, diario, auxiliares y reportes fiscales al grupo `analysis` del módulo **Contabilidad**. «Análisis» queda (si se quiere) para lo gerencial: rentabilidades, datasheets, dashboard. La antigüedad puede quedarse en Ventas/Compras (estilo NetSuite) pero debe aparecer también en el hub de reportes, que ya lo hace (`reports-hub.page.ts`).

#### H-05 · `general-ledger` significa dos cosas: el reporte mayor de una cuenta y el ABM de libros paralelos
- **Categoría:** mal ubicada / funcionalidad repetida
- **Severidad:** alta
- **Ubicación:** `contabilidad.manifest.ts` — `general-ledger` y `general-ledger/:accountId` cargan `GeneralLedgerPage` (reporte por cuenta), mientras `general-ledger/new` y `general-ledger/:id/edit` cargan `LedgerFormPage` (crear/editar un *libro* — multi-book). La lista de esos libros está en otra URL, `accounting/ledgers` (`LedgerListPage`), en el grupo `masters` con etiqueta `multi_ledger`.
- **Estándar:** el libro mayor es un reporte (no se «crea»). Los libros paralelos, donde existen (NetSuite *Accounting Books*, SAP ledgers), son **configuración** de baja frecuencia.
- **Confianza:** alta
- **Qué cambiaría:** mover `general-ledger/new` y `/:id/edit` a `accounting/ledgers/new` y `/:id/edit`, y sacar «Libros contables» del panel del módulo hacia Configuración › Contabilidad. Validar también si multi-book es necesidad real del mercado objetivo (PyME dominicana): si no hay requisito de IFRS + fiscal en paralelo, es candidato a ocultarse.

#### H-06 · «Cierre mensual» y «Checklist de cierre» son la misma página
- **Categoría:** funcionalidad repetida
- **Severidad:** alta
- **Ubicación:** `features/accounting/closing/month-end-close/month-end-close.page.ts` (checks de `ClosingChecklistService` para el período abierto más antiguo) y `features/accounting/closing/checklist/checklist.page.ts` (los mismos checks para un período elegido — su propio comentario lo dice). Ambas en el menú, grupo `documents`, junto a `periods` y `closing/annual-close`.
- **Estándar:** NetSuite tiene **un** *Period Close Checklist* por período; SAP **un** Closing Cockpit; Odoo, fechas de bloqueo + cierre de ejercicio.
- **Confianza:** alta
- **Qué cambiaría:** fusionar en una sola página *Cierre de período* con selector (por defecto, el período abierto). *Períodos* (abrir/cerrar/bloquear) es configuración — moverlo al grupo `masters` o a Configuración › Contabilidad. *Cierre anual* puede quedarse como página propia (Odoo y SAP la tienen aparte).

#### H-07 · Configuración fiscal: tres páginas construidas y probadas que nadie puede abrir
- **Categoría:** debería existir independiente y no existe (en la navegación)
- **Severidad:** alta
- **Ubicación:** `features/settings/finance/einvoicing-regime/`, `finance/withholding-regimes/`, `finance/tax-jurisdictions/` — tienen `selector`, servicio (`fiscal-settings.service.ts:131-158`), specs, y **no figuran en `SECTION_MAP`** (`settings-modal.component.ts:45-91`) ni en ningún manifiesto.
- **Estándar:** régimen de facturación electrónica, retenciones y jurisdicciones fiscales son configuración de impuestos/localización (Odoo *Contabilidad › Configuración* + ajustes de localización; NetSuite *Setup › Tax*).
- **Confianza:** alta (que deben ser alcanzables); media (que las tres deban ser secciones separadas — podrían ser pestañas de una sola «Impuestos y fiscalidad»).
- **Qué cambiaría:** registrarlas en Configuración, agrupadas con `fiscal` y `taxes` bajo un único bloque «Impuestos y facturación electrónica».

#### H-08 · Los reportes 606/607 están dentro de Configuración › Fiscal
- **Categoría:** mal ubicada
- **Severidad:** alta
- **Ubicación:** `features/settings/fiscal/fiscal.page.ts:20-23,122` (certificado, rangos e-NCF y descarga de 606/607 en la misma sección del modal).
- **Estándar:** las declaraciones/reportes fiscales son **reportes** periódicos de Contabilidad (Odoo *Informe de impuestos* + reportes de localización; NetSuite *Reports › Tax*). Certificados y rangos de NCF sí son configuración.
- **Confianza:** alta
- **Qué cambiaría:** sacar 606/607 a *Contabilidad › Informes › Reportes fiscales* (página propia, con período y estado de envío); dejar en Configuración solo certificado y secuencias.

#### H-09 · No hay tipos de cambio
- **Categoría:** debería existir independiente y no existe
- **Severidad:** alta
- **Ubicación:** servidor `currencies/exchange-rates.controller.ts`; ningún archivo del cliente llama a `exchange-rates`. `masters/currencies` solo lista monedas; `settings › currencies` configura política (`fxRateMaxAgeDays`, tolerancia) sobre tasas que no se pueden ver ni cargar.
- **Estándar:** Odoo (tasas dentro de la moneda), NetSuite (*Currency Exchange Rates*), SAP (OB08). Universal en un ERP multimoneda.
- **Confianza:** alta
- **Qué cambiaría:** pestaña o subpágina *Tipos de cambio* dentro de Monedas, con carga manual e importación.

#### H-10 · Workspace: cinco páginas de «inicio/bandeja» que se solapan
- **Categoría:** funcionalidad repetida
- **Severidad:** alta
- **Ubicación:** `workspace.manifest.ts` — `overview` (inicio fijo: accesos, actividad, *novedades y eventos de Virtex*), `dashboard` (KPIs financieros), `my-work` (devuelve `{ tasks, approvals, notifications }` — `features/my-work/my-work.service.ts`), `approvals` (bandeja de aprobaciones) y `notifications`. *Mi trabajo* contiene exactamente lo que muestran *Aprobaciones* y *Notificaciones*.
- **Estándar:** NetSuite: **una** Home con portlets (KPIs + recordatorios). SAP: Launchpad + **un** *My Inbox* + panel de notificaciones del shell. Odoo: actividades + campanita. Ninguno separa «inicio» de «dashboard» de «mi trabajo» de «aprobaciones».
- **Confianza:** media-alta (hay variación entre proveedores, pero la triple duplicación no tiene paralelo)
- **Qué cambiaría:** (1) fusionar *Overview* y *Dashboard* en un solo Inicio con widgets configurables; (2) una sola *Bandeja* (tareas + aprobaciones) — eliminar *Mi trabajo* o *Aprobaciones*, no ambas coexistiendo; (3) notificaciones como panel de la campanita, con la página completa solo como «ver todas».

#### H-11 · Impuestos y monedas viven en un módulo «Administración» y otra vez en el modal de Configuración
- **Categoría:** mal ubicada / funcionalidad repetida
- **Severidad:** alta
- **Ubicación:** `administracion.manifest.ts` (`masters/taxes`, `masters/currencies`, `masters/branches`, `masters/extensions`) y `settings › taxes` / `settings › currencies` (cuentas por defecto y políticas, que enlazan de vuelta a `/masters/taxes` y `/masters/currencies`).
- **Estándar:** impuestos y monedas son configuración de **Contabilidad** en los tres referentes. Separar tasas (maestro) de cuentas por defecto (determinación de cuentas) sí tiene paralelo (SAP los separa), pero no en dos superficies distintas de navegación.
- **Confianza:** alta (ubicación); media (fusión de ambas pantallas)
- **Qué cambiaría:** un solo hogar: Configuración › Contabilidad › *Impuestos* (tasas + cuentas por defecto como pestañas) y *Monedas* (lista + tipos de cambio + política). El módulo «Administración» como tal desaparece (ver H-12, H-13).

#### H-12 · «Sucursales» es una copia de solo lectura de Configuración › Subsidiarias, y mezcla dos conceptos
- **Categoría:** funcionalidad repetida / página que no debería existir
- **Severidad:** alta
- **Ubicación:** `features/masters/branches/branches.page.ts` — su propio comentario: lista `/organizations/subsidiaries` y manda a crear a Configuración porque «una segunda forma de alta sería una segunda respuesta a la misma pregunta».
- **Estándar:** NetSuite distingue *Subsidiaries* (entidad legal) de *Locations* (sucursal/almacén/punto de venta); SAP *company code* de *plant/business place*. «Sucursal» y «subsidiaria» no son sinónimos.
- **Confianza:** alta (duplicación); media (que se necesite el concepto «sucursal/ubicación» por separado — en RD sí suele importar para el punto de emisión de NCF).
- **Qué cambiaría:** eliminar `masters/branches`. Si se necesitan sucursales operativas (punto de emisión, POS, almacén), modelarlas como *Ubicaciones* distintas de subsidiarias.

#### H-13 · «Bancos» es una vista derivada de las cuentas bancarias, sin entidad propia
- **Categoría:** página que no debería existir / funcionalidad repetida
- **Severidad:** media-alta
- **Ubicación:** `features/masters/banks/banks.page.ts` — no hay tabla `banks`; deduce los bancos de las cuentas bancarias y manda a Tesorería para crear.
- **Estándar:** un maestro de bancos (SAP FI12, Odoo *Bancos* en configuración de contactos) es un **catálogo de instituciones** (código, SWIFT), útil para pagos a terceros. Una lista derivada de las propias cuentas duplica la lista de cuentas de Tesorería.
- **Confianza:** media
- **Qué cambiaría:** eliminar la página; la lista de cuentas bancarias de Tesorería ya responde «con qué bancos operamos». Si en el futuro se necesitan cuentas bancarias de proveedores, crear un catálogo de bancos real.

#### H-14 · Pagos a proveedores: hay formulario, no hay lista
- **Categoría:** debería existir independiente y no existe
- **Severidad:** alta
- **Ubicación:** `compras.manifest.ts` — `accounts-payable/payments` es un `DRAFT` (`VendorPaymentPage`) en el menú; no hay lista de pagos emitidos. Contraste: Ventas tiene `customer-receipts` (lista) + `customer-receipts/new`.
- **Estándar:** Odoo *Proveedores › Pagos*; NetSuite *Bill Payments*; SAP *Manage Outgoing Payments*. Simétrico a cobros en los tres.
- **Confianza:** alta
- **Qué cambiaría:** `accounts-payable/payments` como lista (con anulación, igual que cobros) y `…/payments/new` como el formulario actual.

#### H-15 · Herramientas de importación repetidas
- **Categoría:** funcionalidad repetida
- **Severidad:** media-alta
- **Ubicación:** `workspace/data-imports` (motor genérico con proveedores para plan de cuentas, asientos, facturas, facturas de proveedor, clientes, proveedores, productos y POS — `*-data-transfer.provider.ts`); además `accounting/journal-entries/import` (página propia para asientos); servidor `chart-of-accounts/import/coa-import.controller.ts` (importador propio del catálogo); `features/accounting/bulk-operations/bulk-operations.ts` (importación/exportación del catálogo, huérfana); `datasheets/services/datasheet-import.service.ts`.
- **Estándar:** Odoo: un único motor de importación, invocado desde cada lista. NetSuite: un *Import Assistant* central. Ninguno mantiene importadores paralelos para la misma entidad.
- **Confianza:** alta
- **Qué cambiaría:** un único motor (`data-imports`), con el botón «Importar» de cada lista abriéndolo preseleccionado. Eliminar `journal-entries/import`, `bulk-operations` y el controlador `coa-import` si su lógica ya está en el proveedor genérico (verificar paridad antes). La importación de extracto bancario (`reconciliation/import`) **sí** se queda aparte: es otro proceso (Odoo y NetSuite también la separan).

#### H-16 · «Análisis de variaciones» sin presupuestos
- **Categoría:** debería existir independiente y no existe (presupuestos) / página que no debería existir aún (variaciones)
- **Severidad:** media-alta
- **Ubicación:** `features/accounting/variance-analysis/variance-analysis.page.ts` (renderiza vacío; dice que nada devuelve los reales). Servidor: `budgets.controller.ts` con CRUD y `GET budgets/:id/vs-actual`, y `dashboard/budget-vs-actual`. No hay página de presupuestos.
- **Estándar:** el reporte de desviación cuelga de la entidad presupuesto (Odoo *Presupuestos*, NetSuite *Budgets* + *Budget vs. Actual*).
- **Confianza:** alta (que presupuestos debe existir); media (que `vs-actual` ya sirva para la página — no se verificó su forma de respuesta).
- **Qué cambiaría:** crear *Presupuestos* (lista + documento) en Contabilidad; convertir variaciones en una vista del presupuesto conectada a `vs-actual`. Mientras no exista, retirar la página del menú: hoy es un reporte vacío publicado.

#### H-17 · «Libros auxiliares» publicada vacía; el concepto real es el mayor por tercero
- **Categoría:** página que no debería existir (en su forma actual) / debería existir (como reporte de CxC/CxP)
- **Severidad:** media-alta
- **Ubicación:** `features/accounting/subsidiary-ledgers/subsidiary-ledgers.page.ts` (no tiene endpoint; muestra estado vacío), en el menú de Contabilidad, grupo `documents`.
- **Estándar:** Odoo *Libro de empresas* (Partner Ledger); NetSuite *Customer Statement* / *A/R Register*; SAP FBL5N/FBL1N. Es un reporte por cliente/proveedor.
- **Confianza:** alta
- **Qué cambiaría:** sacarla del menú hasta que exista el endpoint; cuando exista, implementarla como *Estado de cuenta / Mayor de terceros* en el grupo `analysis` de Contabilidad (y accesible desde la ficha de cliente/proveedor).

### Medios

#### H-18 · Antigüedad de saldos implementada tres veces en el servidor
- **Categoría:** funcionalidad repetida
- **Severidad:** media
- **Ubicación:** `GET reports/aging` (`reports.controller.ts:33`), `GET accounts-payable/aging`, `GET customer-payments/aging` (los que usa el cliente, `features/contacts/data/aging.service.ts:59-65`), más el widget `dashboard/widgets/ar-aging-chart`.
- **Estándar:** un reporte de antigüedad por lado (ver §0).
- **Confianza:** alta
- **Qué cambiaría:** un solo cálculo; eliminar `reports/aging` si no lo consume nadie (o al revés), y que el widget del dashboard lea del mismo.

#### H-19 · Notas de crédito sin lista propia; notas de débito de proveedor sin pantalla
- **Categoría:** debería existir independiente y no existe
- **Severidad:** media
- **Ubicación:** nota de crédito solo como acción (`core/services/invoices.ts:311`, `POST invoices/:id/credit-note`) y filtro en `features/invoices/list/list.page.ts`. `accounts-payable/vendor-debit-notes.controller.ts` (CRUD + anular) no tiene cliente.
- **Estándar:** Odoo tiene menú *Notas de crédito* (clientes) y *Reembolsos* (proveedores); NetSuite *Credit Memo* / *Vendor Credit*. En RD además son comprobantes fiscales propios (NCF tipo 04 / e-CF 34).
- **Confianza:** media-alta
- **Qué cambiaría:** entrada de menú «Notas de crédito» (lista filtrada por tipo, puede reutilizar la lista de facturas) y pantalla de notas de débito/crédito de proveedor en Compras.

#### H-20 · No existe orden de venta ni entrega (cotización → factura directa)
- **Categoría:** debería existir independiente y no existe
- **Severidad:** media
- **Ubicación:** `ventas.manifest.ts` — `quotes` e `invoices`, nada entre ellos.
- **Estándar:** Odoo, NetSuite y SAP tienen pedido de venta + entrega/despacho (que mueve inventario). Software PyME (QuickBooks, Alegra) no.
- **Confianza:** media (depende del segmento: si Virtex compite con ERPs, falta; si compite con facturadores PyME, es aceptable)
- **Qué cambiaría:** decisión de producto explícita. Si se vende inventario con despacho diferido, agregar *Pedidos de venta* y *Entregas* (simétrico a OC/recepción de H-03).

#### H-21 · Activos fijos, centros de costo/dimensiones, asientos recurrentes y plantillas: en servidor, sin pantalla
- **Categoría:** debería existir independiente y no existe
- **Severidad:** media
- **Ubicación:** `fixed-assets.controller.ts` (CRUD + baja), `cost-accounting.controller.ts` (`cost-centers`), `dimensions.controller.ts` (dimensiones + reglas por cuenta), `recurring-journal-entries.controller.ts`, `journal-entry-templates.controller.ts`. Ningún archivo del cliente los llama.
- **Estándar:** activos fijos (SAP FI-AA, Odoo Activos, NetSuite FAM) y centros de costo/analítica (SAP CO, Odoo cuentas analíticas, NetSuite departamentos/clases) son áreas estándar de Contabilidad. Asientos recurrentes: NetSuite *Memorized Transactions*, SAP FBD1; Odoo no nativo.
- **Confianza:** alta (activos, centros de costo); media (recurrentes/plantillas)
- **Qué cambiaría:** priorizar *Activos fijos* y *Centros de costo* como páginas de Contabilidad (masters); recurrentes/plantillas como acción dentro de *Asientos*. Lo que no se vaya a exponer, retirarlo del servidor: código sin superficie no es funcionalidad.

#### H-22 · «Ajustes de auditoría» como tipo de documento y página propios
- **Categoría:** existe independiente y no debería
- **Severidad:** media
- **Ubicación:** `contabilidad.manifest.ts` — `audit-adjustments` (lista + formulario) con flujo de aprobación propio en `audit/adjustments/`.
- **Estándar:** SAP usa períodos especiales 13–16; NetSuite *adjustment periods*. En ambos el ajuste de auditoría es un **asiento normal** contabilizado en un período de ajuste, no una entidad aparte. Odoo no lo modela.
- **Confianza:** media (no conozco un ERP líder con un documento «ajuste de auditoría» propio; podría existir en un vertical que no conozco)
- **Qué cambiaría:** modelarlo como asiento con período de ajuste (o tipo de diario «Ajustes de auditoría») y filtro en la lista de asientos; eliminar la página propia.

#### H-23 · «Historial de ventas» es la lista de ventas POS, sin decirlo, y fuera del menú; además hay dos POS
- **Categoría:** mal ubicada / funcionalidad repetida
- **Severidad:** media
- **Ubicación:** `features/sales/history/history.page.ts` (lee `GET /pos/sales`; sin `menu` en `ventas.manifest.ts`). POS web `features/sales/pos/pos.page.ts` y app separada `apps/pos/` (`pages/terminal`).
- **Estándar:** Odoo *Punto de venta › Pedidos* (y una sola UI de POS que corre en navegador o tablet). NetSuite usa SuitePOS como producto aparte.
- **Confianza:** alta (nombre/ubicación); media (dos POS — tener app dedicada + web tiene precedente, pero dos bases de código para la misma caja no)
- **Qué cambiaría:** renombrar a *Ventas POS / Tickets*, agruparla con POS y turnos; decidir una sola implementación de terminal.

#### H-24 · Libro diario vs lista de asientos
- **Categoría:** funcionalidad repetida (parcial)
- **Severidad:** media
- **Ubicación:** `accounting/daily-journal` (asientos con líneas, desde `GET /journal-entries`) y `accounting/journal-entries` (misma fuente), ambos en grupo `documents`.
- **Estándar:** Odoo tiene *Asientos* y *Apuntes* (dos vistas del mismo dato) más un reporte de diario; el *Libro Diario* legal es exigencia LatAm/España como **reporte** imprimible con totales y numeración.
- **Confianza:** media
- **Qué cambiaría:** mantener el Libro Diario solo como reporte (grupo `analysis`, formato legal, exportable), no como segunda lista navegable.

#### H-25 · Extensiones (marketplace) dentro de «Datos maestros»
- **Categoría:** mal ubicada
- **Severidad:** media
- **Ubicación:** `administracion.manifest.ts:53-75` — `masters/extensions` y `masters/extensions/run`, grupo `masters`.
- **Estándar:** Odoo *Aplicaciones* (nivel superior); NetSuite *Customization › SuiteApps*. Siempre administración/personalización.
- **Confianza:** media-alta
- **Qué cambiaría:** mover a Configuración › Integraciones y extensiones (junto a `integrations`).

#### H-26 · Módulo «roadmap»: paneles «próximamente» y una ruta duplicada
- **Categoría:** página que no debería existir / funcionalidad repetida
- **Severidad:** media
- **Ubicación:** `administracion.manifest.ts:89-140` — `manufacturing`, `wms`, `projects`, `procurement` (paneles de «próximamente», `features/*/pages/dashboard.component.ts`) y `contacts/suppliers` (misma `SuppliersPage` que `masters/suppliers` de Compras).
- **Estándar:** no hay paralelo de módulos «anuncio» dentro de la navegación de un ERP. Además: *Procurement* **es** lo que ya hace Compras (requisiciones + OC usan `procurement/*` en servidor); *WMS* se superpone con almacenes de Inventario (que ya llaman a `/wms/warehouses`).
- **Confianza:** alta
- **Qué cambiaría:** eliminar `procurement` y `contacts/suppliers`; los otros tres, fuera del producto (página de roadmap en el sitio comercial, no en el ERP).

#### H-27 · Plazos de pago y formas de pago en Tesorería
- **Categoría:** mal ubicada
- **Severidad:** media-baja
- **Ubicación:** `tesoreria.manifest.ts:72-110` (`masters/payment-terms`, `masters/payment-methods`, `panelOf: 'tesoreria'`).
- **Estándar:** plazos de pago: Odoo *Contabilidad › Configuración › Términos de pago*; NetSuite *Accounting Lists › Terms* — se usan en ventas y compras, no en tesorería. Formas de pago: varía (Odoo las ata a diarios).
- **Confianza:** media
- **Qué cambiaría:** plazos de pago a Configuración › Contabilidad (o a maestros compartidos de Ventas/Compras). Formas de pago pueden quedarse en Tesorería.

#### H-28 · Plantillas de documentos = archivos etiquetados
- **Categoría:** página que no debería existir
- **Severidad:** media-baja
- **Ubicación:** `features/documents/templates/templates.page.ts` — su comentario reconoce que no hay motor de plantillas: es el repositorio filtrado por etiqueta.
- **Estándar:** en ERP «plantillas» significa formatos de impresión/correo (NetSuite *Advanced PDF/HTML Templates*, Odoo diseños de reporte y plantillas de correo), en Configuración.
- **Confianza:** media-alta
- **Qué cambiaría:** eliminar la página; dejar la etiqueta como filtro del repositorio. Si se construyen formatos de impresión de factura, van en Configuración.

#### H-29 · Libros contables y diarios en «masters», períodos y cierres en «documents»
- **Categoría:** mal ubicada (taxonomía de grupos)
- **Severidad:** media-baja
- **Ubicación:** `contabilidad.manifest.ts` — `ledgers`, `journals` en `masters`; `periods`, `closing/*`, `daily-journal`, `general-ledger`, `subsidiary-ledgers` en `documents`.
- **Estándar:** documentos = transacciones (asientos); reportes = mayor, diario, auxiliares; configuración = libros, diarios, períodos.
- **Confianza:** alta
- **Qué cambiaría:** `documents` solo para asientos y ajustes; mayor/diario/auxiliares a `analysis`; períodos/libros/diarios a configuración (ver H-05, H-06).

### Bajos

#### H-30 · Categorías de producto sin entrada de menú ni enlace
- **Categoría:** mal ubicada (inalcanzable)
- **Severidad:** baja
- **Ubicación:** `inventario.manifest.ts:47-53` (sin `menu`); ningún enlace a `inventory/categories` en el cliente.
- **Estándar:** Odoo *Inventario › Configuración › Categorías de producto*. Existe y es alcanzable.
- **Confianza:** alta
- **Qué cambiaría:** añadir `menu: { group: 'masters' }`.

#### H-31 · Código huérfano
- **Categoría:** página o funcionalidad que no debería existir
- **Severidad:** baja
- **Ubicación:** `features/accounting/merge-tool/merge-tool.ts` (fusión de cuentas con métodos *simulados*, sin importadores), `features/accounting/bulk-operations/bulk-operations.ts` (sin importadores), `features/documents/documents.page.ts` (archivo comentado).
- **Estándar:** NetSuite sí permite fusionar cuentas; SAP no. No es un requisito estándar.
- **Confianza:** alta (que están huérfanos); media (sobre fusión de cuentas)
- **Qué cambiaría:** borrar los tres.

#### H-32 · Novedades y eventos del proveedor en la página de inicio
- **Categoría:** página o funcionalidad que no debería existir
- **Severidad:** baja
- **Ubicación:** `features/overview/overview.page.ts`; servidor `overview/news`, `overview/events`.
- **Estándar:** no conozco un ERP líder que ponga noticias del proveedor en el inicio del usuario (NetSuite tiene un portlet de anuncios del sistema, más cercano a «mantenimiento programado»).
- **Confianza:** baja
- **Qué cambiaría:** reducir a avisos de sistema (mantenimiento, cambios regulatorios) o quitar.

#### H-33 · Clientes en `/contacts/customers`, proveedores en `/masters/suppliers`
- **Categoría:** mal ubicada (URL)
- **Severidad:** baja
- **Ubicación:** `ventas.manifest.ts:100`, `compras.manifest.ts:68`.
- **Estándar:** Odoo unifica en *Contactos*; NetSuite separa Customer/Vendor. Ambos válidos; lo inconsistente es mezclar.
- **Confianza:** alta
- **Qué cambiaría:** misma convención de URL para ambos (con redirecciones).

---

## 2. Veredicto por concepto de negocio

| Concepto | Dónde está | Veredicto |
|---|---|---|
| Catálogo de cuentas | Contabilidad › masters | **Correcto.** Segmentos de cuenta (estilo Oracle) bien ubicados como subconfiguración. |
| Asientos contables | Contabilidad › documents | **Correcto.** |
| Libro mayor | Contabilidad › documents; URL compartida con libros paralelos | **Existe, mal agrupado y con colisión de URL** (H-05, H-29). |
| Libro diario | Contabilidad › documents | **Duplica parcialmente la lista de asientos**; debería ser reporte (H-24). |
| Libros auxiliares | Contabilidad › documents, vacía | **Publicada sin datos**; debe ser mayor por tercero (H-17). |
| Balance de comprobación | Análisis | **Mal ubicado** — pertenece a Contabilidad (H-04). |
| Estado de resultados / Balance general / Flujo de efectivo | Análisis | **Mal ubicados** (H-04). |
| Antigüedad CxC / CxP | Ventas / Compras + hub de reportes | **Ubicación aceptable** (estilo NetSuite); **triplicada en servidor** (H-18). |
| Conciliación bancaria | Tesorería | **Correcto**, incluida la importación de extractos como proceso aparte. |
| Posición de caja / cuentas bancarias | Tesorería | **Correcto.** Falta historial de transferencias (anunciado en el propio código). |
| Bancos | Tesorería (vista derivada) | **Sobra** (H-13). |
| Períodos contables | Contabilidad › documents | **Existe, mal agrupado** (H-06). |
| Cierre mensual / checklist | Contabilidad, dos páginas | **Duplicado** (H-06). |
| Cierre anual | Contabilidad | **Correcto.** |
| Ajustes de auditoría | Contabilidad, entidad propia | **Sin paralelo claro**; fusionar con asientos (H-22). |
| Libros paralelos / diarios | Contabilidad › masters | **Deberían ser configuración** (H-05). |
| Presupuestos / variaciones | Solo variaciones, vacía | **Falta la entidad** (H-16). |
| Activos fijos | Solo servidor | **Falta** (H-21). |
| Centros de costo / dimensiones | Solo servidor | **Falta** (H-21). |
| Impuestos | Administración + Configuración | **Doble hogar, módulo equivocado** (H-11); 3 páginas fiscales huérfanas (H-07). |
| Reportes fiscales 606/607 | Configuración › Fiscal | **Mal ubicados** (H-08). |
| Monedas / tipos de cambio | Administración + Configuración; sin tasas | **Doble hogar y falta lo esencial** (H-09, H-11). |
| Facturas de venta, cotizaciones, cobros | Ventas | **Correcto.** |
| Notas de crédito | Acción de factura | **Falta lista propia** (H-19). |
| Pedido de venta / entrega | No existe | **Falta** si el segmento es ERP (H-20). |
| Listas de precios | Ventas › masters | **Correcto.** |
| POS e historial | Ventas, nombre engañoso; dos implementaciones | **Mal nombrado; duplicado** (H-23). |
| Facturas de proveedor | Compras | **Correcto.** |
| Pagos a proveedores | Compras, solo formulario | **Falta la lista** (H-14). |
| Requisiciones, órdenes de compra | Compras | **Correcto.** |
| Recepción de mercancía | Acción dentro de la OC | **Falta como documento** (H-03). |
| Notas de débito de proveedor | Solo servidor | **Falta** (H-19). |
| Productos | Inventario | **Correcto como maestro; mal que edite stock** (H-02). |
| Categorías, almacenes, unidades de medida | Inventario | **Correcto** (categorías, inalcanzable — H-30). |
| Existencias / kardex / ajustes / transferencias | No existen | **Falta lo central del módulo** (H-01). |
| Empleados, departamentos, nómina, conceptos, parámetros legales, mis recibos | RRHH | **Correcto** y bien estructurado (autoservicio en bandeja, alineado con ESS de SAP). |
| Inicio / Dashboard / Mi trabajo / Aprobaciones / Notificaciones | Workspace, cinco páginas | **Solapados** (H-10). |
| Búsqueda global | Workspace | **Correcto** (NetSuite tiene página de resultados equivalente). |
| Importar / exportar datos | Workspace + importadores paralelos | **Motor correcto; duplicados alrededor** (H-15). |
| Repositorio de documentos | Workspace | **Aceptable** (Odoo Documents, NetSuite File Cabinet). |
| Plantillas de documentos | Workspace | **Sobra** (H-28). |
| Datasheets (hojas de cálculo) | Análisis | **Aceptable** (Odoo Spreadsheet, NetSuite Workbook). |
| Rentabilidad por producto / cliente | Análisis | **Correcto** (reportes gerenciales estándar). |
| Sucursales vs subsidiarias | Administración + Configuración | **Duplicado y concepto confundido** (H-12). |
| Extensiones | Administración › masters | **Mal ubicadas** (H-25). |
| Usuarios, roles, SSO, sesiones, facturación SaaS, marca | Configuración | **Correcto.** |
| Políticas de aprobación, secuencias, SMTP, integraciones | Configuración | **Correcto.** |
| Cuentas por defecto (contabilidad, impuestos, monedas) | Configuración | **Correcto como concepto** (determinación de cuentas, SAP lo separa igual); mal partido con Administración (H-11). |

---

## 3. Lo que no tiene paralelo reconocible en ERPs reales

Estas son las piezas con más probabilidad de haberse originado por generar algo plausible en el momento y no por una necesidad de negocio. Varias ya están documentadas en sus propios comentarios como «esto era inventado» — la remediación posterior las conectó a datos reales, pero conectar una página a datos no la justifica si el concepto no corresponde.

1. **Cinco páginas de inicio/bandeja** (`overview`, `dashboard`, `my-work`, `approvals`, `notifications`) — H-10. Ningún referente separa así; *Mi trabajo* es literalmente la unión de las otras dos.
2. **«Bancos» derivado de cuentas bancarias** (`masters/banks`) — H-13. No hay entidad; es una consulta que se presenta como maestro.
3. **«Sucursales» de solo lectura** (`masters/branches`) — H-12. Copia de Subsidiarias.
4. **«Plantillas de documentos»** sin motor de plantillas (`documents/templates`) — H-28.
5. **Checklist de cierre como segunda página** del mismo cálculo (`closing/checklist`) — H-06.
6. **Módulo «roadmap» dentro de la navegación**, incluida una promesa de *Procurement* que ya existe como Compras — H-26.
7. **«Ajustes de auditoría» como documento propio** con flujo propio — H-22 (confianza media: puede existir en algún vertical que no conozco).
8. **Herramienta de fusión de cuentas con métodos simulados** y **operaciones masivas** huérfanas — H-31.
9. **Noticias y eventos del proveedor** en el inicio del usuario — H-32 (confianza baja).
10. **Un módulo «Administración»** como contenedor de impuestos, monedas, sucursales y extensiones — H-11. El nombre existe en otros productos, pero ninguno de los referentes guarda ahí impuestos y monedas.

En sentido inverso, lo que sorprende **por ausente** — conceptos con paralelo universal y sin pantalla — es más grave que lo que sobra: existencias/kardex/ajustes (H-01, H-02), recepción de mercancía (H-03), tipos de cambio (H-09), lista de pagos a proveedores (H-14), presupuestos, activos fijos y centros de costo (H-16, H-21). Varios ya tienen servidor; les falta la superficie.

---

## 4. Lo que está bien y no hay que tocar

Para que la lista de cambios no se lea como «todo está mal»: el **mecanismo** de navegación (manifiesto único → rutas, ventanas y menú, con permiso obligatorio) es sólido y mejor que lo habitual. Los módulos Ventas, Compras (salvo recepciones y pagos) y RRHH/Nómina están organizados como lo haría un ERP real; la conciliación bancaria, el cierre anual, el catálogo de cuentas, los asientos y la configuración de usuarios/seguridad están en el sitio que les corresponde. Los problemas son de **qué** se declaró en el manifiesto, no de **cómo**.
