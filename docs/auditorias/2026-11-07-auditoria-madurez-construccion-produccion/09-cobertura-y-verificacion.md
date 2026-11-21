# 09 — Cobertura y verificación del propio informe (Paso 9)

## 1. Verificación de hallazgos críticos y altos

El coordinador volvió a comprobar **todos los críticos** y una muestra de altos contra el código y la base de datos (`erp`, QA). Las familias ya los habían reproducido ejecutando.

### Críticos (10 distintos; todos verificados)

| ID | Qué | Verificación del coordinador | Resultado |
|---|---|---|---|
| PLT-NOT-01 | Escritura entre tenants en `push_subscription` | `push-notifications.controller.ts:22-31`: `@Body()` con tipo literal, sin clase DTO, de modo que la whitelist no filtra `id`; `create({...dto})` + `save()` hace upsert sobre un id ajeno. La tabla no tiene `organization_id` y tiene 0 políticas RLS (`information_schema`, `pg_policies`) | **Confirmado** (PLTA lo explotó en vivo) |
| FAC-CMP-01 = INV-01 | 607/608 → 500 en todo tenant DO | `compliance.service.ts:432-436` consulta `created_at`; la columna real de `pos_sales` es `"createdAt"` | **Confirmado** |
| FAC-INV-01 | NC y anulaciones → 500 con el cupo del plan agotado | `invoices.service.ts:473` llama a `enforceLimit` dentro de la transacción; `usage-metric.repository.ts:86-89` atrapa el `23505` y la transacción queda abortada | **Confirmado** en mecanismo; reproducido por FAC |
| FAC-EINV-01 | Regímenes no DO sin consumidor, presentados como electrónicos | `grep FiscalRegimeRegistry` fuera de `einvoicing/regimes` y del módulo: 0 | **Confirmado** |
| FAC-PL-01 | Las listas de precios no se aplican en ningún documento | `grep PriceList` fuera de `price-lists/`: solo tenancy, app.module, subscriber de auditoría y permisos | **Confirmado** |
| TES-01 | Cobro en USD aplicado 1:1 contra factura en DOP, con ganancia cambiaria ficticia | `customer-payments.service.ts:299-352`: sin comparación entre moneda del recibo y moneda de la factura | **Confirmado**; reproducido por TES |
| FINB-01 | La revaluación cambiaria nunca corre y el cierre la marca como hecha | `create-account.dto.ts` no tiene `currency`; en BD, 0 de 1.241 cuentas con moneda; `currency-revaluation.service.ts` salta las cuentas sin moneda | **Confirmado** |
| FINB-30 | La consolidación infla activo y patrimonio | `consolidation.service.ts:442-452, 795-824`: la eliminación solo se agrega a una lista informativa y el goodwill se suma a `totalAssets` | **Confirmado por código**. No es ejecutable: plan Starter, módulo sin UI |
| LOC-01 | Brasil factura al 0 % sin bloqueo | `tax-determination.service.ts:28-35` → `tenant-jurisdiction.provider.ts:69-79` (`NO_NEXUS`, tasa 0) → `invoices.service.ts:583` solo bloquea `NOT_DETERMINABLE` | **Confirmado**; reproducido por LOC |
| IA-B01 | El KPI "EBITDA" muestra la utilidad neta | `dashboard.service.ts:183-197` devuelve `{ ebitda: netIncome }` | **Confirmado** |

**Pendientes de interpretación normativa.** NOM-01 (cotización AFP/SFS sobre el mínimo cotizable a quien gana menos) y NOM-02 (histórico del mínimo cotizable) están clasificados como **altos**. Pasan a críticos si un contador dominicano confirma la interpretación: sería un cálculo laboral incorrecto.

### Muestra de altos (12 de ~95 ≈ 13 %, más los altos ya re-verificados por las familias en segunda pasada)

El objetivo del 30 % **no se alcanzó** por las tres interrupciones de cuota. Los elegidos no son una muestra al azar: priorizan los de mayor impacto. Esta limitación se declara.

| ID | Resultado |
|---|---|
| FIN-AR-01 (inyección SQL en analytical-reporting) | **FALSO POSITIVO**: `sanitizeColumnName` exige `^[a-zA-Z0-9_ ]+$` (`analytical-reporting.service.ts:232-237`). Reclasificado a **baja** en la ficha. Se revisaron los demás hallazgos de inyección: no hay otros |
| CMP-03 (RNC de proveedor duplicado) | Confirmado: `suppliers` solo tiene PK |
| NOM-03 (deducción negativa) | Confirmado: `upsert-inputs.dto.ts:23-35` sin `@Min(0)` |
| NOM-20 (PII en auditoría) | **Confirmado y ampliado**: además, `employees.social_security_number` está **en claro en la propia tabla** (la ficha decía que estaba cifrado). Corregido en `hcm.md` |
| IA-B05 (`sales_cube_view` inexistente) | Confirmado |
| PLT-STO-01 (disco local por defecto en producción) | Confirmado: `env.validation.ts:474` |
| FAC-TX-02 (tasa estándar = MAX) | Confirmado: `sellable-product.contract.ts:55` |
| FIN-COA-02 (la fusión reescribe líneas contabilizadas) | Confirmado: `account-jobs.processor.ts:88-93` |
| FIN-JE-01 (contravalor por línea tomado del cliente) | Confirmado: `journal-entries.service.ts:561-564` |
| PLTB-WF-02 (doble aprobación concurrente) | Confirmado: `workflows.service.ts:476-480`, `findOne` sin bloqueo |
| XF-09 (documentos en divisa con tasa de 4 decimales rechazados) | Confirmado: la tasa se redondea a 2 decimales (`journal-entries.service.ts:758-760`) y `fx_rate_tolerance = 0` en 22 de 22 organizaciones porque `numericTransformerNotNull` anula el DEFAULT 0.02. Candidato a **crítico** para tenants multimoneda |
| Cron `ecf-retry-contingency` (posible contacto con la DGII) | `ecf_submissions` vacía: sin contacto en este entorno. Queda el hallazgo de diseño (no hay gating por entorno) |

## 2. Topes y coherencia de veredictos

- Todo módulo con un crítico abierto tiene madurez ≤ 59 y preparación ≤ 69, con veredicto **No listo**: invoices, einvoicing, compliance, price-lists, customers, currencies, consolidation, localization, notificaciones-push-websockets, pos, bi-dashboard y saas-payment (este último tras la calibración).
- "Listo con reservas" solo en módulos con las compuertas críticas 1, 2, 3 y 6 cumplidas y preparación entre 70 y 84: auth, users, roles-permisos, multi-tenencia (condicionado a PLT-NOT-01), organizations, security-onboarding, extensions y libs-shared.
- **Ningún** módulo es "Listo para producción". La compuerta 7 (pruebas que pasan en CI) **no se cumple en ninguno**, porque `main` está en rojo.

## 3. Calibración entre módulos (ajustes del coordinador)

| Ficha | Propuesta del agente | Final | Motivo (detalle en la ficha) |
|---|---|---|---|
| extensions | 80–88 | 74 | Sandbox probado, pero sin E2E del ciclo de negocio ni auditoría de publicar y consentir |
| datasheets | 78–85 | 68 | Endpoints sin DTO que devuelven 500; 0 pruebas |
| relationship-map | 76–84 | 70 | Solo lectura; valor acotado por la cobertura de vínculos |
| workflow-engine | 70–80 | 62 | Dos motores duplicados; frontend de 8,2 k líneas sin pruebas |
| workflows | 72–80 | 55 | PLTB-WF-02 verificado: integridad rota en un caso plausible |
| desktop | 68–78 | 58 | Electron vulnerable, sin firma ni auto-actualización |
| multi-tenencia | 85 | 70 | Escritura entre tenants confirmada y tabla sin columna de tenant |
| saas-payment | 74 | 55, No listo | Causa raíz de FAC-INV-01 |
| organizations | 78 | 72 | Perfil legal y membresías sin auditar |

**Orden resultante (madurez)**:

- auth 83
- roles-permisos 82
- security 82
- users 81
- extensions 74
- onboarding 74
- organizations 72
- multi-tenencia 70
- relationship-map 70
- datasheets 68
- journal-entries 66
- config-database 66
- i18n 66
- libs-shared 66
- workflow-engine 62
- financial-reporting 62
- queues-cache-jobs 62
- ai-engine 62
- procurement 60
- settings 60
- my-work 60
- accounts-payable 58
- audit 58
- ai 58
- desktop 58
- accounting 57
- frontend-shell 56
- mail 56
- workflows 55
- pos 55
- invoices 55
- treasury 55
- storage 55
- shared-backend 55
- saas-payment 55
- inventory 52
- reconciliation 52
- dimensions 52
- navegación-UX 52
- search 50
- fixed-assets 50
- observabilidad 50
- legal 50
- customers 48
- chart-of-accounts 45
- currencies 45
- sales 45
- hcm 45
- notificaciones 45
- documentación 45
- payroll 42
- budgets 42
- localization 42
- data-transfer 42
- einvoicing 40
- suppliers 40
- jurisdictions-geo 40
- bi-dashboard 40
- compliance 38
- taxes 35
- ci-cd-infra 34
- collections 33
- analytical-reporting 30
- intercompany 30
- supply-chain 28
- units-of-measure 28
- consolidation 25
- wms 20
- price-lists 18
- projects 18
- manufacturing 15
- customer-service 14

**Comprobación de coherencia.** Los módulos transversales de identidad quedan arriba porque son los más remediados y los más verificados con ejecución real (verificadores HTTP en CI, barrido de 808 handlers). Es coherente con su evidencia, no con su tamaño. Los esqueletos sin efecto (manufactura, WMS, proyectos, customer-service, price-lists) quedan abajo.

Dos pares revisados explícitamente:

- **journal-entries (66) frente a accounting (57)**: se mantiene. Los invariantes de asientos se verificaron todos; accounting tiene el cierre anual roto con dimensiones obligatorias y la inflación inoperante.
- **i18n (66) frente a localization (42)**: se mantiene. La fuente única de traducciones está verificada; las reglas por país son código con un crítico.

**Riesgo de sesgo por el método de reparto.** Las familias con más tiempo de ejecución (IAM, FIN-A, FAC) encontraron más detalle. Las notas de collections, consolidation e intercompany tienen confianza baja porque el plan Starter impidió ejecutarlas.

## 4. Cobertura

### Por módulo

| Estado | Módulos |
|---|---|
| **Completos** (rúbrica completa y ejecución real por API: humo, aislamiento A↔B, autorización con el usuario MEMBER) | accounting, journal-entries, chart-of-accounts, dimensions, financial-reporting (+ analytical-reporting por código), currencies, fixed-assets, budgets, invoices, compliance, taxes, sales, price-lists, procurement, accounts-payable, suppliers, inventory, units-of-measure, pos (+ UI POS), payroll, hcm, legal, treasury, reconciliation, customers, auth, users, roles-permisos, multi-tenencia, organizations, audit, storage-documents, data-transfer, search, workflows, datasheets, relationship-map, extensions, settings, navegación-y-cobertura-ux (UI de 155 rutas) |
| **Parciales** | einvoicing (sin emisión e-CF tipo E por riesgo externo); consolidation e intercompany (solo código: plan Starter); collections (403 por plan: solo código); supply-chain y wms (CRUD por código y authZ en vivo); manufacturing (en vivo, sin UI); projects y customer-service (API parcial); saas-payment (Stripe no ejercitado); security-onboarding (UI de registro no recorrida); ai (copiloto, agentes y anomalías no ejecutables sin clave ni plan); ai-engine (pytest 52 OK; 7 de integración omitidas); bi-dashboard (KPIs contra SQL en un tenant); notificaciones-push-websockets (sin envío real); mail (sin SMTP); observabilidad, queues-cache-jobs y config-database (sin multi-réplica ni `migration:revert`); workflow-engine (sin E2E evento→aprobación→posteo); desktop (sin arrancar binario); jurisdictions-geo, i18n y localization (sin contraste web de tasas) |
| **Sin tocar** | Ninguno del inventario. Todos los módulos del `01-inventario` tienen ficha (70 fichas) |

### UI

Humo de las 155 rutas de los 8 manifiestos y de 27 secciones de settings con Playwright (`03-insumo-humo-ui-FE.md`): 0 errores JS, 0 respuestas 5xx, 0 claves sin traducir. Las 36 rutas con parámetro no se recorrieron. Las familias recorrieron además las pantallas principales de su dominio, con excepción de FAC, CMP y PLTA, que no hicieron humo UI propio y se apoyan en el barrido de FE.

### Países

Los 19 aprovisionados (`verify:markets`). Hubo pruebas en vivo con tenants DO, MX, US, CO, CL, BR, PE, AR, UY y GT. PY, BO, VE, PA, CR, SV, HN y NI se evaluaron por código y aprovisionamiento, no con un tenant propio.

### Flujos cruzados

Ejecutados en vivo los flujos 1, 2, 4, 5, 6, 7, 8 y 9 (`06-flujos-cruzados.md`). El flujo 3 (nómina → tesorería) lo ejecutó NOM; XF lo revisó por código.

## 5. Incidencias del proceso que afectan la confianza

1. **Efecto externo no deseado.** Una familia ejecutó `npm run verify:invoicing`, que contactó `ecf.dgii.gov.do`: pidió la semilla y envió la semilla firmada; la DGII respondió 400 tres veces y no se aceptó ningún e-CF. Infringe la regla de la auditoría. Se prohibió a partir de ese momento y se registra como hallazgo del producto (FAC-EINV-02, FE-CI-03: CI hace lo mismo en cada push).
2. **Configuración del entorno QA.** La API se reinició con `AUTH_THROTTLE_LIMIT=200`, solo en local. El límite de 5 logins por minuto y por IP, compartido entre agentes, impedía las pruebas de aislamiento. El valor de producción (5) no se evaluó con tráfico real. Una familia esquivó el límite usando otras IP de loopback.
3. **Cambios fuera de las fichas, solo en BD local.** Se fijó la contraseña del rol `virtex_app` en la base de pruebas `virteex_test` para ejecutar `verify:rls*`. Se cerraron períodos en los tenants QA propios (qa-do-fin, qa-do-xflow). En qa-do-fac se borró el impuesto "ITBIS 18 %" y se recreó por API.
4. **El contenedor se reinició cuatro veces y la cuota de uso se agotó tres.** Hubo trabajo repetido y hallazgos que no llegaron a muestrearse al 30 %.
5. **RLS no evaluado en tiempo de ejecución con la API.** La API corrió como superusuario. Sí se verificó con `verify:rls-runtime` (como `virtex_app`) y con el rol del motor de IA.
6. **Competitividad con pocas fuentes web** (ver `02-estandares-de-referencia.md`).

## 6. Contraste con informes previos del repositorio (Paso 9.5, leídos al final)

Comparado principalmente con `docs/auditorias/2026-10-31-auditoria-madurez-produccion/` (commit `495719fc`). Entre ambos hay **43 commits de corrección** que citan sus IDs.

| Tema | Informe previo | Ahora | Valoración |
|---|---|---|---|
| Aislamiento por referencias (COA-01, PL-01, MFG-02, PRJ-01) | 6 endpoints con ids de otro tenant | FIN-A, CMP, INV, NOM y FAC: ids ajenos en URL y cuerpo → 404/400 | **Resuelto** (aparece una nueva vía: PLT-NOT-01) |
| Modificar un asiento contabilizado resta dos veces (GL-01) | Crítico | PATCH revierte y crea reemplazo; reportes al centavo con SQL | **Resuelto** |
| Concurrencia en cobros, recepciones y NCF | Críticos | Cobros, pagos, stock y NCF sin doble aplicación con 20 concurrentes | **Resuelto** donde se tocó; persiste en workflows, nómina y anticipos (SP-07) |
| Dinero en coma flotante, redondeo en empates | Crítico | Cálculo DO rehecho a mano con 3–6 decimales: cuadra | **No reproducido** |
| Recuperación de contraseña 500 y cambio de correo de admin (AUTH-01, USR-01) | Críticos | IAM: paridad de respuestas y escalada rechazada | **Resuelto** |
| Firma de extensiones autoafirmada (EXT-02) | Crítico | Firma ausente, alterada o "backdoor" rechazada en vivo | **Resuelto** |
| 607 con columnas corridas (RFC-01) | Crítico | Formato corregido, pero **el 607 y el 608 dan 500** al incluir ventas POS | **Afirmado resuelto y no lo está**: regresión |
| Nómina con mínimo cotizable de 2020 (NOM-01/02/03 del previo) | Crítico | Topes vigentes corregidos, pero histórico sembrado incorrecto (NOM-02) y cotización bajo mínimo (NOM-01) | **Parcial** |
| Cobertura fiscal honesta (LOC-01 del previo) | Alto | Tabla de cobertura creada, pero **Brasil `available` factura al 0 %** | **Afirmado resuelto y no lo está** |
| Cadena de confianza e-CF (EINV-03) | Alto | Su prueba no compila | **No verificable**: el arreglo no está protegido |
| Portal de cliente solo por su cliente (CS-01) | Alto | No explotable por API, pero la FK sin guarda hace fallar `same-tenant-references.spec.ts` | **Parcial** |
| Builders de e-factura no conectados; plan de cuentas DO en todos los países | Críticos | Igual (FAC-EINV-01, LOC-02) | **Sin cambio** |
| CI de `main` en rojo | 6 runs | 15 de los últimos 24 en rojo; último verde 2026-10-13 | **Empeorado** |
| Salud pública y correlación de logs (OBS-01/02/03) | Ausentes | Logs con request-id, tenant y usuario: verificado | **Resuelto**; métricas siguen sin ser utilizables |
| Madurez del producto | ≈38 | ≈46 (ver `00`) | Mejora real y acotada |

Otros documentos del repo con afirmaciones que no se sostienen:

- `docs/ESTADO_MVP_REPUBLICA_DOMINICANA.md` dice que no hay nómina, y sí la hay (FE-DOC-03).
- `README.md` habla de "~55 módulos ERP" (INVT-03).
- El comentario "todo o nada" de `data-transfer.service.ts` no se cumple (PLT-DT-01).
- `fiscal-coverage.ts` define `needs-credentials` como "construido y probado", y no está conectado.

Los demás informes previos (`AUDITORIA_*.md`, `SECURITY_AUDIT_*.md`, `docs/INFORME_AUDITORIA_MODULOS_2026.md`, `docs/qa/**`) no se contrastaron línea a línea: queda pendiente.
