# Estándar de ingeniería: las reglas y la puerta que las sostiene

## 1. Para qué sirve este documento

Este producto debe ser **predecible**: dos personas que resuelvan el mismo problema en dos módulos
distintos deben llegar a la misma forma, y quien llegue nuevo debe poder saber qué es «correcto»
aquí **sin deducirlo del código que ya existe**. Deducirlo del código es exactamente cómo se
propagan los errores: una errata en un andamio se copia, una excepción cruda con una frase en
español se copia, un `process.env` en un servicio se copia. Cada regla de abajo existe porque su
contraria ya se había escrito y había llegado a producción, o a un cliente, o a las dos cosas.

Cada regla tiene **una puerta de CI** que la sostiene. Un comentario no puede hacer fallar una
compilación; una puerta sí. Eso es lo que distingue una regla de una buena intención, y es la razón
de que este documento no sea una guía de estilo: es la lista de lo que el repositorio ya no admite.

Las reglas **no se relajan con una excepción nueva**: se relajan cambiando la puerta, que es un
cambio visible en una revisión. Donde una puerta tiene línea base (un trinquete), la línea base solo
baja.

## 2. Nombre y vocabulario

| Regla | Puerta |
|---|---|
| El producto se llama **virtex**. Ninguna otra grafía aparece en ningún archivo. | `verify:product-name` |
| Lo que pertenece a un mercado vive en su paquete (`markets/<cc>/`, `einvoicing/regimes/<cc>/`, `localization/drivers/<cc>/`) y se alcanza por su registro. El núcleo no nombra ningún país. | `verify:country-neutrality` (en **0**) |
| Ningún texto de interfaz está escrito en el código: todo sale del catálogo, con base neutral por idioma y parche regional por mercado. | `i18n:verify`, `verify:localized-names`, `verify:typescript-prose` |
| Cada uno de los 19 mercados tiene locale reconocido y parche regional, sin claves huérfanas. | `markets/regional-wording.spec.ts` |

**De dónde viene.** `virteex` —una errata— estaba en 729 sitios: <!-- product-name-allow --> el alias de TypeScript, el nombre
del paquete, variables de entorno, las bases de datos de prueba y de CI, dominios de ejemplo, el
namespace de Redis, claves de i18n, los tsconfig, el compose y el workflow de CI. Un nombre que está
bien en unos sitios y mal en otros rompe toda herramienta que haga `match` sobre él.

## 3. Errores y respuestas

| Regla | Puerta |
|---|---|
| Una negativa de la API viaja como **clave**, nunca como frase: `{ statusCode, code, messageKey, params }`. El navegador la redacta en el idioma del lector. | `verify:localized-errors` |
| Una excepción cruda de Nest vale con un **código de máquina** (`AuthError.SESSION_EXPIRED`) o con el contrato escrito a mano; nunca con prosa. | `verify:localized-errors` |
| Nada de un 5xx llega al navegador: ni mensaje, ni traza, ni fragmento de SQL. | `i18n/i18n-exception.filter.ts` + su spec |
| El texto de un tercero (el `error_description` de un IdP, el detalle de una política) va al log, no al navegador. | `verify:localized-errors` |

**De dónde viene.** Nueve sitios saltaban el contrato: el plan de cuentas rechazaba una naturaleza
incorrecta **en español** a quien leía en inglés; dos 401 no llevaban código y el lector recibía la
frase genérica del estado; tres callbacks de OAuth reenviaban al navegador el texto del proveedor; el
transporte dominicano devolvía plantillas con el detalle HTTP del fallo dentro.

## 4. Configuración

| Regla | Puerta |
|---|---|
| **Toda** variable de entorno que la aplicación lee está declarada en `config/env.validation.ts`, con su forma, su valor por omisión y lo que se rechaza fuera de desarrollo. | `verify:env-schema` |
| Un servicio lee configuración por `ConfigService`. El entorno se lee en las fábricas de configuración (`*.config.ts`), en el arranque y en el `DataSource` de la CLI; en ningún otro sitio. | `verify:env-schema` + revisión |
| Una decisión de seguridad no se toma comparando `NODE_ENV` con un literal: se toma con la lista permitida (`isDevLikeEnvironment()`). | `verify:env-gating` |
| Un interruptor peligroso se **rechaza** fuera de desarrollo, no se ignora: el esquema no arranca. | `config/env.validation.spec.ts` |
| Hay una sola derivación de clave por material cifrado, y cada sobre cifrado lleva versión. | `verify:crypto` |

**De dónde viene.** Catorce variables se leían de `process.env` en los servicios que las usan, así
que el esquema —la única descripción de lo que un despliegue puede configurar— no sabía que
existían: una errata (`SONAR_HOST_UR`) era silenciosa y la función detrás simplemente no funcionaba;
los valores por omisión vivían en cuatro archivos; y dos de ellas deciden si el código de una
extensión se analiza antes de admitirla y si se firma con una clave que sobrevive a un reinicio, sin
guarda de producción de ningún tipo.

## 5. Fronteras entre módulos

| Regla | Puerta |
|---|---|
| Un módulo no importa lo privado de otro: se habla por contrato, en `contracts/`. | `verify:boundaries` (trinquete) |
| `markets/` no depende de ningún módulo de negocio. | `verify:boundaries` |
| Un módulo no registra entidades ajenas ni abre transacciones sobre tablas de otro. | `verify:boundaries` |
| La dependencia se invierte con un **registro**: el emisor registra, el receptor lee (`LedgerPostingRegistry`, `FiscalRegimeRegistry`, `TaxIdRegistryRegistry`, `DataTransferRegistry`…). | `verify:boundaries`, `verify:boot` |
| El grafo de módulos resuelve: cada proveedor se inyecta de verdad, no solo compila. | `verify:boot` |

## 6. Datos y persistencia

| Regla | Puerta |
|---|---|
| El esquema de las entidades y el de las migraciones no se separan. | `check:schema-drift` |
| Una migración por transacción, con `down`, y con identidad única. | `verify:migration-identities` |
| Una migración es historia: no se edita. Lo que cambió se corrige en otra. | revisión |
| Una fecha de calendario cruza una frontera como `IsoDate`, no como `Date`. | `verify:date-columns` |
| Una columna `numeric` se declara con su transformador: nunca llega como `string` a una suma. | `verify:numeric-transformers` |
| Toda tabla con dueño lleva política de aislamiento por empresa, y el aislamiento se comprueba **a través de la aplicación**, no solo en la base. | `verify:rls`, `verify:rls-runtime`, `verify:tenant-scope` |
| Historia contabilizada no se reescribe: lo que ya está en el mayor se corrige con un asiento, no con un `UPDATE`. | triggers de inmutabilidad + `account-merge.integration.spec.ts` |
| El plan de una empresa cambia por una sola puerta, `SaasService.applyPlan`, que deja su fila de historia en la misma transacción. El estado de facturación lo escribe solo `BillingStateService`, para **todas** las empresas que factura una suscripción; la caché se invalida después del commit, nunca dentro. | `verify:plan-writes` + `billing-state.integration.spec.ts` |
| Una fila de un inquilino escrita dentro de una unidad de trabajo que no es la suya (un webhook, un cambio que alcanza a un grupo) se escribe con `actAsTenantWithin`, que devuelve a la transacción el contexto que tenía. | `billing-state.integration.spec.ts` (como `virtex_app`) |

**De dónde vienen las dos últimas.** Siete sitios asignaban el plan y ninguno dejaba historia:
la tabla que responde «en qué plan estaba este cliente, y desde cuándo» estaba vacía en todos los
entornos. El webhook que debía mover el plan cuando el cliente lo cambiaba en el proveedor no lo
hacía: el proveedor cobraba Pro y el producto aplicaba Starter. Cada manejador actualizaba UNA empresa
de un grupo que comparte suscripción. Y el cambio de plan desde la aplicación compraba una segunda
suscripción junto a la primera, que seguía cobrando.

## 7. Superficie HTTP

| Regla | Puerta |
|---|---|
| Cada handler declara su permiso (`@HasPermission`), o dice explícitamente que es público. | `verify:role-assignment`, `verify:step-up-coverage` |
| Todo cuerpo de petición pasa por un DTO con lista blanca. | `verify:body-dto` |
| Un parámetro de ruta que es un id se valida como tal. | `verify:body-dto` |
| Una acción sensible exige step-up, y la sesión revocada deja de servir de inmediato. | `verify:step-up-coverage`, `verify:session-revocation`, `verify:auth-contract` |
| Un proceso programado no corre dos veces a la vez. | `verify:cron-exclusive` |

## 8. Interfaz

| Regla | Puerta |
|---|---|
| Un formulario marca sus campos inválidos y los asocia a su etiqueta. | `verify:form-a11y` |
| Ningún literal de interfaz en una plantilla. | `i18n:verify` |
| El cliente no compara códigos de país: dibuja desde la definición pública del mercado. | `verify:country-neutrality` |

## 9. Verificación viva

Una prueba unitaria demuestra que una función hace lo que dice. No demuestra que un inquilino nuevo
pueda emitir una factura. Para eso están los verificadores vivos, que arrancan la aplicación de
verdad contra PostgreSQL y recorren un caso completo:

| Verificador | Qué demuestra |
|---|---|
| `verify:boot` | Cada proveedor de la aplicación se inyecta limpiamente. |
| `verify:markets` | Los 19 mercados se aprovisionan por los servicios reales. |
| `verify:provisioning` | Todo registro produce un inquilino que puede llevar libros. |
| `verify:invoicing` | Un inquilino nuevo emite, contabiliza y acredita. |
| `verify:purchasing` | Comprar mantiene el mayor y el kárdex de acuerdo. |
| `verify:ledger` | Una empresa nueva lleva, reorganiza y cierra sus libros: vigencia del plan, fusión sin reescribir historia, cierre con contabilidad analítica. |
| `verify:fiscal-identity` | La identidad fiscal sobrevive al almacenamiento. |
| `verify:ecf` | El documento electrónico se construye, valida y firma. |
| `verify:rls-runtime` | El aislamiento rige a través de la aplicación. |
| `verify:tenancy` | La pertenencia cruzada entre empresas funciona de extremo a extremo. |
| `verify:auth-contract` | La superficie de autenticación se comporta como se especifica. |
| `verify:upgrade-path` | Una base existente llega al esquema de hoy. |

## 10. Pruebas

- **Una prueba no se desactiva nunca** para poner algo en verde. Si una prueba estorba, es porque
  describe un comportamiento que cambió: se reescribe para describir el nuevo, con su motivo.
- Lo que depende del esquema se prueba **contra el esquema migrado**, no contra un repositorio
  simulado. Los defectos que esta regla encontró —un trigger de inmutabilidad, una restricción
  diferida, un `DEFAULT` de columna— son invisibles para un mock.
- Un arreglo lleva la prueba que **falla antes y pasa después**, y el commit cita las dos.

## 11. Qué hacer cuando algo no encaja

1. Si una regla estorba, se discute la regla, no se hace la excepción. Una excepción sin puerta se
   copia en seis meses.
2. Si no hay regla, se escribe: aquí, y con su puerta. Una regla sin puerta dura lo que dura la
   memoria de quien la escribió.
3. Si la puerta se equivoca (marca algo correcto), se corrige la puerta y se dice por qué en el
   mismo commit.

Documentos relacionados: [`ARQUITECTURA_MERCADOS.md`](ARQUITECTURA_MERCADOS.md) (cómo se añade un
mercado), [`ARQUITECTURA_UX_MODULAR.md`](ARQUITECTURA_UX_MODULAR.md),
[`CICLO_DE_VIDA_DE_REGISTROS.md`](CICLO_DE_VIDA_DE_REGISTROS.md),
[`AUTH_SESSION.md`](AUTH_SESSION.md), [`DEPLOYMENT.md`](DEPLOYMENT.md).
