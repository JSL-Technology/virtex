# 04 — Plataforma transversal

Resumen consolidado de los 23 componentes transversales. Cada uno tiene su ficha completa en `modulos/` con los 12 ejes, las compuertas y los hallazgos; aquí se recogen las conclusiones que condicionan a todos los módulos de negocio.

## Panel

| ID | Componente | Madurez | Prep. | Veredicto | Eje más débil | Crít. | Ficha |
|---|---|---|---|---|---|---|---|
| T01 | Autenticación y sesión | 55 | 52 | No listo | Completitud (recuperación de contraseña rota) | 1 | `autenticacion-y-sesion.md` |
| T02 | Usuarios, roles y permisos | 50 | 48 | No listo | Seguridad | 1 | `usuarios-roles-permisos.md` |
| T03 | Multitenencia y organizaciones | **52** (ajustada; original 70) | **50** | **No listo** | Seguridad y aislamiento | 1 | `multitenencia-y-organizaciones.md` |
| T04 | Suscripción y cobro del SaaS | 60 | 62 | Piloto controlado | Corrección | 0 | `suscripcion-saas.md` |
| T05 | Núcleo técnico compartido | 50 | 58 | No listo | Corrección (redondeo) | 1 | `nucleo-tecnico-compartido.md` |
| T06 | Internacionalización | 62 | 60 | Piloto controlado | Multi-país (pt a medias) | 0 | `internacionalizacion.md` |
| T07 | Localización y reglas por país | 42 | 38 | No listo | Multi-país | 1 | `localizacion-reglas-pais.md` |
| T08 | Impuestos | 45 | 42 | No listo | Multi-país | 1 | `impuestos.md` |
| T09 | Monedas y tipos de cambio | 50 | 46 | No listo | Multi-país | 0 | `monedas-tipos-de-cambio.md` |
| T10 | Reportes fiscales y cumplimiento | 35 | 30 | No listo | Multi-país | 1 | `reportes-fiscales-cumplimiento.md` |
| T11 | Notificaciones | 55 | 55 | Piloto controlado | Robustez | 0 | `notificaciones.md` |
| T12 | Auditoría (rastro) | 35 | 45 | No listo | Corrección | 0 | `auditoria-rastro.md` |
| T13 | Archivos y documentos | 52 | 50 | Piloto controlado | Completitud | 0 | `archivos-y-documentos.md` |
| T14 | Tareas, colas y caché | 60 | 60 | Piloto controlado | Robustez | 0 | `tareas-colas-cache.md` |
| T15 | Importación y exportación | 57 | 52 | No listo | Corrección | 0 | `importacion-exportacion.md` |
| T16 | Búsqueda global | 35 | 35 | No listo | Rendimiento y permisos | 0 | `busqueda-global.md` |
| T17 | Inteligencia artificial | 58 | 55 | Piloto controlado | UX y pruebas | 0 | `inteligencia-artificial.md` |
| T18 | Extensiones / marketplace | 35 | 28 | No listo | Completitud | 1 | `extensiones-marketplace.md` |
| T19 | Observabilidad | 30 | 35 | No listo | Operabilidad | 0 | `observabilidad.md` |
| T20 | CI/CD, infraestructura y gobernanza | 35 | 25 | No listo | Corrección (pipeline rojo) | 2 | `cicd-infraestructura-gobernanza.md` |
| T21 | Shell del portal y diseño | 62 | 60 | Piloto controlado | Pruebas (sin E2E) | 0 | `shell-portal-y-diseno.md` |
| T22 | Escritorio | 40 | 35 | No listo | Operabilidad (sin firma) | 0 | `escritorio.md` |
| T23 | Flujos y aprobaciones | 56 | 55 | Piloto controlado | Arquitectura | 0 | `flujos-y-aprobaciones.md` |

## Respuestas a las preguntas del Paso 4

### Multitenencia: ¿filtro a prueba de olvido?
**No.** Hay dos capas y ninguna es hoy a prueba de olvido:
- **Capa de aplicación (manual).** Cada servicio escribe `where: { organizationId }`. Las lecturas directas por id están bien cubiertas: más de 60 pruebas IDOR de cinco familias (clientes, productos, facturas, asientos, documentos, usuarios, empleados, nómina, tesorería, impuestos) devolvieron 404. Pero las **referencias entrantes** (ids de otros recursos dentro de un DTO) no se validan en al menos seis módulos: plan de cuentas (`parentId`, con lectura de la cuenta ajena), bloqueo de cuenta por período (`accountId`), listas de precios (`productId`, devuelve el producto ajeno completo), landed costs (`glAccountId`), manufactura (componentes y productos) y proyectos (`taskId`, `customerId`). Es el hallazgo sistémico **MT-03 (crítica)**.
- **RLS en PostgreSQL (174 tablas, 176 políticas).** Está bien diseñada, pero solo rige si la API conecta como `virtex_app`. En desarrollo y en este entorno conecta como superusuario (el arranque lo advierte y lo tolera). Además, 30+ tablas con datos de inquilino se clasificaron deliberadamente sin RLS (`users`, `roles`, `user_roles`, `audit_logs`, `notification`, `organization_invitations`, `mcp_oauth_*`…; ver `tenant-table-classification.ts`). `TenantedRepository` (`database/base.repository.ts`) es código muerto.
- **Forma correcta:** un validador de pertenencia común invocado en todos los DTO con `*Id`; claves foráneas compuestas `(organization_id, id)` para que la base rechace la referencia cruzada; la API siempre como `virtex_app`, con el arranque bloqueado fuera de dev si el rol tiene BYPASSRLS; y una prueba automática que recorra los DTO intentando ids de otro tenant.

### Autenticación, sesión y permisos: ¿un solo mecanismo en el servidor?
**Sí, y es una fortaleza real.** `PermissionsGuard` es un `APP_GUARD` de denegación por defecto. Recorriendo 125 controladores y ~800 rutas, F1 no encontró ningún endpoint sin decisión explícita: 667 `@HasPermission`, 88 `@AuthenticatedOnly(reason)` y 45 `@Public`. Se suman CSRF global ligado al usuario, JWT RS256 solo en cookie, rotación del refresh con detección de reutilización, step-up de un solo uso y anti-escalada al asignar roles. Fallan:
- **USR-01 (crítica):** un usuario con `users:edit` cambia el correo de un administrador.
- **AUTH-01 (crítica):** la recuperación de contraseña responde 500 para cuentas existentes (oráculo de enumeración). Combinado con USR-01 forma una cadena de toma de cuenta.
- **BUS-01:** `/search` es `@AuthenticatedOnly` y expone facturas a quien no tiene `invoices:view`.
- **CS-01:** el portal del cliente devuelve todas las facturas del tenant.

### Internacionalización
Fuente única (`libs/shared/locales`) con verificadores en CI que pasan en HEAD: es de lo mejor construido del producto. Fallan la paridad del portugués (41 claves en español y 38 con léxico pt-PT para un mercado brasileño) y algunos textos fijos en español en asientos generados (TES-07) e informes (COB-04).

### Motor de reglas por país
**Las reglas son código TS sembrado una vez por tenant, sin vigencia**, repartido en 9 o más archivos y en dos «packs» de país paralelos (`localization/fiscal/country-profiles.ts` y `contracts/country-pack/country-pack.ts`). Hay 7 tablas de plantillas vacías y sin uso. Solo `tax_jurisdictions` y `payroll_statutory_references` admiten vigencia, y la segunda tiene un único valor desde 2020 (NOM-01). A favor: los condicionales por país dispersos son pocos (3 archivos backend fuera de localización, ~4 en el frontend) y `coverageFor()` declara con honestidad «solo contabilidad» para los mercados sin fila. En contra: `fiscal-coverage.ts`, que se muestra al cliente antes de pagar, marca como «implementado» lo que no funciona (LOC-01).

### Auditoría, notificaciones, archivos, tareas, API pública y extensiones
- **Auditoría (T12):** el rastro automático de 36 tablas financieras se escribe **sin autor ni IP**. Verificado en BD: 71/71 filas de `invoices` con `user_id` NULL, porque `RequestContextModule` no se registra. `audit_logs` es mutable para el rol de la aplicación, y roles, permisos, impuestos y documentos no dejan rastro.
- **Notificaciones (T11):** WebSocket sin adaptador Redis, por lo que la presencia, el envío al usuario y `force-logout` solo funcionan con una réplica. No hay preferencias de notificación.
- **Archivos (T13):** sin sesión no se lee nada (bien). No hay antivirus, se aceptan documentos HTML y las URL de avatar y logo caducan o devuelven 404.
- **Tareas (T14):** BullMQ con reintentos. Los cron no tienen lock distribuido, así que con N réplicas se ejecutan N veces, y el refresco analítico hace DROP/CREATE de la vista cada hora fuera del contexto de tenant.
- **Extensiones (T18):** nominales. La admisión fija la firma como válida (EXT-02, crítica), el sandbox corre dentro del proceso de la API sin límite de concurrencia y ningún módulo invoca una extensión.

### Observabilidad, CI/CD, infraestructura y configuración
- **Observabilidad (T19):** sin sonda de salud pública, sin correlación real (pino `genReqId` ignorado bajo Fastify, sin `x-request-id`), sin `organizationId`/`userId` en los logs y sin métricas ni alertas utilizables. Lo positivo: los logs redactan cookies, tokens y CSRF.
- **Limitación de tasa:** global, fija en código, de 20 peticiones/min por IP (`app.module.ts:269`), más un segundo `ThrottlerModule` contradictorio en `auth.module.ts` y un `.env.example` con TTL en la unidad equivocada.
- **CI/CD (T20):** los **6 últimos runs de CI en `main` fallaron** (consultado en GitHub por F11; el último cae en `verify:tenant-scope` para el commit auditado) y CodeQL también falló. No hay E2E de UI. Las 15 vulnerabilidades altas no bloquean. Solo existe el Dockerfile del motor de IA y no hay IaC. Versión 0.0.0, sin tags.
- **Configuración por entorno:** validada al arrancar con Joi, con lista blanca de entornos de desarrollo. Es una fortaleza bien probada (`env.validation.spec.ts`).

### Respaldo y recuperación
**Sin evidencia.** No hay `backup|respaldo|restore|pg_dump|PITR|RPO|RTO` en `docs/` ni en la infraestructura (CICD-02, crítica para un ERP).

### Documentación y gobernanza del repositorio
El README es extenso y en general veraz sobre cómo arrancar. Hay `docs/DEPLOYMENT.md` (con Node 20 frente al `.nvmrc` 22). En la raíz y en `docs/auditorias/` hay más de 25 informes de auditoría y remediación que se contradicen con el estado actual (ver `09-cobertura-y-verificacion.md` §5). No hay registro de decisiones (ADR). Los comentarios del código son muy extensos y a menudo afirman correcciones que esta auditoría encontró incompletas.

## Cómo condiciona la plataforma a los módulos

| Carencia de plataforma | Módulos afectados | Techo que impone |
|---|---|---|
| Redondeo monetario en coma flotante (`common/money.ts:77-84`) | Todos los que calculan importes: facturación, CxP, CxC, POS, nómina, impuestos, e-factura, asientos | Corrección ≤59 mientras no se corrija |
| Referencias foráneas no validadas (MT-03) | Plan de cuentas, contabilidad, listas de precios, supply-chain, manufactura, proyectos; potencialmente todo CRUD con `*Id` | Seguridad ≤59; compuerta 3 incumplida |
| Rastro de auditoría sin autor (AUD-01) | Todos los módulos financieros | Compuerta 8 incumplida en todos |
| Plan de cuentas dominicano para todos los países (COA-03) | Contabilidad, nómina, impuestos, reportes fiscales en MX, CO, PE y demás | Multi-país ≤40 fuera de DO |
| Limitador global de 20 req/min por IP | Todo el portal, el POS y la IA | Operabilidad: inutilizable tras un NAT con pocos usuarios |
| Sin lock distribuido en cron ni adaptador WebSocket | Analítica, flujos, sesiones, notificaciones | Bloquea escalar horizontalmente |
| Sin correlación en logs, ni salud ni respaldo | Todos | Compuertas 10 y 12 incumplidas |
| Pipeline de CI en rojo | Todos | Compuerta 7 incumplida («pasan en CI») |
