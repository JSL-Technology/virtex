# 03 — Resultados de ejecución (Paso 2)

Entorno: contenedor Linux, 4 vCPU, 15 GB RAM, Node 22.23.4 / npm 10.9.9 (`.nvmrc` = 22), PostgreSQL 16 local **sin pgvector**, Redis 7 local, Chromium/Playwright preinstalados. Rama `ccr-835c4594-wrjtxj`, commit `495719fc`. Logs completos en el scratchpad de la sesión (no versionados).

Los resultados medidos aquí mandan sobre lo que digan la documentación y los comentarios del repositorio.

## 1. Instalación y build

| Paso | Comando | Resultado |
|---|---|---|
| Dependencias | `npm ci` | **OK** en 6 min 33 s. 24 avisos `deprecated` (p. ej. `glob@7`, `glob@10`, `@angular/animations@20` deprecado, `whatwg-encoding`). Un `ERESOLVE overriding peer dependency` (htmlnano ↔ cssnano) resuelto por `overrides`. |
| Build, lint, test, typecheck | `npx nx run-many -t lint test build typecheck` (8 proyectos: api, client-web, pos, desktop, 4 libs) | **OK** («Successfully ran targets … for 8 projects»). |
| Presupuesto de bundle | build `client-web:production` | **Aviso**: bundle inicial **1,78 MB** (389 kB transferidos) supera el presupuesto declarado de 1,60 MB en 182,86 kB. Un chunk `elk-bundled` de 1,46 MB (motor de layout de grafos) es el mayor. |

## 2. Lint, formato y tipos

- Lint: **0 errores**; ≈990 avisos (client-web 469, api 521; el resto en libs/pos/desktop). Por regla: `no-unused-vars` 397, `no-explicit-any` 334, `no-non-null-assertion` 256, `no-console` 4, `no-var-requires` 1. Los avisos no rompen el CI: la deuda puede crecer sin freno.
- Typecheck: OK en todos los proyectos.
- Supresiones: 9 `eslint-disable`, 0 `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`; ≈200 apariciones de `any` fuera de specs (`grep -E ": any\b|as any\b|<any>"`).
- Marcadores de trabajo inacabado: 4 `TODO/FIXME/HACK` en backend, 9 en frontend.

## 3. Pruebas

| Suite | Resultado | Tiempo | Cobertura |
|---|---|---|---|
| client-web (Jest + jsdom) | 238 suites, **1280 tests OK** | — | no medida en CI |
| api **sin BD** (lo que hace `nx test api` sin `DB_HOST`) | 201 suites OK, **65 suites / 671 tests omitidos** | — | — |
| api **con BD real** (`virteex_test` migrada desde cero, `NODE_ENV=test`) | **266 suites, 3409 tests OK, 0 fallos, 0 omitidos** | 6 min 59 s | Statements 75,6 %, Branches **56,2 %**, Functions 69,1 %, Lines 76,9 % |
| libs (types, ui-a11y, ui-i18n, util-auth) | 29 + 5 + 11 + 37 OK | — | — |
| pos, desktop | incluidos en run-many, OK | — | — |
| ai-engine (Python) | no ejecutado por el coordinador (ver ficha IA) | — | — |

Observaciones:
- En CI las suites de integración sí corren porque el job define `DB_HOST` y migra antes (`ci.yml:151-160`). En local, `nx test api` sin BD da verde omitiendo el 20 % de los tests, sin aviso visible salvo el contador «skipped» — riesgo de falsa confianza para el desarrollador.
- No hay pruebas E2E de interfaz (Playwright/Cypress) en el repositorio: los «e2e» se sustituyeron por scripts `tools/verify/*.ts` que ejercen la API (ver ficha CI/CD). La calidad de las pruebas por módulo se evalúa en cada ficha (eje 9).
- Cobertura de ramas del 56 %: casi la mitad de las bifurcaciones (errores, casos borde) no se ejercita.

## 4. Dependencias

`npm audit` (sin `--fix`): **145 vulnerabilidades — 0 críticas, 15 altas, 126 moderadas, 4 bajas**.

Altas con dependencia directa: `@angular/cli`, `@angular/router` (vía `@angular/common`/`platform-browser`), `electron` (varias, p. ej. atribución de permisos a otro frame), `joi` (ReDoS cuadrático en `email({multiple:true})`), **`node-forge`** (verificación de firmas RSA PKCS#1 v1.5 que acepta DigestAlgorithm anidados; truncamiento de OID ASN.1) — **usado en la firma y verificación de comprobantes fiscales** (`einvoicing/services/certificate-vault.service.ts`, `certificate-inspector.ts`, `regimes/ar/afip.*`), `nx`, `puppeteer`. Transitivas altas: `body-parser`, `follow-redirects` (fuga de cabeceras de credenciales en redirecciones), `undici`, `zod`, `vite`, `launch-editor`.
`dependabot.yml` existe (ver ficha CI/CD), pero estas versiones siguen abiertas en HEAD.

## 5. Esquema y migraciones

| Comprobación | Resultado |
|---|---|
| `verify:migration-identities` | OK |
| `migration:run` sobre base vacía | **OK: 163 migraciones**, sin errores. La extensión `vector` no está disponible → la tabla de embeddings se omite condicionalmente (diseño documentado). |
| Esquema resultante | 221 tablas, **174 con RLS activado, 176 políticas** (`pg_policies`). |
| `check:schema-drift` | **Sin deriva** salvo 3 objetos «no modelables» documentados (índices de la vista materializada analítica, índice por expresión del motor de flujos, default decimal). |
| Reversibilidad | No verificada por ejecución (`migration:revert` modificaría el estado compartido). Ver ficha CI/CD. |
| Convención de nombres | Mezcla de columnas `camelCase` entre comillas y `snake_case` en el mismo esquema (p. ej. `customers."companyName"` junto a `customers.organization_id`; `fiscal_regions."countryCode"`). |
| Tipos | Dinero en `numeric(12,2)` en varias tablas (p. ej. `customers.totalBilled`, `creditLimit`): tope 9.999.999.999,99 — insuficiente para acumulados en monedas de alto nominal (PYG, COP, VES); fechas `timestamp without time zone` (p. ej. `customers.created_at`). Detalle en fichas. |

## 6. Grafo de dependencias

- **Proyectos** (`nx graph`): `api → shared-types, shared-util-auth`; `client-web → shared-ui-i18n, shared-types, shared-util-auth, shared-ui-a11y`; `pos → idem`; `desktop` y libs sin dependencias internas. Sin ciclos entre proyectos.
- **Módulos del backend** (`npm run verify:boundaries -- --report`, configuración en `tools/verify/module-boundaries.config.mjs`): **1.344 violaciones** de frontera fuera de specs —**501** importaciones de internos de otro módulo, **242** dependencias prohibidas, **14** ciclos entre dominios (p. ej. contabilidad↔plataforma, contabilidad↔identidad, configuración↔contabilidad, compras↔ventas), **29** registros de entidades ajenas, **103** transacciones compartidas entre módulos (p. ej. `customers/customer-payments.service.ts:524` contabiliza con el `manager` de cobros), **30** `forwardRef`— más 325 en specs.
- **El verificador falla en HEAD**: el trinquete (`module-boundaries.baseline.json`) detecta que las violaciones **suben** respecto del baseline (inventario→contabilidad +2/+2, inventario→identidad +2, identidad→contabilidad +1/+1), introducidas por los últimos cambios de inventario y organizaciones.

## 7. Verificadores propios del repositorio

| Script | En CI | Resultado en HEAD |
|---|---|---|
| `verify:package-families` | sí | OK |
| `verify:boundaries` | sí (`ci.yml:296`) | **FALLA** (ver §6) |
| `verify:security` (tenant-scope, env-gating, crypto, role-assignment, session-revocation, identity-writes, step-up, desktop) | sí (`ci.yml:237`) | **FALLA**: `tenant-scope-guard` marca `legal/legal.service.ts:59` (inserción en la lista de espera de mercados, tabla global: falso positivo del verificador por falta de la anotación `tenant-scope-guard-allow`) |
| `i18n:verify` (catálogos, invariantes, textos sin traducir, prosa en TS, nombres localizados) | sí | OK |
| `lint:design-system` | sí | OK |
| `verify:numeric-transformers`, `verify:date-columns` | sí | OK |
| `verify:form-a11y` | **no** | **FALLA**: 21 formularios sin `VX_FORM_A11Y` (aria-invalid) |
| `verify:required-markers` | **no** | **FALLA**: 2 campos obligatorios sin marca (`statement-import.page.html`) |

**Consecuencia: con dos compuertas obligatorias del propio CI fallando, el pipeline de `main` estaría en rojo en este commit** (el estado real en GitHub se contrasta en la ficha de CI/CD). Un merge (#162) llegó a la rama con las compuertas rotas.

## 8. Aplicación en ejecución

- Arranque: `node dist/apps/backend/api/main.js` con `NODE_ENV=development`, `DEV_SEED=true`: arranca en ~25 s, **804 rutas mapeadas**. Siembra 19 regiones fiscales y el usuario de desarrollo.
- Aviso al arrancar (correcto y valioso): `TenantIsolationCheck` advierte que, conectada como `postgres` (superusuario), **las 174 políticas RLS no aplican**; en desarrollo se tolera. En este entorno la API corre así, de modo que toda prueba de aislamiento por API mide la **capa de aplicación**.
- **No existe sonda de salud pública**: `GET /api/v1/health` → 404; el único endpoint (`/api/v1/health/queues`) exige autenticación (401). Un balanceador u orquestador no puede comprobar liveness/readiness sin credenciales.
- Cada reinicio invalida todas las sesiones (claves de firma efímeras en desarrollo): esperado en dev; en producción las claves vienen de configuración (ver ficha de autenticación).
- Tenants de prueba creados con el camino real de alta (`RegistrationService.completePendingRegistration`, el mismo del webhook de pago): QA-Empresa A DO, QA-Empresa B DO, QA-Empresa MX, QA-Company US, QA-Empresa CO, QA-Flujos DO, QA-Carga DO. Todos reciben **56 cuentas contables** (mismo número para DO, MX, US, CO); impuestos sembrados: DO ITBIS 18/16/0, MX IVA 16/8/0, CO IVA 19/5/0, **US ninguno** (declarado como «requiere configurar jurisdicciones»).

### Limitación de tasa (hallazgo de plataforma)
- `app.module.ts:269`: el `ThrottlerGuard` global (`APP_GUARD`, `app.module.ts:391`) usa **`{ ttl: 60000, limit: 20 }` fijo en código: 20 peticiones por minuto por IP para toda la API**, sin rastreador por usuario/tenant (no hay `getTracker` personalizado). Medido: con 7 clientes desde la misma IP la API devolvió **429 a ~94 % de las peticiones** (280/300 en un listado). En producción, una oficina detrás de un NAT (o un proxy corporativo) comparte IP: con pocos usuarios activos el ERP deja de responder. El portal hace varias peticiones por pantalla.
- Hay además un segundo `ThrottlerModule.forRootAsync` en `auth/auth.module.ts:121-150` que lee `THROTTLE_TTL`/`THROTTLE_LIMIT` (default 60000/10), y `.env.example:130` documenta `THROTTLE_TTL=60` — en `@nestjs/throttler` 6.7.1 el TTL va en **milisegundos**, así que copiar `.env.example` produce una ventana de 60 ms. Dos configuraciones contradictorias del mismo mecanismo.
- Para poder auditar, el entorno de pruebas se relanzó con un preload **fuera del repositorio** que desactiva el guard global excepto en `/auth/` (documentado en la ficha de observabilidad/plataforma). El código no se modificó.

### Prueba de carga ligera (local, 1 proceso Node, tenant QA-Carga DO con 20.000 clientes sintéticos `QA-LOAD`)
Herramienta: script `fetch` con 10 conexiones concurrentes, 300 peticiones por endpoint.

| Endpoint | rps | p50 | p95 | p99 | Errores |
|---|---|---|---|---|---|
| `GET /customers?page=1&limit=50` | 95 | 97 ms | 170 ms | 195 ms | 0 |
| `GET /customers?page=300&limit=50` | 94 | 103 ms | 145 ms | 174 ms | 0 |
| `GET /invoices?page=1&limit=50` | 125 | 70 ms | 135 ms | 169 ms | 0 |
| `GET /journal-entries` | 182 | 50 ms | 75 ms | 116 ms | 0 |
| `GET /chart-of-accounts` (56 cuentas) | 69 | 144 ms | 284 ms | 310 ms | 0 |
| `GET /financial-reporting/trial-balance` | 96 | 102 ms | 127 ms | 138 ms | 0 |
| `GET /audit` | 179 | 52 ms | 71 ms | 80 ms | 0 |
| **`GET /customers` sin parámetros** (4 concurrentes, 20 peticiones) | **1,3** | **2,5 s** | **5,1 s** | 5,1 s | 0 |

Hallazgos de la carga:
- **`GET /customers` sin `limit` devuelve los 20.001 registros (13,8 MB)**; con `limit` devuelve un array sin total. Una sola pestaña puede degradar el proceso para todos los tenants (un único event loop). Es un vector de denegación de servicio autenticado.
- **Contratos de paginación inconsistentes** entre módulos: `customers` → array plano; `invoices` → `{items,total,page,limit,pages}`; `journal-entries` → `{rows,page,pageSize,total,hasMore}`.
- El plan de cuentas (56 filas) es el listado más lento (p50 144 ms): coste por fila alto (relaciones/serialización), relevante para catálogos de miles de cuentas.

## 9. Barrido de secretos

- Archivos `.p12` versionados en `tools/fixtures/signing-certificates/` (7 certificados de **prueba** generados por `tools/dev/generate-test-ecf-certificate.mjs`, usados por `verify:ecf`). Aceptable como fixtures si nunca se confían en producción; verificar con el equipo que no correspondan a contribuyentes reales (los nombres llevan RNC/RFC con formato real, p. ej. `test-ecf-do-131190317.p12`).
- `apps/core/client-web/src/environments/environment.ts:16` y `environment.development.ts:16`: **clave de API de Google Maps** (`AIza…`, valor enmascarado) y site key de reCAPTCHA v3 versionadas. La site key es pública por diseño; la de Maps es de cliente, pero debe estar restringida por referer y salir de configuración (verificar con el equipo).
- No se encontraron claves privadas reales, `sk_live_`, `AKIA…` ni tokens de GitHub/Slack en archivos versionados. Las coincidencias de `BEGIN PRIVATE KEY` son texto en comentarios/informes (`certificate-vault.service.ts:26`, `AUDITORIA_TECNICA.md:159`) y un placeholder de spec en el historial.

## 10. Lo que no se ejecutó
- Pruebas del motor de IA en Python y su integración con el rol de BD (ver ficha IA).
- `verify:rls` / `verify:rls-runtime` como rol `virtex_app` (requieren el rol con contraseña; la API del entorno corre como superusuario).
- `migration:revert` (alteraría el estado compartido).
- Pruebas contra proveedores reales (Stripe, S3, correo, autoridades fiscales): no hay credenciales y están vetadas por riesgo de efecto externo.
