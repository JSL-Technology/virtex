# Auditoría del módulo de traducción (i18n / l10n) — Virtex

**Alcance auditado:** `apps/core/client-web` (frontend Angular 20), `apps/backend/api` (NestJS 11),
`libs/shared`, plantillas de correo, generación de PDF, configuración de build y CI.
**Método:** lectura directa de código y conteos reproducibles sobre el árbol de trabajo
(commit `f94d04c`). Todo dato numérico de este documento es reproducible con los comandos
indicados al final.

**Calificación: 3 / 10**

> **Nota de estado (este documento es el diagnóstico, no el resultado).**
> Las secciones 1 a 9 describen el código **tal como estaba en el commit `f94d04c`** y se
> conservan sin retocar: son la lista de defectos contra la que se trabajó, y borrarlas
> convertiría una auditoría en un folleto. Lo que se entregó después, con sus cifras
> reproducibles y la nota revisada, está en la **§10**.

---

## 1. Resumen ejecutivo

El proyecto no tiene un *módulo* de traducción: tiene una **integración parcial de
`@ngx-translate` que cubre el embudo de registro/login, el sidebar y los widgets del dashboard**,
y nada más. El resto del ERP —facturación, contabilidad, cuentas por pagar, POS, inventario,
compras, reportes y la mayor parte de configuración— está escrito con texto literal incrustado
en las plantillas, mezclando español e inglés en la misma pantalla. El backend no tiene
internacionalización de ninguna clase.

Lo que sí existe está razonablemente bien hecho (paridad de catálogos verificada en CI, 989 claves
sin huecos, sidebar completo). El problema no es la calidad de lo construido, es que **cubre
aproximadamente una cuarta parte de la superficie del producto** y que las piezas que faltan no
son "pendientes de traducir": son decisiones arquitectónicas ausentes (formato numérico y de
fecha, negociación de idioma servidor, catálogo de idiomas único) que obligan a rehacer, no a
completar.

### Los cinco hechos que fijan la nota

| # | Hecho | Evidencia |
|---|---|---|
| 1 | **126 de 167 plantillas HTML no usan `translate` en absoluto** | `grep -rl translate --include=*.html` → 41 |
| 2 | **1.228 nodos de texto literal + 113 atributos humanos literales** en plantillas | escáner reproducible §8 |
| 3 | **El backend tiene 0 archivos con i18n** y ≥197 mensajes de excepción en español fijo | `grep -rn "Accept-Language"` → 0 resultados |
| 4 | **El selector de idioma público está roto**: escribe la clave equivocada en `localStorage` y no sincroniza el servicio | `auth-footer.component.ts:47-48` |
| 5 | **2 idiomas de UI frente a 19 mercados aprovisionables**, uno de ellos `pt-BR` sin catálogo | `country-profiles.ts:693-948` vs `language.ts:18` |

---

## 2. Lo que está bien (y hay que conservar)

No todo es deuda. Estas piezas son sólidas y deben ser la base de la reconstrucción:

- **Paridad de catálogos garantizada por CI.** `translation-parity.spec.ts` verifica claves
  espejo, cadenas vacías y **consistencia de placeholders `{{...}}` entre idiomas** — este último
  control es poco común y es exactamente el correcto.
- **Cobertura de claves usadas.** `translation-coverage.spec.ts` recorre el código fuente y falla
  si una clave usada no existe. Ambos specs corren en CI (`.github/workflows/ci.yml`,
  `npx nx run-many -t lint test build typecheck`).
- **Estado real de los catálogos:** 989 claves en `es.json`, 989 en `en.json`, **0 divergencias**,
  0 cadenas vacías, 0 valores con HTML (sin riesgo de inyección vía catálogo).
- **`sidebar.*`:** 338 claves usadas, 353 definidas, **0 claves usadas sin definir**. El árbol de
  navegación completo (23 grupos) está correctamente externalizado.
- **`FrontendUrlService`** construye enlaces transaccionales con segmento de idioma
  (`/{lang}/auth/reset-password#token=`) y valida contra una lista blanca.
- **`TranslatedTitleStrategy`** unifica el título del navegador vía clave de traducción, con
  *fallback* explícito cuando `instant()` devuelve la clave.

---

## 3. Defectos funcionales verificados (bugs, no opiniones)

### B-1 · El selector de idioma público no persiste ni propaga el cambio — **crítico**

`apps/core/client-web/src/app/features/auth/components/auth-footer/auth-footer.component.ts:46-50`

```ts
changeLang(langCode: string) {
  this.translate.use(langCode);
  localStorage.setItem('lang', langCode);   // ← clave incorrecta
  this.isLangDropdownOpen = false;
}
```

`LanguageService` lee y escribe `'ui_lang'` (`core/services/language.ts:9`), no `'lang'`.
Consecuencias encadenadas, todas verificables leyendo el código:

1. **La elección no sobrevive a un refresco.** Al recargar, `getInitialLanguage()` lee `'ui_lang'`,
   no encuentra nada, y vuelve al idioma del navegador.
2. **`LanguageService.currentLang` no se actualiza** (se llamó a `translate.use()` directamente,
   saltándose el signal). El `effect()` del servicio nunca corre.
3. **`document.documentElement.lang` queda obsoleto** → incumple WCAG 2.2 SC 3.1.1 (Language of
   Page) y rompe el anuncio correcto en lectores de pantalla.
4. **La URL queda desincronizada.** El usuario está en `/es/auth/login` viendo inglés. Peor: en la
   siguiente navegación `languageInitGuard` llama `setLanguage('es')`, pero el signal *sigue*
   valiendo `'es'`, así que la guarda entra por el `if (lang !== this.currentLang())` en falso y
   **nunca revierte** `translate.use('en')`. El estado inconsistente es persistente.
5. **No sincroniza `preferredLanguage`** con el perfil del usuario.

Éste es el único conmutador de idioma en las pantallas de login y registro — el punto exacto donde
un cliente estadounidense decide si el producto habla su idioma.

### B-2 · La sincronización de preferencia es *write-only* y destruye la verdad del servidor — **alto**

`core/services/language.ts:35-59`

El `effect()` envía `PATCH /users/profile { preferredLanguage }` cada vez que `currentLang`
cambia y difiere de `currentUser.preferredLanguage`. Pero **nada lee `preferredLanguage` al
arrancar una sesión ya autenticada**: `getInitialLanguage()` sólo consulta `localStorage` →
idioma del navegador → `'es'`.

Secuencia de fallo (todas las piezas verificadas):
`provideAppInitializer(() => inject(AuthService).resolveSession())` (`app.config.ts:29`) puebla
`currentUser` antes de que se construya `LanguageService` → un usuario con `preferredLanguage: 'en'`
abre la app en un navegador nuevo / ventana privada / otro equipo → `currentLang` se resuelve a
`'es'` → el efecto **sobrescribe su preferencia guardada con la conjetura del cliente**.

El único punto que lee la preferencia es `login.page.ts:295`, es decir sólo tras un login
explícito con formulario.

### B-3 · `USER.STATUS.INACTIVE` no existe — el usuario ve la clave cruda — **medio**

- `user-management.page.html:97`: `{{ "USER.STATUS." + user.status | translate }}`
- `user.entity.ts:21-27`: `enum UserStatus { PENDING, ACTIVE, INACTIVE, ARCHIVED, BLOCKED }`
- `es.json` / `en.json` → `USER.STATUS` sólo define `ACTIVE, PENDING, BLOCKED, ARCHIVED`.

Un usuario en estado `INACTIVE` renderiza literalmente `USER.STATUS.INACTIVE` en la tabla.
**El spec de cobertura no puede detectarlo** porque la clave se compone en tiempo de ejecución.

### B-4 · Las descripciones de los roles del sistema son claves inexistentes, persistidas en base de datos — **medio**

`apps/backend/api/src/app/config/roles.config.ts:21,27,33,47`

```ts
{ name: RoleEnum.ADMINISTRATOR, description: 'USER.ROLE.ADMINISTRATOR_DESC', ... }
```

Esas cuatro cadenas se **escriben en la columna `description`** de cada organización nueva
(`registration.service.ts:633`). Ninguna de las cuatro existe en `es.json` ni en `en.json`
(`grep -c "_DESC"` → 9 claves, ninguna es `USER.ROLE.*_DESC`).
Y `roles.page.html:24` las pinta en crudo: `<td>{{ role.description }}</td>` — sin pipe.

**Resultado en producción: la pantalla de Roles muestra la cadena literal
`USER.ROLE.ADMINISTRATOR_DESC` a todos los clientes, en ambos idiomas.**

### B-5 · La UI de permisos muestra identificadores de máquina en inglés — **medio**

`features/settings/roles/roles.page.ts:65-81` construye los grupos partiendo el *slug* del permiso:

```ts
const [groupName, label] = permission.split(':');
acc[groupName] = { name: groupName.charAt(0).toUpperCase() + groupName.slice(1), ... }
```

Con `PERMISSIONS.JOURNAL_ENTRIES_VIEW = 'journal_entries:view'` el administrador ve el grupo
**"Journal_entries"** y la casilla **"view"**. No hay traducción, ni catálogo de etiquetas, ni
agrupación semántica. Es la pantalla de gobierno de accesos de un ERP.

### B-6 · `country.guard` redirige a una ruta que no existe — **bajo**

`core/guards/country.guard.ts:29`: `createUrlTree(['/es/do/auth/login'])`.
La rama con prefijo de país (`app.routes.ts:82-92`) sólo carga `REGISTER_ROUTES`, que declara
`register` y un `redirectTo: 'register'` (`auth.routes.ts:12-33`). No hay `login` ahí. La URL cae
al `**` global y rebota a `/es/auth/login` — funciona por accidente, mediante una cadena de
redirecciones no intencionada.

### B-7 · Contrato de idioma incoherente entre DTOs — **bajo/medio**

| Archivo | Validación |
|---|---|
| `users/entities/user.entity/invite-user.dto.ts:23` | `@IsIn(['en','es'])` |
| `users/dto/update-profile.dto.ts:36` | `@Matches(/^[a-z]{2}(-[A-Z]{2})?$/)` — **cualquier** etiqueta BCP-47 |

Un `PATCH { preferredLanguage: 'fr-FR' }` se acepta y se persiste. Después:
`LanguageService.setLanguage('fr-FR')` no hace nada (no está en `supportedLangs`), el `<select>`
de `my-profile.page.html:111-114` no tiene una `<option>` que coincida (queda en blanco o toma la
primera), y `FrontendUrlService.language()` cae a `'es'`. La preferencia queda inalcanzable.

---

## 4. Defectos arquitectónicos (lo que obliga a rehacer)

### A-1 · No hay localización de formato: `LOCALE_ID` nunca se provee — **crítico**

```
grep -rn "LOCALE_ID|registerLocaleData|DEFAULT_CURRENCY_CODE|@angular/common/locales" \
     apps/core/client-web/src --include=*.ts
→ 0 resultados
```

Angular usa `en-US` por defecto. Las plantillas usan `| date` 21 veces, `| number` 82 veces y
`| percent` 2 veces. **Todas renderizan en formato estadounidense sin importar el idioma
seleccionado**: `1,234.56` y `Jan 5, 2026` para un usuario dominicano, colombiano o argentino.

Además, `LOCALE_ID` es un token estático fijado en el bootstrap: **cambiar de idioma con
ngx-translate no puede cambiarlo**. Corregir esto exige rediseñar la capa de formato
(pipes propios sobre `Intl`, o recarga controlada del `LOCALE_ID`), no añadir un proveedor.

Mientras tanto, el formato está *hardcodeado por sitio de llamada* y es contradictorio:

| Ubicación | Locale fijo |
|---|---|
| `settings/billing/billing.page.ts:167` | `'es-MX'` |
| `backend/invoices/invoices.service.ts:288-289` | `'es-DO'` |
| `backend/saas/listeners/billing-notifications.listener.ts:136,146,149` | `'es'` |
| `backend/reports/report-builder.service.ts:170` | `'en-US'` + **moneda `'USD'` fija** |
| `backend/invoices/invoices.service.ts:87` | `'en-US'` |

`report-builder.service.ts:170` formatea **todo importe con formato `CURRENCY` como dólares
estadounidenses**, en un ERP multimoneda con 19 monedas declaradas. Eso es un error contable,
no de traducción.

### A-2 · El backend no tiene internacionalización, ni siquiera negociación de idioma — **crítico**

- `grep -rn "Accept-Language|acceptsLanguages"` sobre `apps/` y `libs/` → **0 resultados**.
- No hay `nestjs-i18n` ni equivalente en `package.json`.
- **≥197 mensajes de excepción en español literal** (`grep` sobre `*Exception('…')`), p. ej.
  `users.service.ts:497` `'No puedes desactivar o bloquear tu propia cuenta.'`,
  `journal-entries.service.ts:319` `'El asiento contable no está balanceado.'`

Y el frontend los muestra al usuario: `core/services/error-handler.service.ts:49`
`customErrorMessage = serverError?.message || errorCode;`. El mismo archivo tiene además
**seis mensajes de respaldo en español fijo** (líneas 12, 35, 39, 46, 57, 59) dentro de un
servicio que ya inyecta `TranslateService`.

### A-3 · Correo transaccional: 100 % español fijo, con enlace localizado — **crítico**

Las 10 plantillas de `apps/backend/api/src/app/mail/templates/` están en español y declaran
`<html lang="es">` (`password-reset.hbs:2`, `email-change-confirm.hbs:2`, …). Los asuntos también:
`mail.service.ts` — `'Restablecimiento de Contraseña'`, `'Código de verificación 2FA'`,
`'Confirma tu nuevo correo electrónico'`, `'No pudimos crear tu cuenta — tu pago fue reembolsado'`.

La incoherencia es literal y está en la misma función: `mail.service.ts:44` construye el enlace
con `user.preferredLanguage` → `/en/auth/reset-password`, y a continuación encola una plantilla
en español. **El cliente estadounidense recibe un correo en español con un enlace a la pantalla en
inglés.**

`mail.service.ts:66-77` va más lejos: pluraliza en español dentro de código TypeScript.

```ts
case 'm': return `${value} minuto${value > 1 ? 's' : ''}`;
case 'd': return `${value} día${value > 1 ? 's' : ''}`;
```

Esto no es traducible: es lógica de pluralización de un idioma escrita a mano. Además es
incorrecta como regla CLDR general (`1.5 días` toma la forma `other`, no `one`).

También hay fallbacks en español fijo: `name || 'Usuario'` (7 ocurrencias).

### A-4 · El PDF de factura y las notificaciones de cobro son monolingües — **alto**

- `apps/backend/api/src/app/invoices/templates/invoice.hbs`: `Factura #:`, `Fecha de Emisión:`,
  `Cantidad`, `Precio Unit.`, `Subtotal`, `Impuestos`, `Notas:` — literales.
  Fechas formateadas con `'es-DO'` (`invoices.service.ts:288-289`).
  Un *tenant* estadounidense emite facturas en español a sus clientes estadounidenses.
- `saas/listeners/billing-notifications.listener.ts:139-153`: aviso de impago en español fijo,
  con importes formateados en `'es'` y una referencia a *"Configuración → Facturación"* que no
  coincide con la UI en inglés.

### A-5 · Nueve definiciones independientes de "idiomas soportados" — **alto**

| # | Ubicación | Forma |
|---|---|---|
| 1 | `core/services/language.ts:18` | `['en','es']` |
| 2 | `core/guards/language-init.guard.ts:20` | `['es','en']` |
| 3 | `app.routes.ts:27` | `SUPPORTED_LANGS = ['es','en']` |
| 4 | `core/services/auth.ts:457` | `['es','en']` (en `logout`) |
| 5 | `features/auth/.../auth-footer.component.ts:27-30` | `[{code:'es'},{code:'en'}]` |
| 6 | `features/settings/my-profile/my-profile.page.html:112-113` | dos `<option>` |
| 7 | `shared/components/language-selector/language-selector.html:4-9` | dos `<button>` |
| 8 | `backend/mail/frontend-url.service.ts:31` | `['es','en']` |
| 9 | `backend/users/.../invite-user.dto.ts:23` | `@IsIn(['en','es'])` |

Añadir portugués obliga a tocar los nueve sitios, más `update-profile.dto.ts` (que hoy acepta
cualquier idioma) y `custom-translate-loader.ts` (que importa los JSON uno a uno).
Un catálogo compartido en `libs/shared/types` cuesta menos de una hora y elimina la clase entera
de error.

### A-6 · Dos idiomas de UI contra 19 mercados aprovisionables — **crítico para el objetivo de negocio**

`localization/fiscal/country-profiles.ts:693-948` declara perfiles fiscales completos para
DO, US, MX, CO, CL, PE, AR, **BR**, EC, UY, PY, BO, VE, PA, CR, GT, SV, HN, NI — con `locale`
`es-DO`, `es-MX`, `pt-BR`, etc.

- **Brasil se puede aprovisionar y no existe catálogo `pt.json`.** El tenant brasileño usa la app
  en español.
- Ninguno de esos `locale` llega al cliente para nada: el frontend sólo conoce `es` y `en`
  genéricos, sin variante regional.
- Y las etiquetas del propio formulario de registro las sirve el backend **en un solo idioma
  fijo**: `step-configuration.html:63,97,124,138,161` pinta en crudo `taxIdLabel()`,
  `divisionLabel()`, `postalCodeLabel()`, `field.label`, `field.help`. Para DO eso es
  *"Tipo de ingreso"* / *"La DGII lo requiere en el e-CF y en el reporte 607."* — en español,
  aunque el usuario haya elegido inglés. Para US es *"State"* / *"ZIP code"* — en inglés, aunque
  haya elegido español.

Es el formulario que cobra. No es traducible tal como está diseñado.

### A-7 · Tres mecanismos de traducción disjuntos

1. `@ngx-translate` + JSON planos (frontend, 989 claves).
2. Diccionarios `ES`/`PT`/`EN` a mano en `localization/fiscal/coa-builder.ts:130,172,214`,
   seleccionados **por país** (`labelsFor()`, línea 256), no por usuario.
3. Literales incrustados en todo lo demás (plantillas, DTOs, excepciones, `.hbs`).

Ninguno comparte formato, herramienta ni proceso.

---

## 5. Malas prácticas y código muerto

- **`MissingTranslationHandler` no está configurado** (`app.config.ts:59-66`). El
  comportamiento por defecto de ngx-translate es renderizar la clave. En producción eso significa
  que una clave faltante se ve como `USER.STATUS.INACTIVE` en pantalla en vez de degradar a un
  texto neutro o registrar telemetría. Para un producto comercial es el modo de fallo equivocado.

- **El regex del spec de cobertura sólo ve claves EN MAYÚSCULAS.**
  `translation-coverage.spec.ts:23`: `/['"]([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)['"]/g`.
  **374 de 989 claves (38 %) quedan fuera del control**: todo `sidebar.*` y `datasheets.*`.
  Coexisten dos convenciones de nomenclatura (`NAV.DASHBOARD` vs `sidebar.general.dashboard`) sin
  regla declarada.

- **166 claves muertas (17 %)**, mantenidas verdes por el spec de paridad. Incluyen 26 claves
  `SETTINGS.SECURITY.*` de una implementación anterior (`ACCOUNT_PROTECTED`, `SCAN_QR`,
  `ACTIVATE_2FA`…) que el componente actual ya no usa; el spec de paridad incluso las protege
  explícitamente (`translation-parity.spec.ts:70`).

- **Antipatrón de concatenación.** `USERS.PAGINATION.SHOWING` = `"Mostrando"`, `.OF` = `"de"`,
  `.USERS` = `"usuarios"`: una frase partida en tres fragmentos. Es exactamente lo que rompe en
  idiomas con otro orden. Peor: **las tres claves están sin usar** —
  `user-management.page.html:118` escribe la frase a pelo:
  `Mostrando <strong>{{...}}</strong> de <strong>{{...}}</strong> usuarios`.

- **No hay soporte de plurales ni de género.** No hay compilador ICU (`messageformat`) instalado.
  Ninguna clave usa forma plural. Cualquier "1 factura / 2 facturas" existente está resuelto por
  concatenación o no existe.

- **El componente `LanguageSelector` está sin traducir.** `language-selector.html:2,11`:
  `<label>Idioma de la Interfaz</label>` y
  `<p>Selecciona el idioma en que se mostrará la aplicación.</p>` — literales en español.
  El selector de idioma no habla el idioma del usuario. Se usa en
  `settings/branding/branding.page.html:16`.
  Lo mismo en `my-profile.page.html:110`: `<label>Idioma Preferido</label>` literal, en un archivo
  que sí usa `translate` en la línea de arriba.

- **`index.html` fija `lang="es"`** (línea 2) y contiene dos textos intraducibles fuera de
  Angular: el *skip link* `"Saltar al contenido principal"` (línea ~103) y el `<noscript>`.
  Sin SSR (no hay `server.ts`, ni opción `ssr` en `project.json`), no hay `hreflang`, ni
  `og:locale`, ni prerenderizado por idioma. Las rutas públicas `/terms`, `/privacy`, `/security`,
  `/contact` no son indexables por idioma.

- **Duplicación de los catálogos en el bundle.** `custom-translate-loader.ts` importa los JSON
  estáticamente (94 KB entran al bundle inicial, sin *lazy loading*) **y** `project.json` copia
  `src/assets` a `dist/assets`, así que los mismos 94 KB se publican otra vez como ficheros
  estáticos que nadie descarga (el `provideTranslateHttpLoader` está comentado,
  `app.config.ts:8`). Con un tercer idioma esto escala linealmente en el arranque.

- **Estilos de import incoherentes para el mismo fichero:** `import * as es from …json` en el
  loader vs `import es from …json` en `translation-parity.spec.ts:2`. Depende de la interop de
  módulos JSON del bundler.

- **APIs deprecadas de ngx-translate 17.** `setDefaultLang` (`language.ts:66`), `defaultLang`
  (`overview.page.ts:166`), `currentLang` como propiedad (`auth-footer.component.ts:33`) están
  marcadas `@deprecated` en `@ngx-translate/core@17.0.0` a favor de `setFallbackLang`,
  `getFallbackLang()`, `getCurrentLang()`.

- **`isPlatformBrowser` es código muerto.** `language.ts:31,42,79` protege contra SSR; no hay SSR
  en el workspace.

- **Ruido de desarrollo comprometido a `main`.** `language-redirect.guard.ts:23-28` conserva
  deliberaciones en primera persona (*"The user prompt mentioned /es/home, but in this app…"*,
  *"If :lang has no component and only children, we need to target a specific child."*) en lugar
  de una decisión. `app.ts:36-46` tiene un bloque análogo. `app.ts:105-114` deja un
  `openTestModal()` con textos de prueba en español (`'Modal de Prueba'`,
  `'¡El servicio de modales está funcionando correctamente!'`) y un `console.log`, en el
  componente raíz de producción.

- **`console.log` con identificador de usuario** en `language.ts:118`:
  `` console.log(`Preferencia de idioma del usuario ${userId} sincronizada…`) `` — ruido en consola
  de producción con un identificador de usuario.

---

## 6. Rendimiento, seguridad y accesibilidad

**Seguridad — sin hallazgos en el catálogo.** 0 valores con etiquetas HTML en `es.json`/`en.json`,
0 valores no-string, y sólo un `innerHTML` en toda la app (`invoices/detail/detail.page.ts:206`),
no relacionado con traducción. La superficie de inyección vía i18n es nula. Correcto.

**Accesibilidad — dos incumplimientos.**
- WCAG 2.2 SC 3.1.1: `<html lang>` no se actualiza cuando el idioma cambia desde el pie de
  autenticación (B-1.3).
- Atributos ARIA en español fijo, sin traducir:
  `aria-label="Seleccionar idioma"` y `aria-label="Enlaces legales"`
  (`auth-footer.component.html:12,43`), `aria-label="Código OTP"` (`otp.component.html`),
  `aria-label="Apariencia"` (`theme-toggle.html`). Un lector de pantalla en inglés los anuncia en
  español. 113 atributos humanos literales en total.

**Rendimiento.** 94 KB de catálogos en el bundle inicial sin *code-splitting*, duplicados en
`dist/assets` (§5). Presupuesto `initial` con `maximumWarning: 500kb` — el margen se consume
en traducciones que el usuario no necesita ambas.

**Hallazgos adyacentes al módulo, verificados, fuera de alcance estricto pero bloqueantes para
"producto perfecto":**

1. **RCE por evaluación dinámica.** `reports/report-builder.service.ts:158`:
   `return new Function(\`return ${expression}\`)();` donde `expression` proviene de una definición
   de reporte almacenada. Un usuario con permiso de crear reportes ejecuta código arbitrario en el
   proceso del servidor (CWE-94).
2. **El service worker nunca se genera.** `app.config.ts:96` registra `ngsw-worker.js`, pero **no
   existe `ngsw-config.json`** en el repositorio ni la opción `serviceWorker` en `project.json`.
   El registro fallará con 404 en producción; el PWA no funciona.
3. **La página de aterrizaje tras el login sirve datos falsos.**
   `features/overview/overview.service.ts:59-113`: `getRecentActivity()`, `getNews()` y
   `getEvents()` devuelven arrays literales con `delay(450)` para simular latencia — facturas
   dominicanas inventadas (`'Factura #00128 emitida a Proyectos Globales S.A.'`, `'RD$ 45,800.00'`)
   en español fijo, mostradas a todos los tenants. Contradice directamente el requisito de
   "0 mocks".
4. **Cuatro nombres de marca en circulación:** `APP_TITLE` = `"Virtex"` (i18n),
   `"Virtex ERP"` (`manifest.webmanifest:2`), `"Virteex ERP"` (fallback de `APP_NAME` en
   `mail.service.ts`, 6 ocurrencias), `"Mi App Contable"` (fallback en `mail.service.ts:55`),
   `"VIRTEEX ERP"` (`invoices/detail/detail.page.html:34`) y **`APP_NAME="Billio"` en
   `.env.example:21`** — el valor que un despliegue por defecto pondría en todos los correos.

---

## 7. Cifras y justificación de la nota

### Superficie traducible

| Métrica | Valor |
|---|---|
| Plantillas HTML totales | 167 |
| Plantillas que usan `translate` | **41 (24,6 %)** |
| Plantillas que **no** lo usan | **126 (75,4 %)** |
| Nodos de texto literal en plantillas | **1.228** |
| Atributos humanos literales (`placeholder`/`title`/`alt`/`aria-label`/`label`) | **113** |
| Mensajes de toast en español fijo en `.ts` | **131** |
| Claves definidas (`es`/`en`) | 989 / 989 |
| Claves sin usar | **166 (16,8 %)** |
| Claves fuera del alcance del spec de cobertura | **374 (37,8 %)** |
| Archivos `.ts` del backend | 629 |
| Archivos del backend con i18n | **0** |

### El texto fijo ni siquiera está en un solo idioma

Clasificando los 1.228 literales por marcadores léxicos: **529 en español, 118 en inglés**,
9 ambiguos, 572 sin determinar (etiquetas cortas). Páginas enteras están en inglés dentro de un
producto cuyo idioma por defecto es español:
`features/data-imports` (`"Select Data Type"`, `"Click to browse or drag & drop"`,
`"Once your file is selected, begin the import process."`),
`accounting/periods` (`"Start Date"`, `"End Date"`, `"Status"`),
`accounting/journal-list` (`"Create Journal"`), `accounting/reconciliation`
(`"Account Reconciliation"`), `masters/warehouses` (`"Location"`),
`masters/payment-terms` (`"Net Days"`), `data-exports` (`"Format*"`).

**Hoy, un cliente dominicano ve inglés en contabilidad y un cliente estadounidense ve español en
facturación.** Los dos mercados objetivo reciben el mismo producto mezclado.

### Justificación de 3/10

| Nota | Significado | ¿Aplica? |
|---|---|---|
| 1-2 | No existe i18n | No — hay un núcleo real, probado y en CI |
| **3** | **Existe una base correcta que cubre una minoría de la superficie; el resto exige rediseño, no traducción** | **Sí** |
| 5-6 | Cobertura mayoritaria con huecos | No — 75 % de plantillas sin tocar, backend en 0 |
| 8-10 | Formato regional, plurales ICU, idioma negociado extremo a extremo, catálogo único, pipeline de traducción | Muy lejos |

**Sube de 1-2 porque:** los specs de paridad y cobertura corren en CI y son de buena factura
(la verificación de placeholders es superior a lo habitual); los 989 pares están completos y sin
divergencias; el sidebar completo (338 claves) está externalizado; `FrontendUrlService` y
`TranslatedTitleStrategy` están bien diseñados.

**No llega a 5 porque:** el backend aporta cero; no hay `LOCALE_ID` y por tanto ninguna fecha,
número o moneda está localizada; el único conmutador público de idioma está roto de forma
persistente (B-1); la preferencia guardada del usuario se destruye en cada visita desde un
dispositivo nuevo (B-2); hay claves que se renderizan crudas en pantallas de producción (B-3, B-4);
y el catálogo de idiomas está duplicado nueve veces mientras el backend aprovisiona 19 mercados,
uno de ellos en un idioma que no existe en la aplicación.

---

## 8. Dependencias fuera del alcance del módulo

Para que traducción llegue a 10, estos módulos deben cambiar. Ninguno es opcional:

| Módulo | Cambio requerido | Por qué bloquea |
|---|---|---|
| **`localization` (backend)** | Servir `taxIdLabel`, `divisionLabel`, `postalCodeLabel`, `fiscalAuthority`, `fiscalFields[].label/help/options[].label` como **claves** o como mapas por idioma | Hoy el formulario de registro es intraducible por diseño (A-6) |
| **`mail`** | Resolución de plantilla por idioma (`password-reset.en.hbs`), asuntos por catálogo, pluralización delegada | Todo el correo transaccional es monolingüe (A-3) |
| **`invoices` / `reports`** | Idioma y moneda del *documento* (del tenant/cliente, no del usuario); plantilla `.hbs` por idioma | PDF y reportes monolingües y en USD fijo (A-1, A-4) |
| **`roles` / `permissions`** | Catálogo de permisos con `labelKey` y `groupKey` en `libs/shared/types` | La UI de permisos muestra slugs de máquina (B-5) |
| **`users` (perfil)** | Leer `preferredLanguage` en el arranque de sesión; unificar validación con el catálogo compartido | B-2, B-7 |
| **`auth` (registro)** | Elección de idioma explícita en el alta y persistencia desde el primer momento | El usuario nuevo no elige idioma; se infiere del navegador |
| **`saas` (billing)** | Notificaciones y *dunning* por idioma del destinatario | A-4 |
| **Infra / build** | SSR o prerenderizado por idioma para las rutas públicas; `hreflang`; catálogos con *lazy loading* | SEO por mercado y coste de arranque (§5) |
| **`libs/shared/types`** | **Nuevo:** `SUPPORTED_LOCALES` como fuente única, consumida por frontend, backend, DTOs y rutas | A-5 |

**Decisión de producto que hay que tomar antes de escribir código:** ¿el idioma es del *usuario*,
del *tenant*, o del *documento*? Hoy los tres están mezclados: la UI sigue al usuario, el plan de
cuentas sigue al país (`coa-builder.ts:256`), la factura PDF sigue a un literal `es-DO`, y el
correo no sigue a nada. Un ERP correcto necesita los tres ejes separados y explícitos —
un usuario estadounidense en un tenant dominicano debe ver la UI en inglés, los nombres de cuenta
en español (son los libros legales), y emitir una factura en el idioma del cliente final.
Ninguna cantidad de trabajo sobre `es.json` resuelve eso.

---

## 9. Reproducibilidad

```bash
# 1. Plantillas que usan / no usan translate
find apps/core/client-web/src -name '*.html' | wc -l          # 167
grep -rl 'translate' apps/core/client-web/src --include=*.html | wc -l   # 41

# 2. Paridad y tamaño de catálogos
node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p?p+'.'+k:k):[p?p+'.'+k:k]);
const es=f(require('./apps/core/client-web/src/assets/i18n/es.json')),
      en=f(require('./apps/core/client-web/src/assets/i18n/en.json'));
console.log(es.length,en.length,es.filter(k=>!en.includes(k)).length)"   # 989 989 0

# 3. i18n en el backend
grep -rn "Accept-Language\|acceptsLanguages" apps libs --include=*.ts | wc -l   # 0
grep -n "i18n" package.json                                                     # (vacío)

# 4. LOCALE_ID
grep -rn "LOCALE_ID\|registerLocaleData\|DEFAULT_CURRENCY_CODE" \
     apps/core/client-web/src --include=*.ts | wc -l                             # 0

# 5. Excepciones en español en el backend
grep -rnoE "(BadRequest|NotFound|Conflict|Forbidden|Unauthorized)Exception\(\s*['\"][^'\"]{10,90}" \
     apps/backend/api/src --include=*.ts | grep -v spec | \
     grep -icE "ción|ñ|á|é|í|ó|ú|El |La |No se|Usuario|Cuenta"                   # 197

# 6. Toasts en español fijo
grep -rnoE "(showError|showSuccess|showWarning|showInfo)\(\s*'[^']{8,80}'" \
     apps/core/client-web/src --include=*.ts | grep -v spec | wc -l              # 131

# 7. Estados de usuario sin clave
node -e "console.log(Object.keys(require('./apps/core/client-web/src/assets/i18n/es.json').USER.STATUS))"
grep -n "enum UserStatus" -A 7 apps/backend/api/src/app/users/entities/user.entity/user.entity.ts
```

El conteo de texto literal es reproducible con el escáner que acompaña a esta auditoría:

```bash
node tools/scan-hardcoded-strings.mjs           # resumen
node tools/scan-hardcoded-strings.mjs --list    # cada hallazgo con fichero:línea
```

```
plantillas HTML                 167
  usan translate                41
  no usan translate             126
nodos de texto literal          1228
atributos humanos literales     113
plantillas con texto literal    134
```

El algoritmo es deliberadamente conservador —descarta por construcción toda interpolación, y por
tanto todo `{{ 'X' | translate }}`— para no inflar la cifra. Un muestreo determinista de 31
resultados sobre este repositorio no arrojó falsos positivos.

---

## 10. Estado entregado

Esta sección no reescribe la auditoría: la cierra. Cada cifra se reproduce con los comandos de
la §9 o con los que se indican aquí.

### 10.1 Los cinco hechos que fijaban la nota

| # | Hecho auditado | Estado |
|---|---|---|
| 1 | 126 de 167 plantillas no usaban `translate` | **140 de las 149 plantillas de componente lo usan** (`grep -rl '\| translate' …/src/app --include=*.html`). Las 9 restantes no contienen texto: son envoltorios que reciben el suyo por `@Input` (`stat-card`, `kpi-card`, `modal`, `auth-input`, `auth-button`, `password-strength`), contenedores sin prosa (`toast-container`, `auth-shell`) y el logotipo, que es marca y no palabra. `index.html` es la excepción declarada: su `<noscript>` lleva las tres lenguas a la vez, porque se muestra justo cuando ningún script puede elegir una |
| 2 | 1.228 nodos de texto y 113 atributos literales | **0 y 0**, y ahora medido también dentro de las plantillas en línea de los componentes, que el escáner original no leía |
| 3 | Backend con 0 ficheros de i18n y ≥197 excepciones en español fijo | Catálogo propio de **1.075 claves × 3 idiomas**, negociación por `Accept-Language`, idioma por petición en `AsyncLocalStorage`, filtro de excepciones e interceptor de respuestas |
| 4 | El conmutador público de idioma estaba roto | Un solo componente, un solo camino de escritura; `<html lang>`, `localStorage` y la señal se mueven juntos |
| 5 | 2 idiomas frente a 19 mercados, `pt-BR` sin catálogo | **3 catálogos completos** (es/en/pt), sin claves pendientes en ninguno |

### 10.2 Cifras

```bash
# Catálogos: mismas claves, sin huecos, en los dos productos
python3 - <<'EOF'
import json
def n(d): return sum(n(v) if isinstance(v,dict) else 1 for v in d.values())
for d in ('apps/core/client-web/src/assets/i18n',
          'apps/backend/api/src/app/i18n/messages'):
    print(d, {l: n(json.load(open(f'{d}/{l}.json'))) for l in ('es','en','pt')})
EOF
# → cliente 2.769 × 3   ·   servidor 1.075 × 3

node tools/i18n/externalize-template-text.mjs --dry        # 0 / 0 / 0 / 0
node tools/i18n/externalize-template-text.mjs --dry --hbs  # 0 / 0 / 0 / 0
node tools/i18n/find-orphan-keys.mjs                       # 0 claves huérfanas
node tools/i18n/apply-glossary.mjs                         # 0 pendientes en en y pt
```

El glosario —la memoria es→en/pt que hace reproducible la traducción— tiene **3.067 términos**.

### 10.3 Lo que se rehízo, no se completó

La auditoría sostenía que lo que faltaba no eran «pendientes de traducir» sino decisiones
arquitectónicas ausentes. Se tomaron:

- **Tres ejes de idioma explícitos** (`LanguageAxis`, `libs/shared/types/src/lib/i18n/locale.contract.ts:220`):
  `Interface` sigue a quien lee, `Books` a la lengua estatutaria del inquilino, `Document` al
  destinatario. Es exactamente la decisión de producto que la §8 exigía tomar antes de escribir
  código, y resuelve el caso que la motivaba: **un usuario que no habla español dentro de una
  empresa dominicana** ve la interfaz en su idioma, los nombres de cuenta en español —porque son
  los libros legales, y el auditor pide los nombres con los que se abrieron— y emite una factura
  en el idioma de su cliente.
- **Formato regional por `Intl`**, no por `LOCALE_ID`: `NumberFormat`, `DateTimeFormat`,
  `PluralRules` y `ListFormat`, en el cliente (`core/i18n/format.service.ts`) y en el servidor
  (factura, correo, reportes, reloj fiscal). El idioma se puede cambiar sin recargar.
- **Una sola fuente de idiomas y locales** en `libs/shared/types`, consumida por ambos lados.
- **Validación localizada por un solo sitio**: una `exceptionFactory` traduce ~1.100 reglas de
  `class-validator` sin tocar 1.100 decoradores, y compone varias con `Intl.ListFormat` —que
  aplica sola la regla del español por la que «y» se vuelve «e» ante palabra que empieza por
  sonido i-.
- **Respuestas de éxito por clave** (`messageKey` + `messageParams`), simétricas al filtro de
  errores, con un tipo que hace que el compilador rechace prosa en una respuesta.

### 10.4 Las barreras

Ocho specs, todas en CI. Importan porque **ninguno de estos defectos era un error de tipos, de
ejecución ni de render**: todos eran cadenas, y sólo los detecta una prueba escrita a propósito.

| Spec | Qué impide |
|---|---|
| `translation-parity` / `messages.parity` | Que un catálogo tenga una clave que otro no, o placeholders distintos |
| `translation-coverage` | Que una plantilla use una clave inexistente |
| `no-hardcoded-strings` | Texto literal en plantillas, **incluidas las que viven dentro de un componente** |
| `route-titles` | Un `title:` de ruta que sea prosa, o que no resuelva en los tres idiomas |
| `no-native-dialogs` | `window.confirm`, `alert` o `prompt`, cuyo texto no se puede traducir |
| `validation-messages` | Que un decorador de validación lleve prosa |
| `i18n.service` | Negociación, respaldo y parámetros del catálogo del servidor |

A ellas se añade el paso de idempotencia: la cadena completa de codemods ejecutada dos veces no
cambia un byte. Sin él, `apply-glossary.mjs` —que regenera en/pt desde el español y el glosario—
revierte silenciosamente cualquier traducción escrita a mano en un catálogo.

### 10.5 Nota revisada

**8 / 10.**

**Sube desde 3 porque** la superficie está cubierta de extremo a extremo y verificada por
construcción: cero literales, cero claves huérfanas, cero pendientes, paridad y cobertura en CI,
los tres ejes de idioma separados, formato regional real y el backend traduciendo errores,
validaciones, respuestas, correo, PDF y reportes en el idioma que corresponde a cada uno.

**No llega a 10 porque** quedan tres cosas que este módulo no puede resolver solo:

1. **Sólo tres idiomas para 19 mercados aprovisionables.** Ninguno de los 19 queda sin un idioma
   que se lea, pero el francés (Haití) y el neerlandés (Curazao, Aruba) no existen. Añadirlos ya
   es traducir, no rediseñar — el mecanismo los admite sin cambios.
2. **Las traducciones a inglés y portugués no las ha revisado un hablante nativo del dominio
   contable de cada país.** El glosario las hace consistentes y reproducibles; no las hace
   revisadas. Antes de vender en Brasil, un contador brasileño debe leer el catálogo `pt`.
3. **No hay SSR ni prerenderizado por idioma para las rutas públicas**, ni `hreflang`. No afecta
   al producto en uso, sí al posicionamiento por mercado. Es trabajo de infraestructura y build,
   no de traducción (§8).

Ninguna de las tres es un defecto del código entregado; las tres son decisiones de negocio con
coste conocido. Cuando el catálogo `pt` lo firme un contador brasileño y los dos idiomas que
faltan estén, este módulo es un 10.
