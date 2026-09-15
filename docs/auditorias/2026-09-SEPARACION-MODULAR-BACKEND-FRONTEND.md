# Auditoría de separación modular — backend y frontend

**Alcance:** las 68 carpetas de dominio de `apps/backend/api/src/app/` y las 31 features de
`apps/core/client-web/src/app/features/`, más `core/`, `shared/`, `libs/` y la configuración de
fronteras del workspace.
**Naturaleza:** diagnóstico exclusivo de **la frontera entre módulos**. No se evalúa si cada módulo
funciona bien por dentro, ni la corrección funcional de su lógica. La pregunta que se responde es
una sola: si mañana hubiera que extraer un módulo a su propio microservicio (backend) o
micro-frontend (frontend), ¿la separación actual sería el obstáculo?
**Método:** análisis de imports sobre el árbol real (514 aristas entre carpetas de backend),
mapeo de `@Entity` → módulo dueño (138 entidades) y cruce de cada `TypeOrmModule.forFeature`
contra esa propiedad. Ninguna cifra de este informe es estimada.
**Fecha:** septiembre 2026.
**Estado:** diagnóstico. Ningún hallazgo está corregido.

---

## Paso 0 — El estándar contra el que se mide

Antes de mirar nada, así luce la separación de referencia para este tipo de ERP.

### Backend

Cada módulo es un paquete con frontera compilable propia — en un monorepo Nx: una `lib` con su
propio `project.json` y su tag, no una carpeta dentro de un `src/app` compartido. Dentro: sus
entidades, su repositorio, su servicio, su controlador. Hacia afuera expone **un único barrel
público** (`index.ts`, o un `*.module.ts` con `exports` explícitos) y nada más.

- Cada tabla tiene exactamente un módulo dueño. Los demás la consultan por la interfaz del dueño,
  o por una copia de lectura proyectada vía evento.
- Ninguna transacción de base de datos abarca tablas de dos dueños. Lo que hoy sería un
  `dataSource.transaction` cruzado se convierte en *commit local + evento después del commit +
  saga con compensación*.
- El grafo de dependencias es un DAG con dirección declarada: todo puede depender de Identidad;
  Contabilidad no depende de ningún módulo operativo; los módulos operativos dependen de
  Contabilidad solo por contrato, nunca al revés.

### Frontend

Cada módulo es una feature con su carpeta, sus páginas, su cliente HTTP, su estado y sus rutas
declaradas *dentro* de ella. `shared/` contiene solo sistema de diseño e infraestructura genérica:
cero vocabulario de dominio. Un módulo no importa componentes ni servicios internos de otro; si
necesita datos de otro, es por un contrato explícito — un `<customer-picker>` publicado por
Ventas, no `import { CustomerService } from '../../core/api/customers.service'`.

### Prueba ácida de ambos lados

Borro la carpeta del módulo y el resto compila, salvo por las referencias al contrato publicado.

---

## Inventario de módulos

No existía inventario previo de páginas/endpoints por módulo utilizable para este fin. Se
construyó del árbol real.

| Módulo | Backend (`apps/backend/api/src/app/…`) | Frontend (`features/…` + manifiesto) |
|---|---|---|
| **Registro/Login/Usuarios** | `auth` (119 archivos), `users`, `roles`, `organizations`, `saas`, `geo` | `auth`, `settings` (parcial) |
| **Finanzas y Tesorería** | `treasury`, `reconciliation`, `payment`, `budgets`, `currencies`, `customers/customer-payments*` | `tesoreria.manifest.ts`, `customer-receipts` |
| **Contabilidad** | `accounting`, `journal-entries`, `chart-of-accounts`, `financial-reporting`, `consolidation`, `intercompany`, `fixed-assets`, `cost-accounting`, `dimensions`, `batch-processes` | `contabilidad.manifest.ts` → `features/accounting` |
| **Ventas/Facturación** | `invoices`, `sales`, `customers`, `pos`, `price-lists`, `einvoicing`, `compliance`, `customer-service` | `ventas.manifest.ts` → `invoices`, `sales`, `contacts`, `customer-receipts` |
| **Compras/Proveedores** | `procurement`, `accounts-payable`, `suppliers` | `compras.manifest.ts` → `purchasing`, `accounts-payable` |
| **Inventario** | `inventory`, `supply-chain`, `units-of-measure`, `manufacturing` | `inventario.manifest.ts` → `inventory`, `wms` |
| **RR.HH./Nómina** | `payroll`, `hcm` | `rrhh.manifest.ts` → `payroll`, `hcm` |
| **Reportes** | `reports`, `analytical-reporting`, `bi`, `dashboard`, `overview`, `datasheets`, `my-work` | `analisis.manifest.ts` → `reports`, `datasheets` |
| **Configuración/Admin** | `config`, `localization`, `taxes`, `extensions`, `workflows`, `audit`, `documents`, `i18n`, `common`, `shared`, `notifications`, `storage`, `mail`, … | `administracion.manifest.ts` → `masters`, `extensions` |

### Medición base

- **514** aristas distintas entre carpetas de backend.
- **859** importaciones de entidades ajenas (acceso directo al modelo de datos de otro módulo).
- **56** ciclos de 2 nodos.
- **38** `forwardRef` a nivel de `@Module`, en 19 módulos.
- **57** registros `TypeOrmModule.forFeature` con entidades de otro dueño, en 35 módulos.

---

# Hallazgos — módulo por módulo

Categorías usadas: *mezcla de contexto* · *acoplamiento de datos* · *dependencia circular* ·
*filtración por carpeta compartida* · *acoplamiento de estado en frontend* · *importación cruzada
de componentes* · *estructura por capa en vez de por módulo*.

---

## 1. Inventario

Este es el caso exacto del enunciado del análisis, y está confirmado literalmente.

### B-01 · Mezcla de contexto — **Crítica** — Inventario ↔ Contabilidad

**Ubicación:** `apps/backend/api/src/app/inventory/inventory-posting.service.ts:1-12, 64-118, 125+`

Un archivo entero de lógica contable vive dentro de Inventario. Sus imports son `Journal`,
`JournalEntriesService`, `CreateJournalEntryDto`, `JournalEntryType`, `LedgerNarrativeService`
(Contabilidad), `ModuleSlug` de `accounting/entities/accounting-period.entity`, y
`OrganizationSettings` (Identidad).

El cuerpo decide reglas que son de Contabilidad, no de Inventario: qué contrapartida usa un
inventario inicial (*opening balance equity*, nunca resultados acumulados), que un ajuste va contra
`AccountRole.INVENTORY_ADJUSTMENT` y no contra costo de ventas, y que el asiento se marca
`JournalEntryType.OPENING_BALANCE` para que el proceso de cierre lo distinga. Eso es doctrina
contable codificada en el módulo de productos.

**Qué está mal:** si Contabilidad cambia el rol de cuenta de ajuste o el tipo de asiento, rompe
Inventario sin pasar por ninguna interfaz. Y al extraer Inventario a microservicio, este archivo no
puede irse con él ni quedarse sin él.

**Forma correcta:** Inventario emite `InventoryValuationChanged { productId, deltaValue, reason,
occurredAt }`. Contabilidad tiene un suscriptor que traduce ese hecho a un asiento con las cuentas
y el tipo que ella decide. Inventario no conoce la palabra "asiento".

### B-02 · Transacción compartida entre módulos — **Crítica** — Inventario + Contabilidad

**Ubicación:** `apps/backend/api/src/app/inventory/inventory.service.ts:38-42`, `:82-89`, `:105-112`

```ts
return this.dataSource.transaction(async (manager) => {
  const product = await manager.save(manager.create(Product, { ...createProductDto, organizationId }));
  await this.posting.postOpeningStock(manager, product, actorUserId);   // ← escribe journal_entries, journal_entry_lines, saldos
});
```

Una sola transacción escribe `products` (Inventario) y el asiento completo (Contabilidad). El
comentario del propio código lo declara como invariante deliberado: *"One transaction: a product
saved without its opening entry is exactly the state that put the…"*.

**Qué está mal:** es el bloqueo más duro para microservicios. Dos bases de datos no comparten un
`BEGIN`. Hoy la consistencia la garantiza el motor; al separar hay que reemplazarla por una saga
con compensación, y esa decisión está diseminada en 13 sitios (ver patrón P-1).

**Forma correcta:** `products` se commitea; el evento se publica en un outbox dentro de esa misma
transacción local; Contabilidad lo consume y postea. Si el posteo falla hay reintento y alerta, no
rollback del producto.

### B-03 · Acoplamiento de datos — **Alta** — Inventario ↔ Cadena de suministro

**Ubicación:** `apps/backend/api/src/app/inventory/entities/warehouse.entity.ts:3,17`

`Warehouse` se define en `supply-chain` y se **re-exporta** desde Inventario (`export { Warehouse };`).
El comentario del archivo documenta que antes existían dos `@Entity({ name: 'warehouses' })`
colisionando sobre la misma tabla. La colisión se corrigió, pero el re-export deja la frontera
borrosa: los consumidores siguen escribiendo `from '../inventory/entities/warehouse.entity'` para
una entidad que no es de Inventario.

Además `Location`, `StockItem` y `StockMovement` se declaran en este archivo y **no están
registradas en `InventoryModule`** — `inventory.module.ts:15` solo registra `Product` y
`ProductCategory`. Son tablas sin dueño operativo declarado.

**Forma correcta:** un solo punto de definición y de import (`supply-chain`), sin re-export de
cortesía; y cada entidad registrada por el módulo que la posee.

### F-01 · Filtración por carpeta compartida — **Media** — Inventario / Admin

**Ubicación:** `core/modules/manifests/inventario.manifest.ts:80,90` →
`features/masters/warehouses/`, `features/masters/units-of-measure/`

Dos páginas del módulo Inventario viven en `features/masters/`, una carpeta que también sirve a
Ventas, Compras, Tesorería y Administración. Al extraer el micro-frontend de Inventario hay que
partir `masters/` en cinco.

---

## 2. Ventas / Facturación

### B-04 · Transacción compartida — **Crítica** — Ventas + Config/SaaS + Fiscal + Inventario + Contabilidad

**Ubicación:** `apps/backend/api/src/app/invoices/invoices.service.ts:346-390`

El docstring del método lo dice sin rodeos: *"Everything that makes a document real, in the
caller's transaction: plan limit, fiscal number, stock movement and ledger posting."* Una sola
transacción toca **cinco** módulos:

| Línea | Escribe en | Módulo |
|---|---|---|
| `:357` `saasService.enforceLimit(manager, …)` | `organizations` / contadores de plan | Configuración |
| `:359-369` `adapter.assignSalesNumber({ manager })` | secuencias NCF | Ventas-fiscal / Compliance |
| `:379` `moveStockForIssue(invoice, manager)` → `:895` `inventoryService.decreaseStock` | `products` | **Inventario** |
| `:382` `this.posting.post(invoice, manager)` | `journal_entries`, `journal_entry_lines` | **Contabilidad** |
| `:383` `manager.save(invoice)` | `invoices` | Ventas |

**Forma correcta:** la emisión commitea la factura y su NCF (que sí pertenece al bounded context
fiscal de Ventas) y publica `InvoiceIssued`. Inventario descuenta al consumirlo; Contabilidad
postea al consumirlo; el contador de plan se ajusta al consumirlo. La cuota del plan, además, es
una verificación de admisión que debe ocurrir *antes* de la transacción, no dentro.

### B-05 · Mezcla de contexto — **Alta** — Ventas ↔ Finanzas/Tesorería

**Ubicación:** `apps/backend/api/src/app/customers/customer-payments.service.ts` (+
`customer-payment.entity.ts`, `customer-payment-line.entity.ts`, `customer-payments.controller.ts`)

El cobro a clientes —un hecho de Tesorería— está implementado dentro del módulo `customers`, que es
el maestro de clientes de Ventas. El servicio abre transacciones propias (`:139`, `:518`) y postea
a Contabilidad.

**Qué está mal:** Tesorería (`treasury/`) existe como módulo y tiene `bank-account.entity.ts`, pero
la mitad de su dominio (cobros) está en Ventas y otra parte (conciliación) en `reconciliation/`.
Tres carpetas para un bounded context.

**Forma correcta:** `CustomerPayment` pertenece a Tesorería, junto con `BankAccount` y la
conciliación. Ventas expone `CustomerLookup`; Tesorería referencia al cliente por id, no por
entidad.

### B-06 · Acoplamiento de datos — **Alta** — Ventas → Contabilidad

**Ubicación:** `apps/backend/api/src/app/invoices/invoices.module.ts` y
`customers/customers.module.ts` registran `AccountingPeriod` y `AccountPeriodLock` vía
`TypeOrmModule.forFeature`

Ventas obtiene repositorios directos sobre las tablas de períodos contables para preguntar "¿está
abierto el período?". Eso es leer la tabla de otro dueño.

**Forma correcta:** `AccountingPeriodsPort.isOpen(orgId, date, module)` expuesto por Contabilidad.
Un método, un contrato, cero conocimiento del esquema.

### B-07 · Dependencia circular — **Crítica** — Ventas ↔ Ventas-fiscal (`einvoicing`)

**Ubicación:** `einvoicing → invoices`: 23 imports, los 23 de entidades ·
`invoices → einvoicing`: 17 imports, 6 de entidades

Ciclo bidireccional denso y simétrico. Ninguno de los dos se extrae sin el otro.

**Forma correcta:** `einvoicing` depende de un contrato (`FiscalDocumentRequest`) que Ventas
construye; nunca de la entidad `Invoice`. La dirección debe ser unidireccional:
`invoices → einvoicing`.

### B-08 · Dependencia circular — **Alta** — Ventas ↔ Compliance, Ventas ↔ Clientes

**Ubicación:** `compliance ↔ invoices` (4/4), `customers ↔ invoices` (4/7); a nivel agregado
Compras ↔ Ventas (2/5)

### F-02 · Importación cruzada de componentes — **Alta** — Ventas → Inventario

**Ubicación:** `features/invoices/**` importa `core/api/inventory.service` y
`core/models/product.model`; `features/sales/**` igual

La línea de factura consulta el catálogo de productos importando el cliente HTTP de Inventario
directamente. No hay contrato: si Inventario cambia la forma de `Product`, rompe Ventas en tiempo
de compilación.

**Forma correcta:** Inventario publica un `ProductPicker` y un tipo `ProductSummary` en la API
pública de su feature; Ventas consume eso.

---

## 3. Compras / Proveedores

### B-09 · Transacción compartida + mezcla de contexto — **Crítica** — Compras + Contabilidad

**Ubicación:** `apps/backend/api/src/app/accounts-payable/vendor-debit-notes.service.ts:37` (abre
la transacción) … `:124`

```ts
await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, entryDto, organizationId);
```

Compras arma el `entryDto` completo —incluidos `valuations: [{ ledgerId, debit, credit }]`, es
decir multilibro— y lo postea **en su propio queryRunner**. El módulo de Compras conoce la
estructura interna del asiento contable con valuaciones por libro. Mismo patrón en
`accounts-payable/accounts-payable.service.ts:193, 345, 645, 1078`.

### B-10 · Dependencia circular — **Alta** — Compras ↔ Contabilidad

**Ubicación:** ida: `accounts-payable → accounting` 9 imports, `accounts-payable → journal-entries`
16. Vuelta: `apps/backend/api/src/app/accounting/closing-checklist.service.ts:15` importa
`../accounts-payable/entities/vendor-bill.entity`.

El ciclo entero cuelga de **una sola línea**. Es el ciclo más barato de romper del proyecto: el
checklist de cierre quiere saber si quedan facturas de proveedor abiertas — eso es una pregunta, no
una entidad.

**Forma correcta:** Contabilidad define `interface ClosingBlockerProvider { pendingItems(orgId,
period): Promise<Blocker[]> }`; Compras la implementa y se registra. La dependencia se invierte y
el ciclo desaparece.

### B-11 · Acoplamiento de datos — **Alta** — Compras → Contabilidad / Identidad

**Ubicación:** `accounts-payable` registra vía `forFeature`: `AccountingPeriod`, `AccountPeriodLock`
(Contabilidad), `OrganizationSettings` (Identidad), `Supplier` (mismo módulo de negocio, otra
carpeta).

### F-03 · Importación cruzada — **Alta** — Compras → Contabilidad

**Ubicación:** `features/accounts-payable/**` importa `core/api/chart-of-accounts.service` y
`core/services/account-selection`

La UI de Compras abre el selector de cuentas del plan contable. Es el mismo acoplamiento de B-09,
replicado en el cliente.

---

## 4. Contabilidad

### B-12 · Dependencia circular — **Crítica** — interna (`accounting` ↔ `journal-entries`)

**Ubicación:** `accounting → journal-entries`: 41 imports (21 de entidades).
`journal-entries → accounting`: 27 imports (23 de entidades). Resuelto a la fuerza con `forwardRef`
en `accounting/accounting.module.ts` y `journal-entries/journal-entries.module.ts`.

Añadiendo `chart-of-accounts` el ciclo es triple: `accounting ↔ chart-of-accounts` (24/2),
`chart-of-accounts ↔ journal-entries` (9/15).

**Qué está mal:** estos tres no son tres módulos, son uno solo partido en tres carpetas. Y el
`forwardRef` no resuelve el ciclo: lo oculta del compilador dejándolo intacto en el grafo de
despliegue.

**Forma correcta:** colapsarlos en un solo módulo `contabilidad` con submódulos internos, o cortar
el ciclo definiendo `chart-of-accounts` como dependencia *sin* retorno — el plan de cuentas no debe
saber qué es un asiento.

### B-13 · Dependencia circular — **Alta** — Contabilidad ↔ Reportes

**Ubicación:** `reports → journal-entries` 13 imports, `reports → accounting`; vuelta:
`apps/backend/api/src/app/accounting/general-ledger.spec.ts:26` importa `../reports/reports.service`

Un módulo de dominio importa el servicio de Reportes en su suite de pruebas. La prueba del mayor
general se valida contra el generador de reportes: cualquier cambio en Reportes rompe la suite de
Contabilidad.

### B-14 · Dependencia circular — **Crítica** — 38 ciclos de DI declarados, transversal

**Ubicación:** `grep forwardRef` sobre los `*.module.ts` devuelve 38 declaraciones en 19 módulos.

`accounting.module.ts` usa `forwardRef` seis veces (Audit, Auth, ChartOfAccounts, Currencies,
FixedAssets, JournalEntries). `journal-entries.module.ts` cinco. `organizations.module.ts` cuatro.

**Qué está mal:** cada `forwardRef` es un ciclo confirmado por el propio equipo. No hay jerarquía de
dependencias: hay una malla.

---

## 5. Finanzas y Tesorería

### B-15 · Transacción compartida — **Crítica** — Tesorería/Conciliación + Contabilidad

**Ubicación:** `apps/backend/api/src/app/reconciliation/reconciliation.service.ts:559` y `:583`

Estos bloques escriben `JournalEntryLine` (Contabilidad) junto a `BankTransaction`,
`ReconciliationMatch` y `ReconciliationMatchLine` (Tesorería) en el mismo `dataSource.transaction`.
Además `reconciliation.module.ts` registra repositorios sobre `JournalEntryLine` y sobre
`BankAccount` — este último es de `treasury`, otra carpeta.

### B-16 · Dependencia circular — **Alta** — Finanzas ↔ Contabilidad

**Ubicación:** agregado: `FIN → CTB` 82 imports (52 de entidades), `CTB → FIN` 21 imports. Casos
concretos: `accounting ↔ reconciliation` (1/3), `currencies ↔ journal-entries` (2/5),
`budgets ↔ journal-entries` (12/2), `audit ↔ treasury` (1/2).

### B-17 · Estructura por capa en vez de por módulo — **Media** — Finanzas

**Ubicación:** `treasury/` (8 archivos), `reconciliation/` (16), `payment/` (10), `budgets/` (10),
`currencies/` (16), más `customers/customer-payments*` (3)

Seis carpetas hermanas para un bounded context, al mismo nivel que las 62 restantes. No hay una
frontera de "Finanzas": hay seis carpetas sueltas. `currencies` es en realidad infraestructura
transversal (tipos de cambio) importada por Contabilidad, Ventas, Compras y Reportes por igual —
está mal ubicado en ambas lecturas.

---

## 6. RR.HH. / Nómina

Es el módulo **mejor separado del backend**, y vale la pena decir por qué.

### B-18 · Mezcla de contexto — **Alta** — RR.HH. → Contabilidad

**Ubicación:** `apps/backend/api/src/app/payroll/services/payroll-accounting.service.ts:3-14,
77-82, 163, 209-240`

Mismo patrón que Inventario y Compras, pero contenido: el archivo está aislado, no disperso. Aun
así importa `JournalEntriesService`, `PostingContext`, `CreateJournalEntryLineDto`,
`JournalEntryType`, `Journal` y `LedgerNarrativeService`, busca el diario `NOMINA` por entidad
(`manager.findOneBy(Journal, …)`, `:77`) y lanza
`payroll.payroll_journal_nomina_not_found_create`. Es decir, RR.HH. sabe que existe un diario
llamado NOMINA y que si falta hay que crearlo.

**Forma correcta:** `PayrollRunCompleted { runId, period, accruals[] }`. Contabilidad resuelve el
diario. RR.HH. no debería poder nombrar un diario.

### B-19 · Acoplamiento de datos — **Media** — Nómina → HCM

**Ubicación:** `payroll.module.ts` registra `EmployeeCompensation`, entidad de `hcm`; 7 imports de
entidades `hcm` desde `payroll`.

Ambas son RR.HH., así que el daño de negocio es nulo — pero son dos carpetas sin frontera declarada
entre ellas, no un módulo con submódulos.

**Balance:** RR.HH. tiene solo 8 imports hacia Contabilidad y 11 hacia Identidad, y **ningún
ciclo**. Es el único módulo cuya superficie externa cabe en una página.

---

## 7. Reportes

### B-20 · Acoplamiento de datos masivo — **Crítica** — Reportes → todos

**Ubicación:**
- `apps/backend/api/src/app/reports/reports.module.ts:9-14` registra repositorios directos sobre
  `Invoice`, `InvoiceLineItem` (Ventas), `JournalEntryLine`, `JournalEntry`, `Account`, `Ledger`
  (Contabilidad)
- `reports/profitability.service.ts:4-5` consulta `InvoiceLineItem` e `Invoice` directamente
- `datasheets/datasheets.module.ts` registra `InvoiceLineItem`, `Customer`, `VendorBill`, `Budget`,
  `Organization`, `OrganizationSettings` — **seis módulos distintos**
- `overview/` registra `AuditLog`, `User`, `VendorBill`, `AccountingPeriod` — cuatro módulos

Agregado: Reportes importa entidades de **siete** de los otros ocho módulos (`REP → VTA` 23
entidades, `→ IAM` 24, `→ CTB` 18, `→ CMP` 7, `→ INV` 5, `→ RRHH` 2, `→ FIN` 2).

**Qué está mal:** Reportes está acoplado al **esquema físico** de todos los demás. Cualquier
renombre de columna en Ventas rompe Reportes. Es el módulo imposible de extraer.

**Forma correcta:** Reportes no lee las tablas transaccionales. Consume un modelo de lectura propio
—vistas materializadas o un esquema analítico alimentado por eventos— del que es **dueño**. Es la
única forma en que Reportes se extrae sin arrastrar el resto del sistema.

### B-21 · Dependencia circular — **Alta** — Reportes ↔ Contabilidad

Ver B-13. `CTB ↔ REP` (1 / 38).

### F-04 · Filtración por carpeta compartida — **Media** — Reportes

**Ubicación:** `analisis.manifest.ts` carga 6 páginas de `features/reports`, pero
`compras.manifest.ts` y `ventas.manifest.ts` también cargan páginas de `features/reports`.

`features/reports` no es de Reportes: es de tres módulos.

---

## 8. Configuración / Administración

### B-22 · Filtración por carpeta compartida — **Crítica** — `shared/` escribe las tablas de cinco módulos

**Ubicación:**
- `apps/backend/api/src/app/shared/provisioning/tenant-bookkeeping.provisioner.ts:3-16`
- `apps/backend/api/src/app/shared/shared.module.ts:16` —
  `TypeOrmModule.forFeature([DocumentSequence, Organization, FiscalYear])`, y el módulo es `@Global()`

Es el hallazgo más grave del backend, y el código lo documenta él mismo:

> *"It talks to entities directly rather than to the owning modules' services, which is what lets a
> single provisioner span accounting, journals, organizations and shared sequences **without a
> cycle between those modules**."*

Es decir: se detectó el ciclo y, en vez de romperlo, se movió el código a `shared/`, donde el ciclo
deja de ser visible pero el acoplamiento es exactamente el mismo — agravado, porque `SharedModule`
es `@Global()`. Un provisioner en una carpeta llamada "compartida" escribe `accounts`,
`accounting_periods`, `ledgers`, `journals`, `organizations`, `organization_settings` y
`document_sequences`, todo dentro de la transacción del llamador.

`shared/fiscal-calendar.service.ts:4-5` hace lo mismo a menor escala: inyecta repositorios de
`Organization` (Identidad) y `FiscalYear` (Contabilidad).

**Qué está mal:** `shared/` se volvió el módulo con más poder de escritura del sistema y no aparece
en ningún mapa de dominio. Al extraer Contabilidad hay que llevarse medio `shared/`; al extraer
Identidad, la otra mitad.

**Forma correcta:** el aprovisionamiento es una **saga de onboarding**, no una función. Un
orquestador llama `contabilidad.provisionar(orgId)`, `identidad.provisionar(orgId)`,
`secuencias.provisionar(orgId)` — cada uno commitea lo suyo, con idempotencia (que ya existe) y
compensación. El ciclo que se quiso evitar desaparece porque el orquestador está *encima* de todos,
no entre ellos.

### B-23 · Filtración por carpeta compartida — **Alta** — `shared/permissions.ts` acopla los nueve módulos

**Ubicación:** `apps/backend/api/src/app/shared/permissions.ts` (364 líneas)

Un solo objeto `PERMISSIONS` con los permisos de Usuarios, Roles, Plan de cuentas, Facturación,
Inventario, Nómina y el resto. Todos los controladores de los nueve módulos importan de aquí —
`inventory/inventory.controller.ts:12`, `reports/reports.controller.ts:16`, etc.

**Forma correcta:** cada módulo declara sus permisos en su propio barrel
(`inventario.permissions.ts`) y los registra en un catálogo por composición al arrancar.

### B-24 · Dependencia circular — **Crítica** — Configuración ↔ todo

**Ubicación:** `CFG ↔ IAM` (104/178), `CFG ↔ CTB` (41/207), `CFG ↔ VTA` (8/143),
`CFG ↔ FIN` (5/65), `CFG ↔ INV` (3/30)

Casos puntuales: `auth ↔ i18n` (32/2), `auth ↔ common` (22/1), `common ↔ users` (1/6),
`common ↔ organizations` (1/5), `common ↔ currencies` (1/6), `localization ↔ taxes` (6/1),
`localization ↔ organizations` (6/7), `i18n ↔ pos` (1/1).

Los de `common` son especialmente graves por lo baratos: son aristas **unitarias** hacia arriba,
desde una infraestructura genérica hacia módulos de negocio. Igual que B-10, son ciclos que cuelgan
de una línea.

### B-25 · Sin enforcement de fronteras — **Alta** — transversal

**Ubicación:** `eslint.config.mjs:12-24`

```js
depConstraints: [{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }]
```

`@nx/enforce-module-boundaries` está instalado y **configurado como no-op**. Además, los 68 módulos
de backend y las 31 features de frontend viven dentro de dos aplicaciones Nx (`api`, `client-web`),
no como libs — así que aunque se escribieran restricciones, Nx no podría verlas. Solo hay 4 libs,
todas genéricas: `shared/types`, `shared/locales`, `shared/ui-a11y`, `shared/ui-i18n`.

**Qué está mal:** no existe ningún mecanismo que impida que la próxima importación cruzada entre.
Las 514 aristas y los 56 ciclos no son accidentes: son la consecuencia inevitable de no tener
frontera compilable.

### F-05 · Estructura por capa en vez de por módulo — **Crítica** — frontend completo

**Ubicación:** `apps/core/client-web/src/app/core/api/` (35 servicios), `core/services/` (35),
`core/models/` (15), `core/state/`

Aquí está la trampa del frontend. Las importaciones cruzadas entre `features/` son **solo cuatro**
—`accounting → reports`, `accounts-payable → reports`, `dashboard → overview`, `sales → inventory`—
lo cual parece excelente. No lo es: el dominio no está en `features/`. Está en `core/`, un bucket
por capa técnica donde conviven `accounting.service.ts`, `inventory.service.ts`,
`payroll.service.ts`, `treasury.service.ts`, `customers.service.ts` y treinta más, en una sola
carpeta plana.

Medido: `features/masters` consume 10 clientes API de 5 módulos distintos; `features/invoices`
consume 3 de 3 módulos; `features/accounting` consume 11.

**Qué está mal:** la limpieza de `features/` es cosmética. Para extraer el micro-frontend de
Inventario hay que sacar `core/api/inventory.service.ts`, `core/api/product-categories.service.ts`,
`core/api/warehouses.service.ts`, `core/api/units-of-measure.service.ts`,
`core/models/product.model.ts` — y decidir qué pasa con los seis features de otros módulos que los
importan.

**Forma correcta:** `features/inventario/data/inventory.api.ts`,
`features/inventario/model/product.ts`, con un `features/inventario/index.ts` que publica solo lo
que otros pueden consumir. `core/` queda con `http/`, `i18n/`, `tabs/`, `auth/` — infraestructura,
cero dominio.

### F-06 · Acoplamiento de estado en frontend — **Media** — Contabilidad

**Ubicación:** `apps/core/client-web/src/app/core/state/chart-of-accounts.state.ts:16`
(`@Injectable({ providedIn: 'root' })`)

El único estado global del proyecto es de un módulo (el plan de cuentas), pero vive en
`core/state/`, un directorio genérico, y se declara `providedIn: 'root'`. Hoy solo lo consumen tres
páginas de `features/accounting`, así que el daño real es bajo y el arreglo es trivial.

**Forma correcta:** moverlo a `features/contabilidad/state/` y proveerlo en el route-level de
Contabilidad, no en root. Así el patrón queda establecido antes de que aparezca el segundo store.

---

## 9. Registro / Login / Usuarios

### B-26 · Dependencia circular — **Crítica** — `auth` ↔ `users`

**Ubicación:** `auth → users`: 59 imports (47 de entidades) · `users → auth`: 22 imports.
`forwardRef` en `auth/auth.module.ts` y `users/users.module.ts`.

`auth` registra `User`, `UserSecurity` y `Passkey` vía `forFeature` — escribe directamente las tres
tablas de `users`. Con 59 aristas en una dirección y 22 en la otra, no son dos módulos: es uno con
un tabique.

### B-27 · Dependencia circular — **Crítica** — ciclo de cuatro: `auth` ↔ `organizations` ↔ `users` ↔ `saas`

**Ubicación:** `auth ↔ organizations` (23/18), `organizations ↔ users` (4/8),
`organizations ↔ saas` (6/7), `auth ↔ saas` (12/7), `saas ↔ users` (2/3), `auth ↔ roles` (7/13),
`roles ↔ users` (3/5)

Siete módulos (`auth`, `users`, `roles`, `organizations`, `saas`, `payment`, `geo`) forman un grafo
completamente conectado en ambas direcciones. `organizations.module.ts` tiene cuatro `forwardRef`.

### B-28 · Transacción compartida — **Alta** — Roles + Usuarios; Usuarios + SaaS + Organizaciones

**Ubicación:**
- `roles/roles.service.ts:207` y `:253` — una transacción escribe `Role` (Roles) y `User` +
  `UserSecurity` (Usuarios)
- `users/users.service.ts:332-346` — `membershipService.revoke(…, manager)` (Organizaciones) +
  `saasService.releaseUsage(manager, …)` (SaaS) en la misma transacción
- `users/users.service.ts:753-760`, `:823-826` — `saasService.enforceLimit(manager, …)` +
  `membershipService.grant(…, manager)`
- `auth/services/registration.service.ts:312` — `membershipService.grant(user.id, organization.id, manager)`
- `auth/strategies/registration/profile-registration.strategy.ts:61` —
  `localizationService.applyFiscalPackage(organization, manager)`: Configuración escribiendo dentro
  de la transacción de registro

Estos son menos graves de fondo que B-02/B-04/B-09: Identidad es plausiblemente **un solo
servicio** en cualquier despliegue realista, y las escrituras compartidas caen dentro de esa
frontera. El problema real es `saas` (cuotas de plan) y `localization` (paquete fiscal), que sí son
Configuración.

### B-29 · Acoplamiento de datos — **Alta** — `Organization` es la tabla más compartida del sistema

**Ubicación:** registran repositorios sobre `Organization` u `OrganizationSettings`: `accounting`,
`accounts-payable`, `auth`, `compliance`, `consolidation`, `currencies`, `customers`, `dashboard`,
`datasheets`, `einvoicing`, `financial-reporting`, `fixed-assets`, `intercompany`, `invoices`,
`payment`, `saas`, `sales`, `shared`, `treasury`, `users` — **20 módulos**.

`OrganizationSettings` es un caso aparte: contiene `defaultInventoryId`,
`defaultOpeningBalanceEquityAccountId`, `defaultInventoryAdjustmentAccountId`, `baseCurrency`. La
configuración contable de un tenant está en una tabla de Identidad, leída directamente por
Inventario (`inventory-posting.service.ts:71-73`), Facturación, Nómina y Contabilidad.

**Forma correcta:** `OrganizationSettings` se parte por dueño. Las cuentas por defecto son **de
Contabilidad** y se leen por `ContabilidadPort.defaultAccounts(orgId)`. Identidad conserva nombre,
dominio y jerarquía.

---

# Cierre

## Mapa de dependencias entre los nueve módulos

Aristas medidas sobre imports reales. `(Ne)` = cuántas de esas importaciones son de **entidades**,
es decir acceso directo al modelo de datos ajeno y no a una interfaz.

```
                    ┌─────────────────────────────────────────┐
                    │              CONFIG/ADMIN               │
                    │  common · shared · i18n · localization  │
                    │        audit · workflows · taxes        │◄──┐
                    └──▲────▲────▲────▲────▲────▲────▲────────┘   │
   ciclo ↕ con TODOS ──┘    │    │    │    │    │    │            │ 178(11e)
                            │    │    │    │    │    │            │
   ┌────────────────────────┴────┴────┴────┴────┴────┴────────────┴───┐
   │                                                                  │
┌──▼──────────┐ 172(78e)  ┌──────────────┐                    ┌───────┴──────┐
│ IDENTIDAD   │◄══════════│ CONTABILIDAD │◄═══════ 82(52e) ═══│  FINANZAS/   │
│ auth·users  │  3(1e)    │ accounting·  │═══════► 21(3e)     │  TESORERÍA   │
│ roles·orgs  │══════════►│ journal-entr │                    └───────▲──────┘
│ saas        │           │ ·coa·assets  │◄═══════ 61(29e) ═══┐       │ 15(6e)
└──▲──▲──▲──▲─┘           └──▲───▲───┬───┘  1(1e) ═══════════►│       │
   │  │  │  │ 148(77e)       │   │   │                ┌───────┴───────┴──┐
   │  │  │  └────────────────┼───┼───┼────────────────│  VENTAS/FACTUR.  │
   │  │  │                   │   │   │                │ invoices·custom  │
   │  │  │ 36(12e)        37(15e)│   │ 1(1e)          │ einvoicing·compl │
   │  │  └───────────────────┼───┼───┼────────┐       └──▲────┬──────────┘
   │  │                      │   │   └────────┼──────────┘    │ 8(4e)
   │  │                   ┌──┴───┴──┐      ┌──┴──────────┐    │
   │  │ 25(5e)            │ COMPRAS │◄─────│  2(0e)/5    │    │
   │  └───────────────────┤ procur· │      └─────────────┘    │
   │                      │ AP·supp │───── 4(2e) ────┐        │
   │                      └─────────┘                ▼        ▼
   │  11(1e)          18(9e) │              ┌──────────────────┐
   ├──────────┐   ┌──────────┘              │    INVENTARIO    │
┌──┴───────┐  │   │                         │ inventory·supply │
│  RR.HH.  │──┘   └────────────────────────►│ ·uom·manufact    │
│ payroll  │ 8(3e) → CONTABILIDAD           └──────────────────┘
│  ·hcm    │
└──────────┘
                      ┌──────────────────────────────────────────┐
     REPORTES ───────►│ lee ENTIDADES de 7 de los 8 módulos:     │
  reports·bi·datash   │ VTA 23e · IAM 24e · CTB 18e · CMP 7e ·   │
  overview·dashboard  │ INV 5e · RRHH 2e · FIN 2e                │
                      │ CTB ←1─ REPORTES  ⟹ CICLO                │
                      └──────────────────────────────────────────┘
```

### Ciclos confirmados entre módulos de negocio

Todos críticos por definición: ningún extremo de un ciclo se extrae sin el otro.

| Ciclo | Peso (ida/vuelta) | Dificultad de romper |
|---|---|---|
| CONFIG ↔ IDENTIDAD | 104 / 178 | **Muy alta** — malla densa bidireccional |
| CONFIG ↔ CONTABILIDAD | 41 / 207 | **Muy alta** — incluye B-22 (`shared/` provisioner) |
| CONFIG ↔ VENTAS | 8 / 143 | Media |
| CONFIG ↔ FINANZAS | 5 / 65 | Media |
| CONFIG ↔ INVENTARIO | 3 / 30 | **Baja** — 3 aristas |
| CONTABILIDAD ↔ IDENTIDAD | 172 / 3 | **Baja** — 3 aristas de vuelta |
| CONTABILIDAD ↔ FINANZAS | 21 / 82 | Alta |
| CONTABILIDAD ↔ VENTAS | 1 / 61 | **Trivial** — 1 arista (`financial-reporting.module.ts:10`) |
| CONTABILIDAD ↔ REPORTES | 1 / 38 | **Trivial** — 1 arista (`general-ledger.spec.ts:26`) |
| COMPRAS ↔ CONTABILIDAD | 37 / 1 | **Trivial** — 1 arista (`closing-checklist.service.ts:15`) |
| COMPRAS ↔ VENTAS | 2 / 5 | **Baja** |

Cinco de los once ciclos cuelgan de una a tres líneas. Ese es el trabajo de mayor retorno del
proyecto: **se eliminan cinco ciclos críticos tocando menos de diez líneas.**

Ciclos internos adicionales —dentro de un mismo módulo de negocio, igualmente bloqueantes para el
despliegue— incluyen `auth ↔ users` (59/22), `accounting ↔ journal-entries` (41/27),
`accounting ↔ chart-of-accounts` (24/2), `einvoicing ↔ invoices` (23/17),
`auth ↔ organizations` (23/18), y 51 más: **56 ciclos de dos nodos en total**, con 38 `forwardRef`
a nivel de `@Module` reconociéndolos explícitamente.

## Preparación para extracción, por módulo

| Módulo | Backend → microservicio | Frontend → micro-frontend | Justificación |
|---|---|---|---|
| **RR.HH./Nómina** | **Medio** | **Medio-alto** | El mejor del backend. Superficie externa pequeña (8 imports a Contabilidad, 11 a Identidad), **sin ciclos**, y el acoplamiento contable está aislado en un archivo (`payroll-accounting.service.ts`). Hay que convertir ese archivo en emisor de eventos y cortar la transacción compartida en `payroll-run.service.ts:247,331,374`. En frontend, `features/payroll` + `features/hcm` con manifiesto propio y solo dos clientes API, ambos suyos. |
| **Inventario** | **Bajo-medio** | **Medio** | Ciclos con Config de solo 3 aristas y ninguno con otros módulos de negocio. Pero: transacción compartida con Contabilidad en las 3 operaciones de escritura (B-02), `inventory-posting.service.ts` completo a reubicar, `Warehouse` con dueño ambiguo, y Ventas le escribe el stock desde su propia transacción (B-04). En frontend, dos páginas viven en `features/masters`. |
| **Compras/Proveedores** | **Bajo-medio** | **Medio** | El ciclo con Contabilidad es de una línea. Pero 37 imports hacia Contabilidad, 15 de ellos de entidades, y transacciones compartidas en 5 sitios de `accounts-payable`. `procurement`, `accounts-payable` y `suppliers` no comparten frontera declarada. |
| **Ventas/Facturación** | **Bajo** | **Bajo-medio** | Ciclo interno denso `invoices ↔ einvoicing` (23/17). `issueWithin` toca 5 módulos en una transacción. Registra `AccountingPeriod` y `AccountPeriodLock`. Los cobros (`customer-payments`) son de Tesorería pero viven aquí. 77 imports de entidades a Identidad. |
| **Finanzas/Tesorería** | **Bajo** | **Bajo-medio** | El bounded context está repartido en 6 carpetas (`treasury`, `reconciliation`, `payment`, `budgets`, `currencies`, más `customers/customer-payments`). 52 importaciones de entidades de Contabilidad. Conciliación escribe `JournalEntryLine` en su propia transacción. Ciclo con Identidad (58/6). |
| **Registro/Login/Usuarios** | **Bajo** | **Medio** | 7 carpetas en malla completa con `forwardRef` en 5 de ellas; `auth` escribe directamente `users`, `roles` y `organizations`. Mitigante: Identidad es candidato natural a servicio único — pero `saas` (cuotas) y `payment` (Stripe) están dentro y no deberían. `Organization` la leen 20 módulos. En frontend `features/auth` es la feature más limpia del proyecto. |
| **Contabilidad** | **Bajo** | **Medio-alto** | 10 carpetas con ciclos triples internos (`accounting ↔ journal-entries ↔ chart-of-accounts`), 6 `forwardRef` en un solo módulo, 78 importaciones de entidades de Identidad, y `shared/` escribiendo sus tablas por fuera. Es el núcleo del que cuelga todo — probablemente no debe extraerse, pero debe **poder** hacerlo. En frontend `features/accounting` es coherente (25 rutas de un manifiesto) salvo que Tesorería le roba 5 páginas (`tesoreria.manifest.ts:26-65`). |
| **Configuración/Admin** | **Muy bajo** | **Bajo** | 23 carpetas, ciclos con los 8 módulos restantes, `SharedModule` es `@Global()` y escribe tablas de 5 dueños, `permissions.ts` acopla los nueve. No es un módulo: es el sustrato. |
| **Reportes** | **Muy bajo** | **Medio** | Lee entidades de 7 de los 8 módulos restantes (86 importaciones de entidades). `datasheets` registra repositorios de 6 módulos; `overview` de 4. Extraerlo requiere primero construir un modelo de lectura propio — es el módulo que más trabajo *ajeno* exige. En frontend es mejor: `features/reports` + `features/datasheets` solo consumen 3 clientes API, aunque `features/reports` sirve a tres manifiestos. |

## Patrones de mezcla más repetidos

Estos seis no son errores puntuales: son convenciones del proyecto. Cada uno aparece en 5 o más
módulos, lo que apunta a proceso y no a descuido.

### P-1 · El módulo operativo arma el asiento contable y lo postea en su propia transacción

13 módulos fuera de Contabilidad construyen `CreateJournalEntryDto` y llaman `createWithManager` o
`createWithQueryRunner`: `inventory`, `invoices`, `accounts-payable`, `customers`, `fixed-assets`,
`payroll`, `treasury`, `reconciliation`, `intercompany`, `batch-processes`,
`accounting/inflation-adjustment`, `accounting/period-closing`, `accounting/result-transfer`.

Es el patrón raíz. Explica simultáneamente la mezcla de contexto (vocabulario contable en
Inventario y Nómina), las transacciones compartidas y buena parte de los ciclos. Un solo cambio de
convención —posteo por evento tras el commit— corrige los tres.

### P-2 · `TypeOrmModule.forFeature` con entidades de otro dueño

**57 registros** en **35 módulos**. Los más extremos: `datasheets` registra entidades de 6 módulos;
`overview` de 4; `intercompany` de 3. `Organization` y `OrganizationSettings` son registradas por
20 módulos.

Es la negación directa de "una tabla, un dueño", y es lo que hace que ninguna extracción sea un
corte limpio: hay que reescribir 57 puntos de acceso.

### P-3 · `forwardRef` como forma aceptada de tratar un ciclo

38 declaraciones en 19 módulos, algunas anotadas explícitamente (`roles.module.ts`:
`// Usa forwardRef aquí`). No hay un solo caso en el repositorio donde un ciclo se haya roto
invirtiendo la dependencia en vez de ocultarla.

Es un problema de convención, no de código. Mientras `forwardRef` sea la respuesta esperada, cada
feature nueva añade un ciclo.

### P-4 · `shared/` y `common/` como escape del ciclo

Cuando dos módulos se necesitan mutuamente, el código se mueve a `shared/` — y `SharedModule` es
`@Global()`. Resultado: `shared/permissions.ts` acopla los 9 módulos,
`shared/provisioning/tenant-bookkeeping.provisioner.ts` escribe las tablas de 5,
`shared/fiscal-calendar.service.ts` las de 2, y `common` tiene aristas de vuelta hacia `users`,
`organizations`, `currencies` y `localization`.

El comentario de `tenant-bookkeeping.provisioner.ts:33-36` documenta esta decisión como
intencional. Es el síntoma más claro de que falta un nivel de orquestación por encima de los
módulos.

### P-5 · Frontend organizado por capa bajo una apariencia de features

`core/api/` (35 servicios), `core/services/` (35) y `core/models/` (15) contienen el dominio de los
nueve módulos en carpetas planas. `features/masters` sirve a 5 manifiestos, `features/reports` a 3,
`features/contacts` a 2, y `tesoreria.manifest.ts:26-65` carga 5 páginas desde
`features/accounting`.

Las 4 importaciones cruzadas entre features son un falso positivo de salud: el acoplamiento está un
nivel más abajo y es total.

### P-6 (meta) · Ninguna frontera es verificable

`eslint.config.mjs:16-19` tiene `@nx/enforce-module-boundaries` configurado como `'*' → ['*']`, y
los 68 módulos viven dentro de dos apps Nx en vez de libs, así que la herramienta no podría verlos
aunque estuviera configurada.

Mientras esto no cambie, cualquier corrección de los patrones P-1 a P-5 se degrada de nuevo en
semanas. **Este es el primer arreglo, no el último**: sin frontera compilable, el resto es limpieza
temporal.
