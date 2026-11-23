# 03 — Resultados de ejecución (Paso 2)

Ejecutado por el coordinador el 2026-11-07 sobre el commit `36f10d79` (rama `ccr-f710ff5b-8ijix4`, idéntica a `main`), en un contenedor Linux con Node 22.23.4 / npm 10.9.9, PostgreSQL 16.15 local (**sin la extensión pgvector**) y Redis 7 local. No se modificó código ni configuración. Los resultados mandan sobre lo que dicen la documentación y los comentarios.

Las pruebas de humo por módulo (API y UI), las de aislamiento y autorización y la carga ligera las ejecutaron las familias de auditoría; se citan en cada ficha (`modulos/*.md`) y en los insumos `03-insumo-*.md`.

## 1. Instalación y compilación

| Paso | Comando | Resultado |
|---|---|---|
| Dependencias | `npm ci` | OK (EXIT 0). 24 avisos `deprecated` (glob@7/@10, `@angular/animations` deprecado, eslint 9.39.5 "no longer supported", whatwg-encoding…) |
| Sincronía de referencias TS | `npx nx sync:check` | OK |
| Build api | `nx run api:build` (webpack, production) | OK |
| Build client-web | `nx run client-web:build:production` | OK con avisos: **presupuesto inicial excedido: 2,00 MB vs 1,60 MB (+399,85 kB)**; `@charset` mal ubicado; módulos CommonJS no ESM (`exceljs` en `features/invoices/detail/detail.page.ts`, `elkjs`, `dagre`, `google-libphonenumber`) |
| Build pos | `nx run pos:build:production` | OK |

## 2. Lint, formato y tipos

| Proyecto | Lint | Typecheck |
|---|---|---|
| api | 0 errores, **522 warnings** (214 `no-unused-vars`, 175 `no-explicit-any`, 128 `no-non-null-assertion`, 5 directivas `eslint-disable` sin uso) | **FALLA**: `src/app/einvoicing/services/certificate-trust.spec.ts(25,15): error TS2345` — `pki.PrivateKey` no asignable a `pki.rsa.PrivateKey` (node-forge) |
| client-web | 0 errores, **480 warnings** (178 unused-vars, 156 any, 146 non-null) | OK |
| pos, desktop, libs | 0 errores (1 warning en una lib) | OK |

Búsquedas complementarias (pistas verificadas en las fichas): `any` explícito en código no-spec: 105 (backend) y 86 (client-web + pos); `@ts-ignore/@ts-expect-error` en código no-spec: 0; `catch {}` vacío literal: 0; TODO/FIXME/HACK: 3 (dos son comentarios de datos de bancos); columnas `float` solo en geolocalización de sesiones (`refresh-token.entity.ts:122-125`); el dinero usa `numeric`.

**Conclusión**: el gate `nx run-many -t lint test build typecheck` de CI (`.github/workflows/ci.yml`) **falla hoy en local** por typecheck y test del api.

## 3. Pruebas

Ejecutadas con `nx run-many -t test` contra una base real migrada (`virteex_test`), con `DB_HOST/DB_NAME` definidos, de modo que las suites de integración que se auto-omiten sin base **sí corrieron** (`apps/backend/api/jest.global-setup.cts`).

| Proyecto | Suites | Tests | Tiempo |
|---|---|---|---|
| shared-types | 2/2 | 29/29 | 1,1 s |
| shared-ui-a11y | 1/1 | 5/5 | 3,0 s |
| shared-ui-i18n | 3/3 | 14/14 | 2,4 s |
| client-web | 239/239 | 1.294/1.294 | 137,8 s |
| desktop (`node --test`) | — | 5/5 | — |
| pos | 8/8 | 37/37 | 16,3 s |
| **api** | **285 OK, 3 fallan, 1 omitida** (de 289) | **3.535 OK, 1 falla, 3 omitidos** (de 3.539) | 373,5 s |

Fallos del api (rama principal en rojo):

1. `src/app/database/same-tenant-references.spec.ts:56` — **la FK `FK_customer_portal_accounts_customer` (`customer_portal_accounts.customer_id`) no tiene la guarda de mismo inquilino** que el resto de FKs entre tablas de inquilino. La propia prueba de invariantes de aislamiento detecta la regresión introducida por la última funcionalidad fusionada (portal de cliente, commit `0fe1b484`). Ver ficha `customer-service`.
2. `src/app/customer-service/customer-portal.spec.ts` — la suite no llega a ejecutarse: `CannotExecuteNotConnectedError` en `DataSource.destroy` (línea 64), es decir, su `beforeAll` falla antes de conectar y sus pruebas no protegen nada.
3. `src/app/einvoicing/services/certificate-trust.spec.ts` — no compila (mismo error TS2345). Las pruebas de la cadena de confianza del certificado e-CF (fix EINV-03 del commit `0cf531fb`) **no se ejecutan**.

Calidad de las pruebas: cada ficha evalúa si las pruebas de su módulo verifican invariantes o solo ejecutan código. Observación global: 289 suites en api con abundantes pruebas de integración contra Postgres real y verificadores ejecutables en CI (`tools/verify/*`), lo que es inusualmente bueno; pero dos de los tres fallos están precisamente en las pruebas que protegen los dos últimos arreglos de seguridad fusionados, lo que indica que **se fusionó con CI rojo o sin CI** (ver ficha `ci-cd-infra`).

## 4. Dependencias

`npm audit` (sin `fix`): **128 vulnerabilidades — 0 críticas, 15 altas, 108 moderadas, 5 bajas** (`logs/npm-audit.json`).

| Severidad alta | Paquete | Directa | Relevancia |
|---|---|---|---|
| alta | **node-forge ≤1.4.0** | sí | Verificación de firmas RSA PKCS#1 v1.5 acepta `DigestAlgorithm` anidado; truncado de OID ASN.1. node-forge se usa en la firma/verificación de e-CF y certificados. Alto impacto en el módulo `einvoicing`. |
| alta | electron 44.4.5 (<44.9.0) | sí | Shell de escritorio (permisos de pointer lock, certificados intermedios eMudhra comprometidos) |
| alta | @angular/router ≤20.3.33, @angular/cli | sí | cliente web |
| alta | joi ≤17.13.8 | sí | ReDoS en `string().email({multiple:true})` — usado en validación de entorno |
| alta | nx, puppeteer | sí (dev) | herramientas |
| alta | body-parser, follow-redirects, undici, vite, zod, launch-editor, chromium-bidi | transitivas | follow-redirects puede filtrar cabeceras de credenciales en redirecciones cruzadas |

## 5. Esquema y migraciones

| Comprobación | Resultado |
|---|---|
| `npm run verify:migration-identities` | OK |
| `npm run migration:run` sobre base vacía | **OK: 178 migraciones, ~7,6 s, 243 tablas, 177 políticas RLS** (la migración de embeddings se omite sin pgvector, por diseño: consulta `pg_available_extensions`) |
| Segunda base (`virteex_test`) desde cero | OK (reproducible) |
| `npm run check:schema-drift` | OK: "No schema drift beyond the documented unmodellable objects" (3 excepciones documentadas: índices sobre vista materializada, índice de expresión, default decimal) |
| Limpieza | El script deja la base temporal `erp_drift` (243 tablas) sin borrar tras una ejecución exitosa; el `DROP` del `finally` traga el error (`/* best effort */`, `tools/check-schema-drift.mjs:145-149`). Hallazgo bajo. |
| Reversibilidad, bloqueo de tablas grandes, migraciones de datos | evaluado en la ficha `config-database` |

## 6. Grafo de dependencias

- **Proyectos Nx**: sin ciclos.
- **Módulos del backend** (`node tools/verify/module-boundaries.mjs --report`): **1.237 violaciones** contra un baseline de 1.239 (el trinquete solo impide que suban):

| Regla | Nº |
|---|---|
| private-import (importa internos de otro módulo) | 492 |
| forbidden-dependency | 238 |
| private-import en specs | 234 |
| cross-module-transaction (transacción que abarca tablas de otro módulo) | 108 |
| forbidden-dependency en specs | 92 |
| forward-ref (dependencia circular resuelta con `forwardRef`) | 30 |
| foreign-entity-registration (registra entidades de otro módulo en su `TypeOrmModule.forFeature`) | 29 |
| module-cycle | 14 |

Interpretación en `07-patrones-sistemicos.md`.

## 7. Aplicación levantada

- API: `node dist/apps/backend/api/main.js` con `NODE_ENV=development`, `DEV_SEED=true`. Arranca en ~10 s. **Aviso del propio arranque**: el rol `postgres` es superusuario/BYPASSRLS, "así que ninguna política le aplica" — en este entorno el aislamiento observado es solo el de la capa de aplicación (el de RLS lo prueba la familia IAM con el rol `virtex_app`).
- Portal web: `nx serve client-web` en :4200; POS: `nx serve pos` en :4300.
- Sin SMTP los correos se guardan en `tmp/mail-outbox/` (ignorado por git). Las invitaciones y bienvenidas se generaron correctamente.
- Inquilinos de prueba creados por el flujo real de alta pagada (`RegistrationService.completePendingRegistration`, el mismo que usa el webhook de Stripe): QA-DO-A, QA-DO-B (aislamiento), uno por familia (QA-DO-FIN, -FAC, -CMP, -TES, -INV, -NOM, -XFLOW, -PLT) y uno por país en MX, US, CO, CL, BR, PE, AR, UY, GT. Todos se aprovisionaron sin error. Un intento con RNC repetido falló con un mensaje genérico (`auth.registration_could_not_completed_check_details`), correcto en efecto pero sin decir la causa.
- Usuario de bajo privilegio `qa-do-a-member` (rol MEMBER: `invoices:view`, `products:view`) creado por invitación + step-up + set-password: `GET /journal-entries` → **403** (autorización en servidor funciona en esta muestra).
- Incidencia: el contenedor se reinició a mitad de la sesión; se re-levantó todo con los mismos datos. Log previo de la API: `api-run1.log` (4.380 líneas, 0 respuestas 5xx registradas en la fase de preparación).

## 8. Carga ligera

Ver `03-insumo-carga-PLT.md` (familia PLTA).
