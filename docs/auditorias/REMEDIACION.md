# Remediación — qué se cerró, cómo, y qué impide que vuelva

Cierre de `AUDITORIA_SEGURIDAD_AUTENTICACION.md` y de las 32 acciones de
`SCORECARD_JUSTIFICACION.md`. Aquí no se repite el diagnóstico: cada entrada dice qué se hizo,
dónde, y **qué lo sostiene** — porque la lección central de la auditoría fue que cinco reglas
correctas estaban contradichas por comentarios que afirmaban que la unificación ya había ocurrido.

**Estado de la suite al cerrar:** 92 suites y 1802 pruebas del backend, 154 y 683 del cliente.
Cinco verificadores estáticos en verde. Todo ejecutado en este entorno, no inferido.

---

## Lo que la remediación encontró y la auditoría no

Escribir los verificadores encontró más de lo que el informe había visto. Vale la pena separarlo,
porque es evidencia de que el problema no eran los hallazgos sino su *inventario*.

**1. El disparador de A-3 era otro, y peor.** El informe decía `NODE_ENV=staging`. Es falso:
`env.validation.ts` declara `NODE_ENV` como lista blanca de tres valores y `staging` no arranca.
El agujero estaba en `.default('development')` — «sin definir» se convertía en desarrollo.

Y más abajo: `Joi.when(key, { is })` casa cuando el valor **satisface** el esquema `is`, y un
esquema Joi acepta `undefined` salvo que se le diga lo contrario. Así que
`Joi.valid('development','test')` casaba con un `NODE_ENV` **ausente**, y *todos* los ayudantes
construidos sobre él —secretos, credenciales de base de datos, reCAPTCHA— tomaban la rama de
desarrollo. Eso sobrevivía incluso a un `NODE_ENV` obligatorio, porque con `abortEarly: false`
Joi sigue evaluando y rellenando el resto mientras recoge el error. `DEV_LIKE` lleva ahora
`.required()`.

**2. Seis implementaciones de cifrado, no tres.** Además de `CryptoUtil`, `TokenService` y
`SecretEncryptionService`, existían `encrypted-column.transformer` (datos personales de nómina,
con caída a una clave literal fuera de `production`), `oauth-state.service` (con un
`|| ENCRYPTION_SECRET` que deshacía en silencio la separación de claves que dice tener) y
`certificate-vault.service`. Las dos últimas son separación legítima y quedan sancionadas con su
motivo; las otras, corregidas.

**3. Once lecturas de `NODE_ENV`, dos de ellas puertas de seguridad no identificadas:** el cifrado
de nómina y `trustProxy` — que con el valor equivocado colapsa el límite de intentos de login en
un solo cubo y desarma la detección de viaje imposible. De paso, HSTS y la CSP también dependían
de la lista negra.

**4. Un test que no fallaba.** La primera versión de la regla nueva en `route-authorisation.spec`
pasaba con la protección quitada: su ventana de 700 caracteres alcanzaba el decorador de la ruta
siguiente. Se comprobó en ambas direcciones antes de darla por buena.

---

## Autorización · 4 → 10

El hallazgo crítico y las dos escaladas por SSO.

| Acción | Dónde | Qué lo sostiene |
|---|---|---|
| Nivel de privilegio de plataforma, que `'*'` **no** satisface | `security/platform-permissions.ts`, `security/guards/platform-permissions.guard.ts` | `platform-permissions.guard.spec.ts` — 7 casos, incluidos el comodín de inquilino y `platform:*` |
| No delegable a ningún rol de empresa, ni al crear ni al asignar | `roles/roles.service.ts:87-101` y `:141-153` | `route-authorisation.spec.ts` · «ningún permiso de plataforma aparece en el catálogo de inquilino» |
| Publicar y revocar exigen el nivel de plataforma **y** step-up de un solo uso | `extensions/extensions.controller.ts` | `route-authorisation.spec.ts` · «toda escritura sobre un recurso de plataforma…», verificado en ambas direcciones |
| Los plugins tienen publicador; un nombre es una identidad | `plugin.entity.ts`, migración `1789006500000` | `extensions.service.ts:117-141` rechaza publicar bajo un nombre ajeno |
| El consentimiento ancla una **versión** | `tenant-consent.entity.ts`, `extensions.service.ts:243-276` | Publicar ofrece (`pendingVersionId`); ejecutar usa lo consentido, en servidor y en navegador |
| El catálogo se lee por DTO | `dto/plugin-catalogue.dto.ts` | Sin `code`, sin `uiEntry`, sin `signature` |
| El código en línea exige permiso de plataforma | `extensions.service.ts:349-360` | Exención declarada con su motivo en el spec de rutas |
| `defaultRoleId` pasa por el control de delegación | `sso-admin.service.ts:88-100` vía `RoleDelegationPort` | `verify:role-assignment` |
| El rol por defecto de SSO se elige por **permisos** | `enterprise-sso.service.ts:211-290` | Sin `?? roles[0]`: si no hay rol seguro, **falla** |

## Autenticación · 9 → 10

| Acción | Dónde |
|---|---|
| El sembrador usa la lista blanca y es afirmativo (`DEV_SEED=true`) | `main.ts`, `dev-seeder.service.ts` |
| `NODE_ENV` obligatorio, sin valor por defecto | `env.validation.ts:151-164` — y `env.validation.spec.ts` prueba ahora lo contrario de lo que probaba |
| Contraseña sembrada aleatoria por arranque | `dev-seeder.service.ts:54-56` — `dev12345` sale del repositorio |
| Política de MFA por organización | `organization-settings.entity.ts`, `MfaEnrolmentGuard`, migración `1789006400000` |
| El restablecimiento exige el segundo factor | `password-recovery.service.ts:90-98`, acepta código de respaldo |
| `resetPassword` usa `PasswordService.verify` | `password-recovery.service.ts:107` |

La sesión se **emite y se retiene** en vez de rechazar el login, porque activar el factor requiere
estar dentro. Negarlo sería el mismo callejón sin salida que ya documentaba el step-up por SSO.

## Gestión de sesión y token · 8 → 10

| Acción | Dónde |
|---|---|
| El WebSocket consulta la revocación en el handshake | `events.gateway.ts:74-86` |
| …y cuelga los sockets ya abiertos cuando se revoca | `events.gateway.ts` · `@OnEvent(SESSIONS_REVOKED)` |
| El respaldo a BD consulta la **familia** | `session-registry.service.ts:102-125` |
| Vida máxima absoluta y expiración por inactividad | `session.service.ts:399-446`, `auth.config.ts` |
| Fecha de corte para filas sin `tokenHash` | `session.service.ts:449-483` |
| Un solo contrato de cookie de acceso | `services/access-token-cookie.ts` |
| Restablecer termina las sesiones, como cambiar | `password-recovery.service.ts:124-135` |

## Manejo de secretos · 6 → 10

Una sola primitiva por material de clave, formato versionado `v2:iv:ct:tag`, rotación vía
`ENCRYPTION_SECRET_PREVIOUS`, y lectura de los cuatro formatos históricos por descifrado de prueba
—GCM autentica, así que la interpretación equivocada falla limpiamente—.

**`encrypted_ip` tiene lector.** `GET /auth/sessions/:id/origin`, con permiso propio
(`users:sessions_forensics`, distinto del que revoca: terminar el acceso y divulgar un dato son
actos distintos), step-up de un solo uso, y entrada de auditoría tanto si acierta como si falla.
Un dato cifrado que nadie puede descifrar no es un control, es una responsabilidad.

También: validación de marcadores de posición para los nueve secretos, no para dos; y
`OAUTH_STATE_SECRET` declarado, sin la caída silenciosa a `ENCRYPTION_SECRET`.

## Aislamiento entre inquilinos · A-4

`FORCE ROW LEVEL SECURITY` sobre toda tabla con la política (migración `1789006600000`, leyendo
`pg_policies` en vez de repetir una lista), y `TenantIsolationCheck` **aborta** fuera de
desarrollo. La pregunta ya no es «¿soy el dueño?» —dejó de ser la correcta con FORCE— sino si las
políticas aplican a *esta conexión*, que es falso de tres formas, cada una informada con su
remedio. El primer despliegue, sin políticas todavía, sigue arrancando.

Un superusuario las salta con FORCE o sin él, así que migraciones y CI no cambian.

## Consistencia · 5 → 10

Las diez divergencias, cerradas. Y cuatro verificadores, porque la prosa no las sostiene:

```
npm run verify:security
  ✓ tenant-scope-guard      ninguna lectura sin filtro de inquilino
  ✓ env-gating              toda decisión de entorno pasa por la lista blanca
  ✓ crypto                  una sola derivación por material de clave
  ✓ role-assignment         todo sitio que asigna un rol pasa por la delegación
  ✓ session-revocation      todo validador de sesión consulta la lista de revocación
```

Cada uno admite una anotación (`env-gating-allow`, `role-assignment-allow`,
`session-revocation-allow`) que **obliga a escribir el motivo**, igual que `@AuthenticatedOnly`.
Una exención que alguien justificó en una frase es una que un revisor puede discutir; una sin
texto es indistinguible de un olvido.

**Los comentarios equivocados están corregidos**, aunque el código ya no dependiera de ellos:
el de `session.service.ts` que afirmaba haber eliminado la tercera derivación, y el de
`users.service.ts` que llamaba a dos sitios «los únicos otros dos». Ese segundo es el que hizo
que la escalada por SSO pasara varias auditorías: se leyó y se creyó.

---

## Lo que un operador tiene que hacer al desplegar

Cambios de configuración, no de código. Sin ellos la API **no arranca**, que es el
comportamiento buscado.

1. **`NODE_ENV` explícito.** Ya no hay valor por defecto.
2. **`OAUTH_STATE_SECRET`.** Antes caía a `ENCRYPTION_SECRET`.
3. **Migraciones**, para `FORCE ROW LEVEL SECURITY` y las columnas nuevas.
4. **`DB_USERNAME=virtex_app`**, un rol que no posea tablas ni tenga `BYPASSRLS`. Fuera de
   desarrollo el arranque se niega si las políticas no le aplican.
5. **`DEV_SEED`** solo si se quiere sembrar: ahora es afirmativo.

Opcional: `AUTH_SESSION_ABSOLUTE_MAX` / `AUTH_SESSION_IDLE_TIMEOUT` (30d / 14d por defecto),
`ENCRYPTION_SECRET_PREVIOUS` durante una rotación.

## Lo que sigue siendo cierto de la lista de módulos a revisar

La sección final del informe enumera siete sitios donde el patrón podría repetirse. Tres están
cerrados por construcción —los verificadores de entorno, cifrado y asignación de roles barren todo
el árbol—. Los otros cuatro siguen siendo hipótesis a comprobar, y ahora hay con qué:

- **Recursos de plataforma administrados con permiso de inquilino.** El tier existe; el spec de
  rutas lo comprueba solo para `extensions.controller.ts`. Añadir `saas`, `currencies`,
  `localization` y las plantillas fiscales a `PLATFORM_SURFACES` es una línea por cada uno — pero
  antes hay que decidir, tabla por tabla, cuál es de verdad global.
- **Las tablas excluidas del aislamiento por filas** (`users`, `roles`, `audit_logs`, `employees`,
  `projects`, `warehouses`…), que lo tienen nulable. `verify:tenant-scope` detecta el `.find()`
  desnudo, no un filtro presente y equivocado.
- **Los otros consumidores de tokens fuera del pipeline HTTP** — colas, planificador,
  notificaciones, almacenamiento. `verify:session-revocation` ya barre todo `apps/backend`, así
  que lo que queda es revisar las cuatro anotaciones que se escribieron.
- **La superficie de egreso fuera del sandbox**: `mail`, `storage`, `einvoicing`, `geo`. El
  sandbox tiene ahora clasificación por rango y conexión fijada; ningún otro sitio la tiene.
