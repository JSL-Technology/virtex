# Ficha — CI/CD, infraestructura y gobernanza (T20)

Auditor: familia F11 · Fecha: 2026-10-31/11-01 · HEAD `495719fc` (main)

> **Hallazgo CRÍTICO (operativo, no de fuga): CICD-01 — la rama `main` está en rojo de forma sostenida** (verificado en GitHub con `gh run list`): los 6 últimos runs de CI en `main` fallan (17-oct → 30-oct) y 15 de los últimos 30. El último (`41107900677`, commit `495719fc`) cae en `npm run verify:tenant-scope`, un verificador de **aislamiento entre tenants**, por lo que no llegan a ejecutarse los pasos siguientes (`verify:security`, `verify:rls`, tests del motor IA, `verify:rls-runtime`, `verify:boundaries`, etc.). CodeQL en ese mismo commit también terminó en `failure`.
> **Hallazgo CRÍTICO (operativo): CICD-02 — no hay respaldo ni recuperación definidos** para la base multi-tenant.

## 1. Identificación
- Workflows: `.github/workflows/ci.yml` (365 líneas, 1 job, ~35 pasos), `codeql.yml` (81; lenguajes `actions` y `javascript-typescript`), `ai-eval.yml` (60; semanal/manual, requiere secreto). `.github/dependabot.yml` (ecosistemas `npm` y `github-actions`).
- `tools/`: 32 scripts en `tools/verify/`, 29 scripts `verify:*` en `package.json`, más `tools/i18n`, `tools/db`, `tools/ci`, `check-schema-drift.mjs`, scripts de diagnóstico (`_diag_page.mjs`, `_shots/`).
- Infraestructura: solo `apps/ai-engine/Dockerfile` y `docker-compose.test.yml` (busqué `Dockerfile*` en todo el repo excluyendo node_modules: 1). Sin IaC (no hay terraform/helm/k8s/`render.yaml`). Despliegue documentado en `docs/DEPLOYMENT.md` (pasos manuales) y README (Render, solo para el bundle del cliente).
- Gobernanza: `package.json` `"version": "0.0.0"`, **0 tags**, sin releases; sin `CHANGELOG`, `CONTRIBUTING`, `CODEOWNERS`, `SECURITY.md`, plantilla de PR, directorio de ADRs ni `CLAUDE.md` (todos buscados por nombre). En la raíz: 6 `.md`, de los cuales 4 son informes de auditoría/seguridad (`AUDITORIA_*.md`, `SECURITY_AUDIT_*.md`) + `CHART_OF_ACCOUNTS_SEGMENTS.md`; 20 entradas en `docs/`.

## 2. Estándar de referencia
(a) Básicas: CI obligatoria y **verde** en la rama principal con protección de rama; artefactos reproducibles (imagen de contenedor) para cada servicio; despliegue automatizado con promoción por entornos; respaldo automático con PITR y prueba periódica de restauración, RPO/RTO definidos; gestión de secretos fuera del repo; versionado semántico y notas de versión; escaneo de dependencias y código; sonda de salud. Avanzadas: SLSA nivel 2–3 (provenance firmado), SBOM propio, OpenSSF Scorecard alto, E2E en navegador por PR, despliegue canario, SLOs con presupuesto de error.
Fuentes: Google SRE Book (caps. "Release Engineering" y "Data Integrity", confianza alta); SLSA v1.0 (slsa.dev, alta); OpenSSF Scorecard checks (Branch-Protection, Pinned-Dependencies, Token-Permissions, Dependency-Update-Tool, SAST, Signed-Releases; alta); OWASP SAMM (Implementation › Secure Build/Deployment; alta). Microsoft Azure Well-Architected (Reliability: backup/DR; alta).

## 3. Resultado
- **Madurez: 35** (28–42, confianza media-alta: estado de CI verificado en GitHub).
- **Preparación comercial: 25 — No listo** (CI en rojo = no hay compuerta efectiva; sin respaldo/DR; sin artefactos de despliegue para API/web).
- Eje más débil: 2 Corrección/integridad del proceso (pipeline rojo) y 10 Operabilidad. Críticos 2 (operativos), Altos 5.

## 4. Doce ejes
| Eje | Nota | Evidencia | Para 100 |
|---|---|---|---|
| 1 Autenticidad | 45 (38–52, media) | CI real con Postgres (pgvector) y Redis de servicio y `DB_HOST` definido (`ci.yml:21-55`), de modo que las suites de integración que localmente se omiten **sí** correrían en CI; pero sin despliegue automatizado ni imágenes para API/web | Pipeline de entrega completo |
| 2 Corrección | 25 (18–32, alta) | CICD-01: `main` rojo; `verify:tenant-scope` falla en CI; localmente `verify:boundaries` y `verify:security` también fallan en HEAD y están en `ci.yml:237,296` (coordinador) | Main verde y protegido |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 50 (42–58, media) | Un único job secuencial de ~35 pasos: el primer fallo oculta todos los demás | Jobs paralelos e independientes, con resumen |
| 5 Higiene | 45 (38–52, media) | 32 verificadores ad-hoc; scripts de diagnóstico en `tools/`; informes de auditoría en raíz | Ordenar `tools/`, mover informes a `docs/auditorias` |
| 6 Código | 60 (52–66, media) | Workflows legibles, acciones fijadas por SHA (`ci.yml:124,132`), permisos mínimos (`ci.yml:11-13`, `contents: read`), `persist-credentials: false` en ai-eval | — |
| 7 Robustez | 35 (28–42, media) | Sin DR/backup (CICD-02); sin sonda de salud pública (coordinador); throttler global 20 req/min/IP (`app.module.ts:269`) | PITR, health/readiness, cuotas por usuario |
| 8 Seguridad | 50 (42–58, media) | CodeQL JS/TS + actions; dependabot npm + actions; npm audit 15 altas (electron, node-forge, @angular/*, nx, puppeteer…) sin compuerta; sin escaneo de secretos (busqué `gitleaks|trufflehog|secret-scan`: 0); CodeQL no cubre Python (`apps/ai-engine`); dependabot sin `pip`/`docker`; secretos de CI literales solo de prueba (`ci.yml:50-70`, valores ficticios) | Secret scanning, audit gate, SBOM/provenance |
| 9 Pruebas | 40 (32–48, media) | Mucha verificación estática; **no hay E2E de UI** (coordinador); `verify:form-a11y` y `verify:required-markers` fallan y no están en CI; ~990 avisos de lint no bloquean | E2E Playwright por PR sobre flujos críticos |
| 10 Operabilidad | 22 (15–30, media) | Sin artefactos para API/web, sin IaC, sin releases/tags (0), versión `0.0.0`; despliegue manual por documento; sin RPO/RTO (busqué `backup|respaldo|restore|pg_dump|PITR|RPO|RTO` en `docs/DEPLOYMENT.md`: 0) | Imagen + pipeline de despliegue + runbooks |
| 11 UX | N/A | — | — |
| 12 Competitividad | 35 (28–42, baja) | Un cliente grande pedirá evidencias SOC 2/ISO (cambios controlados, DR probado) que hoy no existen | Evidencia de controles |

Promedio ≈ 41; madurez 35 limitada por eje 2.

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | Parcial | CI real; entrega inexistente |
| 2 | **No cumple** | CICD-01 |
| 3 | No cumple | verificador de aislamiento `verify:tenant-scope` rojo en main |
| 4 | N/A | — |
| 5 | No cumple | sin E2E de UI |
| 6 | N/A | — |
| 7 | **No cumple** | pruebas no pasan en CI |
| 8 | N/A | — |
| 9 | Cumple (local) | 163 migraciones desde cero y sin deriva (Paso 2); en CI el paso `migration:run` pasa |
| 10 | No cumple | sin sonda de salud pública, sin métricas |
| 11 | N/A | — |
| 12 | Parcial | `docs/DEPLOYMENT.md` extenso pero sin backup/DR ni rollback |

## 6. Hallazgos
**CICD-01** · CI · Eje 2/9 · Operabilidad/pruebas · **Crítica** · `gh run list -R jsl-technology/virtex -b main -w CI`: failure en 41107900677 (30-oct, `495719fc`), 40098351693, 40096767574, 39288988760, 39237846245, 39076501295; agregado últimos 30: 15 failure, 13 success, 2 cancelled. Paso fallido en el último: `Run npm run verify:tenant-scope`. Runs de PR recientes (p. ej. 41198389758) fallan en `nx run-many -t lint test build typecheck`. Se integra a `main` con la compuerta roja, por lo que ninguna afirmación "pasa en CI" es válida hoy. Forma correcta: protección de rama con checks requeridos; reparar o revertir; política "main siempre verde". Impacto: bloquea la venta a clientes que exigen gestión de cambios. Esfuerzo M.

**CICD-02** · Infra · Eje 7/10 · Operabilidad · **Crítica** · `docs/DEPLOYMENT.md` (sin sección de respaldo), sin scripts de backup en `tools/db` (no verificado a fondo). No hay RPO/RTO, PITR, ni prueba de restauración para una base multi-tenant con RLS y roles propios (`APP_DB_PASSWORD`, `AI_ENGINE_DB_PASSWORD`). Forma correcta: backup gestionado con PITR, restauración probada trimestralmente, runbook y restauración por tenant. Riesgo de pérdida de datos de clientes. Esfuerzo M.

**CICD-03** · Infra · Eje 10 · **Alta** · Solo existe `apps/ai-engine/Dockerfile` (python:3.12-slim, `requirements.lock`, usuario no root uid 10001 — correcto). API y portal no tienen imagen ni IaC; el despliegue es manual. Forma correcta: Dockerfile multi-etapa para API y web dentro del monorepo, despliegue declarativo. Esfuerzo M.

**CICD-04** · Gobernanza · Eje 10/8 · **Alta** · Sin releases, tags ni versión (`0.0.0`), sin CHANGELOG; sin provenance/SBOM de artefactos (SLSA nivel 0–1). Imposible saber qué versión corre un cliente o revertir. Esfuerzo S–M.

**CICD-05** · Seguridad de cadena · Eje 8 · **Alta** · npm audit: 15 altas sin compuerta; dependabot no cubre `pip` (motor IA) ni imágenes Docker; CodeQL no analiza Python; sin escaneo de secretos en CI; sin `SECURITY.md`. Esfuerzo S.

**CICD-06** · Pruebas · Eje 9 · **Alta** · Riesgo de sustitución: 29 `verify:*` ad-hoc (análisis estático por regex/AST de convenciones: tenant-scope, boundaries, security, i18n…) ocupan el lugar de pruebas de comportamiento; no hay E2E de UI y las suites de integración solo corren en CI (que está rojo). Además, el job único secuencial hace que un verificador estático rojo impida ejecutar las pruebas de aislamiento en tiempo de ejecución (`verify:rls-runtime`, `ci.yml:272-281`). `verify:form-a11y` y `verify:required-markers` fallan y no están en CI. Forma correcta: mantener 3–5 verificadores de alto valor, mover el resto a reglas de lint, añadir E2E Playwright de flujos críticos (alta de tenant, factura, cobro, cierre) y separar jobs. Esfuerzo L.

**CICD-07** · Gobernanza · Eje 5 · Media · 4 informes de auditoría en la raíz, sin ADRs, sin CODEOWNERS ni plantilla de PR; los comentarios del código hacen de registro de decisiones (muy extensos). Forma correcta: `docs/adr/`, CODEOWNERS por módulo, informes en `docs/auditorias/`. Esfuerzo S.

**CICD-08** · Operabilidad · Media · Sin sonda de salud pública (`/api/v1/health` 404; `/health/queues` exige auth — coordinador); ai-eval falla sin secreto y no está en la compuerta. Esfuerzo S.

**CICD-09** · Configuración · Baja · Configuración por entorno vía `.env.example` y `tools/generate-environment.mjs`; listas permitidas de entorno (`isDevLikeEnvironment`) bien usadas en módulos revisados. Sin gestor de secretos documentado (verificar con el equipo). Esfuerzo S.

## 7. Camino mínimo a producción
1. CICD-01 main verde + protección de rama (M) — prerequisito de todo.
2. CICD-02 backup/PITR + restauración probada (M).
3. CICD-03 imágenes de API/web + despliegue reproducible (M).
4. CICD-04 versionado/tags + changelog (S).
5. CICD-05 compuerta de audit altas + secret scanning + pip en dependabot (S).
6. CICD-06 E2E mínimos (L).
Retocar, no rehacer.

## 8. Camino a 100
CICD-01 (+25 corrección), CICD-02 (+20 robustez/operabilidad), CICD-03 (+15 operabilidad), CICD-06 E2E y jobs paralelos (+20 pruebas), CICD-04/05 SLSA L2 + SBOM + Scorecard (+15 seguridad), SLOs y health/readiness (+10 operabilidad), ADRs/CODEOWNERS (+10 higiene).

## 9. Competitividad
Los líderes SaaS (NetSuite, Dynamics, Xero) se venden con SOC 1/2, ISO 27001 y DR documentado; Alegra y Siigo publican disponibilidad y políticas de respaldo (confianza media). Virteex no tiene evidencia equivalente. Nota 35.

## 10. Fortalezas
Acciones fijadas por SHA y permisos mínimos; CI con BD y Redis reales y pruebas de RLS en tiempo de ejecución y de ruta de actualización (`verify:upgrade-path`); verificación de deriva de esquema; Dockerfile del motor bien construido; CodeQL activo; dependabot para npm y actions.

## 11. No verificado
Protección de rama (no consultada); contenido de `tools/db` en detalle; si algún despliegue real (Render) está activo; ejecución local de pytest del motor (no instalé venv por presupuesto).

Cobertura: workflows 100 % leídos por patrón (ci.yml pasos y cabecera completos), dependabot y Dockerfile completos, DEPLOYMENT.md por encabezados y búsqueda; estado de CI verificado en GitHub (últimos 30 runs de main).

<!-- RESUMEN: modulo=cicd-infraestructura-gobernanza; madurez=35; prep=25; veredicto=No listo; eje_debil=Correccion(pipeline rojo)/Operabilidad; criticos=2; altos=5; camino_min=M -->
