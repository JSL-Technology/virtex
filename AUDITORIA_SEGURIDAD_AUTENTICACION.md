# Auditoría de seguridad — autenticación y autorización

Alcance: `apps/backend/api` (NestJS/Fastify/TypeORM/PostgreSQL), `apps/core/client-web`,
`apps/pos`, `libs/shared/util-auth`, `tools/verify/*`, migraciones y CI.
Fecha: 2026-09-21. Revisión sobre `claude/security-auth-audit-6k564x`.

---

## Paso 0 — El estándar contra el que se juzga

Antes de mirar el código, así luce la implementación de referencia para un SaaS multi-inquilino
que guarda contabilidad, nómina y tesorería:

1. **Un solo mecanismo de autenticación.** Una ruta de extracción del token, una de verificación
   de firma, una de resolución del principal. Nada de un validador para HTTP y otro para
   WebSocket.
2. **Autorización por defecto denegada,** aplicada por un guard global. Una ruta sin permiso
   declarado se rechaza; la exención es explícita y motivada, no la ausencia de un decorador.
3. **Contraseñas** con un KDF con factor de coste (argon2id/bcrypt/scrypt), respuesta de login
   genérica e indistinguible entre "no existe", "contraseña mala" y "cuenta bloqueada", y coste
   de tiempo igualado en todos esos caminos.
4. **Límite de intentos en dos dimensiones:** por cuenta (bloqueo) y por origen (rate limit
   distribuido, no por proceso).
5. **Sesiones:** access token corto, refresh rotatorio con detección de reuso, invalidación real
   del lado servidor en logout, cambio de contraseña y cambio de permisos; cota absoluta y cota
   por inactividad. Cookies `HttpOnly`, `Secure`, `SameSite`, prefijo `__Host-`/`__Secure-`.
6. **Autorización siempre en el backend.** El frontend oculta botones; no decide nada.
7. **Aislamiento entre inquilinos impuesto por la base de datos** (RLS con `FORCE`, rol sin
   `BYPASSRLS` y que no posee las tablas), con el filtro de aplicación como segunda capa, no como
   la única.
8. **Re-autenticación (step-up)** para acciones sensibles e irreversibles, con token de un solo
   uso en las que conceden acceso.
9. **Secretos** solo desde el entorno, con fallo duro fuera de desarrollo, y los comportamientos
   de desarrollo bloqueados por una *lista blanca* de entornos, nunca por `!== 'production'`.

**Veredicto general sobre el estándar:** este proyecto lo cumple en una proporción inusualmente
alta. Los controles están centralizados (`app.module.ts:343-417` registra seis `APP_GUARD`), la
mayoría tienen una prueba de CI que impide que se degraden (`npm run verify:security`,
`verify:rls`, `verify:rls-runtime`), y varias decisiones difíciles están tomadas en la dirección
correcta (cookie-only para el access token, RS256 con anillo de claves, RLS real con `FORCE`).
Los hallazgos de abajo son, en su mayoría, los bordes donde un control centralizado todavía no
llega — y eso es precisamente donde hay que mirar en una base así.

---

## Hallazgos

### A-1 · El bloqueo por intentos fallidos es un oráculo de contraseña

- **Categoría:** autenticación
- **Severidad:** **ALTA**
- **Ubicación:** `apps/backend/api/src/app/auth/auth.service.ts:99-132`, con
  `apps/backend/api/src/app/auth/exceptions/auth.exception.ts:11-25` y
  `apps/backend/api/src/app/auth/services/security-analysis.service.ts:214-248`

**Qué está mal.** El orden es: se calcula `isLockedOut` (línea 99), se verifica la contraseña
(103-109), y solo *después* se mira el bloqueo (124). Las dos salidas son distinguibles por el
cliente:

| Entrada | Respuesta |
|---|---|
| contraseña incorrecta, cuenta bloqueada | 401 `AUTH_INVALID_CREDENTIALS`, **tras `simulateDelay()`** (500 ms, línea 119) |
| contraseña **correcta**, cuenta bloqueada | 401 `AUTH_USER_BLOCKED` + `meta.lockoutUntil`, **sin retardo** (línea 129-131) |

`AuthException` serializa `message` y `meta` en el cuerpo (`auth.exception.ts:17-22`), así que la
diferencia no es sutil: es un campo distinto y un tiempo de respuesta distinto.

El comentario de las líneas 84-98 razona correctamente sobre la enumeración de cuentas y verifica
la contraseña primero por ese motivo. El efecto secundario no está contemplado: **el bloqueo deja
de ser un control contra la adivinación en línea**. El atacante sigue probando durante el bloqueo,
y el propio bloqueo le dice cuándo acertó.

Agrava el problema que `handleFailedLoginAttempt` (línea 113) se ejecuta también estando bloqueado
y renueva `lockout_until` en cada fallo (`security-analysis.service.ts:220-232`), mientras que el
acierto no lo renueva: la cuenta queda desbloqueada justo cuando el atacante ya tiene la
contraseña.

**Cómo se explotaría.**
1. `POST /api/v1/auth/login` con la víctima y 5 contraseñas basura → cuenta bloqueada 15 min.
2. Seguir enviando candidatas. El rate limit es 5/60 s **por IP**
   (`auth.controller.ts:79-81`, `AuthConfig.THROTTLE_LIMIT=5`), así que se escala rotando IPs; el
   bloqueo de cuenta —que es el control que debería cortar esto— ya no corta nada.
3. Parar en cuanto una respuesta traiga `AUTH_USER_BLOCKED` en lugar de
   `AUTH_INVALID_CREDENTIALS`. Esa es la contraseña.
4. Esperar a `meta.lockoutUntil` sin enviar nada (para no renovar el bloqueo) e iniciar sesión.

**Cómo se ve la forma correcta.** Que la cuenta esté bloqueada no puede cambiar la respuesta. Dos
opciones, ambas válidas:

- Verificar la contraseña igualmente (para no reintroducir la enumeración por tiempo) pero
  **responder `AUTH_INVALID_CREDENTIALS` sin `meta`, y con el mismo `simulateDelay()`**, cuando
  `isLockedOut` sea cierto. El usuario legítimo bloqueado se entera por correo o por la pantalla
  de recuperación, no por el código de error.
- O bien mantener la respuesta diferenciada **solo tras un segundo factor**, que es lo que
  realmente prueba que quien pregunta es el dueño de la cuenta.

---

### A-2 · `POST /consolidation/mapping` acepta cualquier organización como "subsidiaria", sin comprobar la relación

- **Categoría:** autorización
- **Severidad:** **ALTA**
- **Ubicación:** `apps/backend/api/src/app/consolidation/consolidation-mapping.service.ts:25-43`,
  controlador en `consolidation-mapping.controller.ts:25-32`,
  DTO en `dto/create-consolidation-map.dto.ts:13-21`

**Qué está mal.** El `subsidiaryOrganizationId` viene **del cuerpo de la petición** y la única
validación que recibe es que la organización exista:

```ts
const parentOrg = await this.orgRepository.findOneBy({ id: parentOrganizationId });
const subOrg    = await this.orgRepository.findOneBy({ id: subsidiaryOrganizationId });
if (!parentOrg || !subOrg) throw new NotFoundError('consolidation.organization_not_found');
```

No se comprueba en ningún punto que `subsidiaryOrganizationId` sea realmente una subsidiaria del
inquilino que llama. El resto del módulo sí lo hace bien —`ConsolidationService.runConsolidation`
deriva el grupo de la relación `parentOrg.subsidiaries` cargada de la base
(`consolidation.service.ts:225-236`)— lo que hace de este el único punto del módulo donde la
pertenencia al grupo se toma del cliente.

Además, `consolidation_maps` no tiene columna `organization_id` (usa `parent_organization_id`,
`consolidation-map.entity.ts:33-42`), de modo que queda **fuera del barrido automático de RLS**,
que busca exactamente `organization_id NOT NULL`
(`migrations/1789002100000-TenantRowLevelSecurity.ts:137-146`). Sí está en la lista manual
`inherited`, atada a `accounts` vía `subsidiary_account_id` — una política que, por cómo está
escrita, deniega al padre leer su propio mapeo. Es decir: la capa que hoy contiene el daño lo
contiene por accidente, no por diseño.

**Cómo se explotaría.** Un administrador del inquilino A (`financials:consolidate`, que el `'*'`
del rol ADMINISTRADOR satisface) envía:

```http
POST /api/v1/consolidation/mapping
{ "subsidiaryOrganizationId": "<uuid del inquilino B>",
  "mappings": [{ "subsidiaryAccountId": "<uuid de cuenta de B>",
                 "parentAccountId": "<uuid de cuenta propia>" }] }
```

Se escriben filas que nombran al inquilino B. Después,
`GET /api/v1/consolidation/mapping/<uuid de B>` devuelve esas filas con
`relations: ['subsidiaryAccount', 'parentAccount']` hidratadas
(`consolidation-mapping.service.ts:19-23`), exponiendo nombre, código y tipo de las cuentas del
inquilino B. La explotación requiere conocer UUIDs de cuentas ajenas, lo que la hace costosa; la
ausencia del control, no.

**Cómo se ve la forma correcta.** `createOrUpdateMap` y `getMapForSubsidiary` deben resolver la
relación de grupo contra `organization_subsidiaries` antes de tocar nada, exactamente como hace
`runConsolidation`:

```ts
const isSubsidiary = await this.subsidiaryRepository.exist({
  where: { parentOrganizationId, subsidiaryOrganizationId },
});
if (!isSubsidiary) throw new NotFoundError('consolidation.organization_not_found');
```

Y `consolidation_maps` debería llevar una política de RLS anclada a `parent_organization_id`, que
es el inquilino al que la fila pertenece de verdad.

---

### A-3 · Un inquilino puede reconstruir —y romper— la vista analítica de todos los demás

- **Categoría:** autorización / aislamiento entre inquilinos
- **Severidad:** **ALTA**
- **Ubicación:** `apps/backend/api/src/app/analytical-reporting/analytical-reporting.service.ts:15-85`
  y `analytical-reporting.controller.ts:27-42`

**Qué está mal.** `analytical_report_data` es **una sola vista materializada para todo el
producto** (`VIEW_NAME` es una constante, línea 11). `synchronizeView(organizationId)` la
**destruye y la recrea** usando únicamente las dimensiones del inquilino que llama:

```ts
const dimensions = await this.dataSource.manager.find(Dimension, { where: { organizationId } });
...
await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS "${viewName}"`);
...
CREATE MATERIALIZED VIEW "analytical_report_data" AS ... ${dynamicDimensionColumns}
```

La ruta está detrás de `@HasPermission(PERMISSIONS.SYSTEM_MANAGE_VIEWS)` — un permiso **de
inquilino** (`config/config.permissions.ts:21`), que el `'*'` del rol ADMINISTRADOR de cualquier
cliente satisface. `refreshView()` (línea 30-34) tiene la misma forma con
`analytics:manage_views`.

Son tres problemas encadenados:

1. **Efecto cruzado entre inquilinos.** El administrador de A reconstruye la vista con las
   columnas de A. Las dimensiones de B (`cost_center`, `proyecto`, las que tenga) desaparecen, y
   todas las consultas analíticas de B que las agrupen fallan con `column ... does not exist`. Una
   acción de un cliente degrada el producto de otro.
2. **Una acción de alcance plataforma detrás de un permiso de inquilino.** Es exactamente el
   patrón que el propio proyecto ya identificó y corrigió en extensiones
   (`extensions.controller.ts:24-48`, donde publicar/revocar pasaron a
   `@RequiresPlatformPermission`). Aquí no se aplicó.
3. **Sin aislamiento de base de datos.** PostgreSQL no aplica RLS a vistas materializadas: la
   matview guarda sus propias filas. Todo el eje analítico —cada línea de asiento contabilizada de
   cada inquilino— está aislado **únicamente** por el `where('ard.organization_id = :organizationId')`
   de `query()` (línea 96). `verify:rls` no lo ve porque solo audita `table_type = 'BASE TABLE'`
   (`tools/verify/rls-isolation.ts:119-133`). Hoy el filtro está puesto y es correcto; pero es la
   única puerta, y el proyecto entero está construido sobre la premisa contraria.

**Cómo se explotaría.** Denegación de servicio cruzada, sin credenciales especiales:
`POST /api/v1/analytical-reporting/synchronize-view` desde cualquier inquilino → durante el
`DROP`/`CREATE` la vista no existe para nadie, y al terminar los demás inquilinos han perdido sus
columnas de dimensión.

**Cómo se ve la forma correcta.**

- `synchronize-view` y `refresh-view` pasan a `@RequiresPlatformPermission(...)` + `@StepUp(...)`,
  como publicar una extensión.
- Las columnas de dimensión se derivan de **todas** las dimensiones de la instalación, no de las de
  un inquilino; o la vista pasa a ser por inquilino.
- Como las vistas materializadas no admiten RLS, el acceso debe ir por una vista normal
  (`CREATE VIEW ... WITH (security_barrier)` sobre la matview con el predicado de
  `app.current_organization`) o, como mínimo, `verify:rls` debe enumerar las matviews con
  `organization_id` y exigir que ninguna se consulte sin filtro.

---

### A-4 · `POST /analytical-reporting/synchronize-view` tumba el proceso

- **Categoría:** otro (disponibilidad)
- **Severidad:** media
- **Ubicación:** `analytical-reporting.controller.ts:39-42` y `analytical-reporting.service.ts:78-84`

**Qué está mal.** El controlador **no espera** la promesa:

```ts
synchronizeView(@CurrentUser() user: AuthenticatedUser) {
  this.reportingService.synchronizeView(user.organizationId);   // sin await, sin .catch
  return { messageKey: '...' };
}
```

y el servicio, tras el rollback, **relanza** (`throw new BadRequestError(...)`, línea 82). No hay
manejador de `unhandledRejection` en ninguna parte del proyecto (comprobado sobre
`apps/backend/api/src`). Desde Node 15 el comportamiento por defecto ante una promesa rechazada sin
manejador es **terminar el proceso**.

**Cómo se explotaría.** Crear una dimensión cuyo nombre contenga un carácter fuera de
`[a-zA-Z0-9_ ]` (el DTO no lo restringe, ver A-9) y llamar a `synchronize-view`:
`sanitizeColumnName` lanza (línea 177-179) → `catch` → rollback → `throw` → rechazo no manejado →
caída del proceso. Repetible a voluntad por cualquier administrador de inquilino.

**Forma correcta.** `await` con manejo de error, o encolar el trabajo en BullMQ (el proyecto ya
tiene `queues/`) y devolver 202 con un id de trabajo. Y un `process.on('unhandledRejection')` que
registre en lugar de morir.

---

### A-5 · La suplantación decide con un campo que el principal nunca trae

- **Categoría:** inconsistencia entre implementaciones
- **Severidad:** media (hoy falla cerrado; alta si el tipo del principal cambia)
- **Ubicación:** `apps/backend/api/src/app/auth/services/impersonation.service.ts:32-34, 51-67, 87`
  frente a `apps/backend/api/src/app/auth/services/user-identity.service.ts:188-204`

**Qué está mal.** `ImpersonationService` lee los permisos del actor así:

```ts
private permissionsOf(user: { roles?: readonly { permissions?: string[] }[] | null }): string[] {
  return [...new Set((user.roles || []).flatMap((role) => role.permissions || []))];
}
...
const actorPermissions = this.permissionsOf(adminUser);   // línea 87
```

Pero `UserIdentityService.buildPrincipal` construye `roles` **sin permisos**:

```ts
roles: UserIdentityService.roleNamesFor(user, activeOrganizationId).map((name) => ({ name })),
permissions: UserIdentityService.permissionsFor(user, activeOrganizationId),
```

Los permisos viven en `principal.permissions` — que es lo que lee `PermissionsGuard`
(`security/guards/permissions.guard.ts:94`) y lo que lee `RolesService`. `ImpersonationService` es
el único que lee `roles[].permissions`, y ese array siempre está vacío en producción.

Consecuencias:

1. `hasPermission([], ['users:impersonate'])` es siempre `false`: **la suplantación está muerta**,
   siempre responde 403.
2. `assertNoPrivilegeGain` —la defensa contra escalada documentada en las líneas 36-50— compara
   contra un conjunto vacío. Hoy eso significa "denegar todo"; el día que alguien "arregle" el
   principal para que `roles` traiga permisos, esa defensa se activa con valores que nadie ha
   revisado.
3. **La prueba tapa el defecto.** `impersonation.service.spec.ts:27-40` fabrica el principal como
   `roles: [{ name: 'custom', permissions }]` — una forma que `UserIdentityService` no produce
   jamás. El CI está verde sobre un principal que no existe.

**Forma correcta.** Leer `adminUser.permissions`, que es la fuente única que ya usa el resto del
sistema, y borrar `permissionsOf` para el actor (para el *objetivo* sigue siendo correcta, porque
ahí sí se carga la entidad `User` con `relations: ['roles']`). El fixture del spec debe construirse
con el mismo helper que usa producción, o la prueba no prueba nada.

---

### A-6 · El contador de intentos fallidos nunca se reinicia para quien tiene 2FA

- **Categoría:** autenticación (disponibilidad)
- **Severidad:** media
- **Ubicación:** `apps/backend/api/src/app/auth/auth.service.ts:151-189` y
  `security-analysis.service.ts:242-248`

**Qué está mal.** `resetLoginAttempts` se llama en **un solo sitio** del proyecto:
`auth.service.ts:184`, que es la rama de login **sin** segundo factor. La rama de 2FA retorna en la
línea 174-179 sin pasar por ahí, y `MfaOrchestratorService.complete2faLogin` tampoco lo llama
(comprobado con `grep -rn resetLoginAttempts`).

Resultado: para una cuenta con 2FA, `failed_login_attempts` **solo sube**. Tras cinco erratas
acumuladas a lo largo de la vida de la cuenta, la condición
`failed_login_attempts + 1 >= 5` de `handleFailedLoginAttempt` (línea 224-226) se cumple siempre, y
**cada** fallo posterior —una errata cualquiera— bloquea la cuenta 15 minutos. El control de
seguridad castiga precisamente a los usuarios que activaron el segundo factor.

**Forma correcta.** Llamar a `resetLoginAttempts` en todo camino que termine en una sesión emitida,
incluido el de 2FA, el de WebAuthn y el federado. Mejor aún: hacerlo dentro de
`TokenService.generateAuthResponse`, que es el embudo por el que pasan todos.

---

### A-7 · Dos reglas distintas de CORS para la misma sesión: la del WebSocket está fija en `localhost:4200`

- **Categoría:** gestión de sesión / inconsistencia entre implementaciones
- **Severidad:** media
- **Ubicación:** `apps/backend/api/src/app/websockets/events.gateway.ts:19-24` frente a
  `apps/backend/api/src/main.ts:88-90, 132-136`

**Qué está mal.** HTTP deriva los orígenes de `CORS_ORIGIN`. El gateway los lleva escritos:

```ts
@WebSocketGateway({ cors: { origin: 'http://localhost:4200', credentials: true } })
```

Es el mismo patrón que el propio fichero documenta haber corregido en la línea 50-52 para el
nombre de la cookie ("dos contratos distintos para una credencial"), reaparecido una capa más
arriba. En un despliegue real esto (a) rompe Socket.IO desde el origen legítimo y (b) deja
`http://localhost:4200` como origen aceptado por la API de producción con `credentials: true`.

Secundario, en el mismo fichero: el handshake valida firma, revocación y `tokenVersion`
(líneas 60-92) pero mete el socket en la sala `payload.organizationId` sin volver a resolver la
pertenencia del usuario a esa empresa, cosa que la ruta HTTP sí hace en cada petición
(`UserIdentityService.resolveOrganizationContext`). Una expulsión de la empresa no bumpea
`tokenVersion`, así que el socket sigue recibiendo eventos del inquilino hasta que el access token
caduca (15 min).

**Forma correcta.** `@WebSocketGateway` asíncrono que lea `CORS_ORIGIN` del `ConfigService` — la
misma lista que `app.enableCors` — y resolución del principal en el handshake por
`UserIdentityService.resolveFromPayload`, que es el único validador que el proyecto ya declara como
fuente única.

---

### A-8 · Extensiones: el consentimiento del inquilino se puede eludir por dos caminos

- **Categoría:** autorización
- **Severidad:** media
- **Ubicación:** `apps/backend/api/src/app/extensions/extensions.service.ts:312-342` y `403-422`

**(a) Fijar versión salta la versión consentida.** `resolveVersion` honra un `dto.version` que
viene del cliente **antes** de mirar el consentimiento:

```ts
if (version) {
  resolved = items.find((v) => v.version === version);   // el cliente elige
} else {
  const consent = await this.consents.findOne({ where: { organizationId, pluginId: plugin.id } });
  resolved = consent?.consentedVersionId ? ... : newest;
}
```

El inquilino consintió la versión X; `{"pluginName":"...","version":"Y"}` ejecuta la Y. Las
capacidades de Y sí se comprueban después, así que el daño está acotado a lo que el inquilino ya
concedió — pero "esta organización aprobó *este* código" deja de ser cierto, y ese es el propósito
de `consentedVersionId`.

**(b) Una extensión sin capacidades no necesita estar instalada.** El bloque de consentimiento está
guardado por `if (dto.pluginName && requiredCapabilities.length > 0)` (línea 405). Una versión que
declare `capabilities: []` se ejecuta sin comprobar `consent?.enabled`: cualquier inquilino puede
correr cualquier extensión del catálogo que no haya instalado. Lo que puede hacer se limita a
`log`, así que es contenido; la comprobación de "está habilitada para este inquilino" no debería
depender de cuántas capacidades declare.

**Forma correcta.** Comprobar `consent?.enabled` siempre que haya `pluginName`, antes de resolver la
versión; y aceptar `dto.version` solo si coincide con `consent.consentedVersionId` (o exigir
permiso de plataforma para fijar otra).

---

### A-9 · El nombre de una dimensión entra en un literal SQL; lo que hoy lo salva es un validador puesto para otra cosa

- **Categoría:** otro (inyección SQL, hoy no explotable)
- **Severidad:** baja
- **Ubicación:** `analytical-reporting.service.ts:30-32, 176-181` y
  `apps/backend/api/src/app/dimensions/dto/*.ts`

**Qué está mal.** `CreateDimensionDto.name` es `@IsString() @IsNotEmpty()`, sin juego de caracteres.
Ese nombre, controlado por el inquilino, se interpola **crudo** dentro de un literal SQL:

```ts
.map(dim => `jel.dimensions ->> '${dim.name}' AS "${this.sanitizeColumnName(dim.name)}"`)
```

La primera sustitución no está saneada. Lo que impide la inyección es que la *segunda*
—`sanitizeColumnName`, cuyo trabajo es producir un alias— lanza al evaluar la misma plantilla, antes
de que la cadena llegue a `queryRunner.query`. Funciona, y funciona por accidente: si alguien
separa el alias del valor, o añade una columna dinámica más sin alias, la protección desaparece sin
que nada falle.

**Forma correcta.** Restringir el nombre en el DTO (`@Matches(/^[a-zA-Z0-9_ ]{1,64}$/)`) y sanear
explícitamente el literal, o pasar el nombre como parámetro:
`jel.dimensions ->> $1`. Una regla de seguridad no debería depender del orden de evaluación de una
plantilla de cadena.

---

### A-10 · La comprobación de aislamiento arranca igual cuando no hay ninguna política

- **Categoría:** aislamiento entre inquilinos
- **Severidad:** media
- **Ubicación:** `apps/backend/api/src/app/shared/tenancy/tenant-isolation.check.ts:93-102`

**Qué está mal.** El arranque aborta si el rol tiene `BYPASSRLS` o si faltan los `FORCE`
(líneas 104-162) — correcto y valiente. Pero si no hay **ninguna** política, registra un `error` y
**retorna**:

```ts
if (row.policies === 0) {
  this.logger.error(..., 'No hay políticas de aislamiento ... Ejecuta las migraciones.');
  return;
}
```

El motivo declarado (el primer despliegue, antes de las migraciones) es legítimo. El efecto es que
el caso *peor* de los tres —cero aislamiento en la base— es el único que no impide servir, mientras
que los dos casos parciales sí. Y el propio fichero explica por qué eso importa: esa configuración
"es INDISTINGUIBLE de la correcta desde dentro".

Secundario: la consulta cuenta `policies` pero no compara esa cuenta contra el número de tablas de
inquilino. Con una sola política instalada de 120 tablas, el arranque informa
`tenant_isolation_enforcing`. La cobertura solo se verifica en CI (`verify:rls`), no en el
despliegue real.

**Forma correcta.** Un `DEPLOY_ALLOW_UNPROTECTED_BOOTSTRAP=true` explícito y de un solo uso para el
primer arranque, y abortar en cualquier otro caso. Y llevar la consulta de cobertura de
`rls-isolation.ts:119-133` al propio arranque, para que el despliegue verifique lo mismo que el CI.

---

### A-11 · El barrido de RLS no puede ver una tabla de inquilino cuya columna no se llame `organization_id`

- **Categoría:** aislamiento entre inquilinos (mecanismo)
- **Severidad:** media
- **Ubicación:** `migrations/1789002100000-TenantRowLevelSecurity.ts:137-146`,
  `migrations/1789006000000-TenantColumnNameAndRlsCoverage.ts:129-142`,
  `tools/verify/rls-isolation.ts:119-155`

**Qué está mal.** Tanto la instalación como la verificación de cobertura se apoyan en
`column_name = 'organization_id' AND is_nullable = 'NO'`. Eso deja tres clases fuera del radar, y
ninguna de las tres dispara alarma:

1. **Tablas cuyo inquilino tiene otro nombre.** `consolidation_maps` usa
   `parent_organization_id` (A-2). Ni recibe política automática ni aparece como descubierta.
2. **Tablas hijas que heredan el inquilino del padre.** Hay 23 en una lista escrita a mano
   (migración 1789002100000, líneas 153-181). Nada verifica que esa lista siga completa: una tabla
   de líneas nueva no recibe política y `verify:rls` la da por buena porque no tiene
   `organization_id`.
3. **Vistas materializadas.** `analytical_report_data` (A-3): `table_type = 'BASE TABLE'` la excluye.

La migración 1789006000000 documenta con precisión cómo se llegó a "86 políticas y 32 tablas de
inquilino sin ninguna" por una variante de este mismo mecanismo (el nombre en camelCase). La
lección se aplicó al síntoma —se renombraron las columnas— y no al mecanismo.

**Forma correcta.** Invertir la comprobación: enumerar **todas** las tablas de `public` y exigir
que cada una esté en exactamente una de tres listas revisables — tiene `tenant_isolation`, es
global por diseño (anotada), o hereda su inquilino (anotada, con el padre nombrado). Que aparezca
una tabla nueva sin clasificar rompe el CI. Eso convierte "nadie se acordó" en un fallo de build,
que es el mismo movimiento que este repositorio ya hizo con CSRF, entitlement y permisos.

---

### A-12 · Cambiar de empresa falla *abierto* hacia la empresa de origen

- **Categoría:** autorización / aislamiento
- **Severidad:** media
- **Ubicación:** `apps/backend/api/src/app/auth/services/user-identity.service.ts:345-346`

**Qué está mal.**

```ts
const switched = await this.orgRepository.findOneBy({ id: requestedOrganizationId });
return switched ?? user.organization;
```

Si la fila no se lee —borrada entre la comprobación de pertenencia y la búsqueda, o filtrada por
una política futura sobre `organizations`— la función devuelve **la empresa de origen** en lugar de
fallar. `ActiveTenantGuard` ya decidió que la petición actúa en la empresa B
(`active-tenant.guard.ts:105-110`), el cliente cree que actúa en B, y la petición acaba escribiendo
en A. En un ERP eso es un asiento en el libro equivocado — que es exactamente el daño que
`ActiveTenantGuard` se escribió para impedir (ver su comentario, líneas 44-52).

**Forma correcta.** `if (!switched) throw new UnauthorizedException(AuthError.INVALID_CREDENTIALS);`
Una decisión de inquilino no tiene una respuesta por defecto segura.

---

### A-13 · El verificador de `NODE_ENV` no ve las lecturas por `ConfigService`

- **Categoría:** manejo de secretos / inconsistencia entre implementaciones
- **Severidad:** baja
- **Ubicación:** `tools/verify/env-gating.mjs:55-59` frente a
  `apps/backend/api/src/app/app.module.ts:220`, `auth/auth.module.ts:124`,
  `auth/services/oauth-state.service.ts:72,146,171`,
  `payment/adapters/stripe-payment.adapter.ts:124`

**Qué está mal.** Los patrones del verificador exigen que `NODE_ENV` esté pegado al operador de
comparación:

```js
/NODE_ENV['\]]*\s*[=!]==?\s*['"]/
```

`config.get<string>('NODE_ENV') === 'production'` mete un `)` en medio y no coincide. El resultado
es que el verificador pasa (`✓ env-gating`, comprobado ejecutándolo) mientras cinco sitios deciden
por el deny-list que el propio `auth.config.ts` declara prohibido. El más relevante:

```ts
// app.module.ts:220-225
const isProduction = config.get<string>('NODE_ENV') === 'production';
if (isProduction && !hasRedis) throw new Error('REDIS_URL or REDIS_HOST is required ...');
```

Es decir: la exigencia de un almacén de rate limiting **distribuido** —sin el cual el límite de
login es por proceso y se multiplica por el número de réplicas— depende de la forma exacta del
deny-list.

**Por qué es baja y no alta.** `env.validation.ts:151-164` obliga a `NODE_ENV` a ser exactamente
`development`, `test` o `production`, y lo hace `.required()`. Con esa restricción,
`=== 'production'` y `!isDevLikeEnvironment()` son equivalentes, así que hoy no hay agujero. Lo que
hay es una regla que se sostiene en otro fichero en lugar de en el verificador que existe para
sostenerla — que es, literalmente, el fallo que `env-gating.mjs` documenta en sus líneas 15-24.

**Forma correcta.** Añadir el patrón `/get\(\s*['"]NODE_ENV['"]\s*\)\s*[=!]==?/` al verificador y
pasar los cinco sitios por `isDevLikeEnvironment()`.

---

### A-14 · El guard de alcance de inquilino solo detecta el `.find()` desnudo

- **Categoría:** inconsistencia entre implementaciones
- **Severidad:** baja
- **Ubicación:** `tools/verify/tenant-scope-guard.mjs:38`

```js
const BARE_FIND = /\.(find|findAndCount|findAndCountAll)\(\s*(\{\s*\})?\s*\)/;
```

Su propia documentación lo reconoce: "Scoped reads and lookups by id are untouched". Pero
`findOne({ where: { id } })` sin inquilino **es** el IDOR clásico, no un caso aparte. No detecta
tampoco `createQueryBuilder()` sin filtro ni un `where` que filtra por otra cosa.

En la práctica el código está bien: el barrido manual sobre `findOne/findOneBy` encontró cuatro
lecturas sin inquilino y las cuatro son legítimas (`users.service.ts:377` documentada como
"identity itself", `enterprise-sso.service.ts:86` sobre un IdP global,
`two-factor-auth.service.ts:384` sobre el propio usuario, `registration.service.ts:722` sobre una
fila pre-inquilino). El hallazgo es sobre el alcance del control, no sobre una infracción actual.

**Forma correcta.** Extender el patrón a `createQueryBuilder` y a `findOne*` sobre repositorios de
entidades con `organizationId`, con la misma anotación `tenant-scope-guard-allow` como escape
documentado.

---

### A-15 · Un segundo almacén de permisos, dormido, en el esquema

- **Categoría:** inconsistencia entre implementaciones
- **Severidad:** baja
- **Ubicación:** `apps/backend/api/src/app/procurement/entities/supplier-portal-user.entity.ts:16-17`

`supplier_portal_users` declara `permissions: string[]` y `isActive`. Ningún guard, ningún servicio
y ningún controlador leen esa tabla (solo aparece en `procurement.module.ts` y en migraciones). Es
el esqueleto de un portal para gente que no es personal del inquilino, con su propio modelo de
permisos paralelo al de `roles`.

No es una vulnerabilidad hoy. Es la semilla de una: el día que alguien construya el portal encima
de esa columna, tendrá un segundo mecanismo de autorización que `PermissionsGuard` no conoce — y la
regla de este informe es que el mecanismo más débil define el nivel real del sistema. Conviene
decidirlo antes: o esos permisos se expresan como un `Role` con `organization_id` y pasan por el
guard global, o la tabla se borra.

---

## Scorecard

> Los cinco ejes se puntúan por separado **a propósito**. No hay una nota global promediada: ver
> la evaluación al final.

### Autenticación — **8 / 10**

**Lo que sostiene el 8.** argon2id con parámetros explícitos y `needsRehash` en el login
(`password.service.ts:33-64`); hash señuelo para igualar el tiempo de una cuenta inexistente
(`verifyDummy`, líneas 72-78); cribado contra HIBP con k-anonimato y fallo abierto justificado
(85-138); error de login genérico y verificación de contraseña antes de cualquier comprobación de
estado (`auth.service.ts:84-121`); RS256 con anillo de claves y rotación sin cerrar sesiones
(`key-management.service.ts`), con fallo duro si faltan las claves fuera de desarrollo; TOTP con
quemado del paso temporal, unificado entre el camino de login y el de step-up
(`security-analysis.service.ts:96-149`); bloqueo por cuenta con `UPDATE` atómico, inmune a la
carrera de un ataque paralelo (214-240); rate limit por IP con almacén Redis compartido.

**Lo que impide el 10, concretamente.**
1. **A-1** — el bloqueo distingue la contraseña correcta por código de error *y* por tiempo.
2. **A-6** — `resetLoginAttempts` no se ejecuta en la rama de 2FA.

**Qué haría falta exactamente para el 10.**
- En `auth.service.ts`, mover el `if (isLockedOut)` a después de la verificación pero haciéndolo
  responder `AuthError.INVALID_CREDENTIALS` sin `meta` y pasando por `simulateDelay()`; o exigir el
  segundo factor antes de revelar el estado de la cuenta.
- Llamar a `resetLoginAttempts` dentro de `TokenService.generateAuthResponse`, para que cubra los
  cuatro caminos que emiten sesión (contraseña, 2FA, WebAuthn, federado), y añadir un caso a
  `login.spec.ts` que lo fije.

### Autorización — **7 / 10**

**Lo que sostiene el 7.** `PermissionsGuard` global con **denegación por defecto** y exención
explícita y motivada (`permissions.guard.ts:36-77` + `authenticated-only.decorator.ts`); un nivel
de permisos de plataforma que ni el `'*'` de inquilino satisface y que `RolesService` se niega a
delegar en un rol (`roles.service.ts:101-133, 159-200`); step-up de un solo uso en toda mutación de
roles y en publicar/revocar extensiones; permisos recalculados **por empresa** al cambiar de
inquilino, no copiados (`user-identity.service.ts:149-165, 292-305`); `ActiveTenantGuard` que
autoriza la cabecera de empresa activa contra `user_organizations` y responde igual a "no existe" y
"no es tuya" para no filtrar el censo de clientes; RLS real con `FORCE` sobre las tablas de
inquilino y `verify:rls-runtime` en CI conectando como el rol que no posee las tablas.

**Lo que impide el 10, concretamente.**
1. **A-2** — `consolidation/mapping` toma la relación padre-subsidiaria del cuerpo de la petición.
2. **A-3** — una acción de alcance plataforma (`synchronize-view`) detrás de un permiso de
   inquilino, con efecto sobre los demás inquilinos.
3. **A-8** — el consentimiento de una extensión se elude fijando versión, y no se comprueba en
   absoluto si la extensión no declara capacidades.
4. **A-12** — el cambio de empresa cae silenciosamente en la empresa de origen si la fila no se lee.

**Qué haría falta exactamente para el 10.**
- `ConsolidationMappingService`: `exist({ where: { parentOrganizationId, subsidiaryOrganizationId } })`
  contra `organization_subsidiaries` en `createOrUpdateMap` **y** en `getMapForSubsidiary`.
- `AnalyticalReportingController`: `@RequiresPlatformPermission` + `@StepUp` en `synchronize-view` y
  `refresh-view`, y derivar las columnas de dimensión de toda la instalación.
- `ExtensionsService.execute`: comprobar `consent?.enabled` siempre que haya `pluginName`, y aceptar
  `dto.version` solo si coincide con `consent.consentedVersionId`.
- `user-identity.service.ts:346`: lanzar en lugar de devolver `user.organization`.

### Gestión de sesión / token — **9 / 10**

**Lo que sostiene el 9.** Access token **solo** en cookie `__Host-`, `HttpOnly`, `Secure`,
`SameSite=Lax`, sin cabecera `Authorization` aceptada
(`jwt.strategy.ts:24-35`, `cookie.service.ts:95-145`); refresh en cookie `__Secure-` con `Path`
acotado a la propia ruta de refresco; rotación con reclamo atómico (`UPDATE ... WHERE is_revoked =
false`, `session.service.ts:181-186`) y detección de reuso discriminada por `replacedByToken` y no
por tiempo (196-215), con invalidación de toda la familia; cota **absoluta** desde el primer
`created_at` de la familia y cota por inactividad (`assertSessionWithinLifetimeBounds`, 355-400);
denylist de sesión consultada por HTTP *y* por el handshake de WebSocket, con un verificador de CI
que impide que aparezca un tercer validador que la olvide (`verify:session-revocation`);
`tokenVersion` incrementado en cambio de contraseña, recuperación y cambio de rol; CSRF de doble
envío firmado, **global**, con vínculo al sujeto y capa independiente de `Sec-Fetch-Site`
(`csrf.guard.ts`); step-up de un solo uso con reclamo atómico en Redis y comprobación de propiedad
*antes* de quemar el jti (`step-up.guard.ts:86-99`).

**Lo que impide el 10, concretamente.**
1. **A-7** — el gateway de WebSocket lleva el origen CORS escrito a mano y no vuelve a resolver la
   pertenencia del usuario a la empresa de la sala.

**Qué haría falta exactamente para el 10.**
- Convertir `EventsGateway` en `@WebSocketGateway` construido con `ConfigService` para que su
  `cors.origin` sea la misma lista `CORS_ORIGIN` que usa `app.enableCors`.
- Resolver el principal del handshake con `UserIdentityService.resolveFromPayload` en lugar del
  camino propio, para que la pertenencia a la empresa se compruebe igual que en HTTP.

### Manejo de secretos — **9 / 10**

**Lo que sostiene el 9.** `requireSecret` con lista blanca de entornos, longitud mínima y rechazo de
patrones de marcador (`auth.config.ts:31-76`); `NODE_ENV` obligatorio y restringido a tres valores
exactos, con el mensaje de error explicando por qué (`env.validation.ts:151-164`); claves RS256
obligatorias fuera de desarrollo, par validado al arrancar; separación de claves (CSRF, step-up,
2FA temporal, preverify, social); ningún secreto real en el repositorio —solo `.env.example`, y
`.env.local` en `.gitignore` con la razón escrita—; el sembrador de desarrollo tras **dos** puertas
afirmativas (`isDevLikeEnvironment()` **y** `DEV_SEED === true`, `main.ts:262-270`); la excepción de
firma en el sandbox (`NODE_ENV === 'test' && signature === 'valid-signature'`) eliminada y
documentada (`sandbox.service.ts:414-421`); Swagger tras basic-auth con comparación en tiempo
constante.

**Lo que impide el 10, concretamente.**
1. **A-13** — cinco decisiones de entorno pasan por `ConfigService.get('NODE_ENV') === 'production'`
   y el verificador que existe para prohibirlo no las ve. La más relevante es la que exige Redis
   para el rate limiting distribuido.

**Qué haría falta exactamente para el 10.**
- Añadir `/get\(\s*['"]NODE_ENV['"]\s*\)\s*[=!]==?/` a `PATTERNS` en `tools/verify/env-gating.mjs`.
- Sustituir los cinco sitios por `isDevLikeEnvironment()`: `app.module.ts:220`,
  `auth/auth.module.ts:124`, `oauth-state.service.ts:72,146,171`,
  `stripe-payment.adapter.ts:124`. (`cookie.service.ts:31` ya combina ambas formas y es correcto.)

### Consistencia entre implementaciones — **6 / 10**

Este es el eje más bajo, y es deliberado: lo que se puntúa aquí no es si los controles existen
—existen y son buenos— sino si **hay un solo mecanismo** y si lo que lo mantiene único es
comprobable. El proyecto ha hecho un trabajo excepcional en esa dirección (seis guards globales,
cinco verificadores de seguridad en CI, un `verify:rls-runtime` que se niega a correr como el
usuario equivocado para no dar un éxito por el motivo equivocado). El 6 mide lo que todavía queda
duplicado o no verificado.

**Lo que impide el 10, concretamente.**
1. **A-5** — `ImpersonationService` lee los permisos de `roles[].permissions`; todo lo demás
   (`PermissionsGuard`, `RolesService`, el frontend) lee `principal.permissions`. El array que lee
   está siempre vacío, la suplantación está muerta, y el spec lo tapa porque fabrica un principal
   que producción no produce.
2. **A-11** — la cobertura de RLS se define por el nombre de una columna, de modo que una tabla de
   inquilino con otro nombre (`consolidation_maps`), una tabla hija nueva o una vista materializada
   quedan fuera del control **y fuera de la alarma**.
3. **A-13** — el verificador de `env-gating` no cubre la forma `ConfigService`.
4. **A-14** — el verificador de alcance de inquilino solo ve el `.find()` desnudo.
5. **A-7** — dos reglas de CORS para la misma sesión, una configurable y una fija.
6. **A-15** — un segundo almacén de permisos (`supplier_portal_users.permissions`) en el esquema que
   ningún guard conoce.

**Qué haría falta exactamente para el 10.**
- `ImpersonationService.validateImpersonationRequest`: usar `adminUser.permissions`; y construir el
  fixture del spec con el mismo `buildPrincipal` que usa producción (o exportar un
  `makePrincipal()` compartido), para que la prueba no pueda pasar sobre una forma inexistente.
- `tools/verify/rls-isolation.ts`: invertir la comprobación a "toda tabla de `public` debe estar
  clasificada en una de tres listas" y añadir las vistas materializadas con `organization_id`.
- `tools/verify/env-gating.mjs`: patrón para `ConfigService.get('NODE_ENV')`.
- `tools/verify/tenant-scope-guard.mjs`: cubrir `createQueryBuilder` y `findOne*` sin inquilino.
- `EventsGateway`: CORS desde `ConfigService`.
- Decidir `supplier_portal_users.permissions`: expresarlo como `Role` o eliminarlo.

---

## Evaluación general

**El nivel de seguridad real de esta aplicación es el de su eje más débil, no el de su promedio.**
Con autenticación en 8, sesión en 9 y secretos en 9, sería tentador describir el sistema como
sólido. No lo es todavía: **autorización está en 7 y consistencia en 6**, y esos dos ejes son los
que deciden si un cliente puede tocar los datos o el servicio de otro.

Concretamente, tres cosas sostienen esa lectura:

1. Un administrador de cualquier inquilino puede **reconstruir la vista analítica compartida** y
   dejar sin reportes a todos los demás (A-3), y puede **tumbar el proceso** por el mismo camino
   (A-4). Eso es efecto cruzado entre inquilinos, con permisos que cualquier cliente tiene.
2. Existe un punto —`consolidation/mapping`— donde **la relación entre dos inquilinos la declara el
   cliente** y el backend no la verifica (A-2). Es el patrón "cambia el ID en el cuerpo de la
   petición", en el módulo que por definición cruza fronteras de empresa.
3. El mecanismo que garantiza el aislamiento en la base **define su propio alcance por el nombre de
   una columna** (A-11). Todo lo que no se llame `organization_id NOT NULL` queda fuera de la
   política *y* fuera del verificador. Ya hay tres casos reales de eso en el repositorio.

La contrapartida, y hay que decirla porque cambia el plan de trabajo: **ninguno de estos hallazgos
es de la clase "el control no existe"**. El proyecto ya resolvió los problemas estructurales —los
guards son globales, la denegación es por defecto, las excepciones están escritas y argumentadas, y
hay cinco verificadores de CI que impiden la regresión. Lo que queda son bordes: rutas que
escaparon a la clasificación correcta y verificadores cuyo alcance es más estrecho que la regla que
dicen sostener. Eso es trabajo de días, no de meses, y el orden es: A-1, A-2, A-3/A-4 (alta), luego
A-11 y A-5 (porque son los que impiden que vuelva a pasar), y después el resto.

---

## Mapa: dónde vive la lógica de autenticación y autorización

**Centralizada.** Esta es la mejor noticia del informe: los seis controles transversales están
registrados una sola vez, en `app.module.ts:343-417`, y en este orden, que importa:

```
ThrottlerGuard → JwtAuthGuard → CsrfGuard → ActiveTenantGuard → PermissionsGuard
               → MfaEnrolmentGuard → SubscriptionActiveGuard
```

| Responsabilidad | Fichero |
|---|---|
| Registro de guards globales y orden | `apps/backend/api/src/app/app.module.ts:343-417` |
| Extracción y verificación del token | `auth/strategies/jwt.strategy/jwt.strategy.ts` |
| **Resolución del principal (fuente única)** | `auth/services/user-identity.service.ts` |
| Tipo del principal | `security/principal.ts` |
| Autenticación (guard) | `auth/guards/jwt/jwt.guard.ts`, `optional-jwt.guard.ts` |
| Autorización por permiso y políticas ABAC | `security/guards/permissions.guard.ts` |
| Permisos de plataforma (nivel por encima del inquilino) | `security/platform-permissions.ts`, `security/guards/platform-permissions.guard.ts` |
| Coincidencia de permisos (compartida con el frontend) | `libs/shared/util-auth/src/lib/permissions.util.ts` |
| Empresa activa por petición | `shared/tenancy/active-tenant.guard.ts` |
| Inquilino en la conexión de base de datos (RLS) | `shared/tenancy/tenant-connection.interceptor.ts`, `tenant-context.ts` |
| Comprobación de aislamiento al arrancar | `shared/tenancy/tenant-isolation.check.ts` |
| CSRF | `auth/guards/csrf.guard.ts`, `auth/services/cookie.service.ts:237-325` |
| Re-autenticación (step-up) | `auth/guards/step-up.guard.ts`, `auth/enums/step-up-scope.enum.ts`, `auth/auth-step-up.controller.ts` |
| Alta obligatoria de segundo factor | `auth/guards/mfa-enrolment.guard.ts` |
| Entitlement / suscripción | `saas/guards/subscription-active.guard.ts` |
| Login, bloqueo, 2FA | `auth/auth.service.ts`, `auth/services/mfa-orchestrator.service.ts`, `auth/services/security-analysis.service.ts` |
| Contraseñas | `auth/services/password.service.ts`, `auth/dto/password-policy.ts` |
| Sesiones y rotación de refresh | `auth/services/session.service.ts`, `session-registry.service.ts` |
| Cookies | `auth/services/cookie.service.ts`, `auth/services/access-token-cookie.ts` |
| Claves de firma | `auth/services/key-management.service.ts` |
| Configuración y secretos | `auth/auth.config.ts`, `config/env.validation.ts` |
| Delegación de roles y anti-escalada | `roles/roles.service.ts:96-200` |
| Suplantación | `auth/services/impersonation.service.ts` ⚠️ (A-5) |
| Políticas RLS | `database/migrations/1789002100000`, `1789006000000`, `1789006600000` |
| Verificadores de CI | `tools/verify/{env-gating,crypto-single-derivation,role-assignment,session-revocation,tenant-scope-guard}.mjs`, `tools/verify/rls-isolation.ts`, `rls-runtime.ts` |

**Dispersa (y es donde están los hallazgos).**

- `websockets/events.gateway.ts` — camino de autenticación propio para el handshake, con su propia
  regla de CORS (A-7).
- `analytical-reporting/analytical-reporting.service.ts` — recurso compartido entre inquilinos
  gobernado por permisos de inquilino (A-3).
- `consolidation/consolidation-mapping.service.ts` — relación entre inquilinos tomada del cliente
  (A-2).
- `extensions/extensions.service.ts` — consentimiento por inquilino comprobado condicionalmente
  (A-8).
- `procurement/entities/supplier-portal-user.entity.ts` — modelo de permisos paralelo, dormido
  (A-15).

**El frontend no decide nada.** `apps/core/client-web/src/app/core/guards/permissions-guard.ts` y
`core/services/auth.ts:176-178` usan el **mismo** `hasPermission` de `libs/shared/util-auth` que el
backend, para ocultar navegación y pestañas; toda ruta correspondiente declara su permiso en el
controlador. Lo mismo en `apps/pos`, que consume la misma API con las mismas cookies y cuyos
endpoints (`pos/pos.controller.ts`) declaran `POS_VIEW`/`POS_OPERATE` y derivan el inquilino del
principal, nunca del cuerpo. **El POS no es una versión más débil del portal principal** — fue algo
que se verificó explícitamente en esta auditoría por ser el patrón habitual de fallo.

---

## Módulos que conviene revisar con más profundidad

Ordenados por la probabilidad de que el patrón encontrado aquí se repita. **Esto es una hipótesis a
verificar, no una afirmación:** no se auditaron estos módulos con el detalle de los anteriores.

1. **`intercompany/`** — comparte con `consolidation/` la premisa de cruzar la frontera de empresa.
   Si A-2 (relación entre inquilinos declarada por el cliente) se repite en algún sitio, es aquí.
   *Verificar:* todo endpoint que reciba un `organizationId` en el cuerpo o en la URL.
2. **`bi/`, `reports/`, `financial-reporting/`, `dashboard/`, `overview/`** — el eje de lectura
   agregada. Comparten con A-3 la posibilidad de apoyarse en objetos compartidos (vistas, cachés,
   materializaciones) cuya clave de inquilino es un `WHERE` y no una política.
   *Verificar:* ¿alguno consulta `analytical_report_data` u otra vista sin RLS? ¿hay más matviews?
3. **`queues/`, `shared/jobs/`** — el interceptor que fija `app.current_organization` es **HTTP**
   (`tenant-connection.interceptor.ts:46`: `if (context.getType() !== 'http') return next.handle()`).
   Un trabajo de BullMQ corre fuera de él. Existe `shared/tenancy/tenant-job.ts` y un
   `queue-tenancy.spec.ts`, así que el problema está contemplado; falta confirmar que **todos** los
   procesadores lo usan y que ninguno abre su propia conexión.
4. **`extensions/`** — más allá de A-8: el `SandboxService` y la cadena de admisión son la superficie
   de código no confiable del producto. La defensa real es el aislado V8 (el propio código lo dice:
   la exploración de admisión son seis expresiones regulares). *Verificar:* el puente de syscalls
   completo y la lista de egress.
5. **`payment/`, `saas/`** — el webhook de Stripe es `@Public() @SkipCsrf()`
   (`payment.controller.ts:193-194`), el único punto del producto con ambas cosas.
   *Verificar:* la firma del webhook, la idempotencia frente a reenvíos y que ningún campo del
   payload (plan, inquilino, importe) se tome sin validar contra Stripe.
6. **`documents/`, `storage/`** — no auditado. *Verificar:* que una URL firmada o un `documentId` no
   permita leer un adjunto de otro inquilino, y que `document_nodes` (que sí tiene política, según
   la lista de la migración 1789006000000) cubra también los blobs en S3, que RLS no alcanza.
7. **`hcm/`, `payroll/`** — datos de nómina. El prompt de referencia sitúa "ver datos de nómina"
   entre las acciones que deberían pedir step-up; hoy ninguna ruta de estos módulos lo declara
   (`grep '@StepUp' payroll/ hcm/` → vacío). *Verificar:* si la política de la empresa lo exige, y
   si el cifrado de columna (`common/database/encrypted-column.transformer.ts`) cubre todo lo
   sensible.
8. **`my-work/`, `search/`, `notifications/`** — usan `@AuthenticatedOnly` con motivo escrito, que es
   la forma correcta. *Verificar:* que el filtro por inquilino esté en el servicio y no dependa de
   RLS en tablas que puedan tener `organization_id` nulo.
