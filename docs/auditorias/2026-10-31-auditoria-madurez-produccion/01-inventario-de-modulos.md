# 01 — Inventario de módulos

Auditoría de madurez y preparación para producción — 2026-10-31. Rama auditada: `ccr-835c4594-wrjtxj` en el commit `495719fc` (merge #162).

## Método

Cruce de cuatro fuentes, más la documentación:

1. **Backend**: carpetas de `apps/backend/api/src/app/*` (80 carpetas). Tamaño medido con `find`/`wc` (TS sin `*.spec.ts`), endpoints contando decoradores `@Get/@Post/@Put/@Patch/@Delete`, entidades contando archivos con `@Entity`.
2. **Frontend**: `apps/core/client-web/src/app/features/*` (34 features), rutas y menú declarados en `core/modules/manifests/*.manifest.ts` (8 manifiestos, 13 módulos de menú, 155 rutas); POS (`apps/pos`, 6.319 LOC TS); Electron (`apps/desktop`, 508 LOC).
3. **Esquema**: base migrada desde cero (163 migraciones) → 221 tablas, 174 con RLS activado, 176 políticas `pg_policies`. 204 clases `@Entity`.
4. **Menú/navegación**: los manifiestos son a la vez rutas y menú (`module-registry.ts`): una ruta no declarada en un manifiesto no es navegable.
5. **Documentación**: README (promete «~55 módulos ERP», marketplace de extensiones, POS), `docs/*.md`, cobertura fiscal autodeclarada (`localization/fiscal/fiscal-coverage.ts`).

Tamaño total: backend ≈224 k LOC TS (incl. migraciones 18 k), portal ≈114 k LOC TS+HTML (features ≈95 k, core 19 k, shared 8,5 k), POS 6,3 k, motor IA (Python) 4,7 k.

## Países

`country-profiles.ts` declara **19 mercados**: AR, BO, BR, CL, CO, CR, DO, EC, GT, HN, MX, NI, PA, PE, PY, SV, US, UY, VE. La tabla de cobertura autodeclarada (`fiscal-coverage.ts:73-191`) solo tiene fila propia para **9** (DO, MX, CO, PE, EC, CL, BR, AR, US); los otros 10 caen en `coverageFor()` → «solo contabilidad». Estrategias de jurisdicción con código propio: solo **DO** (`jurisdictions/dominican-republic.strategy.ts`) y drivers de localización **DO** y **US** (`localization/drivers/*`); el resto usa `generic-fiscal.strategy.ts`. Nómina: ver ficha (provisionamiento por país a verificar). El país real soportado por cada módulo se determina en su ficha.

## Unidades de auditoría

Columnas: **Backend** (carpetas; archivos/LOC/endpoints/entidades/specs), **Frontend** (features/rutas), **Núcleo** = forma parte del núcleo mínimo para vender un ERP. Ficha = archivo en `modulos/`.

### Plataforma transversal

| ID | Módulo | Backend | Frontend | Núcleo | Ficha |
|---|---|---|---|---|---|
| T01 | Autenticación y sesión | `auth` (111 arch., 15,3 k LOC, 64 ep, 5 ent, 36 specs), `security` (12/550) | `features/auth` (25 ts, 5,1 k), `core/auth`, `libs/shared/util-auth` | Sí | `autenticacion-y-sesion.md` |
| T02 | Usuarios, roles y permisos | `users` (24/3,2 k/30 ep/5 ent), `roles` (10/735/6 ep/1 ent), `shared/permissions.ts` | `settings` (usuarios/roles) | Sí | `usuarios-roles-permisos.md` |
| T03 | Multi-tenencia y organizaciones | `organizations` (39/4,1 k/30 ep/9 ent), `shared/tenancy`, `database/base.repository.ts`, RLS (migraciones) | `core/tenancy`, `settings` (empresa) | Sí | `multitenencia-y-organizaciones.md` |
| T04 | Suscripción y cobro del SaaS | `saas` (24/2,6 k/2 ep/4 ent), `payment` (11/1,8 k/6 ep/1 ent) | `features/payment`, registro | Sí (para operar el negocio) | `suscripcion-saas.md` |
| T05 | Núcleo técnico compartido (config, common, shared, database) | `config`, `common` (29/2,3 k), `shared` (49/3,5 k), `core`, `database` (base repo, seeds) | — | Sí | `nucleo-tecnico-compartido.md` |
| T06 | Internacionalización | `i18n` (11/1,8 k), `libs/shared/locales`, `libs/shared/ui-i18n`, `tools/i18n` | catálogos `assets/i18n` | Sí | `internacionalizacion.md` |
| T07 | Motor de localización y reglas por país | `localization` (54/7,6 k/17 ep/12 ent), `jurisdictions` (5/465), `geo` (3/156) | `settings` (fiscal) | Sí | `localizacion-reglas-pais.md` |
| T08 | Impuestos | `taxes` (6/223/5 ep/1 ent), `localization/fiscal/tax-determination` | `masters/taxes` | Sí | `impuestos.md` |
| T09 | Monedas y tipos de cambio | `currencies` (16/1,9 k/12 ep/3 ent) | `masters` (monedas) | Sí | `monedas-tipos-de-cambio.md` |
| T10 | Reportes fiscales y cumplimiento | `compliance` (11/2,1 k/10 ep/2 ent), `legal` (5/180/2 ep/1 ent) | `reports/fiscal-returns` | Sí (por país) | `reportes-fiscales-cumplimiento.md` |
| T11 | Notificaciones y mensajería | `notifications` (7/800), `push-notifications` (4/142), `mail` (8/1,3 k), `websockets` (5/463) | `features/notifications` | No | `notificaciones.md` |
| T12 | Auditoría (rastro) | `audit` (17/1,6 k/7 ep/3 ent) | settings (auditoría) | Sí | `auditoria-rastro.md` |
| T13 | Archivos y documentos | `storage` (4/321), `documents` (5/772/10 ep/1 ent) | `features/documents` | No | `archivos-y-documentos.md` |
| T14 | Tareas en segundo plano, colas y caché | `queues`, `cache`, `shared/jobs`, `shared/scheduler`, `shared/inbox`, `shared/after-commit` | `core/jobs` | Sí | `tareas-colas-cache.md` |
| T15 | Importación y exportación | `data-transfer` (6/1 k/6 ep/1 ent), importadores por módulo | `data-imports`, `data-exports`, `core/export` | Sí | `importacion-exportacion.md` |
| T16 | Búsqueda global | `search` (3/124/1 ep) | `global-search` | No | `busqueda-global.md` |
| T17 | Inteligencia artificial | `ai` (72/9,3 k/68 ep/22 ent), `ai-evaluation`, `apps/ai-engine` (Python 4,7 k) | `features/ai` (28 ts, 5,1 k) | No | `inteligencia-artificial.md` |
| T18 | Extensiones / marketplace | `extensions` (18/2,3 k/9 ep/4 ent), `platform/policies` | `features/extensions` | No | `extensiones-marketplace.md` |
| T19 | Observabilidad, salud y operación | `health`, `metrics`, `common/loggers`, interceptores | — | Sí | `observabilidad.md` |
| T20 | CI/CD, infraestructura y gobernanza del repo | `.github/workflows`, `tools/*`, Dockerfile (solo ai-engine), docs | — | Sí | `cicd-infraestructura-gobernanza.md` |
| T21 | Shell del portal, navegación y sistema de diseño | — | `core`, `layout`, `shared` (≈29 k LOC), manifiestos | Sí | `shell-portal-y-diseno.md` |
| T22 | Aplicación de escritorio | — | `apps/desktop` (Electron) | No | `escritorio.md` |
| T23 | Motor de flujos y aprobaciones | `workflow-engine` (28/5,4 k/24 ep/4 ent), `workflows` (11/1,2 k/8 ep/4 ent), `my-work` | `workflow` (8,9 k), `approvals` | No | `flujos-y-aprobaciones.md` |

### Finanzas y contabilidad

| ID | Módulo | Backend | Frontend | Núcleo | Ficha |
|---|---|---|---|---|---|
| M01 | Plan de cuentas | `chart-of-accounts` (24/2,9 k/19 ep/5 ent) | `accounting/chart-of-accounts` | Sí | `plan-de-cuentas.md` |
| M02 | Asientos, libro mayor y cierre de períodos | `journal-entries` (47/7 k/32 ep/9 ent), `accounting` (45/4,9 k/22 ep/7 ent) | `accounting/*` (14,4 k) | Sí | `asientos-mayor-y-cierre.md` |
| M03 | Dimensiones analíticas | `dimensions` (9/755/9 ep/3 ent) | `accounting/dimensions` | No | `dimensiones.md` |
| M04 | Estados financieros y reportes | `financial-reporting` (7/1,5 k), `analytical-reporting` (6/565), `reports` (11/1,1 k), `bi` (7/434) | `reports` (2,1 k), rutas `reports/financial-statements/*` | Sí | `estados-financieros-y-reportes.md` |
| M05 | Consolidación e intercompañía | `consolidation` (8/1,3 k), `intercompany` (6/825) | sin ruta propia (a verificar) | No | `consolidacion-intercompania.md` |
| M06 | Presupuestos | `budgets` (10/992/8 ep/2 ent) | `accounting/budgets`, `variance-analysis` | No | `presupuestos.md` |
| M07 | Activos fijos | `fixed-assets` (11/1,7 k/9 ep/2 ent) | `accounting/fixed-assets` | No (esperado) | `activos-fijos.md` |

### Ventas y facturación

| ID | Módulo | Backend | Frontend | Núcleo | Ficha |
|---|---|---|---|---|---|
| M08 | Facturación de ventas | `invoices` (23/6,4 k/14 ep/2 ent) | `invoices` (3,6 k) | Sí | `facturacion-ventas.md` |
| M09 | Facturación electrónica | `einvoicing` (52/9 k/14 ep/5 ent) | settings (certificados) | Sí (por país) | `facturacion-electronica.md` |
| M10 | Cotizaciones y pedidos (ventas) | `sales` (17/1,7 k/15 ep/5 ent) | `sales` (1,9 k) | Sí | `ventas-cotizaciones.md` |
| M11 | Clientes | `customers` (23/2,9 k/18 ep/6 ent) | `contacts` | Sí | `clientes.md` |
| M12 | Listas de precios | `price-lists` (7/263/5 ep/2 ent) | `masters/price-lists` | No | `listas-de-precios.md` |
| M13 | Cobranza y recibos de clientes | `collections` (9/1,2 k/8 ep/1 ent) | `customer-receipts`, `collections` | Sí | `cobranza-cxc.md` |
| M14 | Punto de venta | `pos` (10/1,2 k/10 ep/2 ent) | `apps/pos` (6,3 k) | No | `punto-de-venta.md` |

### Compras

| ID | Módulo | Backend | Frontend | Núcleo | Ficha |
|---|---|---|---|---|---|
| M15 | Compras (requisiciones, órdenes, recepciones) | `procurement` (25/3,6 k/30 ep/7 ent) | `purchasing` (2,7 k) | Sí | `compras.md` |
| M16 | Cuentas por pagar | `accounts-payable` (38/5,7 k/25 ep/6 ent) | `accounts-payable` (3,5 k) | Sí | `cuentas-por-pagar.md` |
| M17 | Proveedores | `suppliers` (9/694/6 ep/1 ent) | `contacts/suppliers` | Sí | `proveedores.md` |
| M18 | Correo entrante (captura de facturas) | `inbound-mail` (7/763/8 ep/2 ent) | `inbound-mail` | No | `correo-entrante.md` |

### Inventario y operaciones

| ID | Módulo | Backend | Frontend | Núcleo | Ficha |
|---|---|---|---|---|---|
| M19 | Inventario | `inventory` (32/5,1 k/29 ep/6 ent) | `inventory` (4,3 k) | Sí | `inventario.md` |
| M20 | Unidades de medida | `units-of-measure` (7/228/4 ep/2 ent) | `masters/units-of-measure` | Sí | `unidades-de-medida.md` |
| M21 | Cadena de suministro / almacenes (WMS) | `supply-chain` (15/822/13 ep/6 ent) | `masters/warehouses`; `features/wms` = panel «próximamente» sin ruta | No | `cadena-de-suministro-wms.md` |
| M22 | Manufactura | `manufacturing` (13/720/15 ep/4 ent) | `features/manufacturing` = panel «próximamente» sin ruta | No | `manufactura.md` |

### Tesorería

| ID | Módulo | Backend | Frontend | Núcleo | Ficha |
|---|---|---|---|---|---|
| M23 | Tesorería y bancos | `treasury` (17/2,1 k/15 ep/4 ent) | `accounting/treasury`, `masters/banks` | Sí | `tesoreria.md` |
| M24 | Conciliación bancaria | `reconciliation` (25/4,3 k/26 ep/8 ent) | `accounting/reconciliation` | Sí | `conciliacion-bancaria.md` |

### Personas

| ID | Módulo | Backend | Frontend | Núcleo | Ficha |
|---|---|---|---|---|---|
| M25 | Nómina | `payroll` (30/4,4 k/29 ep/9 ent) | `payroll` (2,6 k) | Sí (por país) | `nomina.md` |
| M26 | Recursos humanos | `hcm` (11/1,3 k/15 ep/3 ent) | `hcm` (1,4 k) | No | `recursos-humanos.md` |

### Análisis y otros

| ID | Módulo | Backend | Frontend | Núcleo | Ficha |
|---|---|---|---|---|---|
| M27 | Tablero, vista general y mi trabajo | `dashboard` (16/1,2 k/18 ep), `overview` (4/480), `my-work` (6/235) | `dashboard` (3,6 k), `overview` | No | `tablero-y-vista-general.md` |
| M28 | Mapa de relaciones | `relationship-map` (8/1,8 k/3 ep) | `relationship-map` | No | `mapa-de-relaciones.md` |
| M29 | Hojas de datos (datasheets) | `datasheets` (11/1,7 k/11 ep/4 ent) | `datasheets` (811) | No | `hojas-de-datos.md` |
| M30 | Proyectos | `projects` (12/578/13 ep/3 ent) | `features/projects` = panel «próximamente» sin ruta | No | `proyectos.md` |
| M31 | Servicio al cliente | `customer-service` (9/249/5 ep/2 ent) | ninguna | No | `servicio-al-cliente.md` |
| M32 | Contratos entre módulos (puertos) | `contracts` (25/2,1 k, 0 ep) — no es «contratos comerciales»: son interfaces/puertos entre módulos | — | N/A (arquitectura) | evaluado en `nucleo-tecnico-compartido.md` |

## Discrepancias entre fuentes (hallazgos de inventario)

| ID | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| INVT-01 | Backend sin pantalla: **manufactura** (15 endpoints, 4 tablas), **proyectos** (13 ep, 3 tablas), **cadena de suministro/WMS** (13 ep, 6 tablas), **servicio al cliente** (5 ep, 2 tablas), **consolidación** e **intercompañía** (sin ruta en manifiestos). | Rutas extraídas de `core/modules/manifests/*.manifest.ts`: ninguna `manufacturing`, `projects`, `wms`, `cases`, `consolidation`, `intercompany`. | Alta (código sin dueño funcional; superficie de ataque sin uso) — detalle en cada ficha |
| INVT-02 | Paneles «próximamente» (`features/manufacturing`, `features/projects`, `features/wms`) existen como componentes pero **no están enrutados** en ningún manifiesto: código muerto en el frontend, mientras el backend de esos dominios sí existe. | `grep -rn "manufacturing\|wms\|'projects" core/modules/` → solo un spec. | Media |
| INVT-03 | El README promete «~55 módulos ERP»; el menú real tiene 13 módulos de menú y 155 rutas; varias carpetas backend son fragmentos de un mismo dominio. La cifra no es verificable como «módulos vendibles». | `README.md:3`; `module-registry.ts:23-37`. | Media (documentación/promesa comercial) |
| INVT-04 | 19 países declarados en el perfil, 9 con cobertura fiscal propia y 1 (DO) con estrategia de jurisdicción propia; 10 países «solo contabilidad». | `country-profiles.ts`, `fiscal-coverage.ts:73-219`, `jurisdictions/`. | Alta — ver `05-matriz-pais-modulo.md` |
| INVT-05 | `docs/DEPLOYMENT.md` exige Node 20.x; `.nvmrc` fija 22 (CI usa `.nvmrc`). | `DEPLOYMENT.md` tabla de prerrequisitos; `.nvmrc`. | Baja |
| INVT-06 | Carpeta `contracts` nombrada como dominio de negocio pero contiene puertos entre módulos: nombre engañoso frente a un futuro módulo de «contratos» comerciales. | `apps/backend/api/src/app/contracts/*` | Baja |

## Dependencias (resumen)

El grafo y las violaciones de frontera medidas están en `03-resultados-de-ejecucion.md` (sección grafo) y en cada ficha (eje 5). Dependencias funcionales principales: todo módulo de negocio → T03 (tenencia), T02 (permisos), T12 (auditoría), T07/T08 (país/impuestos); ventas/compras/inventario/nómina/tesorería → M02 (asientos); facturación → M09 (e-factura) y M13 (cobros); compras → M16 → M23.
