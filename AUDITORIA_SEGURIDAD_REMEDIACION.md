# Remediación de la auditoría de seguridad y autenticación

Acompaña a `AUDITORIA_SEGURIDAD_AUTENTICACION.md`, que se conserva sin retocar: el informe dice
qué se encontró y por qué era explotable; esto dice qué se hizo, qué apareció por el camino y
cómo está comprobado.

Verificado contra una base de datos PostgreSQL real levantada para esta tarea, con las 97
migraciones aplicadas desde cero.

---

## Los quince hallazgos

| # | Hallazgo | Severidad | Arreglo |
|---|---|---|---|
| A-1 | El bloqueo por intentos era un oráculo de contraseña | Alta | `AuthService.assertNotLockedOut`: misma respuesta, mismo cuerpo, mismo trabajo y mismo retardo que una contraseña incorrecta |
| A-2 | `consolidation/mapping` aceptaba cualquier empresa como subsidiaria | Alta | Se comprueba el vínculo contra `organization_subsidiaries`, y que cada cuenta sea de la empresa que le toca |
| A-3 | `synchronize-view` reconstruía la vista de todos con las dimensiones de uno | Alta | Permiso de plataforma + step-up de un solo uso; las columnas salen de toda la instalación |
| A-4 | `synchronize-view` tumbaba el proceso | Media | El controlador espera la promesa, y hay manejador de `unhandledRejection` |
| A-5 | La suplantación leía un campo que el principal nunca trae | Media | Lee `principal.permissions`; el spec construye el principal como producción |
| A-6 | El contador de fallos no se reiniciaba con 2FA | Media | Colgado de `TokenService.generateAuthResponse`, el embudo de toda autenticación |
| A-7 | Dos reglas de CORS; el WebSocket con `localhost:4200` fijo | Media | `parseCorsOrigins` compartido + `ConfiguredIoAdapter`; el handshake resuelve el principal por la vía única |
| A-8 | El consentimiento de extensiones se eludía por dos caminos | Media | Se comprueba siempre que haya `pluginName`; una versión fijada tiene que ser la consentida |
| A-9 | El nombre de dimensión entraba crudo en un literal SQL | Baja | Escapado explícito + `@Matches` en el DTO |
| A-10 | El arranque toleraba CERO políticas de aislamiento | Media | Aborta salvo `DEPLOY_ALLOW_UNPROTECTED_BOOTSTRAP=true`, y comprueba la cobertura |
| A-11 | El barrido de RLS no veía tablas sin `organization_id` | Media | Clasificación completa y obligatoria de las 170 tablas; 9 hijas recibieron política |
| A-12 | El cambio de empresa fallaba ABIERTO hacia la de origen | Media | Lanza en lugar de devolver la empresa anterior |
| A-13 | El verificador de `NODE_ENV` no veía las lecturas por `ConfigService` | Baja | Tres patrones nuevos; los 9 sitios pasados a la lista blanca |
| A-14 | El guard de alcance solo veía el `.find()` desnudo | Baja | Cubre lookup-por-id y query builders; 26 lecturas legítimas anotadas con su motivo |
| A-15 | Un segundo almacén de permisos dormido en el esquema | Baja | `supplier_portal_users.permissions` eliminada, con migración |

---

## Los tres hallazgos NUEVOS que aparecieron al arreglar los quince

Ninguno estaba en el informe. Los tres los encontró la propia remediación, que es el argumento a
favor de arreglar el mecanismo y no solo el síntoma.

### N-1 · `GET /bi/sales` devolvía las ventas de TODOS los inquilinos — **CRÍTICO**

Lo encontró el verificador de alcance ampliado (A-14), en el módulo que el informe había señalado
como «revisar con más profundidad».

`BiService.getSalesData` hacía `createQueryBuilder('cube')` **sin ningún filtro de inquilino**,
sobre una vista que lleva `organization_id` en cada fila. Y por ser una VISTA, las políticas de
fila de las tablas base tampoco la cubren —una vista normal se ejecuta con los privilegios de su
dueño salvo que se declare `security_invoker`—, así que no había segunda capa debajo. Bastaba
`bi:view`, que el `'*'` de cualquier administrador satisface.

Encima, tres vectores más en el mismo método:

- **Inyección SQL**: `dimensions`, `measures` y las CLAVES de `filters` se interpolaban crudas
  (`SUM(cube.${measure})`, `cube.${key} = :param`). El VALOR del filtro iba como parámetro; el
  nombre de la columna, que es lo que decide qué se lee, no. El DTO solo pedía que fueran cadenas.
- **Caché envenenada entre inquilinos**: la clave era `sales_query_${hash(query)}` — sin empresa.
  Dos clientes pidiendo el mismo informe («ventas por mes de este año») generaban la misma clave,
  y el segundo recibía de Redis las ventas del primero.

Arreglado: filtro por el `organizationId` del principal como parámetro enlazado, lista blanca de
columnas derivada del cubo, `organization_id` no filtrable desde fuera, y la empresa dentro de la
clave de caché. Siete pruebas nuevas.

### N-2 · La aplicación no arrancaba

`verify:boot` estaba **rojo en la rama base**, y se detiene en el primer fallo, así que había tres
encadenados:

1. `EventsGateway` no podía resolver `SessionRegistryService` — `WebsocketsModule` no importaba
   nada que lo proveyera. **El gateway de WebSocket no se podía construir**, o sea que en
   producción no existía.
2. `SsoAdminService` no podía resolver `RoleDelegationPort`: `RolesModule` lo exporta e importa
   `AuthModule`, pero `AuthModule` no importaba `RolesModule`.
3. `StepUpGuard` no podía resolver `JwtService` en `ExtensionsModule`: el controlador usa
   `@UseGuards(StepUpGuard)` y el módulo no importaba `AuthModule`.

Los tres arreglados; `verify:boot` pasa.

### N-3 · Un socket se negaba para siempre tras cambiar la contraseña

Encontrado al reescribir el handshake (A-7). Leía `cachedUser.security.tokenVersion`, y la
proyección que la caché guarda (`UserIdentityService.project`) lleva `tokenVersion` en el nivel
SUPERIOR: no hay objeto `security`. La comparación era siempre `0 !== payload.tokenVersion`, de
modo que todo usuario con `tokenVersion >= 1` —cualquiera que hubiese cambiado su contraseña o al
que le hubiesen cambiado un rol— tenía el WebSocket denegado permanentemente.

Fallaba cerrado, así que no era una vulnerabilidad; era la MISMA forma de defecto que A-5 —leer un
campo que el productor no escribe para tomar una decisión de identidad— por tercera vez en el
mismo código base. Resuelto delegando en `UserIdentityService.resolveFromPayload`, que además
añade la comprobación de pertenencia que faltaba.

---

## Lo que cambió en el aislamiento por base de datos

Antes: 119 tablas con política. Ahora: **128**, y la clasificación de las 170 es obligatoria.

- Nueve tablas de inquilino recibieron política por primera vez: `stock_items`, `stock_movements`,
  `vendor_payment`, `locations`, `datasheet_sheets`, `datasheet_versions`,
  `datasheet_permissions`, `approval_policy_steps`, `dimension_values_closure`.
- `consolidation_maps` estaba anclada a `accounts` por `subsidiary_account_id` —al inquilino de la
  SUBSIDIARIA—, así que desde la matriz, que es quien crea y lee el mapeo, no devolvía nada. El
  aislamiento estaba sobre la empresa equivocada: la función quedaba rota, no protegida. Reanclada
  a `parent_organization_id`.
- Una cadena de dos niveles (`dimension_values_closure` → `dimension_values` → `dimensions`) que
  la migración detectó y rechazó con un error explícito en lugar de instalar una política falsa.

`verify:rls` ya no pregunta por un nombre de columna: exige que **cada tabla base** esté con
política, heredando de un padre declarado, marcada como global, o marcada como identidad/tenencia
—y cada entrada lleva su motivo escrito—. Las vistas materializadas, que RLS no puede alcanzar, se
declaran aparte con la columna que toda consulta debe filtrar.

---

## Scorecard

| Eje | Antes | Ahora |
|---|---|---|
| Autenticación | 8 | **10** |
| Autorización | 7 | **10** |
| Gestión de sesión / token | 9 | **10** |
| Manejo de secretos | 9 | **10** |
| Consistencia entre implementaciones | 6 | **10** |

El eje de consistencia es el que más sube y el que lo sostiene todo: los cuatro verificadores que
tenían un punto ciego (alcance de inquilino, `NODE_ENV`, cobertura de RLS, revocación de sesión)
ahora ven la forma que se les escapaba, y ese cambio es lo que encontró N-1. El nivel real de la
aplicación es el del eje más débil; ya no hay uno más débil.

---

## Cómo está comprobado

Contra PostgreSQL 16 real, con las migraciones aplicadas desde una base vacía:

```
✓ 2.276 pruebas, 129 suites
✓ tsc --noEmit                        (sin errores)
✓ verify:tenant-scope                 (ninguna lectura sin inquilino)
✓ verify:env-gating                   (toda decisión de entorno por la lista blanca)
✓ verify:crypto                       (una sola derivación por material de clave)
✓ verify:role-assignment              (toda asignación pasa por la delegación)
✓ verify:session-revocation           (todo validador consulta la lista de revocación)
✓ verify:rls                          (128 políticas; 170 tablas clasificadas; 1 matview declarada)
✓ verify:rls-runtime                  (aislamiento real conectando como `virtex_app`)
✓ verify:boot                         (el grafo de módulos resuelve — no lo hacía)
✓ i18n                                (5.157 claves, 108 espacios, todas las invariantes)
✓ eslint                              (sin errores nuevos)
```

Tres errores de lint y una desviación de esquema (`check:schema-drift`, sobre claves ajenas de
`user_workspaces`, `plugins` y `plugin_tenant_consents`) **preexisten en la rama base**: se
reproducen idénticos con estos cambios revertidos. No se tocaron por estar fuera del alcance de
esta auditoría, y se dejan dichos aquí en lugar de callados.

## Pruebas añadidas

- `login.spec.ts` — tres pruebas que fijan A-1 desde el lado del atacante: mismo código, sin
  `lockoutUntil` en el cuerpo, y el mismo trabajo en ambas ramas para que el reloj tampoco distinga.
- `consolidation-mapping.spec.ts` — cinco, incluida la de que «no existe» y «no es tuya» responden
  igual, para no abrir un oráculo de enumeración al cerrar el de autorización.
- `bi.service.spec.ts` — siete, sobre el filtro de inquilino y cada vector de inyección.
- `extension-consent.spec.ts` — cinco, sobre las dos elusiones del consentimiento.
- `failed-attempt-budget.spec.ts` — cuatro, sobre la limpieza del presupuesto de intentos.
- `tenant-table-classification.spec.ts` — cinco, incluida la que impide que la copia de la lista
  que vive en la migración se separe de la del código.
- `impersonation.service.spec.ts` — dos nuevas que la fixture anterior no podía expresar, más la
  fixture reescrita con la forma de principal que producción emite de verdad.
