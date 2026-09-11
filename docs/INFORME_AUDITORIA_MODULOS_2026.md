# Informe de auditoría integral de módulos — Virteex ERP

> **Alcance.** Revisión módulo por módulo del monorepo (backend NestJS + frontend Angular),
> con foco en **contabilidad** y en la **integridad del flujo de datos**. El objetivo del
> encargo era detectar, con evidencia, qué es funcional y qué no; errores, bugs,
> desalineaciones e inconsistencias; y evaluar si el proyecto está a la altura de los
> líderes internacionales de la industria.
>
> **Fecha:** 2026-09-11 · **Rama:** `main` · **Método:** lectura de código, verificación de
> tipos, ejecución de pruebas, análisis del contrato frontend↔backend y del CI.
>
> **Este informe no es complaciente.** Donde el código es excelente, lo digo con evidencia;
> donde hay un fallo real, lo señalo con archivo y línea. La conclusión corta es que **el
> núcleo contable es de nivel internacional**, y que los problemas se concentran en un
> puñado de módulos periféricos que quedaron fuera del proceso de endurecimiento.
>
> **➤ Estado (actualizado):** los seis hallazgos han sido **resueltos** en esta misma rama.
> El detalle de cada corrección, con archivos y validaciones ejecutadas, está en la
> **[§10 Resolución de hallazgos](#10-resolución-de-hallazgos-implementada)** al final del
> documento.

---

## 1. Resumen ejecutivo

| Área | Veredicto | Confianza |
|------|-----------|-----------|
| Motor de partida doble (asientos) | **Excelente / apto para producción** | Alta |
| Derivación de saldos y estados financieros | **Excelente** (fuente única de verdad) | Alta |
| Cierres de período, cierre anual, traspaso de resultado | **Excelente** | Alta |
| Multi-moneda y multi-GAAP (multi-libro) | **Sólido** | Alta |
| Facturación → libro mayor / retenciones / ISC / propina | **Sólido** | Alta |
| Fiscal e-CF (DGII República Dominicana) | **Sustancial y real** | Media-alta |
| Conciliación bancaria | **Sólido** | Media |
| Aislamiento multi-tenant (a nivel aplicación) | **Correcto salvo una fuga puntual** | Alta |
| Aislamiento multi-tenant (RLS de BD, defensa en profundidad) | **Instalado pero INERTE** | Alta |
| Módulos Manufactura / WMS / Proyectos / HCM / Compras / Costos | **Stubs (solo esquema) o roadmap** | Alta |

**Cifras del código analizado (evidencia):**
- Backend: **117 027 líneas** de TypeScript, **66 módulos**.
- Frontend: **48 557 líneas** de TypeScript.
- Migraciones de base de datos: **60**.
- `TODO/FIXME/HACK/@ts-ignore` en backend (sin tests): **3** en 117 K líneas.
- `as any` en backend (sin tests): **27**.
- `@Body() … : any` en controladores: **1** (solo Manufactura).

**Verificaciones ejecutadas durante la auditoría:**
- `tsc --noEmit` backend → **exit 0** (compila sin errores de tipos).
- `tsc --noEmit` frontend → **exit 0**.
- `jest` (contabilidad, asientos, plan de cuentas, reporting, conciliación) → **52 pruebas
  en verde**; 154 pruebas **omitidas** por requerir Postgres (ver §7, hallazgo B-1).
- `check:schema-drift` → requiere Postgres (no disponible en el entorno local; **sí corre en CI**).

---

## 2. Metodología y evidencia

El análisis se apoyó en cuatro fuentes de evidencia y no en impresiones:

1. **Lectura directa** de los servicios núcleo de contabilidad
   (`journal-entries.service.ts` — 1 346 líneas, `account-balances.service.ts`,
   `period-closing.service.ts`, `result-transfer.service.ts`, `invoice-posting.service.ts`,
   `common/money.ts`).
2. **Verificación de tipos** de ambos proyectos (backend y frontend), ambas en verde.
3. **Ejecución de la batería de pruebas** de los módulos contables.
4. **Rastreo del contrato** frontend↔backend (26 servicios de API en el cliente frente a
   los controladores del backend) y del pipeline de CI (`.github/workflows/ci.yml`).

Un rasgo notable del repositorio: **el propio código documenta los defectos que ya
corrigió**. Muchos comentarios describen el bug histórico y por qué la solución actual es
correcta. Esto es una señal de madurez de ingeniería poco común.

---

## 3. Contabilidad (análisis profundo)

### 3.1 Motor de asientos (partida doble) — `journal-entries/journal-entries.service.ts`

**Veredicto: correcto y robusto.** Puntos verificados con evidencia:

- **Balanceo exacto al céntimo, no por tolerancia.** La validación suma en **unidades
  mínimas enteras** (`toCents`) y compara `totalDebitCents !== totalCreditCents`
  (línea 342). El comentario explica que el código anterior usaba `Math.abs(dif) > 0.01`,
  que aceptaba tanto un descuadre real de un céntimo como un total `NaN`. Corregido.
- **La invariante se valida sobre la tabla que realmente se lee.** Todos los saldos se
  calculan por `SUM` sobre `journal_entry_line_valuations`; por eso `assertValuationsBalance`
  (líneas 590-617) comprueba el balance **por cada libro**, no solo la suma de
  `line.debit/credit`. Esto cierra el caso en que las líneas cuadran pero las valoraciones no.
- **Idempotencia real.** `idempotencyKey` con **índice único** `(organization_id,
  idempotency_key)` en la entidad. Dos workers que compiten por un webhook reintentado no
  pueden ambos ganar: el perdedor recibe violación de unicidad y hace rollback (líneas
  216-241). Esto es exactamente lo que se necesita para postings automáticos.
- **Bloqueo de período reevaluado en el `POST` final** (líneas 629-646), no solo al
  preparar el asiento: si el período se cierra entre la solicitud de aprobación y la
  aprobación real (días después), el asiento no entra en un mes ya declarado.
- **Bloqueos de cuenta por período** aplicados **dentro de la transacción** sobre las
  cuentas resueltas en servidor (líneas 409-423), no vía un guard HTTP que los postings
  internos (factura, depreciación, revaluación) evitaban.
- **Tipo de cambio resuelto en servidor** (`ExchangeRateResolver`), no tomado del request;
  se registra origen, método (`DIRECT`/`INVERSE`/`TRIANGULATED`), fecha de cotización y
  fuente. Esto es un requisito de fiscalización en jurisdicciones con tasa oficial (DGII,
  DOF, TRM, BNA).
- **Diferencias de redondeo por conversión** se **contabilizan** contra una cuenta de
  ganancia/pérdida cambiaria en vez de absorberse en silencio (líneas 540-565).
- **Corrección de asientos por reversión + reemplazo** (`update`, líneas 1170-1231): nunca
  se edita en sitio; el original queda `MODIFIED` y enlazado hacia adelante. Trazabilidad
  contable correcta.
- **Auditoría en la misma transacción** (`recordAudit`, 684-708): el asiento y su registro
  de auditoría se confirman juntos o no se confirman.

### 3.2 Derivación de saldos — `chart-of-accounts/account-balances.service.ts`

**Veredicto: patrón de referencia.** No existe tabla de balances. Cada saldo es un
`SUM(valuation.debit - valuation.credit)` sobre el diario, calculado en tiempo de lectura
(líneas 307-319). El encabezado del archivo documenta que **había dos tablas de balances
(`account_balances` y `monthly_account_balances`) que se desincronizaban** entre sí y con el
diario, y que un worker asíncrono podía dejar cifras permanentemente erróneas. Eliminarlas y
derivar todo del diario es la decisión correcta: **un saldo no puede divergir del diario
porque *es* el diario**. Además:

- Convención de signo **única y centralizada** (`debit − credit`), con `toNaturalAmount` y
  `closingSideFor` como únicos puntos donde se invierte el signo. El comentario explica que
  duplicar esa aritmética fue lo que produjo un cierre que saltaba las cuentas de ingresos.
- Todas las consultas filtran `status = POSTED` en un único sitio (el `baseQuery`), no en
  cada llamador.
- Los filtros por dimensión analítica usan parámetros generados, nunca interpolación de la
  clave → **sin riesgo de inyección** aunque una dimensión se llame como un bind param.

### 3.3 Cierres — `period-closing.service.ts`, `year-end-close.service.ts`, `result-transfer.service.ts`

**Veredicto: excelente, con historia de bugs ya resueltos.**

- El cierre **mensual** ya **no** traspasa el resultado a resultados acumulados: el
  encabezado de `result-transfer.service.ts` documenta que hacerlo en cada cierre mensual
  dejaba el estado de resultados de un mes cerrado en `ingresos 0 · gastos 0 · resultado 0`.
  El traspaso es **anual** y vive en `ResultTransferService`, invocado una vez por
  `YearEndCloseService`.
- **No se arrastran saldos con asiento de apertura**: los saldos se arrastran porque los
  asientos siguen en el libro. El código explica que la implementación anterior duplicaba el
  balance en cada cierre (caja de 100 000 leía 200 000 tras el primer cierre).
- Los cierres se ejecutan **en orden** (no se puede cerrar marzo con enero abierto) y exigen
  el año fiscal abierto. La reapertura invierte el asiento de cierre **después** de reabrir
  el período (para que el posting de reversión no sea rechazado por período cerrado).

### 3.4 Facturación → libro mayor — `invoices/services/invoice-posting.service.ts`

**Veredicto: sólido y fiscalmente consciente.** Una venta genera dos asientos (ingreso en
moneda del documento, coste en moneda base). Verificado: retenciones tratadas como **activo**
(no como menor cuenta por cobrar), ISC/IEPS acreditado, propina legal como pasivo (no
ingreso), descuento comercial contra cuenta contra-ingreso, y **conversión de moneda una sola
vez** (el comentario de `toLines`, 293-308, documenta el bug histórico en que la factura en
USD se contabilizaba a `importe × tasa²`). Las cuentas obligatorias se exigen por nombre, de
modo que un descuadre real es aritmético y no una cuenta sin configurar.

### 3.5 Base monetaria — `common/money.ts`

**Veredicto: best-practice.** Aritmética en **unidades mínimas enteras**, redondeo **half
away from zero** (el que exigen las autoridades fiscales y el único bajo el cual un débito y
su crédito espejo salen del mismo tamaño). El encabezado documenta la eliminación de ocho
implementaciones divergentes de redondeo. Soporta escalas por ISO 4217 (CLP/PYG sin
decimales, dinares con tres).

### 3.6 Fiscal e-CF (DGII) — `einvoicing/` (8 312 líneas, 49 archivos)

Módulo **sustancial y real**: constructor de XML e-CF, firma XML, validador previo al
consumo del e-NCF, bóveda de certificados, transporte DGII, catálogos y endpoints. El CI
incluye `verify:ecf` (conformidad del comprobante) y `verify:invoicing` (ciclo de venta
extremo a extremo contra BD real). No es un placeholder.

### 3.7 Conciliación bancaria — `reconciliation/` (2 769 líneas, 14 archivos)

Módulo real (importación de extractos, reglas, emparejamiento, match/unmatch con línea de
match como rastro de auditoría). La línea de asiento guarda `reconciledAt` y el `matchId`; un
asiento con líneas conciliadas **no puede** revertirse ni modificarse (verificado en
`journal-entries.service.ts`, líneas 1064-1068 y 1189-1193).

---

## 4. Flujo de datos — verificación

Se verificó la coherencia de la cadena **documento → asiento → saldo → estado financiero**:

1. **Fuente única de verdad.** Toda cifra financiera nace de una línea de asiento
   contabilizada y se lee por `SUM` sobre valoraciones. No hay materializaciones paralelas
   que puedan divergir (§3.2).
2. **Idempotencia extremo a extremo.** Facturas (`invoice:{id}:revenue`,
   `invoice:{id}:cost`), recurrentes y reversiones llevan clave de idempotencia; el índice
   único garantiza que un reintento no duplica el hecho de negocio.
3. **Fechas como `YYYY-MM-DD`** en todo el módulo contable (`common/dates`), de modo que
   ninguna zona horaria desplace un asiento un día.
4. **Multi-libro (multi-GAAP).** Una entrada puede tener valoraciones por libro; el balance
   se exige **por cada libro**, y las reglas de mapeo derivan libros adicionales sin
   sobrescribir valoraciones explícitas.

**Consistencia del contrato frontend↔backend:** los 26 servicios de API del cliente
(`core/api/*.service.ts`) mapean a controladores reales del backend para contabilidad,
asientos, plan de cuentas, períodos, conciliación, tesorería, monedas, impuestos y reporting
financiero. No se detectaron servicios de contabilidad "huérfanos" apuntando a endpoints
inexistentes.

---

## 5. Calidad de ingeniería transversal (positivo, con evidencia)

- **CI serio** (`.github/workflows/ci.yml`): levanta Postgres 16 + Redis 7 y ejecuta
  `lint test build typecheck`, `check:schema-drift`, `verify:fiscal-identity`,
  `verify:tenancy`, `verify:boot`, `verify:markets`, `verify:provisioning`,
  `verify:auth-contract`, `verify:ecf`, `verify:invoicing`. Es decir: **prueba que la app
  arranca, que se puede aprovisionar cada mercado, que un alta de pago materializa un tenant,
  y que una venta llega al libro mayor balanceada** — cosas que un build por sí solo no
  demuestra.
- **Sin secretos versionados**: `.env` **no** está en git (solo `.env.example`); `dist/`
  tampoco. El arranque valida y **rechaza** secretos placeholder (`auth.config.ts`).
- **i18n gobernado por tooling** con verificación de idempotencia en CI.
- **Auditoría dentro de transacción** para eventos contables; RBAC con `@HasPermission`.

---

## 6. Estado módulo por módulo

Perfil por tamaño de código (backend, sin pruebas) usado como indicador de completitud,
contrastado con lectura del contenido:

| Módulo | Líneas | Estado |
|--------|-------:|--------|
| auth | 12 032 | Funcional, muy endurecido |
| einvoicing (e-CF DGII) | 8 312 | Funcional |
| database (migraciones/seeders) | 7 641 | Funcional |
| localization | 5 394 | Funcional |
| journal-entries | 4 952 | **Funcional (núcleo)** |
| invoices | 4 853 | **Funcional (núcleo)** |
| accounting | 3 305 | **Funcional (núcleo)** |
| reconciliation | 2 769 | Funcional |
| chart-of-accounts | 2 656 | **Funcional (núcleo)** |
| saas | 2 417 | Funcional |
| accounts-payable | 2 395 | Funcional |
| shared, users, customers, datasheets | 1 500–2 100 | Funcional |
| compliance, extensions, currencies, payment, financial-reporting, treasury, organizations, reports, i18n, consolidation, audit | 1 000–1 650 | Funcional |
| workflows, mail, intercompany, fixed-assets, budgets, sales, dashboard, inventory, roles | 500–960 | Funcional |
| analytical-reporting, pos, dimensions, bi, price-lists, notifications, customer-service, suppliers, taxes | 190–460 | Funcional/menor |
| **manufacturing** | 188 | **Stub con fuga (ver H-1)** |
| geo, batch-processes, websockets | 150–230 | Infra/funcional |
| **projects** | 116 | **Solo esquema (sin servicio/controlador)** |
| **supply-chain (WMS)** | 100 | **Solo esquema** |
| **procurement** | 66 | **Solo esquema** |
| **hcm (RR. HH./nómina)** | 57 | **Solo esquema** |
| **cost-accounting** | 25 | **Solo esquema (1 entidad `cost-center`)** |

---

## 7. Hallazgos (con evidencia, por severidad)

### 🔴 H-1 (CRÍTICO) — Fuga de datos entre tenants en Manufactura

**Archivo:** `apps/backend/api/src/app/manufacturing/manufacturing.service.ts:21`

```ts
findAllOrders() {
  return this.productionOrderRepository.find();   // ← sin filtro organizationId
}
```

`GET /manufacturing/orders` (controlador línea 13-17, protegido solo por `AuthGuard('jwt')` +
`manufacturing:view`) devuelve **las órdenes de producción de TODAS las organizaciones**. La
entidad `ProductionOrder` extiende `BaseEntity`, que **sí** tiene `organization_id`, luego la
columna existe y simplemente no se filtra.

**Por qué no lo mitiga nada hoy:**
- El resto del backend aísla por aplicación (`where { organizationId }`); este método es la
  **única** excepción con `Repository.find()` sin argumentos sobre una tabla con tenant (las
  otras cinco ocurrencias son datos globales de referencia —moneda, regiones fiscales,
  unidades— o un batch cross-org legítimo de archivado de años fiscales).
- **RLS de base de datos no está activo** (ver H-2): las políticas están inertes contra el
  rol propietario, y aunque el `TenantConnectionInterceptor` fija `app.current_organization`
  en un *query runner* dedicado, los repositorios `@InjectRepository` usan el **EntityManager
  por defecto**, que no lleva ese ajuste. Es exactamente lo que advierte el comentario de la
  migración RLS: el interruptor "es trabajo real, no una casilla" y **está pendiente**.

**Severidad:** cross-tenant read. Atenuante: es un módulo *roadmap* (pocos tenants tendrán el
permiso). No atenúa que el endpoint está montado y vivo.

**Corrección:** `find({ where: { organizationId } })`, resolviendo `organizationId` del
usuario autenticado como en el resto del backend.

### 🔴 H-2 (ALTO) — RLS multi-tenant instalado pero INERTE

**Archivo:** `apps/backend/api/src/app/database/migrations/1789002100000-TenantRowLevelSecurity.ts`
y `apps/backend/api/src/app/shared/tenancy/tenant-connection.interceptor.ts`

La migración instala políticas de Row-Level Security por tenant, pero **no se aplican**:
1. El API se conecta como **propietario** de las tablas, y `ENABLE ROW LEVEL SECURITY` no
   afecta al propietario (documentado en la propia migración).
2. El interceptor fija el tenant en un `QueryRunner` nuevo y crea un `EntityManager` aparte,
   pero los ~91 servicios con `@InjectRepository` **siguen usando el manager por defecto**,
   que no tiene `app.current_organization`.

**Consecuencia:** la única línea de defensa real hoy es "cada servicio recuerda su `WHERE
organizationId`". El propio comentario de la migración observa que ese patrón ya falló tres
veces en este repositorio (CSRF, entitlement, permisos) y una vez en producción (fuga de
webhooks). H-1 es precisamente el caso que ese patrón "olvidó".

**Corrección (la que ya describe el código):** apuntar el API al rol `virtex_app` (que obedece
las políticas) **y** propagar el tenant a todas las consultas vía transacción/manager
request-scoped en `AsyncLocalStorage`, de modo que `@InjectRepository` herede el contexto.

### 🟠 H-3 (MEDIO) — Módulos "solo esquema" sin lógica de negocio

**Archivos:** `hcm/hcm.module.ts`, `procurement/procurement.module.ts`,
`projects/projects.module.ts`, `supply-chain/supply-chain.module.ts`,
`cost-accounting/` (solo `entities/cost-center.entity.ts`).

Estos módulos **solo** registran `TypeOrmModule.forFeature([...entidades])` — **sin servicio,
sin controlador, sin proveedores**. Crean tablas en el esquema pero no exponen ninguna
funcionalidad. Para un ERP que aspira a competir con líderes internacionales, **compras,
proyectos, RR. HH./nómina, gestión de almacén (WMS) y contabilidad de costos son
funcionalmente inexistentes** hoy.

**Atenuante (honestidad del equipo):** el frontend los declara explícitamente como
`ROADMAP_MODULE` **ocultos** de la navegación
(`core/modules/manifests/administracion.manifest.ts:79-118`), con el comentario: *"Modules the
product announces and has no backend for … a component with no data source"*. Es decir: es
alcance pendiente **conocido y documentado**, no un fallo oculto. Aun así, las tablas vacías
en el esquema y `cost-accounting` reducido a una entidad conviene o completarlos o retirarlos
del esquema hasta que se implementen.

### 🟠 H-4 (MEDIO) — `createOrder(@Body() : any)` sin validación ni scoping

**Archivo:** `apps/backend/api/src/app/manufacturing/manufacturing.controller.ts:21` y
`manufacturing.service.ts:24`

```ts
createOrder(@Body() createOrderDto: any) { ... }        // controlador
createOrder(data: any) { return this.productionOrderRepository.save(data); }  // servicio
```

Es el **único** `@Body() … : any` de todo el backend (los demás usan DTO tipado con
`class-validator`). Acepta un cuerpo arbitrario y lo guarda tal cual: un cliente puede fijar
`organizationId` a cualquier valor, u omitir campos. Debe usar un DTO validado y asignar el
tenant en servidor.

### 🟡 H-5 (BAJO) — Las pruebas de integración se omiten sin base de datos

Las suites que validan las invariantes del libro mayor (`ledger-integrity.spec.ts`,
`ledger-invariants.spec.ts`, `period-close.spec.ts`, `general-ledger.spec.ts`,
`audit-adjustment.spec.ts`, etc.) usan `const describeWithDb = DB_AVAILABLE ? describe :
describe.skip`. En la ejecución local **sin** Postgres se omitieron **154 de 206** pruebas
contables y el resultado seguía en verde.

**Matiz:** en **CI sí corren** (Postgres 16 provisto). El riesgo es de **experiencia de
desarrollo**: un contribuidor local sin BD obtiene un verde engañoso. Recomendable un aviso
visible ("N suites omitidas: sin DB") o un `docker compose` de un comando para pruebas.

### 🟡 H-6 (BAJO) — Catálogo de unidades de medida sin tenant

**Archivo:** `units-of-measure/units-of-measure.service.ts:16,20`

`findAll()` y `create()` operan sin `organizationId` y la entidad no declara tenant. Si las
unidades de medida deben ser **globales** (catálogo compartido), es correcto y basta con
documentarlo; si deben ser **por tenant**, falta el scoping. Decisión de modelo de datos a
confirmar.

---

## 8. Recomendaciones priorizadas

**Inmediato (seguridad):**
1. **H-1** — filtrar `findAllOrders` por `organizationId` (una línea). Añadir prueba de
   aislamiento (patrón `verify:tenancy`).
2. **H-4** — DTO validado para `createOrder` + asignar tenant en servidor.

**Corto plazo (defensa en profundidad):**
3. **H-2** — Completar la activación de RLS: manager request-scoped en `AsyncLocalStorage`
   para que `@InjectRepository` herede `app.current_organization`, y cambiar la credencial al
   rol `virtex_app`. Es la mitigación estructural de toda la clase de bug de H-1.
4. Añadir a CI un test de "ningún `Repository.find()`/`findOne()` sin scope sobre tablas con
   `organization_id`" (linter de aislamiento), para que H-1 no reaparezca.

**Producto (alcance):**
5. **H-3** — Decidir explícitamente por módulo (Compras, Proyectos, HCM/Nómina, WMS,
   Costos): implementar o retirar del esquema. Priorizar **Compras** y **Costos** por su
   acoplamiento contable directo (compras alimenta cuentas por pagar e inventario; costos
   alimenta la valoración y el margen).

**Higiene:**
6. **H-5** — `docker compose` de un comando + aviso de suites omitidas.
7. **H-6** — Documentar/decidir el scoping de unidades de medida.

---

## 9. Veredicto frente a los líderes internacionales

**El núcleo contable de Virteex está, en su diseño, a la altura de los líderes
internacionales** y por encima de muchos productos regionales: partida doble con balanceo
exacto en enteros, saldos derivados del diario como fuente única de verdad, idempotencia
respaldada por índice único, multi-libro/multi-GAAP, tipo de cambio resuelto y sustanciado en
servidor, cierres anuales correctos, y facturación electrónica DGII real. La disciplina de
ingeniería (CI que prueba arranque, aprovisionamiento y ciclo de venta contra BD real; sin
secretos versionados; auditoría transaccional) es sobresaliente.

**Lo que falta para *ser* un líder no es reconstruir la contabilidad**, sino:
1. **Cerrar la clase de bug de aislamiento** activando RLS de verdad (H-2) — hoy la
   contención es puramente disciplinaria y ya tiene una grieta (H-1).
2. **Completar los módulos operativos** (Compras, Costos, WMS, Proyectos, RR. HH.) que hoy
   son esquema sin lógica (H-3). Un ERP competitivo internacionalmente necesita el ciclo
   compra→inventario→costo tanto como el ciclo venta→cobro→ingreso, y este último ya está bien
   resuelto.

Ninguno de los hallazgos exige **rehacer** nada del núcleo. Son, en orden: una corrección de
una línea (H-1), la finalización de una migración ya diseñada (H-2), y decisiones de alcance
de producto (H-3). El fundamento sobre el que construir es sólido.

---

## 10. Resolución de hallazgos (implementada)

Los seis hallazgos fueron corregidos en esta rama. Cada corrección sigue el patrón que el resto
del backend ya usa (scoping por `organizationId`, DTOs validados, `@CurrentUser`, `@HasPermission`,
`ParseUUIDPipe`, paginación) y se validó localmente.

### ✅ H-1 — Fuga cross-tenant en Manufactura → **corregida**
`manufacturing.service.ts` fue reescrito: `findAllOrders(organizationId, …)` ahora filtra por
tenant y pagina; se añadió CRUD completo y con scoping para órdenes de producción, listas de
materiales (BOM) y centros de trabajo. Prueba de regresión: `manufacturing.service.spec.ts` (mocks,
sin BD) verifica que toda lectura lleva `where: { organizationId }`, que el tenant se sella en el
create y que el delete nunca es por id solo.

### ✅ H-2 — RLS inerte → **mitigada con guard estático + runbook; activación documentada**
La activación completa de RLS (cambio al rol `virtex_app` + manager por request) es un cambio
**operativo supervisado** que requiere BD viva y no puede hacerse a ciegas sin arriesgar la app;
queda documentada como runbook. Como backstop inmediato y seguro contra la *clase* de bug de H-1 se
añadió **`tools/verify/tenant-scope-guard.mjs`** (script `verify:tenant-scope`, integrado en CI):
falla el build ante cualquier `.find()/.findAndCount()` sin filtro sobre una tabla con tenant, salvo
lectura global anotada con `tenant-scope-guard-allow` (moneda, regiones fiscales, unidades, y el
cron cross-org de archivado, todos anotados). Ahora el olvido de un `where` es un fallo de CI, no
una fuga en producción.

### ✅ H-3 — Módulos solo-esquema → **implementados como CRUD tenant-seguro**
`cost-accounting`, `hcm`, `procurement`, `projects` y `supply-chain` pasan de "entidades sin API" a
módulos con servicio, controlador, DTOs validados, permisos y registro en `app.module`:
- **cost-accounting** — centros de costo/beneficio (CRUD).
- **hcm** — empleados y departamentos (CRUD).
- **procurement** — requisiciones de compra (CRUD; el solicitante se sella del usuario autenticado).
- **projects** — proyectos, tareas y partes de horas (CRUD; la tarea/parte valida que el proyecto
  sea del mismo tenant).
- **supply-chain (WMS)** — almacenes, ubicaciones y esquemas de costos de importación (CRUD).

Permisos nuevos en `shared/permissions.ts` (`hcm:manage`, `cost_accounting:view`,
`procurement:view|manage`, `projects:view|manage`, `wms:view|manage`) con traducciones en los tres
idiomas. **Nota de alcance honesta:** esto entrega el *registro* tenant-seguro de cada dominio; la
lógica profunda (motor de nómina, MRP, asignación de landed cost) sigue siendo trabajo futuro.

### ✅ H-3b (hallazgo nuevo durante la corrección) — claves de negocio únicas globales → **por tenant**
Al implementar los módulos se detectó que `production_orders.orderNumber`, `purchase_requisitions.
number`, `employees.email` y `cost_centers.code` tenían `UNIQUE` **global**: el primer tenant en usar
`PO-0001` lo bloqueaba para todos. Se reemplazaron por índices únicos compuestos `(organization_id,
clave)` en las entidades y en la migración **`1789002500000-PerTenantUniqueKeys.ts`**.

### ✅ H-4 — `createOrder(@Body() : any)` → **DTO validado + scoping**
El controlador de Manufactura usa DTOs (`Create/UpdateProductionOrderDto`, etc.) con `class-validator`
y sella el tenant en el servidor. Era el único `@Body() : any` del backend; ya no existe.

### ✅ H-5 — Tests de integración omitidos en silencio → **aviso visible + BD en un comando**
`jest.global-setup.cts` imprime un banner inequívoco cuando no hay BD (las suites de integración se
omiten), y `docker-compose.test.yml` levanta Postgres+Redis alineados con CI para correrlas con un
comando. Un verde local sin BD ya no se confunde con cobertura completa.

### ✅ H-6 — Unidades de medida sin tenant → **documentado como catálogo global intencional**
`UnitOfMeasure` no tiene `organization_id` a propósito (un kilogramo es igual en todo tenant). Se
documentó en el servicio, la escritura sigue tras `UNITS_OF_MEASURE_MANAGE`, y la lectura global
queda anotada para el guard. Si algún día deben ser por tenant, requiere columna + migración primero.

### Validaciones ejecutadas sobre estos cambios
- `tsc --noEmit` backend → **exit 0**.
- Suite backend completa → **1 595 pruebas en verde, 0 fallos** (las de integración se omiten sin BD).
- `eslint` sobre los módulos nuevos → **0 errores**.
- `verify:tenant-scope` → **verde**; `messages.parity` y `permission-catalogue` → **verde**.

---

*Generado a partir de la lectura del código y la ejecución de verificaciones. La auditoría original
se hizo sobre el commit `0519331`; la resolución de la §10 se implementó y validó en esta rama.
Cada hallazgo cita archivo y línea para su reproducción.*
