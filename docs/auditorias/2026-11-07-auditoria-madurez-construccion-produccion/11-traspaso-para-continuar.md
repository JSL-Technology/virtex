# Traspaso: cómo continuar el cierre de la auditoría (estado al 2026-11-08)

Este documento es todo lo que necesita quien continúe el trabajo, sea una persona o una IA. Léelo
completo antes de tocar código. El estado vivo, hallazgo por hallazgo, está en
[`10-verificacion-de-cierre.md`](10-verificacion-de-cierre.md).

---

## 1. Qué se pidió

1. **Auditoría (hecha, commit `774be6e3`).** Auditoría de madurez de todo Virteex ERP: backend NestJS,
   cliente Angular, POS, escritorio Electron, motor de IA, base de datos y plataforma. Salida en esta
   carpeta: `00`–`09`, `modulos/` (70 fichas) y `progreso.md`.
2. **Mandato vigente del usuario** (literal): *«Continúa resolviendo todos estos problemas hasta que los
   pendientes queden en cero y los impulso. No omitas ninguno; asegúrate de haberlos terminado por
   completo y resuelto de la forma más robusta, escalable, segura y con buenas prácticas.»*
   Antes había pedido: *«sigue buenas prácticas, sé proactivo y mantén los estándares altos, corrige
   todos los problemas que mencionaste sin excepción»* y *«superando a los líderes de la industria…
   no escatimes… aquí no importa el costo»*.

Objetivo: dejar **0 pendientes** en `10-verificacion-de-cierre.md`, con cada solución verificada
(pruebas, verificadores, y en vivo cuando aplique) y empujada a la rama.

## 2. Rama y reglas de git

- **Rama: `ccr-f710ff5b-8ijix4`** (repo `JSL-Technology/virtex`). Desarrolla y empuja **solo** ahí:
  `git push -u origin ccr-f710ff5b-8ijix4`. Si el push falla por red, reintenta hasta 4 veces con
  espera exponencial (2, 4, 8 y 16 s).
- **No crees un PR** salvo que el usuario lo pida. Ya existe el PR #175 abierto desde esta rama; el CI
  corre sobre él.
- **Commits** en español, con prefijo convencional (`fix(área):`, `feat(área):`, `docs(auditoría):`…),
  citando los IDs de hallazgo y con un cuerpo que explique el qué y el porqué. Terminan con:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LobtT2n44AeWKGvxQiDnTS
  ```
  (Si eres otra sesión o herramienta, usa tu propia línea de atribución.) **Nunca** pongas un
  identificador de modelo en el código, los comentarios, el PR ni el texto del commit fuera de esas
  líneas.
- Haz commit y push **con frecuencia**: el contenedor se reinicia y se pierde lo no empujado.

## 3. Restricciones que no se negocian

- **Solo local/desarrollo**, nunca producción. Los datos de prueba llevan el prefijo **`QA-`**.
- **Sin efectos externos**: nada de correos reales, pagos ni envíos a autoridades fiscales.
  `EXTERNAL_EFFECTS` vale `none` por defecto fuera de producción (`apps/backend/api/src/app/config/external-effects.ts`).
  No lo actives. Un verificador ya contactó una vez `ecf.dgii.gov.do` por accidente.
- **No copies secretos** a documentos ni commits. Enmascáralos.
- **No recomiendes ni introduzcas microservicios.** Es un monolito modular con fronteras verificadas.
- Lo regulatorio o contable (tasas, formatos fiscales, nómina, NIIF) lleva la nota **«verificar con
  contador/abogado local»** en los textos y commits donde aplique.
- **No desactives, saltes ni pongas en cuarentena una prueba** para ponerla en verde. Si una prueba
  codifica el comportamiento defectuoso, actualízala explicando por qué el nuevo comportamiento es el
  correcto (ya se hizo así en `order-mail.handler.spec.ts` y `regime-adapters.spec.ts`).

## 4. Estado actual

Cifras de `10-verificacion-de-cierre.md`: **388 identificadores; 37 resueltos, 7 parciales, 318
pendientes**, 10 informativos y 16 que no son hallazgos.

| Severidad | Resueltos | Parciales | Pendientes |
|---|---|---|---|
| Crítica | 11 | 0 | **2** (SP-02, SP-03) |
| Alta | 15 | 4 | **88** |
| Media | 11 | 1 | **151** |
| Baja | 0 | 0 | **64** |
| Sin severidad | 0 | 2 | **13** (patrones SP-04…SP-13, etc.) |

Del total de pendientes, 13 no tienen severidad. Son patrones que se cierran al resolver sus
hallazgos concretos.

### Commits ya hechos (en orden)

| Commit | Qué cerró |
|---|---|
| `017fa1d5` | Escritorio: Electron 45.2.3 fijado, firma (Azure Trusted Signing / notarización), auto-actualización verificada con declaraciones Ed25519, fuses, CSP, sandbox (PLTB-DT-01/02/03) |
| `4b930dfc` | CI en verde en la rama; interruptor `EXTERNAL_EFFECTS`; node-forge 1.4.3 + `certificate-trust` corregido; guarda de mismo inquilino en el portal de clientes (FAC-EINV-02/03, FE-CI-01/03, IAM-T2, CS-01, NOM-41) |
| `471e0e3e` | Robo de libros de datasheets entre inquilinos; SSRF en push; todo `@Body` es un DTO validado (`tools/verify/body-dto.mjs`) (PLT-NOT-01/05, PLTB-DS-01/02) |
| `8b1ee726` | 607/608 vuelven a generarse; el cupo SaaS no aborta la transacción; las NC no consumen cupo (FAC-CMP-01 = INV-01, FAC-INV-01/02) |
| `e6bcf4d4` | Cobros multimoneda (TES-01/02) |
| `e87dd8a0` | Revaluación cambiaria real, por cuenta y moneda (FINB-01, FIN-AC-03 parcial) |
| `4909944d` | Brasil ya no factura al 0 % sin impuestos configurados (LOC-01) |
| `b012b456` | EBITDA operativo real, KPIs del ejercicio, ventas del día netas (IA-B01, IA-B03, IA-B04 parcial) |
| `40ec5afa` | i18n de lo anterior |
| `a3f55f52` | Tolerancia cambiaria real (transformador `numericTransformerWithDefault`) y tasa con 6 decimales (XF-09, FINB-02) |
| `4f411a27` | Sin regresiones de fronteras de módulos |
| `7e3640e0`, `94a20869` | Listas de precios aplicadas en factura, cotización y caja; deriva de esquema corregida (FAC-PL-01..04) |
| `ddb6d13c` | Informe de cierre hallazgo por hallazgo + herramientas |
| `f43ade93` | e-factura de 7 regímenes con *outbox*, reconciliador y canal/credencial por empresa (FAC-EINV-01, FAC-EINV-04) |
| `958cf094` | Consolidación: eliminaciones reales, corridas guardadas, pantalla, vincular subsidiaria existente (FINB-30..35) |
| `1112bb5c` | Informe de cierre actualizado |

Los parciales que hay que terminar, con lo que falta de cada uno, están en la sección «PARCIAL» de
`10-verificacion-de-cierre.md`: FE-CI-01, FIN-AC-03, IA-B04, PLT-DT-01, FE-CI-07, SP-01 y SP-11.

### En curso al momento del traspaso: SP-02 (crítico), todavía sin código

SP-02 es la República Dominicana filtrada como regla implícita (ver `07-patrones-sistemicos.md`).
Se cierra resolviendo sus hallazgos concretos:

- **FIN-COA-03 / LOC-02**: `localization/fiscal/coa-builder.ts` (~l.152 y 367-393) da a todo país
  hispano cuentas AFP/SFS/SRL/INFOTEP/TSS, «Propina Legal» e ISC.
  - Hay que hacer el plan base neutro y lo dominicano un paquete de país; los roles `AccountRole.AFP_PAYABLE…` deben ser neutros.
  - Mantén compatibilidad con los inquilinos ya creados: migración o mapeo de roles. No renombres cuentas existentes sin migración.
- **LOC-03**: el formulario de factura de BR pide «série B/E» (NCF) y muestra el aviso de sales tax de
  EE. UU. Los requisitos de emisión deben venir del paquete país; en los países `preview`, mostrar el
  aviso «este documento no es un comprobante fiscal».
- **LOC-04 / I18N-02**: «ITBIS», «RNC» y «NCF» aparecen en claves genéricas. El término neutro va en la
  base y el dominicano en `libs/shared/locales/src/regional/es-DO.json`.
- **JUR-01**: la interfaz de estrategia de nómina está modelada sobre la TSS (`afp*`, `sfs*`, `srl*`,
  `infotep*`). Pasar a `contributions: ContributionResult[]` con código libre y un catálogo por país.
  **JUR-02**: declarar la capacidad «payroll» en `fiscal-coverage.ts`.
- **CMP-16**: un `taxId` de 9 dígitos sin tipo se toma por cédula. Inferir por longitud (9 = RNC,
  11 = cédula) en `IdentityDocumentService.resolveParty`.
- **Verificador**: añadir a `verify:markets` aserciones de **contenido**: que ningún mercado no
  dominicano reciba vocabulario o cuentas de DO.

### Orden recomendado después de SP-02

1. **SP-03** (crítico): reglas fiscales y laborales con vigencia (tasa, base, tope, desde/hasta, fuente
   oficial), leídas en la fecha del documento. Cubre LOC-06, FAC-TX-03, CMP-05 y NOM-02 (el histórico
   sembrado de salario mínimo es erróneo y una prueba lo consagra: `dominican-statutory-data.spec.ts:29`).
2. **Los 88 de severidad alta**, por bloques de dominio:
   - **Integridad de compras:** CMP-01 (3-way match), CMP-02 (ITBIS de proveedor), CMP-03 (RNC único), CMP-15, CMP-17, CMP-21.
   - **Valores del cliente sin recalcular (SP-04):** FIN-JE-01, FAC-TX-01/02, NOM-03, NOM-05.
   - **Concurrencia (SP-07):** PLTB-WF-02, NOM-04, TES-18.
   - **Nómina:** NOM-01/02/06/12/20 (cifrar el NSS)/25/30/32/40/42/50.
   - **POS e inventario:** INV-02/03/04/06/07/14/20/23, INV-OP-1.
   - **Plataforma:** PLT-AUD-01/02, PLT-DB-01, PLT-DT-02, PLT-JOB-01, PLT-MAIL-01, PLT-NOT-02, PLT-OBS-01, PLT-SH-01, PLT-SRCH-01, PLT-STO-01.
   - **Tesorería:** TES-03/04/05/08/13.
   - **Contabilidad:** FIN-AC-01/04, FIN-COA-01/02, FIN-FR-01, FINB-03/10/13/16/20/21/22/40/41/44/45.
   - **IA:** IA-03, IA-B02, IA-B05.
   - **Identidad:** IAM-A4, IAM-R1.
   - **Frontend:** FE-CI-02/04, FE-DOC-01, FE-NAV-01, FE-SET-01, FE-SH-01.
   - **Ventas e impuestos:** FAC-CMP-02/03, FAC-INV-03/05, FAC-SAL-01, FAC-TX-03.
   - **Localización:** LOC-05/06, PLTB-WF-01/03.
3. **Los 151 medios y los 64 bajos.** La lista completa con su cita está en
   `10-verificacion-de-cierre.md` (sección PENDIENTE).
4. Los patrones SP-04…SP-13 se cierran cuando estén cerrados sus hallazgos, y además con el
   verificador que cada patrón propone en `07-patrones-sistemicos.md`.

Para cada hallazgo, lee primero su ficha en `modulos/<módulo>.md`. Trae ubicación, qué está mal,
forma correcta, impacto y esfuerzo. Comprueba que el defecto sigue presente en el código antes de
arreglarlo: algunos se cerraron de paso con otros arreglos.

## 5. Cómo se marca un hallazgo como resuelto

1. Arréglalo con pruebas, preferiblemente contra PostgreSQL con `describeWithDb`.
2. En `herramientas/informe-cierre.mjs`, añade una entrada al mapa `M`:
   `'ID': R('<commit>', '<evidencia: archivos, pruebas, verificación en vivo>')`, o
   `P(commit, hecho, falta)` si es parcial.
3. Regenera el informe desde la raíz del repo:
   ```bash
   node docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/herramientas/extraer-hallazgos.mjs
   node docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/herramientas/informe-cierre.mjs \
        docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/10-verificacion-de-cierre.md
   ```
   El extractor escribe `/tmp/claude-0/v/findings.json` (crea el directorio).
4. Haz commit del informe junto con el arreglo, o justo después con el hash real.

## 6. Montar el entorno (contenedor nuevo)

```bash
cd /home/user/virtex
service postgresql start; redis-server --daemonize yes
# El acceso a Postgres usa su postgres -c "psql …" (peer auth) o la contraseña de desarrollo
# 'postgres' por TCP. Bases: erp (desarrollo, API en vivo) y virteex_test (pruebas). Crea las que falten:
su postgres -c "psql -tAc \"select 1 from pg_database where datname='virteex_test'\"" | grep -q 1 || su postgres -c "createdb virteex_test"
export DB_HOST=localhost DB_USERNAME=postgres DB_PASSWORD=postgres DB_SSL=false REDIS_HOST=localhost REDIS_PORT=6379
for db in virteex_test erp; do DB_NAME=$db npm run migration:run; done
```

**Pruebas del backend** (las de base de datos se saltan en silencio si falta `DB_HOST`/`DB_NAME`):
```bash
export DB_HOST=localhost DB_NAME=virteex_test DB_USERNAME=postgres DB_PASSWORD=postgres DB_SSL=false REDIS_HOST=localhost
npx jest -c apps/backend/api/jest.config.cts apps/backend/api/src/app/<módulo> --forceExit
npx jest -c apps/backend/api/jest.config.cts --forceExit   # suite completa: unos 12-15 min, en segundo plano
```

**Cliente y POS:**
```bash
npx jest -c apps/core/client-web/jest.config.cts <ruta>
npx jest -c apps/pos/jest.config.cts <ruta>
npx ngc -p apps/core/client-web/tsconfig.app.json --noEmit   # tipos y plantillas
npx ngc -p apps/pos/tsconfig.app.json --noEmit
```

**Verificadores que arrancan la app** (necesitan el entorno de CI):
```bash
node docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/herramientas/qa/ci-env.mjs > /tmp/ci-env.sh
source /tmp/ci-env.sh && export DB_NAME=virteex_test
npm run -s verify:boot && npm run -s verify:markets && npm run -s verify:invoicing && npm run -s verify:provisioning && npm run -s verify:purchasing
```
`verify:boot` detecta errores de inyección de dependencias y ciclos de módulos que las pruebas
unitarias no ven. Pasó una vez con `AuthModule` ↔ `EinvoicingModule`.

**API en vivo y QA:**
```bash
NX_DAEMON=false npx nx run api:build --skip-nx-cache
NODE_ENV=development DB_HOST=localhost DB_PORT=5432 DB_USERNAME=postgres DB_PASSWORD=postgres DB_NAME=erp DB_SSL=false \
  REDIS_HOST=localhost REDIS_PORT=6379 AUTH_THROTTLE_LIMIT=200 PORT=3000 nohup node dist/apps/backend/api/main.js > /tmp/api.log 2>&1 &
```

- **Inquilinos QA.** En un contenedor nuevo no existen. Se crean con
  `herramientas/qa/qa-tenant.ts` (por el mismo camino que un registro real):
  ```bash
  NODE_ENV=development DB_NAME=erp … TS_NODE_TRANSPILE_ONLY=true TS_NODE_PROJECT=tools/verify/tsconfig.boot.json \
    npx ts-node -r tsconfig-paths/register docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/herramientas/qa/qa-tenant.ts DO:a,MX:a,BR:a,US:a
  ```
  Crea `qa-do-a@virtex.test`, `qa-mx-a@virtex.test`, etc. Antes elige una contraseña local con `export QA_PASSWORD='<12+ caracteres>'`: el mismo valor lo usa `qa-client.mjs` y no se guarda en el repositorio.
- **Cliente HTTP.** `herramientas/qa/qa-client.mjs` gestiona sesión, cookies y CSRF:
  `QA_SESSION=<etiqueta> node …/qa-client.mjs qa-mx-a@virtex.test GET /invoices/context`.
  - Para el *step-up*: `POST /auth/step-up {"password":"<QA_PASSWORD>","scope":"<scope>"}`. La prueba queda en cookie y los alcances «single-use» se gastan en una sola petición.
  - Cabeceras extra con `QA_HEADERS='{"Idempotency-Key":"…"}'`.
  - Cada inquilino de prueba debe ser de un solo dominio, para que lo que hagas no interfiera con otras pruebas. El aislamiento se prueba atacando desde otro inquilino (`qa-do-b`).

## 7. Lista de comprobación antes de cada commit

```bash
npx tsc -p apps/backend/api/tsconfig.spec.json --noEmit
npx eslint <archivos tocados>                 # 0 errores; no añadas avisos nuevos
node tools/verify/module-boundaries.mjs       # «Sin regresiones de frontera»; si bajan: --update
node tools/verify/numeric-transformers.mjs
npm run -s verify:security                    # tenant-scope, env-gating, crypto, step-up, body-dto…
npm run -s check:schema-drift                 # con DB_*; el CI lo exige
node tools/i18n/build-catalogues.mjs && npm run -s i18n:verify
node tools/verify/form-a11y.mjs && node tools/verify/required-markers.mjs   # si tocas formularios
npm run -s verify:migration-identities        # si añades una migración
```

Más las pruebas del módulo con base de datos, las del cliente y `ngc` si tocaste el frontend, y los
verificadores de arranque si tocaste módulos, proveedores o controladores. Tras el push, revisa el
CI del PR #175 con las herramientas MCP de GitHub (`actions_list`, `get_job_logs`).

## 8. Convenciones del repositorio (aprendidas en el camino)

- **i18n.**
  - La fuente única es `libs/shared/locales/src/base/<namespace>.json`, con `{ es, en, pt }` por clave y el portugués europeo.
  - Los JSON de `apps/*/assets/i18n` y de `apps/backend/api/src/app/i18n/messages` **se generan**: no los edites a mano.
  - Para añadir claves, usa `herramientas/qa/add-i18n-keys.mjs <spec.json>` y después `build-catalogues.mjs`.
  - Las claves van en `lower_snake` con puntos. Las familias compuestas en tiempo de ejecución (`'x.status.' + value`) se declaran en `libs/shared/locales/src/composed-keys.json`; inserta el bloque a mano, sin reformatear el archivo.
  - Una clave que deja de usarse se borra de la fuente; `i18n:verify` falla con huérfanas.
- **Migraciones.**
  - Van en `apps/backend/api/src/app/database/migrations/`, con marca de tiempo creciente. La última es `1789460000000`; usa `1789470000000` y siguientes.
  - Toda tabla de inquilino lleva RLS con `USING ("organization_id" = (NULLIF(current_setting('app.current_organization', true), ''))::uuid)`, `FORCE ROW LEVEL SECURITY` y `GRANT … TO virtex_app` si el rol existe. El patrón está en `1789450000000-FiscalRegimeSubmissions.ts`.
  - Para las FK entre tablas de inquilino, termina con `SELECT virtex_install_same_tenant_guards()`.
- **Deriva de esquema.**
  - La entidad debe declarar todo lo que crea la migración: `@Index` (incluidos los parciales con `where`), `@Check`, y las FK con `@ManyToOne` + `@JoinColumn({ foreignKeyConstraintName })`.
  - Excepciones conocidas:
    - Un índice parcial cuyo `where` filtra por un enum siempre se lee como deriva: evítalo.
    - No pongas `enumName` en `@Column({ type: 'enum' })` si coincide con el nombre por defecto.
- **Fronteras de módulos** (`tools/verify/module-boundaries.config.mjs`).
  - No importes `entities/`, `services/` ni `dto/` de otro módulo.
  - Las relaciones a entidades de otro módulo van por nombre (`@ManyToOne('Organization')`), y en SQL se usa el nombre de la tabla.
  - En pruebas, `ds.getRepository('Organization')`.
  - Si un módulo necesita `AuthModule` (por `@RequireStepUp`) y `AuthModule` lo alcanza, crea un módulo hoja (ejemplo: `einvoicing/einvoicing-admin.module.ts`). Nunca uses `forwardRef`.
- **Numéricos.**
  - `numeric` + `numericTransformer` (nullable) o `numericTransformerNotNull`.
  - Para columnas NOT NULL con DEFAULT distinto de 0, usa `numericTransformerWithDefault`; el verificador lo exige.
- **Seguridad.**
  - Todo `@Body` es una clase DTO con class-validator.
  - Los `:id` llevan `UuidParamPipe`.
  - Cualquier lectura de repositorio va acotada por inquilino (`verify:tenant-scope`).
  - Las referencias que manda el cliente se validan con `assertTenantOwns` y responden 404, no 403, para no confirmar que existen.
  - Una URL configurada por un inquilino pasa por `common/net/outbound-address.ts`: HTTPS público, `publicOnlyHttpsAgent`, sin redirecciones.
  - Las credenciales se cifran con `CryptoUtil` en una columna `select: false` y nunca se devuelven.
- **Step-up.**
  - Un alcance nuevo se añade a `auth/enums/step-up-scope.enum.ts`, al enum espejo en `apps/core/client-web/src/app/core/services/step-up.service.ts`, y a `SINGLE_USE_SCOPES` en ambos si es irreversible o da acceso.
  - El cliente lo resuelve solo, con un interceptor.
- **Transacciones y PostgreSQL.**
  - Cualquier error, aunque se capture, aborta la transacción: no captures un 23505 dentro de una transacción ajena. Usa `INSERT … ON CONFLICT DO NOTHING` y `UPDATE … RETURNING`.
  - El driver devuelve `[filas, n]` en `UPDATE … RETURNING`.
  - El trabajo posterior al commit va por `runAsTenantJob` (RLS).
  - Los crons llevan `@ExclusiveJob()` + `SchedulerLockService.runOnce` + la comprobación de `externalEffectAllowed`.
- **Pruebas.**
  - `describeWithDb` + `openTestDataSource` + `createTestOrganization` (en `common/database/testing/integration-db.ts`); limpia en `afterAll`.
  - Los servicios se construyen por constructor posicional. Si añades una dependencia, actualiza todos los `new X(` de los specs.
  - Usa ejemplos numéricos resueltos a mano en los cálculos contables (ver `consolidation/group-eliminations.ts` y su spec).
- **Estilo.**
  - Comentarios de código en inglés, explicando el porqué y citando el hallazgo (`(audit 2026-11-07, ID)`).
  - Textos de usuario siempre por i18n.
  - Commits y documentos en español.

## 9. Trampas ya pisadas

- Un servidor que no arranca no se ve en las pruebas unitarias: corre `verify:boot`.
- El CI falló dos veces por cosas que no se ven en las pruebas: `verify:boundaries` y `check:schema-drift`. Córrelos siempre.
- `git checkout` de un archivo generado o reformateado deshace cambios: revisa `git diff --stat` antes de hacer commit.
- `jest -t` con pruebas que dependen de otras falla: haz cada prueba autosuficiente.
- El login tiene limitación de intentos: arranca la API con `AUTH_THROTTLE_LIMIT=200` en QA.
- El contenedor se reinicia y los límites de uso cortan sesiones largas: commit y push frecuentes, y trabaja por bloques cerrados.
- Las suites largas mándalas a segundo plano y no lances dos a la vez.

## 10. Prompt para la siguiente IA

> Continúas el trabajo de cierre de la auditoría de Virteex ERP en el repositorio `JSL-Technology/virtex`,
> rama **`ccr-f710ff5b-8ijix4`** (desarrolla y empuja solo ahí con `git push -u origin
> ccr-f710ff5b-8ijix4`; no crees PR). Antes de nada, lee completo
> `docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/11-traspaso-para-continuar.md`
> y después `10-verificacion-de-cierre.md`, `07-patrones-sistemicos.md` y `08-hoja-de-ruta.md`.
>
> El mandato del usuario es resolver **todos** los hallazgos de la auditoría, sin excepción, hasta que
> los pendientes de `10-verificacion-de-cierre.md` queden en cero, de la forma más robusta, escalable
> y segura, con buenas prácticas y sin atajos. Quedan 2 críticos (SP-02, en curso sin código; SP-03),
> 88 altos, 151 medios, 64 bajos y 7 parciales. Sigue el orden de la sección 4 del traspaso.
>
> Para cada hallazgo:
> 1. Lee su ficha en `modulos/`.
> 2. Confirma en el código que sigue presente.
> 3. Arréglalo de raíz, con pruebas contra PostgreSQL cuando haya datos de por medio.
> 4. Pasa la lista de comprobación de la sección 7 y verifica en vivo con los inquilinos QA cuando aplique.
> 5. Registra la evidencia en el mapa `M` de `herramientas/informe-cierre.mjs` y regenera el informe.
> 6. Haz commit y push.
>
> Respeta las restricciones de la sección 3: solo desarrollo, datos `QA-`, sin efectos externos, sin
> secretos, sin microservicios, «verificar con contador/abogado local» en lo regulatorio, y nunca
> desactives una prueba. Trabaja por bloques de dominio, haz commit y push al cerrar cada uno, y al
> final de cada bloque informa al usuario, con evidencia, qué quedó resuelto y qué falta.
