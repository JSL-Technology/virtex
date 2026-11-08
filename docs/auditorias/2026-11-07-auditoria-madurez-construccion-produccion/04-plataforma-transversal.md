# 04 — Plataforma transversal

Cada componente tiene su ficha completa en `modulos/` con los 12 ejes, las compuertas y los hallazgos. Este documento resume cómo condicionan al resto del producto. Las notas son las finales, ya calibradas por el coordinador; los ajustes y sus motivos están en `09-cobertura-y-verificacion.md`.

| Componente | Ficha | Madurez | Prep. | Veredicto | Lo que condiciona a los demás módulos |
|---|---|---|---|---|---|
| Autenticación y sesión | `auth.md` | 83 (77–88) | 82 | Listo con reservas | Base sólida: cookies `__Host-`, CSRF firmado, rotación de refresh, step-up de un solo uso y revocación inmediata, todo verificado por HTTP real (`verify:auth-contract`). Reservas: la CSP permite `unsafe-inline` y en producción se admite `RECAPTCHA_DISABLED=true` |
| Usuarios | `users.md` | 81 (75–86) | 80 | Listo con reservas | Escalada y asignación masiva rechazadas en vivo. No hay auditoría de cambios de usuario (PLT-AUD-02) |
| Roles y permisos | `roles-permisos.md` | 82 (76–86) | 80 | Listo con reservas | **Un solo mecanismo**: guard global con denegación por defecto. 126 controladores y 808 handlers sin ningún endpoint sin declarar; muestra del miembro → 403 en todas las familias. Es la mejor pieza del producto |
| Multi-tenencia | `multi-tenencia.md` | 70 (63–76) | 72 | Listo con reservas, condicionado | Guard + RLS + trigger de FK de mismo tenant + verificadores en CI. **No es a prueba de olvido**: escritura entre tenants en `push_subscription` (tabla sin `organization_id` ni política; PLT-NOT-01, crítico) y FK sin guarda en `customer_portal_accounts` (prueba en rojo). En producción el arranque rechaza roles con BYPASSRLS (correcto). Aquí la API corre como superusuario |
| Organizaciones | `organizations.md` | 72 (65–78) | 70 | Listo con reservas | Cambio de organización activa y cabecera de tenant verificados. Perfil legal y membresías sin auditar |
| Suscripción SaaS y pagos | `saas-payment.md` | 55 (48–62) | 50 | **No listo** | Causa raíz de FAC-INV-01: el control de cupo aborta la transacción del documento. Los límites de plan salen como 500. Las funciones básicas quedan detrás de planes de pago (SP-11). Stripe no se ejercitó |
| Seguridad / onboarding | `security-onboarding.md` | 82 / 74 | 78 | Listo con reservas | Cifrado de campos y derivación única de claves verificados. El NSS de los empleados está en claro (NOM-20, ampliado en verificación). Clave de Maps fija en el cliente |
| Internacionalización | `i18n.md` | 66 (58–72) | 64 | Piloto controlado | **Fuente única** (`libs/shared/locales`), 10.307 claves con paridad es/en/pt, verificadores en CI. Terminología DO en el catálogo base, portugués que mezcla PT y BR, idioma que sigue al navegador y no a la URL |
| Motor de reglas por país | `localization.md` | 42 (35–50) | 38 | **No listo** | Las reglas son **código, no datos versionados** (SP-03). DO se filtra a otros países (SP-02). Brasil factura al 0 % (LOC-01, crítico) |
| Jurisdicciones / geo | `jurisdictions-geo.md` | 40 (32–48) | 35 | No listo fuera de DO | La nómina "genérica" está modelada sobre la TSS. `x-forwarded-for` se lee sin validar |
| Auditoría de negocio | `audit.md` | 58 (50–64) | 60 | Piloto controlado | Append-only verificado (trigger + REVOKE). No ve `repository.update()`, ni usuarios, roles, tasas o perfil de empresa (SP-09) |
| Notificaciones / push / websockets | `notificaciones-push-websockets.md` | 45 (38–52) | 45 | **No listo** | Crítico PLT-NOT-01. Socket.io sin adaptador Redis: con varias réplicas se pierden notificaciones |
| Correo entrante y saliente | `mail-inbound-mail.md` | 56 (48–62) | 58 | Piloto controlado | Cola con reintentos. No hay historial de envíos ni de rebotes |
| Archivos y documentos | `storage-documents.md` | 55 (48–62) | 55 | Piloto controlado | Aislamiento OK. **Disco local por defecto también en producción** (verificado). No hay validación de tipo ni de contenido |
| Importación / exportación | `data-transfer.md` | 42 (35–50) | 42 | **No listo** | Síncrona, máximo 5.000 filas, se rompe a mitad de un archivo con un 500. Bloquea la migración de clientes medianos: es la puerta de entrada comercial |
| Búsqueda | `search.md` | 50 (43–56) | 48 | Piloto controlado | Solo cubre facturas, productos y clientes |
| Colas, caché y jobs | `queues-cache-jobs.md` | 62 (55–68) | 60 | Piloto controlado | `@ExclusiveJob` con lock advisory en una sola réplica (verificado). No hay alerta ni métrica cuando un job agota sus reintentos. Los crons con efecto externo no están condicionados al entorno |
| Observabilidad | `observabilidad.md` | 50 (43–57) | 48 | Piloto controlado | Logs pino con request-id, tenant y usuario (OK). `/metrics` es inaccesible, no hay métricas HTTP ni de colas, ni alertas |
| Configuración y migraciones | `config-database.md` | 66 (60–72) | 65 | Piloto controlado | 178 migraciones reproducibles, sin deriva, con validación de entorno en el arranque. 291 `CREATE INDEX` sin `CONCURRENTLY` y sin `lock_timeout`: riesgo con tablas grandes |
| Backend compartido | `shared-backend.md` | 55 (48–62) | N/A | — | `shared/common` importa identidad, organizaciones, localización y seis dominios (PLT-SH-01). 1.237 violaciones de frontera (SP-08) |
| Bandeja de trabajo | `my-work.md` | 60 (52–66) | 60 | Piloto controlado | — |
| Motor de flujos | `workflow-engine.md` / `workflows.md` | 62 / 55 | 60 / 55 | Piloto controlado | **Dos motores** con aprobaciones solapadas. Doble aprobación concurrente posible (PLTB-WF-02, verificado). 8,2 k líneas de frontend sin una sola prueba |
| Extensiones | `extensions.md` | 74 (68–80) | 72 | Listo con reservas | Sandbox `isolated-vm` probado contra escape, SSRF y firma alterada: resistió. Falta auditar publicar, revocar y consentir |
| Hojas de datos / mapa de relaciones | `datasheets.md` / `relationship-map.md` | 68 / 70 | 66 / 68 | Piloto controlado | — |
| IA (copiloto, agentes, MCP) | `ai.md` / `ai-engine.md` | 58 / 62 | 52 / 55 | Piloto controlado | Degradación honesta sin clave (503 explícito, sin datos inventados). Acciones con aprobación humana y con los permisos del usuario. Motor Python con rol propio bajo RLS (verificado) |
| Shell del frontend | `frontend-shell.md` | 56 (50–62) | 55 | Piloto controlado | ~55 servicios de dominio en `core/` con duplicados. Paquete inicial de 2,0 MB frente al presupuesto de 1,6 MB |
| Navegación y cobertura UX | `navegacion-y-cobertura-ux.md` | 52 (45–60) | 50 | Piloto controlado | 155 rutas recorridas: 0 errores JS, 0 respuestas 5xx, 0 claves sin traducir. Nueve backends sin pantalla. El menú ofrece funciones fuera del plan |
| Configuración general (settings) | `settings.md` | 60 (53–66) | 60 | Piloto controlado | Los ajustes persisten y se validan en el servidor. El perfil de empresa no se audita. `/settings/<sección>` está roto en 27 de 27 casos |
| Librerías compartidas | `libs-shared.md` | 66 (60–72) | 68 | Listo con reservas | Una regla contable vive en `libs/shared/types` |
| CI/CD e infraestructura | `ci-cd-infra.md` | 34 (28–42) | 30 | **No listo** | **`main` en rojo desde el 2026-10-13** (15 de los últimos 24 runs fallan). Se fusiona con CI y CodeQL fallando. CI contacta a la DGII. Sin respaldo, restauración ni rollback. 0 releases |
| Escritorio (Electron) | `desktop.md` | 58 (50–65) | 50 | Piloto controlado | Runtime seguro, pero Electron vulnerable y binarios sin firma ni auto-actualización |
| Documentación y gobernanza | `documentacion-gobernanza.md` | 45 (38–52) | 40 | No listo | Sin ADR, CHANGELOG, CONTRIBUTING ni SECURITY. Documentos de estado desactualizados |

## Respuestas a las preguntas del Paso 4

- **Filtro de organización: ¿a prueba de olvido?** No del todo. El guard y RLS lo hacen a prueba de olvido **para las tablas que el modelo conoce**. Una tabla nueva sin `organization_id` (push), un `@Body()` sin DTO o una FK nueva sin trigger quedan fuera, y ya hay un caso explotado (PLT-NOT-01). En producción, RLS solo protege si la API se conecta con el rol `virtex_app` (el arranque lo exige) y si la tabla tiene política.
- **¿Un solo mecanismo de autorización, en el servidor?** Sí. Es la fortaleza más clara del producto (`roles-permisos.md`).
- **Internacionalización.** Fuente única y paridad verificada. Falla la neutralidad del catálogo base, que usa terminología DO.
- **Reglas por país.** Son código. Solo la nómina y las jurisdicciones de EE. UU. tienen vigencia, y la nómina con datos históricos incorrectos (NOM-02). Es el mayor bloqueo para la expansión.
- **Respaldo y recuperación.** No hay evidencia en el repositorio: ni procedimiento ni pruebas de restauración (`grep` vacío en `docs/DEPLOYMENT.md` y `tools/`; FE-CI-04). Es un hallazgo alto.
- **Observabilidad.** Correlación de logs correcta. Faltan métricas y alertas.

## Dependencias que impiden que los módulos lleguen a su techo

| Carencia de plataforma | Módulos topados |
|---|---|
| Motor de reglas por país sin vigencia y con DO filtrado | taxes, invoices, einvoicing, compliance, chart-of-accounts, payroll, accounts-payable (retenciones), pos |
| Auditoría basada en el ORM | Todos los que cambian estado con `update()`: quotes/sales, invoices, workflows, organizations, users |
| Límites SaaS dentro de la transacción del documento | invoices (NC y anulación), customers, data-transfer |
| Importación síncrona de 5.000 filas | Migración de cualquier módulo maestro (clientes, productos, plan de cuentas, saldos iniciales) |
| CI en rojo sin protección de rama | Compuerta 7 incumplida en **todos** los módulos |
| Sin métricas ni alertas | Compuerta 10 parcial en todos |
