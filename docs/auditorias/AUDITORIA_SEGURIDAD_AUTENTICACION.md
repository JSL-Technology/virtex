# Auditoría de seguridad y autenticación — Virtex

**Alcance:** todo el repositorio. Backend (`apps/backend/api`), cliente web (`apps/core/client-web`),
punto de venta (`apps/pos`), escritorio (`apps/desktop`), librerías compartidas (`libs/shared`),
políticas de plataforma (`platform/policies`) y utilidades de verificación (`tools/verify`).

**Método:** lectura del código, no de los comentarios. Donde un comentario afirma que algo está
resuelto, la afirmación se comprobó contra la implementación y contra sus llamantes.

---

## Paso 0 — El estándar contra el que se juzga

Antes de mirar el código, así luce la implementación de referencia para un ERP SaaS multi-inquilino:

1. **Un solo mecanismo de autenticación.** Un emisor de tokens, un validador, una política de
   estados que pueden autenticarse. Nada de dos caminos que puedan divergir.
2. **Autorización por defecto denegada, aplicada en guards globales.** Un endpoint que no declara
   nada no se abre: se cierra y se registra el olvido. La exención es explícita y razonada.
3. **Aislamiento entre inquilinos garantizado por la base de datos**, no por el recuerdo de cada
   servicio. Las políticas de fila se aplican al rol con el que corre la aplicación, y la
   aplicación se niega a arrancar si no rigen.
4. **Sesiones cortas, rotación de refresh con detección de reuso**, invalidación real en el
   servidor al cerrar sesión y al cambiar la contraseña.
5. **Cookies `HttpOnly`, `Secure`, `SameSite`, con prefijo `__Host-`.** Ningún token de sesión
   accesible desde JavaScript.
6. **Step-up para acciones sensibles**, con alcance firmado y de un solo uso donde el daño es
   irreversible.
7. **Ningún secreto en el repositorio**, y todo comportamiento de desarrollo bloqueado fuera de
   desarrollo mediante **lista blanca de entornos**, no lista negra.
8. **Una sola frontera de privilegio por cada recurso.** Un recurso compartido por toda la
   plataforma se administra con un rol de plataforma, nunca con un permiso de inquilino.

Los puntos 1 a 6 están implementados aquí, y bien. Los hallazgos de esta auditoría se concentran en
los puntos 7 y 8, y en un módulo —extensiones— que quedó fuera del modelo de inquilinos que el
resto del producto aplica con rigor.

---

## Hallazgos

### C-1 · Cualquier administrador de cualquier inquilino puede publicar código que se ejecuta en los demás inquilinos

- **Categoría:** autorización / aislamiento entre inquilinos
- **Severidad:** **CRÍTICA**
- **Ubicación:**
  - `apps/backend/api/src/app/extensions/extensions.controller.ts:55-65` (`POST /extensions`, `POST /extensions/:name/revoke`)
  - `apps/backend/api/src/app/extensions/extensions.service.ts:59-114` (`register`, `revoke`)
  - `apps/backend/api/src/app/extensions/entities/plugin.entity.ts:36-62` (la tabla no tiene `organization_id`)
  - `apps/backend/api/src/app/extensions/extensions.service.ts:155-170` (`resolveVersion`)
  - `apps/backend/api/src/app/extensions/extensions.service.ts:252-283` (`runtime`)
  - `apps/backend/api/src/app/config/roles.config.ts:27-33` (el rol ADMINISTRADOR de **cada** inquilino lleva `'*'`)

**Qué está mal y por qué.** El catálogo de extensiones es deliberadamente global —el propio
comentario de la entidad lo dice: *«an extension is authored once and offered to every tenant»*— y
por tanto `plugins` y `plugin_versions` no llevan columna de inquilino. Pero las rutas que
**escriben** ese catálogo global están protegidas por `PERMISSIONS.EXTENSIONS_MANAGE`
(`'extensions:manage'`), que es un permiso ordinario del catálogo de inquilino
(`config.permissions.ts:66`) y que el comodín `'*'` del rol ADMINISTRADOR satisface
(`libs/shared/util-auth/src/lib/permissions.util.ts:10-12`). Todo inquilino que se registra recibe
ese rol.

Ni `register` ni `revoke` reciben `organizationId`. `register` busca el plugin **por nombre**
(`extensions.service.ts:60`) y, si ya existe, **le añade una versión** en vez de rechazar la
escritura sobre un artefacto ajeno. Y la resolución de qué versión se ejecuta es *la más reciente*:

- servidor: `resolveVersion` sin `version` explícita ordena por `createdAt` descendente y toma la primera (`extensions.service.ts:164-166`);
- navegador: `runtime` pide `order: { createdAt: 'DESC' }` y toma la primera con `uiEntry` (`extensions.service.ts:268-273`).

La firma no cierra esto: la firma la produce el propio servidor sobre el código recién recibido
(`plugin-admission.service.ts:97, 242-247`), así que el artefacto del atacante queda firmado por la
plataforma y `SandboxService.verifyCodeSignature` lo acepta.

**Cómo se vería la forma correcta.** Un catálogo global es un recurso de plataforma y necesita una
frontera de privilegio de plataforma: un rol con `organization_id IS NULL` —la figura que
`UserIdentityService.permissionsFor` ya contempla (`user-identity.service.ts:283-289`)— y un
permiso `platform:extensions:publish` que **ningún** rol de inquilino pueda llevar y que
`assertAssignablePermissions` no pueda delegar. Además: la propiedad del plugin debe comprobarse
(`plugins.publisher_organization_id`), el nombre debe estar reservado a su autor, y la versión que
un inquilino ejecuta debe ser la que ese inquilino **fijó al dar su consentimiento**, no «la última
que haya subido cualquiera».

**Cómo se explotaría.**
1. Me registro como cliente normal. Recibo el rol ADMINISTRADOR con `'*'`.
2. `GET /api/v1/extensions` → veo el catálogo completo de la plataforma y elijo una extensión que
   otros inquilinos usan, por ejemplo `facturacion-dian`.
3. `POST /api/v1/extensions` con `{ name: "facturacion-dian", version: "9.9.9", code: "<mi código>",
   uiEntry: "<mi JS>", sbom: { bomFormat: "CycloneDX", specVersion: "1.4", components: [] } }`.
   El servicio encuentra el plugin por nombre, no comprueba quién lo publicó, y **añade mi versión**.
4. A partir de ese instante, cualquier inquilino que ejecute `facturacion-dian` sin fijar versión
   corre **mi** código en el aislado del servidor, con las capacidades que *ese* inquilino había
   concedido (`extensions.service.ts:206-226`) — incluida `egress:http` si la tenía.
5. Y el `uiEntry` que sirve `GET /extensions/runtime` a esos inquilinos es el mío, que se ejecuta con
   `new Function(code)(virtex, root)` en el navegador de su administrador
   (`extension-host.component.ts:178`) y puede leer su API con la sesión de esa persona vía
   `virtex.api(...)` si tienen `api:read`.
6. `POST /api/v1/extensions/facturacion-dian/revoke` deja la extensión inservible para **todos** los
   inquilinos de la plataforma.

---

### C-2 · El código fuente y la firma de toda extensión de la plataforma son legibles por cualquier inquilino

- **Categoría:** autorización / aislamiento entre inquilinos
- **Severidad:** **ALTA**
- **Ubicación:** `apps/backend/api/src/app/extensions/extensions.controller.ts:49-53`;
  `apps/backend/api/src/app/extensions/extensions.service.ts:53-57`

**Qué está mal.** `getByName` devuelve `this.plugins.findOne({ where: { name }, relations: { versions: true } })`
— la entidad completa, con `versions[].code` (el fuente que corre en el servidor),
`versions[].uiEntry` (el fuente que corre en el navegador) y `versions[].signature`. La ruta solo
exige `extensions:view`, permiso de inquilino que el comodín satisface. No hay DTO de salida ni
`select` que recorte nada; compárese con el cuidado que sí se pone en
`UserResponseDto` + `excludeExtraneousValues` en el resto del producto.

**Cómo se vería la forma correcta.** Un DTO de catálogo (nombre, versión, descripción, autor,
capacidades declaradas, manifiesto de contribuciones) y nada más. El `code` solo debe salir hacia el
aislado y hacia el publicador del propio plugin.

**Cómo se explotaría.** `GET /api/v1/extensions` para listar, luego `GET /api/v1/extensions/{nombre}`
para cada uno: se obtiene el código propietario de todos los proveedores del marketplace. Como
subproducto, se lee el código exacto que se está ejecutando en otros inquilinos, que es el insumo
para preparar la sustitución descrita en C-1.

---

### C-3 · `extensions:execute` permite ejecutar código arbitrario en el servidor

- **Categoría:** autorización / otro
- **Severidad:** **ALTA**
- **Ubicación:** `apps/backend/api/src/app/extensions/extensions.controller.ts:77-81`;
  `apps/backend/api/src/app/extensions/extensions.service.ts:172-226`;
  `apps/backend/api/src/app/extensions/dto/execute-plugin.dto.ts`

**Qué está mal.** `ExecutePluginDto.code` es un `string` libre. El servicio lo pasa por el pipeline de
admisión, lo **firma con la clave de la plataforma** (`extensions.service.ts:202`) y lo ejecuta. El
pipeline no es una barrera de confianza: el escaneo heurístico son seis expresiones regulares
(`plugin-admission.service.ts:109-124`) triviales de eludir —`eval\(` no ve `globalThis['ev'+'al']`,
`__proto__` no ve `constructor.prototype`— y la política OPA solo comprueba firma y egreso
declarado, no el comportamiento del código.

La contención real es el aislado V8 con límite de memoria y timeout, y eso es una defensa seria.
Pero significa que **la seguridad del producto frente a cualquier usuario con `extensions:execute`
—es decir, cualquier administrador de cualquier inquilino— depende de que no exista una fuga de
`isolated-vm`**. Es una superficie muy grande para un permiso de inquilino.

**Cómo se vería la forma correcta.** La ejecución de código inline es una herramienta de desarrollo
de extensiones: debe estar detrás de una bandera de entorno apagada en producción, o detrás del
mismo permiso de plataforma de C-1. La ejecución en producción debe limitarse a versiones admitidas
y consentidas, por nombre y versión.

**Cómo se explotaría.** `POST /api/v1/extensions/execute` con `{ "code": "<JS>", "sbom": {...} }` desde
cualquier cuenta con rol administrador. Los logs del aislado vuelven en la respuesta, así que el
canal de salida existe sin necesidad de egreso de red.

---

### A-1 · El rol por defecto de SSO se asigna sin pasar por el control de delegación de privilegios

- **Categoría:** autorización / escalada de privilegios
- **Severidad:** **ALTA**
- **Ubicación:** `apps/backend/api/src/app/auth/services/sso-admin.service.ts:80` (`createProvider`)
  y `:87-93` (`updateProvider`); `apps/backend/api/src/app/auth/sso-admin.controller.ts:23`;
  consumido en `apps/backend/api/src/app/auth/services/enterprise-sso.service.ts:211-218`

**Qué está mal.** El producto tiene una regla explícita y bien implementada: *nadie reparte derechos
que no tiene*. `RolesService.assertCanAssignRole` la aplica en `UsersService.updateUser`
(`users.service.ts:220`) y en `UsersService.inviteUser` (`users.service.ts:722`), y el comentario de
este último dice que esos «eran los únicos otros dos sitios donde se asigna un rol».

No lo son. `IdentityProvider.defaultRoleId` es un tercer sitio: se acepta tal cual desde el DTO,
sin `assertCanAssignRole` y sin step-up, y se usa después para asignar el rol a cada usuario
aprovisionado por SSO. La ruta exige `SETTINGS_EDIT_COMPANY`, un permiso de configuración que no
implica ninguno de los de gestión de usuarios.

**Cómo se vería la forma correcta.** `createProvider` y `updateProvider` reciben el principal y
llaman `rolesService.assertCanAssignRole(actor, role)` sobre el `defaultRoleId` antes de guardarlo,
exactamente igual que la invitación. Y la ruta lleva `@StepUp(StepUpScope.MANAGE_ROLES)`, porque
fijar el rol por defecto de SSO reescribe el grafo de autorización igual que crear un rol.

**Cómo se explotaría.** Un usuario con `settings:edit_company` y sin ningún permiso sobre usuarios:
1. `GET /api/v1/roles` para obtener el `id` del rol ADMINISTRADOR (que lleva `'*'`).
2. `PATCH /api/v1/auth/sso/admin/providers/{id}` con `{ "defaultRoleId": "<id del administrador>" }`.
3. Cualquier cuenta nueva que entre por el IdP del dominio verificado se aprovisiona con `'*'`
   (`enterprise-sso.service.ts:188-189`). Si el atacante controla una dirección del dominio
   corporativo que aún no tenga cuenta, la siguiente es la suya.

---

### A-2 · La elección del rol de SSO cuando no hay `defaultRoleId` se decide por el **nombre** del rol

- **Categoría:** autorización / inconsistencia entre implementaciones
- **Severidad:** **ALTA**
- **Ubicación:** `apps/backend/api/src/app/auth/services/enterprise-sso.service.ts:219-225`

```ts
// Fall back to a non-admin role in the org, preferring the least-privileged one.
const roles = await this.roleRepository.find({ where: { organizationId: idp.organizationId } });
if (!roles.length) throw new BadRequestError('auth.organization_has_no_roles_assign_sso_users');
const nonAdmin = roles.find((r) => !/admin/i.test(r.name));
return nonAdmin ?? roles[0];
```

**Qué está mal.** Dos cosas, y la segunda es peor que la primera.

Primero: el comentario dice *«preferring the least-privileged one»* y el código no compara
privilegios en ningún momento. Toma el **primer rol de la consulta sin `ORDER BY`** cuyo nombre no
contenga «admin». Los inquilinos definen nombres arbitrarios —`RolesService` lo permite y el propio
módulo de impersonación lo documenta—, así que un rol llamado «Dirección General», «Socio» o
«Gerente» que lleve `'*'` es «no-admin» para esta expresión regular y es el que se asigna.

Segundo: `nonAdmin ?? roles[0]`. Si **todos** los roles del inquilino tienen «admin» en el nombre,
el respaldo es el primero de la lista, que puede ser precisamente el ADMINISTRADOR con `'*'`. El
respaldo del caso «no encuentro un rol seguro» es «asigna cualquiera».

Esto es exactamente el antipatrón que este mismo repositorio ya identificó y corrigió en
`ImpersonationService`, donde el comentario de `assertNoPrivilegeGain`
(`impersonation.service.ts:36-50`) explica que puntuar roles por nombre produjo *«una escalada de
privilegios completa»*. La lección se aplicó en un archivo y no en el otro.

**Cómo se vería la forma correcta.** Elegir por el conjunto de permisos, no por el nombre: descartar
todo rol que lleve `'*'` o cualquier comodín de prefijo, y entre los restantes tomar el de menor
cardinalidad de permisos. Si no queda ninguno, **fallar** — negarse a aprovisionar es correcto; dar
el primero que haya, no.

**Cómo se explotaría.** Organización con SSO habilitado y sin `defaultRoleId` fijado (es opcional en
el DTO). Sus roles se llaman, digamos, «Dirección» (con `'*'`) y «Contabilidad». La consulta sin
orden devuelve «Dirección» primero; el `find` la acepta porque no dice «admin»; todo usuario nuevo
que entre por SSO nace con `'*'`.

---

### A-3 · El sembrado de desarrollo se bloquea con lista negra, no con la lista blanca que el propio proyecto declara como regla

- **Categoría:** manejo de secretos / autenticación
- **Severidad:** **ALTA**
- **Ubicación:** `apps/backend/api/src/main.ts:217-226`;
  `apps/backend/api/src/app/auth/services/dev-seeder.service.ts:31-41`;
  contrastar con `apps/backend/api/src/app/auth/auth.config.ts:1-24`

**Qué está mal.** `auth.config.ts` abre con la regla del proyecto, escrita explícitamente:

> *«The previous implementation gated every fail-fast check on `NODE_ENV === 'production'`. That left
> a hole: any other value — `staging`, `prod`, `qa`, or simply an unset variable — silently fell
> through to a hardcoded development secret. […] The rule is now inverted and allow-list based.»*

`isDevLikeEnvironment()` implementa esa lista blanca y la usan `requireSecret`, `KeyManagementService`
y `JwtStrategy`. El sembrador **no** la usa. Sus dos puertas son:

```ts
configService.get<string>('NODE_ENV') !== 'production' && ...   // main.ts:218
if (nodeEnv === 'production') { ...return; }                     // dev-seeder.service.ts:33
```

Con `NODE_ENV=staging` —o `qa`, o `prod`, o sin definir— ambas dejan pasar. Y lo que crean no es un
registro vacío: `provisionTenantDirect` es el mismo `materializeAccount` del alta de pago, así que
produce un **inquilino completo con un administrador operativo** cuya credencial está en el
repositorio:

```ts
const email    = this.config.get('DEV_SEED_EMAIL')    || 'dev@virtex.local';
const password = this.config.get('DEV_SEED_PASSWORD') || 'dev12345';
```

Además, la contraseña se escribe en claro en el log al sembrar (`dev-seeder.service.ts:70-72`). Y
`dev12345` tiene ocho caracteres: por debajo del mínimo que el propio producto publica en
`GET /auth/password-policy` (`auth.controller.ts:299-312`), lo que confirma que este camino no pasa
por la política de contraseñas.

El mismo patrón afecta a Swagger (`main.ts:162`), aunque ahí el daño está contenido porque el gate
de basic-auth deniega cuando `SWAGGER_PASSWORD` está vacío.

**Cómo se vería la forma correcta.** Una sola función decide qué es un entorno de desarrollo, y es
la que ya existe:

```ts
if (isDevLikeEnvironment() && configService.get('DEV_SEED') !== 'false') { ... }
```

y dentro del servicio, `if (!isDevLikeEnvironment()) return;`. Mejor aún: exigir `DEV_SEED=true`
de forma afirmativa, para que el sembrado nunca sea el comportamiento por defecto de nada.

**Cómo se explotaría.** Despliegue de preproducción accesible —el caso normal: staging con datos
reales copiados— con `NODE_ENV=staging`. El atacante prueba `dev@virtex.local` / `dev12345` en
`POST /auth/login` y entra como administrador de un inquilino. Desde ahí, C-1 convierte ese acceso
en ejecución de código en el resto de los inquilinos de esa instancia.

---

### A-4 · El aislamiento por filas está instalado pero su vigencia es opcional y solo se anuncia en un log

- **Categoría:** aislamiento entre inquilinos / otro
- **Severidad:** **ALTA**
- **Ubicación:** `apps/backend/api/src/app/shared/tenancy/tenant-isolation.check.ts:20-23, 56-65`;
  `apps/backend/api/src/app/database/migrations/1789002100000-TenantRowLevelSecurity.ts:22-25, 99-107`

**Qué está mal.** El trabajo aquí es serio: 118 políticas `USING` + `WITH CHECK`,
`TenantConnectionInterceptor` que fija `app.current_organization` por petición,
`patchDataAccessForTenancy` que encamina los 91 repositorios y las 96 transacciones por esa
conexión, y `verify:rls-runtime` que lo prueba contra una base real. Nada de eso se cuestiona.

Lo que falla es el cierre. `ENABLE ROW LEVEL SECURITY` no aplica al **dueño** de la tabla, y las
políticas se crearon sin `FORCE ROW LEVEL SECURITY`. La vigencia depende, por tanto, de una
variable de entorno: `DB_USERNAME=virtex_app` frente a `DB_USERNAME=postgres`. Y la comprobación de
arranque que detecta esa diferencia **deliberadamente no aborta** (`tenant-isolation.check.ts:20-23`):
registra un `logger.error` y devuelve.

El propio comentario nombra el problema mejor de lo que yo podría: *«Lo peligroso de esa
configuración no es que exista: es que es INDISTINGUIBLE de la correcta desde dentro. Todo funciona,
las pruebas pasan, las políticas están en la base, y nadie se entera hasta que alguien ve datos de
otra empresa.»* Un control cuya activación depende de que alguien lea una línea de log es un control
opcional, y el propio repositorio documenta que el filtro aplicativo ya falló dos veces (órdenes de
producción sin filtro; suscriptores de webhook recibiendo las cargas de todos los inquilinos).

Dos huecos adicionales, de distinto origen:
- **Sin `FORCE`:** si el rol de la aplicación llegara a poseer una tabla —una migración futura
  ejecutada con las credenciales equivocadas basta— esa tabla deja de estar protegida en silencio.
- **Tablas excluidas por diseño:** `users`, `roles`, `audit_logs`, `warehouses`, `employees`,
  `projects` y una docena más quedan fuera porque su `organization_id` es nulable
  (migración, líneas 39-46). Son tablas con datos personales y con el grafo de autorización, y su
  aislamiento sigue dependiendo enteramente del `where` de cada servicio.

**Cómo se vería la forma correcta.**
1. `ALTER TABLE … FORCE ROW LEVEL SECURITY` en las 118, para que la propiedad de la tabla deje de
   ser relevante.
2. `TenantIsolationCheck` **aborta el arranque** cuando `row.owned > 0` o `row.policies === 0` y el
   entorno no es de desarrollo. Un ERP que no arranca es peor que uno que avisa solo si alguien lee
   el aviso; un ERP que sirve la contabilidad de otra empresa es peor que ambos.
3. Para las tablas excluidas: política con predicado que admita explícitamente la fila sin inquilino
   (`organization_id IS NULL AND <condición acotada>`), o separación en dos tablas. La nulabilidad
   es una decisión de modelo que puede tomarse; dejarlas sin política es aplazarla.

**Cómo se explotaría.** No hay un exploit directo: es una condición de despliegue. El camino es un
`DB_USERNAME` heredado de antes del cambio de rol, y a partir de ahí cualquier consulta que olvide
su filtro devuelve las filas de todos los inquilinos. `verify:tenant-scope` cubre el caso
`.find()` desnudo, no un `where` con el filtro equivocado.

---

### M-1 · SSRF en el sandbox: la comprobación de destino se hace sobre una resolución distinta de la que se usa, y la lista de rangos privados está incompleta

- **Categoría:** otro (SSRF)
- **Severidad:** **MEDIA**
- **Ubicación:** `apps/backend/api/src/app/extensions/services/sandbox.service.ts:278-320`

**Qué está mal.** Dos defectos independientes en el mismo bloque.

*Tiempo de comprobación ≠ tiempo de uso.* Se hace `dns.lookup(hostname)` para validar la dirección y
después se llama `https.get(url)`, que **vuelve a resolver** el nombre por su cuenta. Entre las dos
resoluciones el DNS puede devolver otra cosa: es el ataque clásico de *DNS rebinding*, y con un TTL
de cero segundos no requiere más que paciencia.

*La lista de rangos privados no cubre lo que más importa:*

```ts
address.startsWith('127.')  || address.startsWith('10.') ||
address.startsWith('192.168.') || address.startsWith('172.16.')
```

- **Falta `169.254.0.0/16`** — el servicio de metadatos de AWS, GCP y Azure vive en
  `169.254.169.254` y entrega credenciales de instancia. Es el destino más valioso de todo SSRF en
  la nube y es el que no está.
- **`172.16.` cubre una de las dieciséis /16 del rango `172.16.0.0/12`.** Falta de `172.17.` a
  `172.31.`, y `172.17.0.0/16` es la red puente por defecto de Docker.
- Faltan `100.64.0.0/10` (CGNAT), `0.0.0.0`, y el bucle IPv6 (`family: 4` lo mitiga en la
  comprobación, pero `https.get` no está restringido a IPv4).
- La coincidencia es textual sobre la representación decimal, así que no cubre formas alternativas.

La lista de egreso limita el daño —el nombre debe estar en `PLUGIN_EGRESS_ALLOWLIST`— pero la
coincidencia es por sufijo (`hostname.endsWith('.' + allowed)`, línea 272), de modo que todo
subdominio de un host permitido vale, y el atacante de C-1/C-3 es quien elige el código.

**Cómo se vería la forma correcta.** Resolver una vez, validar **todas** las direcciones devueltas
contra una lista blanca de rangos públicos (no una lista negra de privados), y conectar **a la IP
validada** fijando la cabecera `Host` y el SNI, de modo que no haya segunda resolución. Bloquear
redirecciones o revalidar cada salto. Mejor aún: sacar el egreso del proceso y ponerlo en un proxy
de salida con su propia política de red.

**Cómo se explotaría.** Con capacidad `egress:http` concedida y control del DNS de un subdominio de
un host permitido: el plugin llama `fetch('https://x.api.taxjar.com/…')`; la primera resolución
devuelve una IP pública y pasa la comprobación; la segunda, la que usa `https.get`, devuelve
`169.254.169.254`; la respuesta del servicio de metadatos vuelve al plugin como cuerpo de la
respuesta.

---

### M-2 · `NODE_ENV=test` desactiva la verificación de firma del sandbox y el control de SSRF

- **Categoría:** manejo de secretos / otro
- **Severidad:** **MEDIA**
- **Ubicación:** `apps/backend/api/src/app/extensions/services/sandbox.service.ts:323` y `:278, 294`

```ts
if (process.env['NODE_ENV'] === 'test' && signature === 'valid-signature') return true;
```

**Qué está mal.** Una cadena literal en el repositorio sustituye a una firma RSA. Es la misma clase
de puerta que A-3 —comportamiento de prueba gobernado por `NODE_ENV`— y aquí lo que se salta es el
control que decide si se ejecuta código no confiable. El mismo valor de entorno desactiva además el
control SSRF (`:278`) y sustituye la petición real por una cadena (`:294`).

`isDevLikeEnvironment()` incluye `'test'` en su lista blanca, así que el resto del sistema trata ese
entorno como de desarrollo y es coherente; lo que no es coherente es que la puerta esté escrita a
mano, en otro sitio y con otra forma, en el archivo que verifica firmas.

**Cómo se vería la forma correcta.** La prueba inyecta un `SigningKeyProvider` doble y firma de
verdad con una clave efímera. El código de producción no contiene ninguna rama de prueba. Si hace
falta una bandera, que sea un `ALLOW_UNSIGNED_PLUGINS` explícito, validado por el esquema de
entorno y prohibido fuera de `isDevLikeEnvironment()`.

**Cómo se explotaría.** Requiere que el proceso corra con `NODE_ENV=test`, lo que no es un despliegue
normal. El riesgo real es de cadena: un runner de CI o un contenedor de pruebas con acceso de red al
que llega tráfico, o un futuro `NODE_ENV=test` en un preproducción.

---

### M-3 · La capacidad `api:read` de una extensión equivale a toda la API que el usuario puede leer

- **Categoría:** autorización
- **Severidad:** **MEDIA**
- **Ubicación:** `apps/core/client-web/src/app/features/extensions/extension-host.component.ts:127-148`

**Qué está mal.** El aislamiento del iframe está bien hecho: `sandbox="allow-scripts"` sin
`allow-same-origin`, código entregado por `postMessage`, y el padre solo acepta mensajes de
`event.source === this.iframe.contentWindow`. El problema no es el aislamiento sino la granularidad
de lo que se concede a través de él.

`handleApiRequest` valida tres cosas —que la capacidad `api:read` esté concedida, que el método sea
`GET`, y que la ruta empiece por `/` y no contenga `..`— y después hace la petición **con la sesión
del usuario que tiene la pantalla abierta**. No hay lista blanca de rutas. Una extensión a la que se
concedió `api:read` para pintar un mapa de calor de ventas puede pedir `/payroll/runs`,
`/users`, `/audit`, `/treasury/...`: todo lo que esa persona pueda leer. Si quien tiene la
extensión abierta es un administrador con `'*'`, es todo el ERP del inquilino.

La pantalla de consentimiento muestra `grantedCapabilities` (cadenas como `api:read`), así que lo que
el cliente aprueba no describe lo que concede.

**Cómo se vería la forma correcta.** Capacidades con ámbito: `api:read:sales`, `api:read:inventory`,
resueltas contra una lista blanca de prefijos de ruta declarada por la extensión en su manifiesto y
mostrada literalmente en la pantalla de consentimiento. El puente rechaza toda ruta fuera de los
prefijos concedidos.

**Cómo se explotaría.** Combinado con C-1: el atacante sustituye el `uiEntry` de una extensión que
ya tiene `api:read` concedida en otros inquilinos; su JS corre en el navegador del administrador de
esos inquilinos, recorre `/users`, `/payroll/runs` y `/audit`, y saca los datos por `fetch` a un
host propio (el iframe es de origen opaco, pero puede emitir peticiones salientes).

---

### M-4 · El WebSocket no consulta la lista de revocación de sesiones

- **Categoría:** gestión de sesión o token
- **Severidad:** **MEDIA**
- **Ubicación:** `apps/backend/api/src/app/websockets/events.gateway.ts:53-90`; contrastar con
  `apps/backend/api/src/app/auth/services/user-identity.service.ts:89-94`

**Qué está mal.** `SessionRegistryService` existe porque `tokenVersion` es un contador **por usuario**
y cerrar una sesión concreta no debe matar las demás; su propio comentario
(`session-registry.service.ts:17-27`) explica que sin la lista de revocación *«la interfaz prometía
un control que no existía»*. El camino HTTP la consulta en la primera línea de
`resolveFromPayload`. El gateway de WebSocket no: comprueba firma, `tokenVersion` y estado del
usuario, y nunca pregunta si la sesión fue revocada.

Cerrar sesión (`terminateCurrentSession`) y revocar un dispositivo (`revokeSession`) **no** suben
`tokenVersion` —por diseño, para no tumbar las demás sesiones—, así que su único efecto sobre un
token de acceso ya emitido es la lista de revocación. El socket, por tanto, sobrevive a ambas
acciones hasta la expiración natural del token (hasta 15 minutos), recibiendo los eventos de la sala
`org:<id>` del inquilino.

**Cómo se vería la forma correcta.** `if (await this.sessionRegistry.isRevoked(payload.sessionId)) { disconnect }`
en el handshake, y una comprobación periódica o una desconexión activa de los sockets de una sesión
cuando se revoca. `SessionService.verifyUserFromToken` ya hace la comprobación correcta
(`session.service.ts:555-557`); el gateway tiene su propia copia de la lógica, y es la copia que
diverge — el mismo patrón que `UserIdentityService` se creó para eliminar.

**Cómo se explotaría.** Un token de acceso capturado (por ejemplo en un equipo compartido). La
víctima ve la sesión en «Sesiones activas» y pulsa «cerrar»; la interfaz confirma. El atacante abre
un WebSocket con la cookie capturada y sigue recibiendo los eventos del inquilino hasta que el token
expira por sí solo.

**Nota menor del mismo archivo (BAJA):** el gateway acepta la cookie sin prefijo `access_token`
también en producción (`events.gateway.ts:45`), mientras `JwtStrategy` restringe ese nombre a
entornos de desarrollo (`jwt.strategy.ts:34-38`). La firma sigue siendo obligatoria, así que no es
explotable por sí solo, pero es una diferencia de contrato entre dos validadores del mismo token.

---

### M-5 · La cobertura de step-up no llega a mover dinero ni a ver datos de nómina

- **Categoría:** autenticación
- **Severidad:** **MEDIA**
- **Ubicación:** `apps/backend/api/src/app/payroll/payroll.controller.ts:99-106`
  (`runs/:id/approve`, `runs/:id/pay`), `:141-148` (`runs/:id/payslips`);
  `apps/backend/api/src/app/auth/sso-admin.controller.ts` (todo el controlador);
  `apps/backend/api/src/app/extensions/extensions.controller.ts` (todo el controlador);
  inventario de scopes en `apps/backend/api/src/app/auth/enums/step-up-scope.enum.ts`

**Qué está mal.** El mecanismo de step-up es sólido: alcance firmado, cookie `HttpOnly`, consumo
atómico del `jti` para los alcances irreversibles, comprobación de propiedad antes de quemar el
token. Está aplicado en 25 rutas: administración de usuarios, 2FA, contraseña, correo, pagos de
suscripción, roles, impersonación, revocación de sesiones.

Lo que no cubre, medido contra el criterio que el propio enum declara —«irreversible, o concede
acceso a datos que el operador no tiene de otro modo»—:
- **Aprobar y pagar una nómina.** Mueve dinero e implica datos salariales de todo el personal.
- **Leer las nóminas individuales** (`runs/:id/payslips`), que es el ejemplo canónico de dato
  sensible.
- **Configurar el IdP de SSO**, que como muestra A-1 es una ruta de escalada.
- **Publicar o revocar extensiones**, que como muestra C-1 es ejecución de código.

**Cómo se vería la forma correcta.** Nuevos alcances `APPROVE_PAYROLL`, `VIEW_PAYROLL_DATA`,
`MANAGE_SSO` y `PUBLISH_EXTENSION`; los tres primeros reutilizables dentro de la vida del token, el
último de un solo uso. Y, para pagos, un umbral por importe, que es el criterio que la gente
realmente usa para decidir cuándo vale la pena reconfirmar.

---

### M-6 · Restablecer la contraseña olvidada limpia menos que cambiarla estando dentro

- **Categoría:** gestión de sesión o token / inconsistencia entre implementaciones
- **Severidad:** **MEDIA**
- **Ubicación:** `apps/backend/api/src/app/auth/services/password-recovery.service.ts:84-89`;
  contrastar con `apps/backend/api/src/app/auth/auth.service.ts:399-406`

**Qué está mal.** Las dos rutas que cambian una contraseña hacen cosas distintas:

| | `changePassword` (con la contraseña actual) | `resetPassword` (token por correo) |
|---|---|---|
| sube `tokenVersion` | sí | sí |
| marca `refresh_tokens.is_revoked` | sí, vía `terminateAllSessions` | **no** |
| escribe la lista de revocación de sesiones | sí | **no** |
| limpia la caché del usuario | sí | sí |

El efecto criptográfico es parecido, porque `tokenVersion` se comprueba tanto en el acceso
(`user-identity.service.ts:103`) como en el refresco (`session.service.ts:105-112`). Pero las
consecuencias observables divergen: las filas quedan con `isRevoked = false` y
`expiresAt` futuro, así que `getUserSessions` **sigue listando como vivas** sesiones que ya no lo
son (`session.service.ts:404-408`). Y es justo al revés de como debería estar: el restablecimiento
por correo es el camino que se usa **después de una sospecha de compromiso**, y es el que hace menos.

**Cómo se vería la forma correcta.** `resetPassword` llama a `sessionService.terminateAllSessions(user.id)`,
igual que `changePassword`. NIST SP 800-63B §7.1 —que el comentario de `changePassword` ya cita— no
distingue entre las dos formas de cambiar una contraseña.

**Cómo se explotaría.** Tras un restablecimiento hecho precisamente porque se sospecha una intrusión,
la víctima abre «Sesiones activas» para comprobar que no queda nadie y ve sesiones que el sistema
presenta como vivas, sin forma de distinguir las suyas de las del atacante. El control informativo
en el que se apoya la respuesta al incidente dice algo falso.

---

### B-1 · El respaldo a base de datos de la lista de revocación consulta por la columna equivocada

- **Categoría:** gestión de sesión o token
- **Severidad:** **BAJA** (falla en el sentido seguro; se reporta porque la «fuente de verdad» es incorrecta)
- **Ubicación:** `apps/backend/api/src/app/auth/services/session-registry.service.ts:102-114`

**Qué está mal.** Cuando Redis no responde, `isRevokedInDatabase(sessionId)` busca
`findOne({ where: { id: sessionId } })`. Pero `sessionId` es el identificador de **familia**, que
por construcción coincide con el `id` de la **primera** fila de la familia
(`token.service.ts:283-284`). En cuanto esa sesión rota una vez —cada quince minutos— la fila
original queda con `isRevoked = true` (`session.service.ts:172-175`). Así que la consulta encuentra
una fila revocada y devuelve `true` para **toda sesión que haya rotado al menos una vez**, es decir,
para todas.

El efecto es una desconexión general durante una caída de Redis, no un agujero. Se reporta por dos
razones: el camino de respaldo nunca hace lo que su comentario dice que hace («la fuente de verdad»),
y una corrección apresurada bajo la presión de una caída es exactamente la circunstancia en que se
elige la dirección insegura.

**Cómo se vería la forma correcta.** Consultar por la familia y decidir sobre ella:

```ts
const rows = await this.refreshTokenRepository.find({ where: { sessionId }, select: ['isRevoked', 'expiresAt'] });
if (!rows.length) return true;                       // purgada o inexistente: cerrar
return rows.every((r) => r.isRevoked || r.expiresAt.getTime() < Date.now());
```

---

### B-2 · Comparación no constante en el gate de Swagger

- **Categoría:** autenticación
- **Severidad:** **BAJA**
- **Ubicación:** `apps/backend/api/src/main.ts:192`

`if (user !== swaggerUser || pass !== swaggerPassword)` compara cadenas con cortocircuito. Junto con
A-3 (Swagger activo en cualquier entorno que no sea exactamente `production`), el conjunto merece
`crypto.timingSafeEqual` sobre buffers de longitud igualada. El ataque es poco práctico sobre la red,
pero la corrección cuesta tres líneas y el resto del código ya usa `timingSafeEqual` donde
corresponde (`session.service.ts:374`).

---

### B-3 · Las filas de refresh sin hash se aceptan indefinidamente

- **Categoría:** gestión de sesión o token
- **Severidad:** **BAJA**
- **Ubicación:** `apps/backend/api/src/app/auth/services/session.service.ts:366-368`

```ts
// Rows issued before hashing existed have no hash; accept them rather than logging out
// every user at deploy time. Every token issued from now on carries one.
if (!row?.tokenHash) return;
```

La compatibilidad hacia atrás es razonable y la ventana es acotada por naturaleza —la vida máxima de
un refresh es 30 días—, pero la excepción no tiene fecha de caducidad en el código. Si una futura
ruta de escritura olvidara rellenar `tokenHash`, la comprobación quedaría desactivada para esas filas
sin que nada lo señale. La forma correcta es una fecha de corte: rechazar la fila sin hash cuando su
`createdAt` sea posterior al despliegue que introdujo el hashing.

---

### B-4 · `resetPassword` llama a `argon2.verify` directamente

- **Categoría:** autenticación
- **Severidad:** **BAJA**
- **Ubicación:** `apps/backend/api/src/app/auth/services/password-recovery.service.ts:74`

`PasswordService.verify` existe precisamente porque `argon2.verify` **lanza** ante un hash mal
formado en vez de devolver `false`, y su comentario explica que dejarlo sin capturar convertía un
problema de datos en un 500 (`password.service.ts:12-31`). El archivo ya usa `passwordService` para
hashear dos líneas más abajo, con un comentario sobre la misma clase de error. Esta llamada quedó sin
convertir.

---

## Scorecard

No se promedia. Un producto puede tener una autenticación excelente y una frontera de privilegio mal
puesta al mismo tiempo, y fundir las dos notas en una borra exactamente la información útil.

| Eje | Nota | Justificación |
|---|---|---|
| **Autenticación** | **9 / 10** | Argon2id con parámetros aplicados de verdad y rehash en el login; comparación con hash señuelo para igualar tiempos; error genérico y orden de comprobaciones que verifica la contraseña *antes* de mirar el estado de la cuenta; cribado contra HIBP con k-anonimato; bloqueo por intentos, límite por IP y reCAPTCHA; 2FA con sesión pendiente en servidor, atada a IP y user-agent, con contador de intentos que sí funciona; WebAuthn; SSO empresarial con dominio verificado por DNS. Descuentan A-3 (admin sembrado con credencial conocida fuera de `production`) y M-5 (step-up sin cubrir nómina ni pagos). |
| **Autorización** | **4 / 10** | El núcleo es de los mejores que se ven: `PermissionsGuard` global con **denegación por defecto**, exención explícita y razonada vía `@AuthenticatedOnly(reason)`, políticas ABAC evaluadas incluso para comodines, permisos resueltos por inquilino activo, y el control «nadie delega lo que no tiene» en las asignaciones de rol. La nota la hunden tres cosas concretas, no una impresión: el catálogo de extensiones es un recurso de plataforma administrado con un permiso de inquilino (C-1, C-2, C-3), y el rol por defecto de SSO escapa al control de delegación por dos caminos distintos (A-1, A-2). El módulo de extensiones vive fuera del modelo que el resto aplica. |
| **Gestión de sesión / token** | **8 / 10** | Acceso RS256 con `kid` y anillo de claves rotable; refresh HS256 con secreto propio, `jti`, hash del token en la fila, familia de sesión estable, reclamación atómica de la rotación, detección de reuso por `replacedByToken` (no por tiempo) con invalidación de toda la familia, ventana de gracia para concurrencia según RFC 9700, y binding de dispositivo. Revocación real: lista de denegación consultada en cada petición + `tokenVersion`, sin fallo abierto ante caída de Redis. Cookies `HttpOnly` + `Secure` + `SameSite=Lax` + `__Host-`/`__Secure-`, token nunca en el cuerpo de la respuesta. Descuentan M-4 (el WebSocket no consulta la revocación), M-6 (el restablecimiento limpia menos que el cambio) y B-1. |
| **Manejo de secretos** | **6 / 10** | Ningún secreto real comiteado; `requireSecret` con lista blanca de entornos, longitud mínima y patrones de marcador de posición; claves RSA obligatorias fuera de desarrollo con auto-verificación del par; claves de firma del marketplace obligatorias en producción; secretos de IdP cifrados en reposo; IP enmascarada para mostrar y cifrada para forense. Descuentan A-3 (`dev12345` como credencial de administrador alcanzable con `NODE_ENV=staging`, además impresa en el log) y M-2 (`'valid-signature'` como firma válida bajo `NODE_ENV=test`). |
| **Consistencia entre implementaciones** | **5 / 10** | La dirección del proyecto es la correcta y está documentada: un `UserIdentityService` que existe para que no haya dos resoluciones de identidad; guards globales porque «un control que hay que recordar es un control que falta»; una lista blanca de entornos declarada como regla. Pero esa regla no está aplicada de forma pareja, y **el nivel de seguridad real del sistema es el de su implementación más débil**: la lista blanca de entornos no gobierna el sembrador (A-3) ni el sandbox (M-2); el control de delegación de roles no gobierna el SSO (A-1); la decisión por permisos y no por nombre de rol se corrigió en impersonación y no en SSO (A-2); la lista de revocación se consulta en HTTP y no en WebSocket (M-4); la terminación de sesiones ocurre al cambiar la contraseña y no al restablecerla (M-6). Cinco reglas correctas, cada una con al menos un sitio donde no llegó. |

---

## Mapa: dónde vive la lógica de autenticación y autorización

**Centralizada, y bien centralizada.** Salvo el módulo de extensiones, no hay autorización
reimplementada por endpoint.

### Cadena de guards globales (`apps/backend/api/src/app/app.module.ts:343-400`)

El orden es significativo y está fijado por pruebas (`active-tenant.guard.spec.ts`,
`global-guards.spec.ts`):

```
ThrottlerGuard            → límite por IP
JwtAuthGuard              → identidad;      exención: @Public()
CsrfGuard                 → doble envío firmado + Fetch Metadata;  exención: @SkipCsrf()
ActiveTenantGuard         → resuelve y AUTORIZA la empresa activa de la petición
PermissionsGuard          → autorización;   exención: @AuthenticatedOnly(motivo)
SubscriptionActiveGuard   → derecho de uso; exención: @AllowInactiveSubscription()
```

Los tres primeros son «denegar salvo exención declarada». Ese es el patrón que hace que la nota de
autorización del núcleo sea alta a pesar de los hallazgos.

### Autenticación

| Archivo | Papel |
|---|---|
| `auth/auth.service.ts` | Login, 2FA pendiente, cambio de contraseña, emisión de step-up |
| `auth/services/user-identity.service.ts` | **Única** conversión de payload JWT a principal. Un `AUTHENTICABLE_STATUSES` como lista blanca |
| `auth/strategies/jwt.strategy/jwt.strategy.ts` | Extracción solo por cookie; RS256 con `kid`; sin `Authorization: Bearer` |
| `auth/services/token.service.ts` | Emisión del par acceso/refresh; construcción del payload y del principal, ya acotados por inquilino |
| `auth/services/password.service.ts` | Argon2id, hash señuelo, `needsRehash`, cribado HIBP |
| `auth/services/key-management.service.ts` | Anillo de claves RS256: una firma, N verifican; JWKS |
| `auth/services/cookie.service.ts` | Prefijos `__Host-`/`__Secure-`, flags, token CSRF firmado y atado al principal |
| `auth/auth.config.ts` | Lista blanca de entornos y validación de secretos — **la regla del proyecto** |

### Sesiones

| Archivo | Papel |
|---|---|
| `auth/services/session.service.ts` | Rotación, detección de reuso, terminación individual / otras / todas, limpieza |
| `auth/services/session-registry.service.ts` | Lista de denegación de sesiones; respaldo a base de datos |
| `auth/entities/refresh-token.entity.ts` | Fila de sesión: `sessionId` (familia), `tokenHash`, `replacedByToken` |

### Autorización

| Archivo | Papel |
|---|---|
| `security/guards/permissions.guard.ts` | Guard global, denegación por defecto, permisos y políticas ABAC |
| `security/decorators/*` | `@HasPermission`, `@AuthenticatedOnly`, `@Public`, `@CurrentUser` |
| `shared/permissions.ts` + `*/`*.permissions.ts` | Catálogo compuesto por módulo |
| `libs/shared/util-auth/src/lib/permissions.util.ts` | `hasPermission` — **compartido con el frontend**, una sola semántica de comodines |
| `roles/roles.service.ts` | `assertCanAssignRole` / `assertAssignablePermissions` — el control de delegación |
| `auth/policies/is-organization-owner.policy.ts` | Política ABAC de propiedad |
| `auth/guards/step-up.guard.ts` + `enums/step-up-scope.enum.ts` | Reautenticación por alcance, un solo uso donde es irreversible |

### Aislamiento entre inquilinos

| Archivo | Papel |
|---|---|
| `shared/tenancy/active-tenant.guard.ts` | Resuelve `x-virtex-organization` y **recalcula el principal completo** para esa empresa |
| `shared/tenancy/tenant-context.ts` | `AsyncLocalStorage` con la empresa y el manager fijado a su conexión |
| `shared/tenancy/tenant-connection.interceptor.ts` | Fija `app.current_organization` en la conexión y la libera con `RESET` |
| `shared/tenancy/tenant-repository.patch.ts` | Encamina los 91 repositorios y las 96 transacciones por esa conexión |
| `database/migrations/1789002100000-TenantRowLevelSecurity.ts` | 118 políticas `USING` + `WITH CHECK` y el rol `virtex_app` |
| `shared/tenancy/tenant-isolation.check.ts` | Dice al arrancar si rigen — **solo lo dice** (A-4) |
| `tools/verify/{rls-runtime,rls-isolation,cross-tenant-membership,tenant-scope-guard}` | Verificación contra base real y guard estático en CI |

### Clientes

| App | Postura |
|---|---|
| `apps/core/client-web` | Cookies de sesión; `hasPermission` compartido con el backend, usado para **mostrar**, no para autorizar |
| `apps/pos` | **Mismo** backend, mismas cookies, mismo CSRF, mismos permisos (`POS_VIEW` / `POS_OPERATE`), servicio con inquilino tomado del principal. No es una versión debilitada; es el mismo control |
| `apps/desktop` | Electron con `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload de superficie mínima y guard de navegación |

Sobre el invariante «nada de autorización solo en el frontend»: se cumple. La prueba no es que los
guards del cliente existan, sino que el backend **deniega por defecto** a cualquier ruta que no
declare nada, y que `route-authorisation.spec.ts` y `permissions-enforced.spec.ts` lo fijan. El
cliente oculta; el servidor decide.

---

## Módulos a revisar con más profundidad si el patrón se repite

Formulado como **hipótesis a verificar**, no como afirmación: lo que sigue no se auditó en
profundidad, y se enumera porque comparte mecanismo con algo que aquí sí falló.

**1. Todo recurso de plataforma administrado con un permiso de inquilino** *(patrón de C-1)*

La pregunta a hacerle a cada tabla sin `organization_id`: ¿quién puede escribirla, y con qué
permiso? Candidatos por su naturaleza global —`saas_plans`, `currency`, `exchange_rate`,
`fiscal_regions`, `coa_templates`, `tax_templates`, `localization_templates`—, más los módulos que
los administran: `saas/`, `currencies/`, `localization/`, `jurisdictions/`, `chart-of-accounts/`
(plantillas). El catálogo de plantillas fiscales es el más preocupante: si un inquilino puede
editarlas, altera el cálculo de impuestos de los demás. **Verificar:** que cada ruta de escritura
sobre esas tablas exija un permiso de plataforma, no uno satisfecho por `'*'` de inquilino.
*(`seed-plans.ts` y `saas/` son el primer sitio donde mirar.)*

**2. Las veinte tablas excluidas del aislamiento por filas** *(patrón de A-4)*

`users`, `roles`, `audit_logs`, `warehouses`, `employees`, `projects` y el resto con
`organization_id` nulable dependen enteramente del `where` de cada servicio. `verify:tenant-scope`
detecta el `.find()` desnudo, pero no un filtro presente y equivocado. **Verificar:** `hcm/`,
`payroll/`, `projects/`, `inventory/` (almacenes) y `audit/`, leyendo cada consulta sobre esas
entidades. Prioridad alta en `hcm/` y `payroll/` por la naturaleza de los datos.

**3. Los otros sitios donde se decide algo por el nombre de un rol** *(patrón de A-2)*

Ya hay dos ocurrencias conocidas del antipatrón: una corregida (`ImpersonationService`) y una viva
(`EnterpriseSsoService.resolveDefaultRole`). `IsOrganizationOwner` compara con
`RoleEnum.ADMINISTRATOR` por nombre (`is-organization-owner.policy.ts:79`); ahí puede ser correcto,
porque es un rol de sistema, pero conviene confirmar que un inquilino no puede renombrarlo ni crear
otro con ese nombre. **Verificar:** `grep -rn "\.name ===\|/admin/i\|RoleEnum\." apps/backend`.

**4. Los otros consumidores de tokens fuera del pipeline HTTP** *(patrón de M-4)*

El gateway de WebSocket resultó tener su propia validación, y esa copia diverge. **Verificar:** todo
lo que valide un token sin pasar por `JwtAuthGuard` — `queues/`, `shared/scheduler/`,
`shared/jobs/`, `notifications/`, `push-notifications/`, `mail/` (webhooks entrantes), `storage/`
(URLs firmadas). La pregunta concreta para cada uno: ¿consulta `SessionRegistryService.isRevoked`?

**5. Los otros caminos que gobiernan comportamiento por `NODE_ENV`** *(patrón de A-3 y M-2)*

Hay al menos cinco formas distintas en el repositorio: `isDevLikeEnvironment()` (correcta),
`!== 'production'` (sembrador, Swagger), `=== 'production'` (admisión de plugins, `TokenService`),
`=== 'test'` (sandbox) y `?? 'development'` (varios). **Verificar:**
`grep -rn "NODE_ENV" apps/backend/api/src --include=*.ts`, y unificar todo lo que decida sobre un
control de seguridad bajo la lista blanca que el propio proyecto declaró como regla.

**6. Los otros sitios donde se asigna un rol o se conceden permisos** *(patrón de A-1)*

`assertCanAssignRole` cubre `updateUser` e `inviteUser`; el comentario afirmaba que eran los únicos
dos y el `defaultRoleId` de SSO demostró que no. **Verificar:** toda escritura sobre `user.roles`,
`role.permissions` y cualquier columna que nombre un rol —incluidas las de aprovisionamiento
(`registration.service.ts`), las de consolidación/intercompañía si crean usuarios, y las semillas—,
comprobando que cada una pasa por el control de delegación.

**7. La superficie de egreso y de SSRF fuera del sandbox** *(patrón de M-1)*

La lista incompleta de rangos privados suele estar copiada en más de un sitio. **Verificar:**
`mail/` (webhooks y plantillas remotas), `storage/` (si acepta URLs), `einvoicing/` (integraciones
con DIAN, SEFAZ, DGII), `geo/`, y cualquier `axios`/`fetch`/`https.get` con host que venga de datos.
`grep -rn "169.254\|dns.lookup\|new URL(" apps/backend/api/src` es el punto de partida.

---

## Resumen ejecutivo

La autenticación, la gestión de sesión y el aislamiento entre inquilinos del núcleo están
construidos con un nivel de cuidado poco común: guards globales que deniegan por defecto,
denegación de reuso de refresh por causa y no por tiempo, permisos resueltos por inquilino activo,
políticas de fila en la base de datos, y una utilidad de permisos compartida entre frontend y
backend para que no puedan contradecirse. Nada de eso es fachada; se sostiene al leerlo.

El riesgo no está ahí. Está en **un módulo que quedó fuera de ese modelo** —extensiones, donde un
recurso compartido por toda la plataforma se administra con un permiso de inquilino que el rol
administrador de cualquier cliente satisface— y en **cinco reglas correctas que no llegaron a todos
sus sitios**. La observación que el propio repositorio repite —«un control que hay que recordar es
un control que falta»— aplica una vez más, y esta vez a las propias correcciones: se aplicaron donde
se encontró el fallo, no allí donde el mismo mecanismo se usa.

El orden de trabajo que propondría: **C-1 primero** (aísla el catálogo de extensiones o desactiva
las rutas de escritura hasta que exista un rol de plataforma), **A-3 inmediatamente después**
(es un cambio de una línea y cierra una credencial conocida en preproducción), luego **A-1 y A-2**
(el control de delegación ya existe; solo hay que llamarlo), y **A-4** como trabajo de plataforma
—`FORCE ROW LEVEL SECURITY` y abortar el arranque cuando las políticas no rigen— que convierte el
aislamiento de «configurado correctamente» en «imposible de configurar mal».
