# Justificación del scorecard — evidencia por eje

> **ESTADO: REMEDIADO.** Las notas de abajo son las del código tal como se encontró. Lo que hacía
> falta para llevar cada eje a 10 está hecho; `REMEDIACION.md` recorre las 32 acciones y dice
> dónde quedó cada una. Este documento se conserva porque la calibración —por qué un 4 y no un 6,
> qué evidencia lo sostenía— es lo que hace comprobable el 10 de después.

Complemento de `AUDITORIA_SEGURIDAD_AUTENTICACION.md`. Para cada eje: por qué esa nota y no otra,
la evidencia que la sostiene en ambas direcciones, y la lista concreta de lo que falta para llegar
a 10.

**Dos aclaraciones sobre el método, antes de empezar:**

1. **No pude ejecutar la suite de pruebas.** `node_modules` no está instalado en este entorno, así
   que `jest` no corre. Las pruebas que cito (`env.validation.spec.ts`, `route-authorisation.spec.ts`,
   `permissions-enforced.spec.ts`, `active-tenant.guard.spec.ts`) las cito **por su contenido leído**,
   no por haberlas visto pasar. Sí pude ejecutar los verificadores estáticos, que no dependen de
   `node_modules`: `verify:tenant-scope` («no unscoped repository reads») y `verify:required-markers`
   («139 labelled controls, every marker matching its validator»), ambos en verde.
2. **Una nota no es una impresión.** Cada una está anclada a hechos contables —rutas declaradas,
   políticas instaladas, secretos validados— y a defectos citados por archivo y línea. Donde el
   código y su comentario se contradicen, gana el código.

---

## Corrección al informe anterior: el disparador de A-3 no es `staging`, es `NODE_ENV` sin definir

En el informe escribí que `NODE_ENV=staging` alcanzaba el sembrador de desarrollo. **Es falso.**
`apps/backend/api/src/app/config/env.validation.ts:82-84` declara:

```ts
NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
```

`NODE_ENV` es una lista blanca de tres valores. Con `staging` el esquema rechaza y **el proceso no
arranca**, y eso está fijado explícitamente en `env.validation.spec.ts:186-194`, que prueba
`['staging', 'prod', 'dev', 'Development', '']` y espera error en los cinco. Esa parte del diseño
funciona, y funciona bien.

El agujero real es el otro extremo del mismo esquema, y está pinchado en la prueba de al lado
(`env.validation.spec.ts:196-204`):

```ts
it('rejects an unset NODE_ENV that carries no secrets', () => {
  expect(check({}).value.NODE_ENV).toBe('development');
  expect(check({}).error).toBeUndefined();
});
```

Un entorno **completamente vacío** valida sin error y se convierte en `development`. A partir de
ahí, en cascada:

| Consecuencia | Evidencia |
|---|---|
| Los 9 secretos criptográficos se rellenan con `sha256('virteex-dev-only:' + nombre)` — valores **públicos, calculables desde este repositorio** | `env.validation.ts:58-66`, lista en `:69-79` |
| El sembrador crea `dev@virtex.local` / `dev12345` como administrador de un inquilino completo | `main.ts:217-226`, `dev-seeder.service.ts:32-41` |
| HSTS desactivado y CSP con `'unsafe-inline'` en `script-src` | `main.ts:64, 78-80, 86` |
| Clave RSA efímera regenerada en cada arranque | `key-management.service.ts:59-85` |
| reCAPTCHA apagado por defecto | `env.validation.spec.ts:92-94` |
| La comprobación de secretos débiles de `TokenService` no corre | `token.service.ts:185-188` |
| `trustProxy` en `false`, así que el límite por IP y el bloqueo por intentos se atribuyen al proxy | `main.ts:36-45` |
| Swagger expuesto | `main.ts:162` |

Y, lo más grave para el eje de consistencia: **dos archivos afirman implementar la misma regla y
dicen lo contrario sobre el mismo caso.** `auth.config.ts:13-16` declara:

> *«development fallbacks are permitted ONLY when NODE_ENV is explicitly `development` or `test`.
> Every other value — **including unset** — is treated as a real deployment and fails fast.»*

Y `env.validation.ts:54-56` afirma aplicar *«the same allow-list `auth.config.ts` enforces one layer
down»*. No es la misma: una trata «sin definir» como despliegue real, la otra lo convierte en
desarrollo — y lo hace **antes**, así que es la que decide. Un `Dockerfile` al que le falte
`ENV NODE_ENV=production` obtiene la postura de desarrollo completa sin un solo mensaje de error.

**Severidad:** se mantiene **ALTA**. El camino cambia; el resultado no.

---

## Eje 1 · Autenticación — **9 / 10**

### Por qué 9

Esto es lo que se mide, y está casi todo:

| Control | Evidencia | Estado |
|---|---|---|
| Hash de contraseña con KDF y factor de coste | `password.service.ts:33-42` — Argon2id con `memoryCost`/`timeCost`/`parallelism` **aplicados explícitamente**; el comentario L-12 documenta que antes eran configuración muerta | ✅ |
| Rehash transparente al subir parámetros | `password.service.ts:51-64` + `auth.service.ts:343-354` | ✅ |
| Igualación de tiempos contra enumeración | `password.service.ts:72-78` (`verifyDummy`) invocado en `auth.service.ts:104-106` cuando no hay hash | ✅ |
| Mensaje de error genérico | `auth.service.ts:108-118` — una sola `AuthError.INVALID_CREDENTIALS` | ✅ |
| **Orden** de comprobaciones: contraseña antes que estado de cuenta | `auth.service.ts:81-118` — el bloque documenta que el orden previo filtraba `USER_BLOCKED`/`USER_INACTIVE` a cualquiera que enviase un correo | ✅ |
| Retardo simulado en el fallo | `auth.service.ts:114` + `auth.config.ts:206` (500 ms) | ✅ |
| Cribado contra filtraciones (NIST §5.1.1.2) | `password.service.ts:95-138` — HIBP con k-anonimato, `Add-Padding`, timeout, falla abierto por decisión declarada | ✅ |
| Política de contraseña | `dto/password-policy.ts:3-8` — mínimo **12**, máximo 72, mayúscula + minúscula + dígito o símbolo | ✅ |
| Bloqueo por intentos, atómico | `security-analysis.service.ts:214-240` — un solo `UPDATE ... CASE WHEN` con `RETURNING`, sin lectura-modificación-escritura | ✅ |
| Límite por IP en login | `auth.controller.ts:79-81` — 5/60 s, con almacén Redis compartido y **negativa a arrancar en producción sin él** (`app.module.ts:222-224`) | ✅ |
| reCAPTCHA, desacoplado de `NODE_ENV` | `app.module.ts:256-258` — `skipIf` gobernado por `RECAPTCHA_DISABLED`, nunca por el entorno; pinchado en `env.validation.spec.ts:245-263` | ✅ |
| TOTP con protección de repetición | `two-factor-auth.service.ts:109-141` — quema el paso temporal con `UPDATE` condicional; comparación en tiempo constante (`:128-129`) | ✅ |
| Ventana de deriva TOTP que **de verdad** funciona | `two-factor-auth.service.ts:120-126` — el comentario documenta que `authenticator.generate(secret, epoch)` ignoraba el segundo argumento y la ventana no hacía nada | ✅ |
| Códigos de respaldo con Argon2 y quemado al usar | `two-factor-auth.service.ts:313-325` (hash), `:288-311` (verificación y borrado) | ✅ |
| Sesión 2FA pendiente en servidor, atada a IP **y** user-agent | `auth.service.ts:232-254` (creación), `:280-303` (consumo, **ambas** mitades comparadas) | ✅ |
| Contador de intentos 2FA que no se autodestruye | `auth.service.ts:316-328` — el comentario documenta que borrar la entrada al primer fallo hacía del límite de 5 código muerto | ✅ |
| Enrolamiento 2FA en secreto «pendiente», con rechazo si ya está activo | `two-factor-auth.service.ts:50-65` (A-5) | ✅ |
| WebAuthn / passkeys | `auth-webauthn.controller.ts`, `webauthn.service.ts`; `WEBAUTHN_RP_ID` validado como hostname real (`env.validation.ts:116`) | ✅ |
| SSO empresarial con dominio verificado por DNS TXT, y doble comprobación en el callback | `enterprise-sso.service.ts:117-131` — exige `emailVerified` del IdP **y** que el dominio pertenezca a la organización del IdP | ✅ |
| Abuso de SMS acotado | `sms-abuse.guard.service.ts` | ✅ |
| Viaje imposible | `security-analysis.service.ts:163-171` + `auth.config.ts:232-233` | ✅ |

### Por qué no 10 — lo que descuenta

1. **A-3 (la corrección de arriba).** Un `NODE_ENV` sin definir produce un administrador con
   contraseña conocida y publicada en el repositorio (`dev12345`, `dev-seeder.service.ts:41`),
   además impresa en el log (`:70-72`). Esa contraseña, con 8 caracteres, es además **inferior al
   mínimo de 12 que el propio producto publica** en `GET /auth/password-policy`
   (`auth.controller.ts:299-312`, `password-policy.ts:3`): el camino del sembrado no pasa por la
   política de contraseñas del producto. Esto solo ya impide un 10.
2. **El segundo factor no se puede exigir.** `isTwoFactorEnabled` es una columna por usuario
   (`user-security.entity.ts`); no hay ninguna política de organización que obligue a MFA a sus
   miembros. Un inquilino que compra un ERP con nóminas y tesorería no puede exigir 2FA a su
   equipo. Búsqueda que lo confirma: no existe `requireMfa`, `mfaPolicy` ni equivalente en
   `org-settings/` ni en `organizations/`.
3. **`resetPassword` llama a `argon2.verify` en crudo** (`password-recovery.service.ts:74`) en vez
   de `passwordService.verify`, cuya razón de existir es precisamente que `argon2.verify` **lanza**
   ante un hash mal formado en lugar de devolver `false` (`password.service.ts:12-31`). El propio
   archivo usa `passwordService` dos líneas más abajo, con un comentario sobre la misma clase de
   error.
4. **Un restablecimiento de contraseña no exige el segundo factor** ni lo revoca
   (`password-recovery.service.ts:53-90`). El daño está acotado porque `isTwoFactorEnabled` sigue
   activo y el login lo seguirá pidiendo, pero NIST SP 800-63B §6.1.2.3 pide reverificar el vínculo
   con el autenticador en una recuperación.

### Por qué no menos de 9

Porque no falta ningún control **fundamental**: no hay hashing reversible, no hay enumeración por
mensaje ni por tiempo, no hay ausencia de límite de intentos, y la sesión 2FA pendiente está atada
al dispositivo por sus dos mitades. Los cuatro descuentos son un fallo de configuración con puerta
conocida (1), una funcionalidad de empresa ausente (2), y dos detalles (3, 4). Nada de eso es un
fallo del mecanismo de autenticación en sí.

### Cómo llegar al 10

1. **Sustituir las dos puertas del sembrador por `isDevLikeEnvironment()`**, y exigir además
   `DEV_SEED=true` de forma afirmativa para que sembrar nunca sea el comportamiento por defecto de
   nada:
   ```ts
   // main.ts
   if (isDevLikeEnvironment() && configService.get('DEV_SEED') === 'true') { … }
   // dev-seeder.service.ts
   if (!isDevLikeEnvironment()) return;
   ```
2. **Hacer que `NODE_ENV` sin definir sea un error**, no un `development`. Quitar
   `.default('development')` de `env.validation.ts:84` y obligar a declararlo. Un desarrollador
   local lo pone una vez en `.env`; un despliegue que lo olvida se entera al arrancar y no en
   producción. Actualizar `env.validation.spec.ts:196-204`, que hoy **fija el comportamiento
   equivocado como si fuera el deseado**.
3. **Que la contraseña sembrada pase la política del producto**, o mejor: generar una aleatoria por
   arranque e imprimirla una sola vez. Nunca una literal en el código.
4. **Política de MFA por organización**: una columna en `org_settings`, comprobada en
   `AuthService.login` después de validar la contraseña, que fuerce el enrolamiento antes de emitir
   tokens. Con excepción explícita y auditada para cuentas de servicio.
5. **Encaminar `resetPassword` por `passwordService.verify`.**
6. **Exigir el segundo factor en la recuperación** cuando la cuenta lo tenga activo, o invalidarlo
   explícitamente dejando constancia en la auditoría.

---

## Eje 2 · Autorización — **4 / 10**

Es la nota más baja y la que más explicación necesita, porque **el núcleo es excelente**. La nota
no puntúa el diseño: puntúa el nivel de acceso real que alcanza un atacante.

### Lo que sostiene la parte alta

| Control | Evidencia |
|---|---|
| `PermissionsGuard` es `APP_GUARD` **global** | `app.module.ts:390-392` |
| **Denegación por defecto**: una ruta que no declara nada se cierra y se registra | `permissions.guard.ts:36-77` — el comentario cuantifica el estado previo: «102 route handlers reached production reachable by any authenticated member of the tenant» |
| La exención es explícita y **razonada**: `@AuthenticatedOnly(motivo)` obliga a escribir por qué | `authenticated-only.decorator.ts`, 35 usos, todos con texto |
| Cobertura contada hoy | 93 controladores, **542** manejadores de ruta; 450 `@HasPermission`, 35 `@AuthenticatedOnly`, 44 `@Public()`, el resto cubierto por decoradores a nivel de clase |
| El decorador **lleva su propio guard**, así que declarar y aplicar no pueden separarse | `permissions-enforced.spec.ts:24-56`; el comentario documenta que ocho controladores declaraban permisos que nada leía — entre ellos cierre de periodo contable, consolidación y emisión de facturas |
| Un barrido del árbol falla la compilación si una ruta nueva no declara nada | `route-authorisation.spec.ts:44-60` |
| Las políticas ABAC se evalúan **incluso para comodines** | `permissions.guard.ts:86-89` (M-05) y `:101-126` |
| Los permisos se resuelven **por inquilino activo**, no aplanados entre inquilinos | `user-identity.service.ts:271-289`; misma regla en `token.service.ts:372-396` |
| Cambiar de empresa recalcula el principal **completo**, no solo el `organizationId` | `active-tenant.guard.ts:107-126` — el comentario explica que copiar solo el id dejaría a alguien en B con los permisos de A |
| Nadie delega derechos que no tiene | `roles.service.ts:77-93` y `:119-136` |
| Impersonación decidida por **conjunto de permisos**, no por nombre de rol | `impersonation.service.ts:51-67` |
| Sin enumeración de inquilinos: «no existe» y «no es tuya» responden igual | `active-tenant.guard.ts:96-124`, `organizations.controller.ts:91-95` |
| Ningún control queda solo en el frontend | El backend deniega por defecto; `hasPermission` es **la misma función** en cliente y servidor (`libs/shared/util-auth/src/lib/permissions.util.ts`) |

Eso es un 9 de núcleo. La nota es 4 por lo que sigue.

### Lo que la hunde

**El módulo de extensiones tiene la frontera de privilegio en el sitio equivocado**, y eso
convierte a cualquier cliente en administrador de la plataforma:

| Hecho | Evidencia |
|---|---|
| El catálogo es global por diseño, sin columna de inquilino | `plugin.entity.ts:18-26` y `:36-62`; `plugin-version.entity.ts:89-138` |
| Se escribe con `extensions:manage`, permiso **de inquilino** | `extensions.controller.ts:56`, catálogo en `config.permissions.ts:66` |
| El rol ADMINISTRADOR de **cada** inquilino lleva `'*'` | `roles.config.ts:27-33` |
| `'*'` satisface cualquier permiso | `permissions.util.ts:10-12` |
| `register` busca **por nombre** y añade versión a un plugin ajeno | `extensions.service.ts:59-69, 87-98` |
| La versión ejecutada es **la más reciente**, no la consentida | `extensions.service.ts:164-166` (servidor), `:268-273` (navegador) |
| La firma la emite el propio servidor sobre el código recién recibido | `plugin-admission.service.ts:97, 242-247` |
| `revoke(name)` deja la extensión inservible para **todos** | `extensions.service.ts:108-114` |
| `getByName` devuelve `code`, `uiEntry` y `signature` sin DTO de salida | `extensions.service.ts:53-57` |
| `execute` acepta `code` arbitrario como `string` libre | `execute-plugin.dto.ts`, `extensions.service.ts:193-203` |

Y dos rutas de escalada **dentro** del inquilino, ambas por el mismo hueco: el control de
delegación de roles no cubre el tercer sitio donde se asigna un rol.

| Hecho | Evidencia |
|---|---|
| `assertCanAssignRole` se aplica en `updateUser` e `inviteUser`… | `users.service.ts:220`, `:722` |
| …y el comentario afirma que son «the only other two places a role is assigned» | `users.service.ts:717-719` |
| Pero `IdentityProvider.defaultRoleId` es un tercero, aceptado tal cual del DTO | `sso-admin.service.ts:80`, `:87-93` |
| Y se usa para asignar el rol a cada usuario aprovisionado | `enterprise-sso.service.ts:211-218, 188-189` |
| El respaldo elige por **nombre**: `roles.find(r => !/admin/i.test(r.name)) ?? roles[0]` | `enterprise-sso.service.ts:224-225` |
| Sin `ORDER BY`, y el comentario dice «preferring the least-privileged one» sin comparar privilegios | `enterprise-sso.service.ts:220` |

### Calibración: por qué exactamente 4

- **No es menos de 4** porque el núcleo es real y demostrable: 542 rutas con declaración obligatoria
  y denegación por defecto, permisos por inquilino, sin autorización delegada al frontend. Un
  atacante sin `'*'` choca con un muro sólido en 450 rutas.
- **No es más de 4** porque el criterio del propio encargo —«si distintas partes del código verifican
  permisos de formas distintas, **la implementación más débil es el verdadero nivel de seguridad
  del sistema completo**»— se aplica aquí literalmente. El sistema tiene una ruta por la que un
  cliente cualquiera ejecuta código en los demás inquilinos. Con eso en pie, la calidad de las otras
  450 rutas no describe el nivel de seguridad del sistema.
- **No es 2 o 3** porque el fallo está **localizado y acotado**: un módulo, cinco rutas, y todas
  detrás de autenticación. No es una ausencia general de autorización.

### Cómo llegar al 10

1. **Crear el nivel de plataforma que hoy no existe.** `UserIdentityService.permissionsFor`
   (`:283-289`) ya contempla roles con `organization_id IS NULL` y los llama «platform-level roles
   (support, operations) […] seeded, not self-assignable». La figura existe; no se usa. Definir
   `platform:extensions:publish` y añadirlo a una lista de permisos **no delegables** en
   `assertAssignablePermissions` (`roles.service.ts:77-93`), junto a `'*'`.
2. **Mover las rutas de escritura del catálogo a ese permiso**: `POST /extensions`,
   `POST /extensions/:name/revoke`.
3. **Dar propiedad a los plugins**: `plugins.publisher_organization_id`, y que `register` rechace un
   nombre cuyo publicador no sea el llamante. El nombre es la identidad del artefacto; hoy no está
   reservado.
4. **Fijar la versión en el consentimiento.** `TenantConsent` guarda `pluginVersionId`, y
   `resolveVersion`/`runtime` lo respetan. Que aparezca una versión nueva debe ser una **propuesta**
   que el inquilino acepta, no un cambio automático.
5. **DTO de salida para el catálogo**: nombre, versión, descripción, autor, capacidades declaradas y
   manifiesto. Nunca `code`, `uiEntry` ni `signature`. El producto ya usa
   `plainToInstance(..., { excludeExtraneousValues: true })` en todas partes; aquí no.
6. **Retirar `ExecutePluginDto.code` de producción**, o ponerlo detrás del permiso de plataforma.
7. **Llamar a `assertCanAssignRole` en `createProvider` y `updateProvider`** sobre `defaultRoleId`,
   y añadir `@StepUp(StepUpScope.MANAGE_ROLES)` a esas rutas.
8. **Reescribir `resolveDefaultRole` para decidir por permisos**: descartar todo rol con `'*'` o con
   comodín de prefijo; entre los restantes, el de menor cardinalidad; si no queda ninguno, **fallar**.
   El respaldo `?? roles[0]` debe desaparecer.
9. **Añadir al barrido de `route-authorisation.spec.ts` una segunda regla**: que ninguna ruta que
   escriba una tabla sin `organization_id` declare un permiso satisfecho por `'*'` de inquilino. Así
   el hallazgo no puede repetirse en el siguiente módulo global que se añada.

---

## Eje 3 · Gestión de sesión y token — **8 / 10**

### Por qué 8

| Control | Evidencia |
|---|---|
| Acceso RS256 con `kid`, anillo de claves con rotación real (una firma, N verifican) | `key-management.service.ts:36-147`; `jwt.strategy.ts:45-71` |
| Se rechaza el par de claves que no case, al arrancar | `key-management.service.ts:99-111` |
| `issuer` y `audience` fijados y verificados | `token.service.ts:344-345, 358-359`; `jwt.strategy.ts:70-71` |
| Audiencia distinta para step-up, para que un token no sirva en el otro camino | `auth.service.ts:489-492` |
| Acceso 15 min, refresh 7 d, «recordarme» 30 d, step-up 10 min | `auth.config.ts:128-137` |
| El token **solo** viaja en cookie: se eliminó `fromAuthHeaderAsBearerToken` | `jwt.strategy.ts:24-40` |
| Nunca en el cuerpo de la respuesta | `auth.controller.ts:109-112, 156-159` |
| Cookies `HttpOnly` + `Secure` + `SameSite=Lax` + `__Host-` | `cookie.service.ts:112-119, 186-189` |
| `__Secure-` donde `__Host-` es imposible por el `Path`, con la razón escrita | `cookie.service.ts:50-71` |
| Rotación con reclamación **atómica** (`UPDATE ... WHERE is_revoked = false`) | `session.service.ts:169-177` |
| Reuso detectado por **causa** (`replacedByToken`), no por tiempo | `session.service.ts:178-206` — el comentario C-3 explica que el discriminante temporal resucitaba sesiones recién cerradas |
| Reuso ⇒ se invalida **toda la familia** | `session.service.ts:387-394` |
| Tolerancia de concurrencia según RFC 9700 §4.14.2 | `session.service.ts:195-212` |
| El token presentado se compara contra su hash, en tiempo constante | `session.service.ts:359-381` |
| `jti` atado al sujeto, además de firmado | `session.service.ts:138-146` |
| Binding de dispositivo por navegador/SO en la rotación | `session.service.ts:215-236` |
| Revocación real de tokens de acceso ya emitidos | `session-registry.service.ts` completo; consultado en `user-identity.service.ts:89-94` |
| **No falla abierto**: un error de Redis cae a la base, no a «no revocado» | `session-registry.service.ts:85-99` |
| La lista de denegación vive lo que vive el token de acceso, más margen de reloj | `auth.config.ts:174-179` |
| Cambio de contraseña ⇒ `tokenVersion` + revocación de todas las sesiones | `auth.service.ts:399-406` |
| `tokenVersion` comprobado también en el **refresco**, no solo en el acceso | `session.service.ts:101-112` |
| Sesión estable entre rotaciones (familia), y la lista de sesiones agrupa por familia | `token.service.ts:284-286`; `session.service.ts:396-436` |
| «Recordarme» se re-deriva de la vida de la fila, no de una reclamación manipulable | `session.service.ts:65-82, 249-256` |
| La empresa sobrevive a la rotación | `session.service.ts:264-285` |
| Impersonación con vida corta que la rotación no promociona | `session.service.ts:258-262` |
| Limpieza por lotes con lock de asesoramiento, para que N réplicas no la repitan | `session.service.ts:575-608` |

### Por qué no 10 — lo que descuenta

1. **M-4: el WebSocket no consulta la lista de revocación.** `events.gateway.ts:53-90` comprueba
   firma, `tokenVersion` y estado, y nunca `isRevoked`. Como `terminateCurrentSession` y
   `revokeSession` **no** suben `tokenVersion` —por diseño, para no tumbar las demás sesiones—, su
   único efecto sobre un token de acceso vivo es la lista de denegación. Resultado: tras «cerrar
   sesión», un token capturado sigue abriendo un socket y recibiendo los eventos de la sala
   `org:<id>` hasta 15 minutos. `SessionService.verifyUserFromToken` (`:555-557`) **sí** hace la
   comprobación correcta: el gateway tiene una copia de la lógica, y es la copia la que diverge.
2. **M-6: restablecer la contraseña limpia menos que cambiarla.** `password-recovery.service.ts:86-89`
   sube `tokenVersion` y limpia la caché, pero **no** llama a `terminateAllSessions`. Las filas
   quedan con `isRevoked = false` y `expiresAt` futuro, así que `getUserSessions`
   (`session.service.ts:404-408`) **sigue listándolas como vivas**. Y está al revés de como debería:
   el restablecimiento por correo es el camino post-compromiso.
3. **B-1: el respaldo a base de datos consulta la columna equivocada.**
   `session-registry.service.ts:104-107` busca `where: { id: sessionId }`, pero `sessionId` es el id
   de **familia**, que coincide con el `id` de la primera fila (`token.service.ts:283-284`). En
   cuanto esa sesión rota una vez, esa fila queda `isRevoked = true` (`session.service.ts:172-175`),
   así que durante una caída de Redis el respaldo devuelve `true` para toda sesión que haya rotado
   —es decir, todas—. Falla cerrado, pero la «fuente de verdad» nunca dice la verdad.
4. **No hay vida máxima absoluta ni expiración por inactividad.** `expiresAt` se recalcula en cada
   rotación (`token.service.ts:272`: `Date.now() + ms(refreshExpiration)`), de modo que una sesión
   que se refresca cada quince minutos **no caduca nunca**. `lastActiveAt` se registra
   (`session.service.ts:291`) y solo se usa para mostrar y para el viaje imposible; nada la
   convierte en expiración. Búsqueda que lo confirma: no existe `MAX_SESSION`, `absoluteExpiry` ni
   `idleTimeout` en todo `apps/backend/api/src/app/auth`.
5. **B-3: las filas sin `tokenHash` se aceptan sin fecha de caducidad**
   (`session.service.ts:366-368`). La compatibilidad es razonable; la excepción sin corte no.
6. **B-5: el gateway acepta la cookie `access_token` sin prefijo también en producción**
   (`events.gateway.ts:45`), mientras `jwt.strategy.ts:34-38` la restringe a desarrollo. La firma
   sigue siendo obligatoria, así que no es explotable por sí solo, pero son dos contratos distintos
   para el mismo token.

### Calibración

- **No es menos de 8**: la parte difícil —rotación con detección de reuso por causa, revocación de
  tokens de acceso autocontenidos, y no fallar abierto ante una caída de la caché— está resuelta, y
  resuelta mejor que en la mayoría de productos comparables.
- **No es 9 o 10** porque hay un canal (WebSocket) donde la revocación **no rige**, y porque una
  sesión puede vivir indefinidamente.

### Cómo llegar al 10

1. **Añadir la comprobación de revocación al handshake del WebSocket**, y desconectar activamente
   los sockets de una sesión cuando se revoque:
   ```ts
   if (await this.sessionRegistry.isRevoked(payload.sessionId)) { client.disconnect(true); return; }
   ```
   Mejor aún: que el gateway llame a `sessionService.verifyUserFromToken`, que ya hace lo correcto, y
   borrar la copia divergente.
2. **`resetPassword` llama a `sessionService.terminateAllSessions(user.id)`**, igual que
   `changePassword`. NIST SP 800-63B §7.1 —que el comentario de `changePassword` ya cita— no
   distingue entre las dos formas de cambiar una contraseña.
3. **Corregir el respaldo de la lista de revocación** para que consulte la familia:
   ```ts
   const rows = await this.refreshTokenRepository.find({ where: { sessionId }, select: ['isRevoked','expiresAt'] });
   if (!rows.length) return true;
   return rows.every((r) => r.isRevoked || r.expiresAt.getTime() < Date.now());
   ```
4. **Vida máxima absoluta de sesión.** Guardar el `createdAt` de la **primera** fila de la familia y
   negarse a rotar pasado, digamos, `AUTH_SESSION_ABSOLUTE_MAX` (30 días; 12 h para impersonación).
   Hoy el dato existe y no se usa.
5. **Expiración por inactividad**, derivada de `lastActiveAt`, configurable y más corta para
   sesiones sin «recordarme».
6. **Fecha de corte para las filas sin `tokenHash`**: rechazar la que no lo tenga y cuyo `createdAt`
   sea posterior al despliegue que introdujo el hashing.
7. **Unificar el nombre de cookie aceptado** entre `JwtStrategy` y el gateway, leyendo ambos de
   `CookieService`, que es donde vive el nombre.

---

## Eje 4 · Manejo de secretos — **6 / 10**

### Por qué 6

Lo que está bien hecho, y es bastante:

| Control | Evidencia |
|---|---|
| **Ningún secreto real comiteado.** `.env.example` solo contiene marcadores | `.env.example:58-74, 139-141, 182, 240` — todos `REPLACE_WITH_…` o `price_REPLACE` |
| Esquema de entorno que **impide arrancar** sin secretos en producción | `env.validation.ts:61-66`, 9 secretos en `:69-79` |
| Pinchado por pruebas, una por secreto | `env.validation.spec.ts:109-140` — `it.each([...CRYPTOGRAPHIC_SECRETS])('rejects production with %s missing')` |
| El valor de desarrollo es **distinto por secreto**, para que una filtración no forje las demás | `env.validation.ts:58-59`; pinchado en `:66-70` del spec |
| Y **estable**, para que una recarga no cierre la sesión | spec `:72-76` |
| `NODE_ENV` como lista blanca de tres valores: `staging`, `prod`, `dev` y `''` se rechazan | `env.validation.ts:82-84`; spec `:186-194` |
| Segunda capa de validación: longitud mínima y patrones de marcador | `auth.config.ts:31-76` |
| Secretos separados por propósito, para rotación independiente | `auth.config.ts:142-148` |
| Claves RSA **obligatorias** fuera de desarrollo | `key-management.service.ts:59-63` |
| Claves de firma del marketplace obligatorias en producción | `signing-key.provider.ts:305-309` |
| Secretos de IdP cifrados en reposo con AES-256-GCM | `secret-encryption.service.ts:30-36` |
| Secretos TOTP cifrados, con clave heredada solo para descifrar (rotación gradual) | `crypto.util.ts:9-30, 61-68` |
| La caché **dejó de guardar** hashes y secretos TOTP | `user-identity.service.ts:238-269` |
| IP enmascarada para mostrar, cifrada para forense | `token.service.ts:192-220` |
| Contraseñas fuera de las cabeceras: se eliminó `x-reauth-password`, que `pino-http` serializaba | `step-up.guard.ts:19-34` |
| El frontend no hornea valores por defecto: el build falla si faltan | `tools/generate-environment.mjs:31-40` |

### Por qué no más — lo que descuenta

1. **A-3 corregido: `NODE_ENV` sin definir inyecta 9 secretos públicos.** `env.validation.ts:84`
   convierte «sin definir» en `development`, y `:58-59` los rellena con
   `sha256('virteex-dev-only:' + nombre)` — un valor **que cualquiera puede calcular leyendo este
   archivo**. Entre ellos `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CSRF_SECRET`, `ENCRYPTION_SECRET`,
   `AUTH_SALT` y `JWT_STEP_UP_SECRET`. Y `env.validation.spec.ts:196-204` **fija ese comportamiento
   como correcto**, así que no es un descuido: es una decisión escrita.
2. **`dev12345` como contraseña de administrador en el código** (`dev-seeder.service.ts:41`), además
   impresa en el log (`:70-72, 87-89`). Es CWE-798 literal, y el propio comentario del archivo dice
   que negarse a correr en producción «es la seguridad entera de la funcionalidad» — con una puerta
   que, como se ha visto, no cierra el caso que importa.
3. **`'valid-signature'` como firma válida** bajo `NODE_ENV=test` (`sandbox.service.ts:323`), que
   además desactiva el control SSRF (`:278`). Una cadena literal en el repositorio sustituyendo a
   una firma RSA.
4. **Tres derivaciones de clave y dos formatos incompatibles para el mismo dato.** Esto es concreto
   y verificable:

   | Servicio | Derivación | Formato de salida |
   |---|---|---|
   | `CryptoUtil` | `scryptSync(secret, AUTH_SALT \|\| 'default-salt-change-me-in-prod', 32)` (`crypto.util.ts:20-27`) | `iv:tag:ct` (`:42`) |
   | `TokenService` | `scryptSync(getOrThrow(ENCRYPTION_SECRET), getOrThrow(AUTH_SALT), 32)` (`token.service.ts:183-189`) | `iv:ct:tag` (`:219`) |
   | `SecretEncryptionService` | `scryptSync(get(ENCRYPTION_SECRET) \|\| 'dev-secret-encryption', AUTH_SALT \|\| 'secret-encryption-salt', 32)` (`secret-encryption.service.ts:18-27`) | `iv:ct:tag` (`:35`) |

   La consecuencia es medible: **la columna `refresh_tokens.encrypted_ip` se escribe en dos formatos
   distintos.** Al emitir el token la escribe `TokenService.encryptIp` como `iv:ct:tag`
   (`token.service.ts:138` → `:213-220`); al refrescar la escribe `SessionService.encryptIp` como
   `iv:tag:ct` (`session.service.ts:300` → `:707-709` → `CryptoUtil.encrypt`). **Y no hay ningún
   lector**: `grep -rn "encryptedIp" apps/backend/api/src` devuelve solo los dos escritores, la
   definición de columna (`refresh-token.entity.ts:69-70`) y la migración. Así que el control
   forense que `token.service.ts:274-275` declara —*«the encrypted copy exists only for incident
   forensics»*— no puede cumplirse: el día que alguien lo necesite, la mitad de las filas fallará la
   autenticación GCM.

   Y el comentario que dice haberlo arreglado sigue ahí: `session.service.ts:705-707` afirma
   *«delegate to the centralized CryptoUtil so all encryption shares one key derivation […] Removes
   the third, divergent derivation»*. La tercera derivación **no se eliminó**: se quitó de
   `SessionService` y sigue viva en `TokenService:183-220`.
5. **`CryptoUtil` cae a un salt literal cuando `AUTH_SALT` falta y `NODE_ENV !== 'production'`**
   (`crypto.util.ts:22-25`): `'default-salt-change-me-in-prod'`. Es la lista negra otra vez, y el
   valor coincide con uno de los patrones que `auth.config.ts:31-38` rechaza por inseguro — pero
   esa validación no se aplica a este camino.
6. **No hay rotación de `ENCRYPTION_SECRET`.** `CryptoUtil` mantiene una clave heredada
   (`:28-29`) para descifrar datos viejos, lo que permitiría una rotación gradual, pero es de
   **salt**, no de secreto, y ni `SecretEncryptionService` ni `TokenService` tienen equivalente. Un
   `ENCRYPTION_SECRET` comprometido no se puede cambiar sin perder los secretos TOTP y los de IdP.

### Calibración

- **No es menos de 6**: no hay ningún secreto real en el repositorio, la producción se niega a
  arrancar sin ellos, y hay más de treinta pruebas fijando esa propiedad. Eso está por encima de la
  media.
- **No es 7 u 8** porque existe un camino de configuración —`NODE_ENV` sin definir— que sustituye
  los nueve secretos criptográficos por valores publicados en el repositorio, y está **fijado como
  comportamiento deseado** por una prueba.

### Cómo llegar al 10

1. **Quitar `.default('development')` de `NODE_ENV`** (`env.validation.ts:84`) y exigirlo siempre.
   Corregir `env.validation.spec.ts:196-204`, que hoy prueba lo contrario.
2. **Eliminar `dev12345` del código.** Aleatoria por arranque, impresa una vez, o exigir
   `DEV_SEED_PASSWORD` sin valor por defecto.
3. **Eliminar la rama de prueba de `verifyCodeSignature`** (`sandbox.service.ts:323`) y firmar de
   verdad en las pruebas con una clave efímera inyectada.
4. **Una sola primitiva de cifrado.** Que `TokenService` y `SecretEncryptionService` usen
   `CryptoUtil`, con un único formato. Y **migrar `encrypted_ip`**: como no hay lector, la opción
   barata y honesta es vaciar la columna y reescribirla con el formato único; la alternativa es un
   prefijo de versión (`v2:iv:tag:ct`) que permita distinguir. Elegir una, pero no dejar la columna
   como está.
5. **Escribir el lector forense** que justifica que la columna exista, o **borrar la columna**. Un
   dato cifrado que nadie puede descifrar no es un control: es una responsabilidad.
6. **Quitar el salt literal de `CryptoUtil`** (`:25`) y pasar por `requireSecret`, para que la
   validación de marcadores de posición de `auth.config.ts:31-38` también lo cubra.
7. **Rotación de `ENCRYPTION_SECRET`**: aceptar `ENCRYPTION_SECRET_PREVIOUS` para descifrar,
   reescribiendo con la actual, en las tres rutas. El patrón ya existe en `KeyManagementService`
   (`RS_RETIRED_PUBLIC_KEYS`, `:113-136`); replicarlo.
8. **Una prueba que barra el árbol** y falle si aparece una segunda derivación de
   `ENCRYPTION_SECRET`. El comentario de `session.service.ts:705` demuestra que una afirmación en
   prosa no basta para mantener esta propiedad.

---

## Eje 5 · Consistencia entre implementaciones — **5 / 10**

Este eje no mide si hay reglas correctas. Mide si **cada regla rige en todos sus sitios**. El
criterio es el del encargo: la implementación más débil es el nivel real del sistema.

### Lo que sostiene la parte alta

El proyecto no solo tiene la intención correcta: la ha ejecutado varias veces, y lo ha documentado.

| Unificación lograda | Evidencia |
|---|---|
| **Una** resolución de identidad, creada explícitamente porque había dos que habían divergido | `user-identity.service.ts:17-36` — incluye la tabla de divergencias: `JwtStrategy` aceptaba `PENDING`, `TokenService` no |
| **Un** `hasPermission` compartido por frontend y backend | `libs/shared/util-auth/src/lib/permissions.util.ts`, usado en `permissions.guard.ts:94`, `roles.service.ts:89`, `impersonation.service.ts:63` |
| **Un** mecanismo de reautenticación: se eliminó `TwoFactorVerifiedGuard` | `auth.service.ts:412-422`, `step-up.guard.ts:19-38` |
| **Un** catálogo de permisos, compuesto por módulo | `shared/permissions.ts:1-38` |
| **Una** declaración de permiso que lleva su propio guard | `permissions-enforced.spec.ts:24-56` |
| **Un** origen para el nombre y el path de cada cookie | `cookie.service.ts:34-45` |
| Los guards globales existen precisamente porque el control por endpoint fallaba, con las cifras medidas: CSRF 4/50, derecho de uso 1/67, permisos 47/76 | `app.module.ts:352-356, 381-389, 394-396` |
| Verificadores estáticos en CI que impiden la regresión | `tools/verify/tenant-scope-guard.mjs`, `required-markers.mjs` (ambos en verde hoy) |

Eso es trabajo real y merece reconocimiento. La nota no es 5 por falta de intención.

### Las divergencias vivas — la lista completa

| # | Regla | Dónde rige | Dónde no | Evidencia |
|---|---|---|---|---|
| 1 | Lista blanca de entornos para los comportamientos de desarrollo | `auth.config.ts:22-24`, `key-management.service.ts:59`, `jwt.strategy.ts:36`, `cookie.service.ts:30-32` | Sembrador (`main.ts:218`, `dev-seeder.service.ts:33`), Swagger (`main.ts:162`), sandbox (`sandbox.service.ts:278, 294, 323`), admisión (`plugin-admission.service.ts:54, 128, 165`), `SigningKeyProvider:305`, `CryptoUtil:22`, `SecretEncryptionService:21`, `TokenService:185` | 5 formas distintas conviviendo |
| 2 | **Y el esquema y `auth.config` discrepan sobre «sin definir»** | `env.validation.ts:84` lo hace `development` | `auth.config.ts:13-16` afirma que lo trata como despliegue real | Dos archivos, la misma regla declarada, resultados opuestos |
| 3 | Nadie delega derechos que no tiene | `users.service.ts:220, 722` | `sso-admin.service.ts:80, 87-93` | El comentario de `users.service.ts:717-719` afirma que son los únicos dos sitios |
| 4 | Decidir por conjunto de permisos, no por nombre de rol | `impersonation.service.ts:51-67` (corregido, con la razón escrita) | `enterprise-sso.service.ts:224-225` | Mismo antipatrón, un archivo corregido y otro no |
| 5 | Consultar la lista de revocación de sesiones | `user-identity.service.ts:89-94`, `session.service.ts:555-557` | `events.gateway.ts:53-90` | El gateway tiene copia propia de la lógica |
| 6 | Terminar las sesiones al cambiar la contraseña | `auth.service.ts:405` | `password-recovery.service.ts:86-89` | El camino post-compromiso hace menos |
| 7 | Una sola derivación de clave de cifrado | — | `crypto.util.ts:20-27`, `token.service.ts:183-189`, `secret-encryption.service.ts:18-27` | Tres, con **dos formatos incompatibles** sobre la **misma columna** |
| 8 | Reclamación atómica contra el consumo concurrente | TOTP: `two-factor-auth.service.ts:109-141` (`UPDATE` condicional, con la razón escrita); step-up: `step-up.guard.ts:113-126`; rotación: `session.service.ts:172-175` | Códigos de respaldo: `two-factor-auth.service.ts:302-306` hace `filter` + `save` | **En el mismo archivo**: el TOTP se protege con un UPDATE condicional y el código de respaldo con lectura-modificación-escritura |
| 9 | El nombre de cookie aceptado para el token de acceso | `jwt.strategy.ts:34-38` (solo `__Host-` en producción) | `events.gateway.ts:45` (acepta el desnudo siempre) | Dos contratos para el mismo token |
| 10 | Usar `PasswordService.verify` en lugar de `argon2.verify` | `auth.service.ts:104, 363`, `two-factor-auth.service.ts:302` | `password-recovery.service.ts:74` | El mismo archivo usa `passwordService.hash` dos líneas después |

Diez divergencias. Cinco de ellas (1, 3, 4, 5, 7) están **contradichas por un comentario del propio
repositorio que afirma que la unificación ya ocurrió**. Ese es el patrón que define la nota: no es
que falten reglas, es que la prosa va por delante del código.

### Calibración

- **No es menos de 5**: las unificaciones logradas son reales, están probadas y son más de las que
  se ven normalmente. Los guards globales y el `hasPermission` compartido eliminan clases enteras de
  inconsistencia.
- **No es 6 o 7** porque cinco de las diez divergencias están explícitamente negadas por comentarios
  que dicen lo contrario. Un comentario equivocado es peor que ninguno: el siguiente auditor lo lee,
  lo cree y no mira.

### Cómo llegar al 10

1. **Cerrar las diez**, en el orden de la tabla. Ocho son cambios de pocas líneas; la 7 necesita
   además una decisión sobre `encrypted_ip`.
2. **Convertir cada regla unificada en un verificador estático**, porque la prosa no la mantiene.
   El repositorio ya sabe hacer esto —`tenant-scope-guard.mjs`, `required-markers.mjs`,
   `route-authorisation.spec.ts`, `permissions-enforced.spec.ts`—; lo que falta es aplicarlo a las
   reglas que hoy solo viven en un comentario:
   - `verify:env-gating` — el único lector de `NODE_ENV` permitido es `isDevLikeEnvironment()`, con
     una lista de excepciones anotadas.
   - `verify:role-assignment` — toda escritura sobre `user.roles` o un campo `*RoleId` va precedida
     de `assertCanAssignRole`.
   - `verify:session-revocation` — todo validador de token consulta `SessionRegistryService`.
   - `verify:crypto` — una sola derivación de `ENCRYPTION_SECRET`.
3. **Cambiar cómo se cierra un hallazgo.** Los cinco comentarios que afirman una unificación que no
   ocurrió comparten causa: se corrigió el sitio donde se encontró el fallo y se escribió la
   conclusión general. La regla debería ser: *cuando se corrige una clase de fallo, se busca la
   clase entera y se deja un verificador; hasta entonces, el comentario dice «corregido aquí», no
   «eliminado»*.
4. **Auditar los comentarios como se audita el código.** Los cinco citados deben corregirse aunque
   el código no cambie hoy, porque hoy mismo están induciendo a error.

---

## Resumen

| Eje | Nota | Lo que impide el 10, en una línea |
|---|---|---|
| Autenticación | **9** | Un `NODE_ENV` sin definir siembra un administrador con contraseña publicada; y el 2FA no se puede exigir por organización |
| Autorización | **4** | Un recurso de toda la plataforma se administra con un permiso de inquilino, y el control de delegación de roles no cubre el SSO |
| Sesión / token | **8** | La revocación no rige en el WebSocket, y una sesión puede vivir indefinidamente |
| Manejo de secretos | **6** | «Sin definir» inyecta nueve secretos calculables desde el repositorio, y hay tres cifrados donde debería haber uno |
| Consistencia | **5** | Diez divergencias vivas, cinco de ellas negadas por un comentario que afirma que ya se cerraron |

El trabajo para subir los cinco ejes a 10 son **32 acciones concretas**, enumeradas arriba. Ninguna
es una reescritura: la más grande es dar propiedad y nivel de plataforma al catálogo de extensiones.
Veintitrés de las treinta y dos son cambios de menos de diez líneas.
