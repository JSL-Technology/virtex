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
| `MAIL_*` | Los correos transaccionales fallan al enviarse y se registra el error; el flujo no se rompe. |

En producción no hay nada de esto: con `NODE_ENV=production` el esquema de configuración exige
todos los secretos y credenciales al arrancar, y el proceso no acepta tráfico si falta alguno. Los
valores generados de desarrollo son inalcanzables fuera de `development` y `test` —cualquier otro
valor, incluido `staging` o `NODE_ENV` mal escrito, falla en el arranque—. Las dos reglas están
fijadas en `apps/backend/api/src/app/config/env.validation.spec.ts`.

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

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

✨ Your new, shiny [Nx workspace](https://nx.dev) is almost ready ✨.

[Learn more about this workspace setup and its capabilities](https://nx.dev/nx-api/js?utm_source=nx_project&amp;utm_medium=readme&amp;utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!

## Finish your CI setup

[Click here to finish setting up your workspace!](https://cloud.nx.app/connect/o7uokeTSSx)


## Generate a library

```sh
npx nx g @nx/js:lib packages/pkg1 --publishable --importPath=@my-org/pkg1
```

## Run tasks

To build the library use:

```sh
npx nx build pkg1
```

To run any task with Nx use:

```sh
npx nx <target> <project-name>
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Versioning and releasing

To version and release the library use

```
npx nx release
```

Pass `--dry-run` to see what would happen without actually releasing the library.

[Learn more about Nx release &raquo;](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Keep TypeScript project references up to date

Nx automatically updates TypeScript [project references](https://www.typescriptlang.org/docs/handbook/project-references.html) in `tsconfig.json` files to ensure they remain accurate based on your project dependencies (`import` or `require` statements). This sync is automatically done when running tasks such as `build` or `typecheck`, which require updated references to function correctly.

To manually trigger the process to sync the project graph dependencies information to the TypeScript project references, run the following command:

```sh
npx nx sync
```

You can enforce that the TypeScript project references are always in the correct state when running in CI by adding a step to your CI job configuration that runs the following command:

```sh
npx nx sync:check
```

[Learn more about nx sync](https://nx.dev/reference/nx-commands#sync)


[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/nx-api/js?utm_source=nx_project&amp;utm_medium=readme&amp;utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:
- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
