# 01 — Inventario de módulos

Construido por el coordinador cruzando cuatro fuentes, medidas el 2026-11-07 sobre `ccr-f710ff5b-8ijix4` (= `main` @ `36f10d79`):

1. **Backend**: carpetas de `apps/backend/api/src/app/*` (76 carpetas, NestJS 11 sobre Fastify, TypeORM).
2. **Frontend**: `apps/core/client-web/src/app/features/*` (34 features, Angular 20), `apps/pos` (aplicación POS aparte), `apps/desktop` (Electron que envuelve portal y POS).
3. **Esquema**: 178 migraciones → 243 tablas, 177 políticas RLS (medido sobre base vacía migrada). Entidades por módulo: `grep -rl '@Entity('` por carpeta.
4. **Menú**: 8 manifiestos de navegación en `apps/core/client-web/src/app/core/modules/manifests/` (analisis, compras, contabilidad, inventario, rrhh, tesoreria, ventas, workspace).

Además: `apps/ai-engine` (Python, pronósticos y detección de anomalías; 29 archivos, ~3,6 k líneas), librerías `libs/shared/{types,ui-a11y,ui-i18n,util-auth,locales}`.

Método de medida: archivos `.ts` y líneas (`wc -l`), endpoints = decoradores `@Get/@Post/@Put/@Patch/@Delete`, entidades = archivos con `@Entity(`, pruebas = `*.spec.ts`. Las cifras son aproximadas y sirven para dimensionar.

## Países soportados (determinados en código, no asumidos)

El producto declara **19 mercados** (`apps/backend/api/src/app/localization/fiscal/country-profiles.ts:711-948`, `country-tax-schemes.ts:67-140`): DO, US, MX, CO, CL, PE, AR, BR, EC, UY, PY, BO, VE, PA, CR, GT, SV, HN, NI.
La profundidad no es homogénea. Según la tabla de cobertura que el propio producto muestra (`localization/fiscal/fiscal-coverage.ts`):

| Grupo | Países | Lo que el producto declara |
|---|---|---|
| Piloto | DO | Contabilidad, ITBIS, e-CF DGII (requiere certificado), 606/607/608/609, retenciones ITBIS/ISR; nómina DO (TSS/ISR) |
| Con régimen de factura electrónica construido (falta credencial del contribuyente) | MX, CO, PE, EC, CL, AR, BR | Contabilidad, determinación de IVA/IGV (BR requiere configuración), e-invoicing "needs-credentials"; declaraciones periódicas no implementadas; MX contabilidad electrónica "needs-configuration" |
| EE. UU. | US | Contabilidad; sales tax "needs-credentials" (jurisdicciones que configure el tenant); 1099 no implementado |
| Solo contabilidad genérica + IVA de tasa única | UY, PY, BO, VE, PA, CR, GT, SV, HN, NI | No figuran en `FISCAL_COVERAGE` → `coverageFor()` declara solo contabilidad; aun así `country-tax-schemes.ts` aprovisiona un IVA fijo y `configurationRequired: false` |

Los veredictos por país (Paso 6) se emiten por estos grupos en `05-matriz-pais-modulo.md`.

## Inventario

Columnas: archivos / líneas / endpoints / entidades / specs del backend; feature frontend y su tamaño; menú; núcleo mínimo para vender un ERP (★); países; familia de auditoría.

### Finanzas y contabilidad

| Módulo | Backend (arch/lín/end/ent/spec) | Frontend | Menú | ★ | Países | Familia |
|---|---|---|---|---|---|---|
| accounting (períodos, ejercicios, cierres, ledgers, reglas de mapeo, inflación) | 53 / 8.003 / 22 / 7 / 7 | features/accounting (compartida: 57 arch, 14,6 k lín, 37 páginas, 23 specs) | contabilidad: periods, closing/*, ledgers, audit-adjustments | ★ | 19 | FIN-A |
| journal-entries | 59 / 9.070 / 32 / 9 / 11 | accounting (journal-entries, daily-journal, recurring, templates, import) | contabilidad | ★ | 19 | FIN-A |
| chart-of-accounts | 29 / 3.378 / 19 / 5 / 5 | accounting (chart-of-accounts, segments, merge) | contabilidad | ★ | 19 | FIN-A |
| dimensions | 10 / 912 / 9 / 3 / 1 | accounting (dimensions) | contabilidad | | 19 | FIN-A |
| financial-reporting | 8 / 1.863 / 4 / 0 / 1 | accounting/reports (balance, resultados, balanza, flujo) | contabilidad-reportes | ★ | 19 | FIN-A |
| analytical-reporting | 6 / 569 / 3 / 0 / **0** | (consumido por reportes) | — | | 19 | FIN-A |
| currencies | 18 / 2.481 / 12 / 3 / 2 | masters (currencies, exchange-rates) | contabilidad-masters | ★ | 19 | FIN-B |
| fixed-assets | 13 / 2.125 / 9 / 2 / 2 | accounting (fixed-assets) | contabilidad | | 19 | FIN-B |
| budgets | 11 / 1.549 / 8 / 2 / 1 | accounting (budgets, variance-analysis) | contabilidad | | 19 | FIN-B |
| consolidation | 10 / 1.953 / 3 / 1 / 2 | **sin pantalla identificada** | **sin menú** | | 19 | FIN-B |
| intercompany | 6 / 825 / 4 / 1 / **0** | **sin pantalla identificada** | **sin menú** | | 19 | FIN-B |

### Ventas, facturación y cumplimiento fiscal

| Módulo | Backend | Frontend | Menú | ★ | Países | Familia |
|---|---|---|---|---|---|---|
| invoices | 32 / 7.989 / 14 / 2 / 9 | features/invoices (6 arch, 3,7 k lín) | ventas | ★ | 19 | FAC |
| einvoicing | 67 / 12.153 / 14 / 5 / 14 | (dentro de invoices/settings) | — | ★ (DO) | DO + 7 regímenes declarados | FAC |
| compliance (606–609, NCF, filings) | 14 / 3.129 / 10 / 2 / 3 | accounting fiscal-returns | contabilidad-reportes | ★ (DO) | DO | FAC |
| taxes | 7 / 243 / 5 / 1 / 1 | masters (taxes) | contabilidad-masters | ★ | 19 | FAC |
| sales (cotizaciones, pedidos, historial) | 20 / 1.993 / 15 / 5 / 3 | features/sales (8 arch, 2,0 k lín) | ventas | ★ | 19 | FAC |
| price-lists | 7 / 318 / 5 / 2 / **0** | masters (price-lists) | ventas | | 19 | FAC |

### Compras y cuentas por pagar

| Módulo | Backend | Frontend | Menú | ★ | Países | Familia |
|---|---|---|---|---|---|---|
| procurement | 30 / 4.373 / 30 / 7 / 4 | features/purchasing (8 arch, 2,9 k lín) | compras | ★ | 19 | CMP |
| accounts-payable | 49 / 8.284 / 26 / 6 / 8 | features/accounts-payable (9 arch, 3,7 k lín) | compras | ★ | 19 (retenciones DO) | CMP |
| suppliers | 10 / 753 / 6 / 1 / 1 | features/contacts (proveedores) | compras | ★ | 19 | CMP |
| supply-chain | 16 / 885 / 13 / 6 / 1 | **sin pantalla identificada** | **sin menú** | | ? | CMP |

### Tesorería, cobranza y clientes

| Módulo | Backend | Frontend | Menú | ★ | Países | Familia |
|---|---|---|---|---|---|---|
| treasury | 22 / 4.191 / 17 / 4 / 3 | masters (banks, payment-methods) + páginas treasury | tesoreria | ★ | 19 (catálogo de bancos DO) | TES |
| reconciliation | 32 / 6.043 / 26 / 8 / 7 | páginas reconciliation | tesoreria | ★ | 19 | TES |
| collections | 11 / 1.548 / 8 / 1 / 2 | (collections) | ventas | | 19 | TES |
| customers | 26 / 3.746 / 18 / 6 / 3 | features/contacts (clientes), features/customer-receipts | ventas | ★ | 19 | TES |

### Inventario, POS y operaciones

| Módulo | Backend | Frontend | Menú | ★ | Países | Familia |
|---|---|---|---|---|---|---|
| inventory | 36 / 6.101 / 29 / 6 / 5 | features/inventory (13 arch, 4,5 k lín) | inventario | ★ | 19 | INV |
| units-of-measure | 8 / 286 / 4 / 2 / 1 | masters | inventario-masters | ★ | 19 | INV |
| pos | 14 / 2.094 / 10 / 2 / 3 | **apps/pos** (48 arch, 6,6 k lín, 8 specs) | ventas › Punto de venta (enlace) | | DO principalmente | INV |
| manufacturing | 15 / 912 / 15 / 4 / 2 | features/manufacturing = **panel "roadmap"** sin funcionalidad (42 lín) | **sin menú** | | — | INV |
| wms | **sin backend** | features/wms = **panel "roadmap"** (38 lín) | **sin menú** | | — | INV |

### Nómina, RR.HH. y otros

| Módulo | Backend | Frontend | Menú | ★ | Países | Familia |
|---|---|---|---|---|---|---|
| payroll | 38 / 5.036 / 29 / 9 / 8 | features/payroll (6 arch, 2,7 k lín, **0 specs**) | rrhh | (★ para el segmento) | DO (otros: verificar) | NOM |
| hcm | 12 / 1.380 / 15 / 3 / 1 | features/hcm (4 arch, 1,5 k lín) | rrhh | | 19 | NOM |
| projects | 13 / 679 / 13 / 3 / 1 | features/projects = **panel "roadmap"** (28 lín) | **sin menú** | | — | NOM |
| customer-service (casos, KB, portal de cliente) | 13 / 570 / 8 / 3 / 1 | **sin pantalla** (portal de cliente vía ruta `e/:org`?) | **sin menú** | | — | NOM |
| legal (waitlist, aceptaciones) | 5 / 183 / 2 / 1 / 0 | features/legal (1 página) | — | | 19 | NOM |

### Plataforma transversal (evaluada como módulos)

| Componente | Backend | Frontend | ★ | Familia |
|---|---|---|---|---|
| auth (login, sesión, CSRF, MFA, step-up, SSO, registro) | 148 / 21.154 / 64 / 5 / 37 | features/auth (25 arch, 5,1 k lín), core/auth, libs/shared/util-auth | ★ | IAM |
| users | 31 / 4.526 / 30 / 5 / 5 | settings (usuarios) | ★ | IAM |
| roles / permisos | 13 / 1.044 / 6 / 1 / 3 | settings (roles) | ★ | IAM |
| multi-tenencia (RLS, filtros, guards) | transversal (`shared/`, migraciones RLS, `tools/verify/*`) | core/tenancy | ★ | IAM |
| organizations | 46 / 4.744 / 30 / 9 / 5 | settings (empresa, sucursales) | ★ | IAM |
| saas + payment (planes, Stripe) | 29 / 2.978 / 2 / 4 / 5 + 12 / 2.078 / 6 / 1 / 1 | features/payment, auth/plan-selection | ★ | IAM |
| security (cripto, KMS) | 15 / 993 / 0 / 0 / 3 | — | ★ | IAM |
| audit | 21 / 2.336 / 7 / 3 / 4 | accounting audit-adjustments | ★ | PLTA |
| notifications / push / websockets | 16/1.505 + 4/142 + 6/763 | features/notifications | | PLTA |
| mail / inbound-mail | 12 / 1.721 + 9 / 929 | features/inbound-mail | | PLTA |
| storage / documents | 4 / 321 + 6 / 1.027 | features/documents | | PLTA |
| data-transfer (import/export) | 8 / 1.372 / 6 / 1 / 2 | features/data-imports, data-exports | ★ | PLTA |
| search | 5 / 226 / 1 / 0 / 1 | features/global-search | | PLTA |
| queues / cache / jobs | 1/26 + 4/418 + `@Cron` dispersos | — | | PLTA |
| observabilidad (health, metrics, logging) | 2/104 + 2/42 + common | — | ★ | PLTA |
| config / database (migraciones) | 5/1.039 + 183/19.264 | — | ★ | PLTA |
| shared-backend (shared, common, contracts, core) | 71/5.684 + 37/2.967 + 34/2.540 + 1/45 | — | | PLTA |
| my-work | 8 / 408 / 4 / 0 / 2 | (workspace) | | PLTA |
| workflow-engine + workflows | 32/6.159/24/4/4 + 12/1.739/8/4/1 | features/workflow (24 arch, 8,9 k lín, **0 specs**), approvals | | PLTB |
| extensions (marketplace, isolated-vm) | 21 / 2.726 / 9 / 4 / 3 | features/extensions | | PLTB |
| relationship-map | 10 / 2.238 / 3 / 0 / 2 | features/relationship-map | | PLTB |
| datasheets | 11 / 1.660 / 11 / 4 / **0** | features/datasheets (**0 specs**) | | PLTB |
| desktop (Electron) | — | apps/desktop | | PLTB |
| ai (copiloto, agentes, MCP, RAG, anomalías…) | 96 / 11.673 / 68 / 22 / 24 | features/ai (28 arch, 5,1 k lín) | | IA |
| ai-engine (Python) | apps/ai-engine | — | | IA |
| bi / dashboard / overview / reports | 8/599 + 17/1.399 + 5/776 + 13/1.674 | features/dashboard, overview, reports | | IA |
| localization (motor de reglas por país) | 65 / 9.552 / 17 / 12 / 11 | settings (fiscal) | ★ | LOC |
| jurisdictions + geo | 6/585 + 3/156 | — | | LOC |
| i18n (backend + libs/shared/locales + ui-i18n) | 15 / 2.243 | libs/shared/locales, ui-i18n | ★ | LOC |
| frontend-shell (core, layout, shared, rutas, manifiestos) | — | apps/core/client-web core/layout/shared | ★ | FE |
| settings (configuración general) | — | features/settings (48 arch, 13,0 k lín) | ★ | FE |
| libs-shared | libs/shared/* | | | FE |
| ci-cd-infra | .github/workflows (ci, codeql, ai-eval), Dockerfile del ai-engine, docs/DEPLOYMENT.md | | ★ | FE |
| documentación y gobernanza | README, docs/*.md | | | FE |

## Discrepancias entre fuentes (hallazgos de inventario)

| ID | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| INVT-01 | **Backend sin pantalla ni menú**: `manufacturing` (15 endpoints, 4 tablas), `projects` (13 endpoints, 3 tablas), `supply-chain` (13 endpoints, 6 tablas), `customer-service` (8 endpoints, 3 tablas), `consolidation` (3 endpoints), `intercompany` (4 endpoints). Ningún manifiesto de menú los enlaza (`grep -rn "manufact\|project\|supply\|consolidat\|intercompany" core/modules/manifests/` sin coincidencias de ruta). | manifiestos `core/modules/manifests/*.ts`; `app.routes.ts` | alta (capacidades que el backend promete y el cliente no puede usar) |
| INVT-02 | **Pantallas "roadmap"** sin funcionalidad: `features/manufacturing`, `features/wms`, `features/projects` contienen solo `pages/dashboard.component.ts` con un panel de hoja de ruta (clases `.roadmap__*`). WMS no tiene backend. | `apps/core/client-web/src/app/features/{manufacturing,wms,projects}/pages/` | media (no están en menú; si se exponen, son fachada) |
| INVT-03 | El README afirma "los ~55 módulos ERP"; el backend tiene 76 carpetas de las cuales ~20 son infraestructura, y varias "funcionales" no llegan al usuario (INVT-01). La cifra no es verificable como "módulos ERP utilizables". | `README.md:3` | baja (documentación) |
| INVT-04 | `analytical-reporting`, `intercompany`, `price-lists`, `datasheets`, `legal`, `push-notifications`, `storage`, `geo`, `metrics`, `queues` sin un solo `*.spec.ts`; `features/payroll`, `features/workflow` (8,9 k líneas), `features/datasheets` sin specs en el cliente. | medición de este documento | alta para workflow/payroll (flujos críticos sin pruebas de cliente); media el resto |
| INVT-05 | Diez mercados (UY…NI) se aprovisionan con un IVA de tasa única fija en código y `configurationRequired: false`, mientras la tabla de cobertura no los nombra (solo "contabilidad"). Dos fuentes del producto dicen cosas distintas sobre el mismo país. | `country-tax-schemes.ts:116-140` vs `fiscal-coverage.ts:206-219` | verificar en ficha LOC |

## Dependencias principales

- Grafo Nx de proyectos sin ciclos (api → shared-types, shared-util-auth; client-web y pos → libs shared).
- Grafo de módulos del backend (herramienta del repo `tools/verify/module-boundaries.mjs --report`): **1.237 violaciones de frontera** y **14 ciclos** entre agrupaciones de módulos (contabilidad↔plataforma, contabilidad↔identidad, configuración↔contabilidad, compras↔ventas, plataforma↔reportes, configuración↔plataforma, configuración↔identidad, …). Detalle por módulo en cada ficha y en `07-patrones-sistemicos.md`.
- Dependencias funcionales: casi todos los módulos transaccionales escriben en `journal-entries` (asientos) y leen `chart-of-accounts`, `accounting` (períodos), `localization` (impuestos/documentos) y `organizations` (tenant). La plataforma (auth, multi-tenencia, auditoría, i18n) condiciona a todos.
