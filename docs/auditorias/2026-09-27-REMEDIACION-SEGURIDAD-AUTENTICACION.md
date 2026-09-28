# Remediación — auditoría de seguridad y autenticación (2.ª ronda, 2026-09-27)

Cierre de la segunda auditoría de seguridad y autenticación (hallazgos S-1 a S-18). Cada entrada
dice **qué estaba mal** (a alto nivel), **qué se cambió y dónde**, y **qué impide que vuelva**:
una prueba que falla sin la corrección, un verificador de CI, o las dos cosas. No se describen
secuencias de explotación.

Rama: `claude/security-auth-audit-9g9f6b` · PR #105 · Base: `main` @ `56dfddac`.

**Estado al cerrar** (ejecutado en este entorno, no inferido):

- Backend: 143 suites, **2435 pruebas**, contra PostgreSQL 16 y Redis reales.
- Cliente web: 158 suites, **715 pruebas**.
- Todos los pasos del workflow de CI en verde en local, incluido
  `nx run-many -t lint test build typecheck` para los 8 proyectos, y CI verde en GitHub.
- `verify:rls-runtime` ejecutado como `virtex_app` (el único rol para el que rigen las políticas).

---

## Resumen

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| S-1 | Un administrador de un inquilino podía mutar la identidad global de un miembro | Crítica | Cerrado |
| S-2 | Guardar un `User` con roles filtrados borraba sus roles en las otras empresas | Crítica | Cerrado |
| S-3 | La suplantación no quedaba fijada a la empresa en la que se autorizó | Crítica | Cerrado |
| S-4 | La rotación del refresh descartaba la marca de suplantación | Alta | Cerrado |
| S-5 | La rotación y el cambio de empresa descartaban la obligación de MFA | Alta | Cerrado |
| S-6 | El host de extensiones validaba la ruta sin normalizarla | Alta | Cerrado |
| S-7 | El POS confiaba en los precios y totales del cliente | Alta | Cerrado |
| S-8 | Step-up desigual entre acciones sensibles equivalentes | Media | Cerrado |
| S-9 | El login social y el SSO no exigían el TOTP de la cuenta | Media | Cerrado |
| S-10 | La verificación del email de Microsoft confiaba en claims mutables | Media | Cerrado |
| S-11 | `stop-impersonation` no revocaba la sesión suplantada | Media | Cerrado |
| S-12 | Una reclamación de dominio SSO no verificada bloqueaba el dominio globalmente | Media | Cerrado |
| S-13 | Escritorio: `openExternal` sin lista blanca y orígenes HTTP por defecto | Media | Cerrado |
| S-14 | Los sockets no se cerraban al perder el usuario su acceso | Baja | Cerrado |
| S-15 | La revocación dependía de que Redis no perdiera su estado | Baja | Cerrado |
| S-16 | `TenantIsolationCheck` fallaba abierto si su propia consulta fallaba | Baja | Cerrado |
| S-17 | El token de invitación no se borraba de la base de datos | Baja | Cerrado |
| S-18 | Helpers de `SessionRegistryService` que devolvían el id equivocado | Baja | Cerrado |

Más **siete defectos que la auditoría no vio** y que aparecieron al corregir (sección final).

---

## Autorización e identidad

### S-1 — Un inquilino administra su pertenencia, no la identidad global

**Qué estaba mal.** La identidad (`users`, `user_security`, `user_roles`) es global, pero las
operaciones administrativas se autorizaban solo por pertenecer a la empresa de quien actuaba.

**Qué se cambió.**
- Los cambios de identidad (email, contraseña, sesiones, nombre, bloqueo de cuenta) exigen la
  **empresa de origen** de la persona (`users.service.ts`, `assertHomeOrganization`).
- Cualquier otra empresa solo suspende o reincorpora **su** pertenencia
  (`user_organizations.suspended_at`, `membership.service.ts`).
- Añadir a alguien que ya tiene cuenta crea una **invitación** que la persona acepta o rechaza
  (`organization_invitations`, `organization-invitations.service.ts`, selector de empresa en el
  cliente). Antes se la incorporaba sin preguntarle.

**Qué lo sostiene.** `organization-invitations.service.spec.ts` (Postgres, 9 pruebas) y los specs
de `users.service`.

### S-2 — Las escrituras de roles quedan acotadas a la empresa que actúa

**Qué estaba mal.** `save` de TypeORM sobre un `ManyToMany` recarga la relación completa y borra
lo que no está en memoria. Guardar un usuario cargado con roles filtrados por empresa borraba sus
roles en todas las demás.

**Qué se cambió.** Toda escritura pasa por `users/persistence/identity-writes.ts`:
- `saveIdentity` guarda la identidad sin tocar la relación de roles.
- `replaceRolesInOrganization` hace `addAndRemove` solo sobre los roles de esa empresa.

**Qué lo sostiene.**
- `identity-writes.spec.ts` (Postgres): la primera prueba reproduce el defecto con un `save` normal.
- `verify:identity-writes` (en `verify:security`) falla el build ante un `save` de `User` fuera de
  los escritores.
- `verify:role-assignment` exige la comprobación de delegación en cada sitio de asignación.

### S-3, S-4, S-11 — La suplantación es un hecho del servidor

**Qué estaba mal.**
- La suplantación vivía solo en los claims del token.
- La rotación los reconstruía sin ella (S-4).
- No quedaba fijada a la empresa autorizada (S-3).
- Terminarla no revocaba la sesión (S-11).

**Qué se cambió.**
- `refresh_tokens.impersonator_id` e `impersonation_organization_id` se escriben al abrir la sesión.
  `TokenService.generateAuthResponse` los lee de la primera fila de la familia en cada rotación.
- La duración absoluta cuenta desde el inicio de la suplantación.
- `ActiveTenantGuard` y el cambio de empresa rechazan una sesión suplantada.
- Iniciar y terminar la suplantación revocan la sesión que se deja.
- Si el operador deja de estar activo, la siguiente rotación termina la sesión.

**Qué lo sostiene.** `impersonation-rotation.spec.ts` (Postgres; falla sin la corrección),
`impersonation.service.spec.ts` y `active-tenant.guard.spec.ts`.

### S-6 — Alcance de extensiones: la misma normalización en ambos lados

**Qué se cambió.**
- `libs/shared/util-auth/src/lib/extension-scope.ts` normaliza la ruta y rechaza lo que la
  normalización cambiaría: codificaciones de `.`, `/` y `\`, `%25`, barras invertidas,
  caracteres de control, `#` y `//`.
- El host del cliente la usa.
- En el servidor, un `APP_GUARD` global (`ExtensionScopeGuard`) rechaza toda petición de una
  extensión fuera de los alcances que el inquilino consintió.

**Qué lo sostiene.** `extension-scope.guard.spec.ts` (23 pruebas) y el spec del host con casos de
recorrido de ruta.

### S-7 — El POS: el servidor fija los precios

**Qué se cambió.**
- **Precios.** El servidor valora cada línea desde el catálogo (a través del contrato
  `inventory/contracts/sellable-product.contract.ts`) y rechaza la venta si lo que se mostró al
  cliente no coincide (`pos.prices_changed`, `pos.totals_changed`).
- **Turnos.**
  - Cada turno pertenece a su cajero; otra persona necesita `pos:manage_shifts`.
  - El cierre compara el efectivo contado con el esperado y registra la diferencia.
  - Un índice parcial impide dos turnos abiertos en una terminal.
- **Operación.** Las ventas son idempotentes y la app del POS admite 2FA.

**Qué lo sostiene.** `pos.service.spec.ts` (11 pruebas) y `verify:boundaries` (el POS ya no
importa entidades de Inventario).

### Nuevo — Los datos de referencia compartidos los escribe la plataforma

**Qué estaba mal.** Monedas, tipos de cambio, unidades de medida y tablas legales de nómina son
de todos los inquilinos, y cualquier administrador de inquilino podía escribirlos con `'*'`.

**Qué se cambió.**
- Las escrituras exigen permisos `platform:`, que ni `'*'` ni un comodín por prefijo satisfacen
  (`permissions.util.ts`, la misma regla en el navegador y en la API).
- La tasa oficial propia de un inquilino va a `tenant_exchange_rates`, bajo RLS. El resolvedor la
  prefiere para ese inquilino.

**Qué lo sostiene.** `exchange-rates.spec.ts` (32 pruebas) y `verify:date-columns`.

---

## Autenticación

### S-5 — La obligación de MFA se deriva en cada petición

**Qué estaba mal.** La obligación de MFA era un claim congelado en el token, y la política se leía
sin contexto de inquilino, así que bajo RLS nunca se aplicaba.

**Qué se cambió.** `MfaEnrolmentGuard` consulta en cada petición la política de la empresa activa
(`runAsTenantJob`, caché de 60 s que se invalida al editarla). Falla cerrado si no puede leerla.

**Qué lo sostiene.** `mfa-enrolment.guard.spec.ts` (11 pruebas).

### S-9 — El login federado pide el segundo factor propio de la cuenta

**Qué se cambió.** Si la cuenta tiene TOTP, Google, Microsoft y el SSO empresarial abren una
sesión pendiente de 2FA (las mismas cookies que el login con contraseña, atadas a IP y agente) y
llevan al paso de verificación.

### S-10 — Una identidad federada es su sujeto, no una dirección que cualquiera puede fijar

**Qué estaba mal.** Una cuenta de un tenant organizativo de Entra se consideraba con email
verificado. Cualquier administrador de un tenant puede poner a sus usuarios un email arbitrario
sin verificar (la clase de fallo publicada como «nOAuth»).

**Qué se cambió.**
- **Microsoft.** Un email es verificado solo con el claim opcional `xms_edov` y solo para el
  claim `email`. `preferred_username` y `upn` son nombres de inicio de sesión y nunca cuentan
  como verificados.
- **Proveedores sociales.** Una cuenta ligada a un sujeto de un proveedor no se vuelve a ligar a
  otro sujeto porque coincida la dirección; se rechaza.
- **Step-up federado.** Exige el sujeto ligado o, para un IdP empresarial encontrado por dominio,
  una dirección verificada por el IdP que sea la del usuario.

**Configuración.** `.env.example` documenta que el registro de la app de Microsoft debe emitir
`email` y `xms_edov`.

**Qué lo sostiene.** `oidc-provider.service.spec.ts` (la prueba que afirmaba la regla vulnerable
se sustituyó), `social-auth.service.spec.ts` y `step-up-federated.spec.ts`.

### S-8 — Step-up: una sola lista de permisos sensibles

**Qué se cambió.**
- `tools/verify/step-up-coverage.mjs` declara una vez qué permisos son sensibles y para qué
  métodos, y falla el build ante cualquier ruta que los use sin re-autenticación.
- Nuevos alcances: compensación, movimiento de fondos y cuentas bancarias (los dos últimos de un
  solo uso).
- `@StepUp` admite una condición: editar un empleado solo lo pide si cambia el destino del pago.
- El cliente web pide la re-autenticación y reintenta, en lugar de mostrar un 401.
- Se eliminó una ruta de checkout duplicada sin step-up.

**Qué lo sostiene.** `verify:step-up-coverage`, `step-up.guard.spec.ts` (incluye paridad de
alcances cliente/servidor) y `step-up.interceptor.spec.ts`.

### S-12 — Reclamaciones de dominio SSO

**Qué estaba mal.** Cualquier inquilino podía reclamar un dominio sin probar nada y bloquear para
siempre al dueño real; el error, además, revelaba que otro inquilino lo había reclamado. Las
reclamaciones pendientes no caducaban y las verificadas no se volvían a comprobar.

**Qué se cambió.**
- **Unicidad.** Solo entre reclamaciones **verificadas** (índice único parcial), más una por
  empresa y dominio. Varias empresas pueden tener una reclamación pendiente; gana la primera que
  prueba el control del DNS, y el índice resuelve la carrera.
- **Caducidad.** Las reclamaciones pendientes caducan a los 14 días.
- **Re-verificación diaria contra DNS.**
  - Tres ausencias seguidas del registro retiran la verificación.
  - Una empresa sin ningún dominio verificado queda con sus IdPs desactivados.
  - Un fallo del resolvedor no cuenta en contra de nadie.

**Qué lo sostiene.** `sso-domain-claims.spec.ts` (Postgres, 8 pruebas).

---

## Sesiones y tokens

### "Recordarme" e inactividad — un solo modelo, en ambos lados

Esta petición llegó durante la remediación: la app cerraba la sesión por inactividad, pero al
recargar volvía al dashboard.

**Qué estaba mal.**
- El cierre por inactividad saltaba a los 15 minutos, justo cuando vence el token de acceso.
  `POST /auth/logout` necesitaba ese token, respondía 401 y no revocaba nada.
- «Recordarme» casi no cambiaba nada.
- Con 2FA, «Recordarme» se perdía.

**Qué se cambió.**

| | Sin «Recordarme» | Con «Recordarme» |
|---|---|---|
| Cookie de refresco | de sesión del navegador | 30 días |
| Inactividad en el cliente | 15 min, con aviso y cuenta atrás | no |
| Inactividad en el servidor | 30 min sin refresco | 14 días |
| Duración absoluta | 12 h | 30 días |

- **Servidor.**
  - `refresh_tokens.remember_me` es un hecho de la familia de sesión, heredado por cada rotación.
  - `POST /auth/refresh/revoke` cierra la sesión con la cookie de refresco, sin necesitar un
    token de acceso vigente. Está protegido por CSRF.
  - El servidor declara la política al cliente.
- **Cliente.**
  - Actividad en tiempo real compartida entre pestañas.
  - Cerrar sesión en una pestaña cierra todas.
  - Una sesión ya inactiva no se restaura al recargar.
  - La sesión de quien sigue activo se mantiene viva.
  - La casilla viene desmarcada y explica qué implica.

**Qué lo sostiene.**
- `session-kinds.spec.ts` (Postgres).
- `session-lifetime.spec.ts`, `idle.service.spec.ts` y `activity-tracker.service.spec.ts`.
- `verify:auth-contract` comprueba por HTTP la vida de las cookies, el cierre sin token de acceso
  y que una recarga después no renueva la sesión.

### S-14 — Se revalida cada socket abierto, no solo su handshake

**Qué se cambió.** `SocketAuthenticatorPort.revalidate` aplica las mismas comprobaciones que HTTP
(lista de revocación, versión de token, estado, pertenencia) a la identidad que probó el
handshake. Se exime solo la caducidad del token; la firma, el emisor, la audiencia y la clave se
siguen verificando. El gateway re-comprueba cada socket cada 5 minutos y corta los que ya no
pasan.

**Qué lo sostiene.** `socket-authenticator.service.spec.ts` y `events.gateway.spec.ts`.

### S-15 — La lista de revocación sabe cuándo puede fiarse de sí misma

**Qué se cambió.**
- La lista lleva una marca de época en Redis. Mientras la marca falta (reinicio, vaciado,
  desalojo) o es más joven que la vida de un token de acceso, un «no está en la lista» se
  comprueba contra `refresh_tokens`.
- Lo mismo ocurre en la instancia donde falló una escritura en la lista.

**Qué lo sostiene.** `session-registry.service.spec.ts` (15 pruebas).

### S-16, S-17, S-18

- **S-16.** `TenantIsolationCheck` no arranca fuera de desarrollo si no puede hacer su propia
  comprobación (`tenant-isolation.check.spec.ts`).
- **S-17.** El token de invitación se borra con `null`. `undefined` no llegaba al `UPDATE`.
  Además se consume con un `UPDATE` condicional, de modo que dos canjes simultáneos no pueden
  prosperar ambos (`invitation-redemption.spec.ts`, Postgres; falla sin la corrección).
- **S-18.** Se eliminaron los helpers muertos que devolvían ids de fila en lugar de ids de sesión.

---

## Clientes secundarios

### S-13 — Escritorio

La política está en un módulo probado (`apps/desktop/src/security-policy.js`,
`verify:desktop-policy`):
- `openExternal` solo para `https:` y `mailto:` sin credenciales.
- Un build empaquetado no arranca sin URLs HTTPS explícitas.
- Se protege `will-redirect` y se rechaza `<webview>`.
- El IPC solo atiende a marcos de orígenes de confianza.
- Permisos denegados salvo una lista corta.
- Sin herramientas de desarrollo en builds empaquetados.

---

## Lo que la remediación encontró y la auditoría no

1. **El SSO empresarial no podía funcionar con el rol de producción.** `organization_domains` e
   `identity_providers` están bajo RLS, y el descubrimiento, el inicio y el retorno del SSO los
   leían antes del login, sin inquilino.
   - Una política de solo lectura (`sso_routing`) expone las reclamaciones **verificadas**.
   - Los IdPs siguen aislados y se leen en el contexto de su empresa, que viaja en la URL de
     inicio y en la transacción OAuth firmada.
   - `verify:rls-runtime` lo prueba como `virtex_app`.
2. **La lista multiempresa era invisible bajo RLS.** `user_organizations` se reclasificó como
   tabla entre inquilinos.
3. **La política de MFA se leía sin contexto de inquilino** y bajo RLS nunca se aplicaba.
4. **El principal no llevaba ids ni permisos de rol**, y eso rompía flujos de aprobación y hojas
   de datos.
5. **El POS enviaba el total de ventas como efectivo contado**, así que todas las cajas cuadraban.
6. **La búsqueda y el filtro de miembros** usaban nombres de parámetro que la API rechaza.
7. **Editar un rol invalidaba globalmente los tokens** y sacaba a la persona de sus otras empresas.

---

## Puntuación actualizada (por eje, sin promediar)

| Eje | Antes | Ahora | Justificación |
|---|---|---|---|
| Autenticación | 6 | **9** | La obligación de MFA se deriva por petición y falla cerrado. El login federado pide el TOTP propio. La verificación de email de Microsoft sigue la única aserción que ofrece Microsoft, y las identidades federadas se atan a su sujeto. «Recordarme» es un hecho de la sesión. |
| Autorización | 3 | **9** | La identidad global solo la cambia la empresa de origen. Las escrituras de roles quedan acotadas y un verificador de CI lo exige. La suplantación está fijada a su empresa. El alcance de extensiones se aplica en servidor y cliente. El POS no fija precios. Los datos compartidos exigen permisos de plataforma. Los dominios SSO no se pueden acaparar. |
| Sesión / token | 5 | **9** | Los hechos de la sesión viven en el servidor y sobreviven a la rotación. El cierre de sesión no depende del token de acceso. Cliente y servidor aplican el mismo modelo de inactividad. La revocación no confía en un Redis que perdió su estado. Los sockets se revalidan. |
| Manejo de secretos | 9 | **9** | Sin cambios de fondo. Mejoras: el escritorio empaquetado exige HTTPS explícito, y el arranque no sirve si no puede demostrar el aislamiento. |
| Consistencia | 3 | **9** | Cuatro verificadores nuevos en CI: `identity-writes`, `step-up-coverage`, `desktop-policy` y la ampliación de `rls-runtime` y `auth-contract`. Un único matcher de permisos para navegador y API. Una única normalización de rutas de extensión. Un único escritor de identidad. |

### Por qué no 10

Un 10 exige evidencia que este trabajo no puede producir por sí solo, y conviene decirlo:

- **Nadie externo ha intentado romperlo.** Hace falta una prueba de penetración independiente
  sobre un despliegue real, con el rol `virtex_app`, Redis y el IdP configurados como en producción.
- **Dependencias de configuración.**
  - Sin el claim `xms_edov`, las cuentas de Microsoft no pueden **ligarse** por dirección
    (limitación deliberada y documentada).
  - Los inicios de sesión federados y con passkey no ofrecen «Recordarme»: siempre son sesiones
    normales.
- **Métricas de detección.** Los eventos de seguridad se registran (`event: …`) pero no hay
  alertas definidas sobre ellos (reuso de refresh, dominios que pierden verificación, sockets
  cortados por revalidación).
- **La URL de inicio del SSO cambió.** Ahora lleva `?org=`. Los marcadores antiguos llevan al
  login con `sso_unavailable`; los clientes usan la URL que devuelve el descubrimiento, así que
  el flujo normal no se ve afectado.
