# Virteex

## Ejecutar en local

Necesitas Postgres y Redis. Nada más: con `NODE_ENV` sin definir o en `development`, la API genera
sus propios secretos, apunta a `localhost` y trata Stripe, S3 y reCAPTCHA como opcionales, así que
arranca sin `.env` y sin credenciales de terceros.

```bash
# 1. Infraestructura (o usa tus propias instancias)
docker run -d --name virteex-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
docker run -d --name virteex-redis -p 6379:6379 redis:7
docker exec virteex-db psql -U postgres -c 'CREATE DATABASE erp'

# 2. Esquema (obligatorio: la API aborta al arrancar si las tablas no existen)
npm run migration:run

# 3. Arrancar API (:3000) y cliente (:4200) a la vez
npm run dev
```

También por separado: `npm run dev:api` y `npm run dev:web`.

Los valores por defecto de desarrollo coinciden exactamente con esos contenedores
(`localhost:5432`, usuario y contraseña `postgres`, base `erp`). Si usas otros, ponlos en `.env`
—`cp .env.example .env`— o expórtalos; cualquier variable definida gana sobre el valor por defecto.

**Si la consola del navegador muestra `ERR_CONNECTION_REFUSED` contra `localhost:3000`**, la API no
está corriendo. El cliente en `:4200` la espera en `:3000` (`environment.apiUrl`); arráncala con
`npm run dev:api` y revisa su salida. Dos causas habituales, ambas con mensaje explícito en esa
salida: falta ejecutar `npm run migration:run` (`relation "saas_plans" does not exist`), o Postgres
no está levantado (`ECONNREFUSED 127.0.0.1:5432`).

Qué queda desactivado sin credenciales, y cómo se nota:

| Sin configurar | Efecto |
| --- | --- |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_*` | El alta de pago responde `Este plan no está disponible para contratación en este momento.` en el paso de checkout. Login, sesiones, validación fiscal y el resto del ERP funcionan. |
| `AWS_*` | Se usa `LocalStorageStrategy`; los adjuntos van al disco local. Solo hacen falta con `STORAGE_DRIVER=s3`, y entonces se exigen también en desarrollo. |
| `RECAPTCHA_V3_SECRET_KEY` | `RECAPTCHA_DISABLED` vale `true` por defecto en desarrollo: el guard se salta y los DTO dejan de exigir `recaptchaToken`. Ponlo a `false` para probar el flujo real. |
| `MAIL_*` | Los correos transaccionales se encolan igual y el worker reintenta hasta agotar los 5 intentos; el trabajo queda en la cola fallida de BullMQ, no se pierde, y ningún flujo de usuario se rompe por ello. |

En producción no hay nada de esto: con `NODE_ENV=production` el esquema de configuración exige
todos los secretos y credenciales al arrancar, y el proceso no acepta tráfico si falta alguno. Los
valores generados de desarrollo son inalcanzables fuera de `development` y `test` —cualquier otro
valor, incluido `staging` o `NODE_ENV` mal escrito, falla en el arranque—. Las dos reglas están
fijadas en `apps/backend/api/src/app/config/env.validation.spec.ts`.

## Verificación

Además de `nx run-many -t lint test build typecheck`, el repositorio lleva comprobaciones que
ejercen el sistema real —con Postgres y Redis levantados— en lugar de describirlo. Todas corren en
CI y todas son re-ejecutables: liberan lo que dejó la ejecución anterior antes de empezar.

```bash
npm run check:schema-drift    # las migraciones y las entidades describen el mismo esquema
npm run verify:fiscal-identity # la identidad fiscal sobrevive al almacenamiento y no colisiona
npm run verify:tenancy         # una identidad, varios inquilinos, permisos por inquilino
npm run verify:boot            # el grafo de módulos resuelve: la aplicación arranca de verdad
npm run verify:markets         # los 19 mercados se aprovisionan (plan contable, segmentos, impuestos)
npm run verify:provisioning    # un alta PAGADA produce un inquilino operativo, y hacerlo dos veces produce uno
npm run verify:auth-contract   # el contrato HTTP de autenticación, sobre peticiones reales
```

`verify:auth-contract` es lo que sustituye a los andamios e2e generados por Nx, que afirmaban
`{ message: 'Hello API' }` sobre una ruta inexistente y un saludo `Welcome` que ninguna pantalla
muestra: comprueba cookies `httpOnly` con las vidas que dicen tener, CSRF exigido y rotado,
rotación del refresh, step-up rechazado sin prueba, paridad de respuestas entre contraseña
incorrecta y buzón desconocido, y una sesión revocada que deja de servir en el acto.

El bundle del cliente se sirve con cabeceras de seguridad declaradas en
`apps/core/client-web/public/serve.json` (CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`,
COOP y `Permissions-Policy`). Si lo pones detrás de otro servidor estático, replícalas ahí.

## Topología de despliegue

**La API y el cliente web deben servirse desde el MISMO ORIGEN.** Las cookies de sesión son
`SameSite=Lax` y la cookie CSRF lleva el prefijo `__Host-`, que la hace host-only: servidos desde
hosts distintos, el navegador ni adjunta la sesión ni deja que el SPA lea el token CSRF, y toda
petición que cambie estado responde 403. Usa un prefijo de ruta (`https://app.ejemplo.com/api/v1`)
o un proxy inverso que sirva ambos bajo un solo host. Ver `docs/DEPLOYMENT.md`.

Las instrucciones de Render de abajo describen cómo construir el bundle del cliente. Si lo sirves
como sitio estático independiente, apúntalo detrás del mismo proxy que la API — un servicio
separado en otro dominio no puede autenticar.

## Deploy de `client-web` en Render

Si en Render ves una pantalla como:

`Index of /` con entradas tipo `client-web/`, `browser/` o `prerendered-routes.json`,

estás sirviendo la carpeta raíz del build en lugar de la carpeta SPA final.

En este workspace (Angular + Nx con `@angular/build:application`), el build de `client-web`
genera el contenido web dentro de:

- `dist/apps/core/client-web/browser`

Por eso, en Render usa:

- **Build Command**
  - `npm install --legacy-peer-deps && npm run build:client-web`
- **Start Command**
  - `npm run start:client-web`

> Nota: Si prefieres no usar scripts, el equivalente directo del Start Command es:
> `npx nx build client-web --configuration=production && npx serve -s dist/apps/core/client-web/browser -l $PORT`

También puedes validar localmente con el target Nx ya definido:

- `npx nx run client-web:serve-static`

Ese target también apunta a `dist/apps/core/client-web/browser`.

## Comandos de Nx

Dos proyectos: `api` (NestJS sobre Fastify) y `client-web` (Angular).

```sh
npx nx <target> <proyecto>              # p. ej. npx nx build api
npx nx run-many -t lint test build typecheck
```

Los targets se infieren de los plugins configurados en `nx.json` o se declaran en cada
`project.json`.

## Referencias de proyecto de TypeScript

Nx mantiene las `references` de los `tsconfig.json` a partir del grafo de dependencias real. Si
quedan desfasadas, `typecheck` se niega a correr con «The workspace is out of sync».

```sh
npx nx sync        # aplica los cambios
npx nx sync:check  # falla si hay algo pendiente — es lo que corre CI
```
