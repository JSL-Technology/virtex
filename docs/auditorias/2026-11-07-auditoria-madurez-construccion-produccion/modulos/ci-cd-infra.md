# Ficha — ci-cd-infra (CI/CD, empaquetado, despliegue, respaldo, releases)

Familia FE · auditor FE · 2026-11-07/08 · evidencia por GitHub API (`gh`/MCP, solo lectura) y repo local.

## 1. Identificación
- Alcance: `.github/workflows/ci.yml` (427 l.), `codeql.yml` (81 l.), `ai-eval.yml` (60 l.); `apps/ai-engine/Dockerfile` (único Dockerfile del repo); `docs/DEPLOYMENT.md` (273 l.); `platform/policies/security/plugin_admission.rego`; `tools/` (verify/*, ci/, db/, i18n/, check-schema-drift.mjs, generate-environment.mjs); `apps/core/client-web/src/environments/*` (fileReplacements prod).
- Países: N/A (transversal). Núcleo para vender: sí (sin CI fiable y sin respaldo no hay operación SaaS seria).

## 2. Estándar de referencia
(a) Básico: CI obligatoria y verde en la rama que se despliega; merge bloqueado si CI falla (branch protection/rulesets con checks requeridos); artefactos reproducibles (imágenes de contenedor versionadas para api/web/pos); entornos separados (dev/staging/prod) con configuración por entorno validada; gestión de secretos fuera del repo; respaldo y restauración probados (RPO/RTO declarados, PITR de Postgres, ensayo de restore); versionado semántico, tags y releases con changelog; rollback documentado; escaneo SAST/dependencias. Avanzado: despliegues progresivos, migraciones expand/contract, SBOM y firma de artefactos, entornos efímeros por PR. (b) Invariantes: nunca se despliega lo que no pasó CI; las pruebas de CI no tienen efectos externos reales. (c) Práctica de referencia: DORA/Google SRE, GitHub "protected branches + required status checks" (confianza alta, documentación pública de GitHub); NetSuite/Dynamics publican ventanas de release y notas por versión (confianza media). (d) Construcción: pipeline por etapas con caché, jobs paralelos, gates obligatorios.

## 3. Resultado
- **Madurez: 34 (28–42, confianza alta)** — CI muy rica en verificaciones de sistema real, pero main lleva semanas en rojo, se fusiona con CI rojo, no hay imágenes de api/web, ni respaldo/restore, ni releases.
- **Preparación comercial: 30 — Veredicto: No listo.**
- Eje más débil: 10 Operabilidad (respaldo/recuperación inexistente) y 9 (CI roja no bloquea).
- Hallazgos críticos abiertos: 0 marcados como CRÍTICO de seguridad; 3 altos que bloquean producción (FE-CI-01, 02, 04).

## 4. Ejes
| Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad/completitud | 35 (30–45, alta) | CI real con 39 pasos, Postgres pgvector+Redis de servicio; sin pipeline de CD ni imágenes para api/web/pos (solo `apps/ai-engine/Dockerfile`) | Dockerfiles/imágenes para api, client-web, pos; workflow de despliegue a staging/prod |
| 2 Corrección/integridad | 30 (25–40, alta) | Run 42324878666 (main, 2026-11-07) `failure`: `api:typecheck` (certificate-trust.spec.ts:25 TS2345) y `api:test` | CI verde y obligatoria |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 45 (40–55, media) | Un único job `main` secuencial de ~16 min; pasos `if: !cancelled()` dan señal completa | Paralelizar jobs, caché Nx Cloud real |
| 5 Higiene | 55 (45–60, media) | Gates de fronteras/tenancy/drift en CI (`verify:boundaries`, `check:schema-drift`, `verify:tenant-scope`) | — |
| 6 Calidad | 50 (40–55, media) | Lint 0 errores pero 1.002 warnings tolerados (api 522, client-web 480) | Umbral de warnings decreciente |
| 7 Robustez | 40 (30–50, media) | Sin reintentos/aislamiento de red en pruebas; `verify:invoicing` contacta ecf.dgii.gov.do (aviso coordinador 14:05) y corre en CI paso 37 (ci.yml:403-405) | Simular DGII; bloquear egreso en CI |
| 8 Seguridad | 50 (40–60, media) | Secretos de CI son literales de prueba (ci.yml env: `JWT_SECRET: ci-secret…`, `STRIPE_SECRET_KEY: sk_test_ci`, enmascarables, sin valor real); permisos mínimos `contents: read`; CodeQL semanal + PR. CodeQL `failure` en el head del PR #162 | Rulesets con CodeQL requerido; dependabot/`npm audit` como gate (128 vulns, 15 high) |
| 9 Pruebas/verificabilidad | 30 (25–40, alta) | 15 de 24 runs CI en main (últimos 100 runs) = failure, 8 success, 1 cancelled; último verde en main: run 315 (2026-10-13). PR #174 fusionado 2026-11-07T01:35 con check `main=failure`; PR #162 fusionado con `main=failure` y `CodeQL=failure` | Branch protection con checks requeridos |
| 10 Operabilidad | 15 (10–25, alta) | `grep -niE "backup|respaldo|restore|pg_dump|PITR|rollback" docs/DEPLOYMENT.md` → 0 coincidencias; no hay scripts de respaldo en `tools/` | Política RPO/RTO, PITR, ensayo de restore, runbook de rollback de migraciones |
| 11 UX | N/A | — | — |
| 12 Competitividad | 30 (25–40, media) | 0 releases y 0 tags (`gh api …/releases`, `…/tags`); 358 commits sin versionado | SemVer + release notes |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | No cumple | No existe CD ni imágenes de api/web |
| 2 | Integridad | No cumple | Se fusiona con CI roja (#174, #162) |
| 3 | AuthZ/aislamiento | N/A (CI ejecuta `verify:tenancy` y aislamiento por aplicación: pasan) | pasos 24, 27, 31 OK |
| 4 | Validación servidor | N/A | — |
| 5 | Humo sin 500 | Parcial | `verify:boot` OK en CI |
| 6 | Cumplimiento país | N/A | — |
| 7 | Pruebas en CI | **No cumple** | `api:test`, `api:typecheck` fallan en main |
| 8 | Auditoría | N/A | — |
| 9 | Migraciones reproducibles | Cumple | `migration:run` desde vacío + sobre BD con tenant (paso 28) + drift OK |
| 10 | Observabilidad | No cumple | Sin alertas de despliegue; sin notificación de CI rota |
| 11 | UI | N/A | — |
| 12 | Documentación operativa | No cumple | DEPLOYMENT.md sin respaldo/restore/rollback/entornos |

## 6. Hallazgos
- **FE-CI-01** — ci-cd-infra, eje 9 · pruebas · **Alta** · `.github/workflows/ci.yml` / rama main. main está en rojo: 15/24 últimos runs de CI en main fallan; el último verde es del 2026-10-13 (run 315). El run 42324878666 (commit 36f10d7, 2026-11-07) falla en `api:typecheck` (`src/app/einvoicing/services/certificate-trust.spec.ts(25,15) TS2345`) y `api:test` (coincide con lo medido localmente: same-tenant-references.spec.ts:56, customer-portal.spec.ts). Forma correcta: arreglar y mantener verde. Impacto: riesgo operativo. Esfuerzo S.
- **FE-CI-02** — eje 9/2 · operabilidad · **Alta** · GitHub. Se fusiona con CI roja: PR #174 (merged 2026-11-07T01:35:23Z, head 8c74910: `main=failure`), PR #162 (merged 2026-10-30, head 8afbca7: `main=failure`, `CodeQL=failure`). `gh api …/branches/main/protection` → 403 (no visible con este token), pero los hechos demuestran que ningún check bloquea el merge. Forma correcta: ruleset en main con `CI / main` y `CodeQL` requeridos. Impacto: bloquea venta enterprise (no hay garantía de calidad del artefacto). Esfuerzo S.
- **FE-CI-03** — eje 7 · robustez/efecto externo · **Alta** · `ci.yml:403-405` (`npm run verify:invoicing`). Según el aviso del coordinador, ese verificador contacta `ecf.dgii.gov.do` aunque NODE_ENV=test; CI lo ejecuta en cada push y PR → tráfico real hacia la autoridad fiscal desde CI y prueba no determinista. Forma correcta: adaptador DGII simulado en pruebas + egreso bloqueado. Esfuerzo S–M.
- **FE-CI-04** — eje 10 · operabilidad · **Alta** · `docs/DEPLOYMENT.md`, `tools/`. Sin respaldo ni recuperación: no hay política, script, PITR ni ensayo de restore (grep vacío). Para un ERP con libros contables es un bloqueo de venta. Esfuerzo M.
- **FE-CI-05** — eje 1 · arquitectura de entrega · **Media** · repo. Solo existe `apps/ai-engine/Dockerfile`; api, client-web y pos no tienen imagen ni pipeline de despliegue (README describe deploy manual en Render solo para el cliente). Esfuerzo M.
- **FE-CI-06** — eje 12 · versionado · **Media** · GitHub. 0 tags, 0 releases, sin CHANGELOG.md: imposible decir a un cliente qué versión corre ni hacer rollback a una versión. Esfuerzo S.
- **FE-CI-07** — eje 8 · seguridad · **Media** · CI. `npm audit` (128 vulns, 15 high: node-forge ≤1.4.0, @angular/router, electron…) no es gate; CodeQL falla sin bloquear. Esfuerzo S.
- **FE-CI-08** — eje 6 · calidad · **Baja** · CI. 1.002 warnings de lint aceptados sin presupuesto; presupuesto de bundle solo como warning (`maximumWarning 1.6mb`, `maximumError 4mb` en `apps/core/client-web/project.json:79-80`), por eso 2,00 MB no rompe CI. Esfuerzo S.

## 7. Camino mínimo a producción
1. Arreglar los 2 fallos de api y dejar main verde (S). 2. Ruleset en main con CI+CodeQL requeridos (S). 3. Aislar `verify:invoicing` de DGII (S–M). 4. Respaldo/PITR + restore ensayado + runbook (M). 5. Imágenes de api/web/pos y pipeline a staging (M). 6. Tags/releases (S). Retocar, no rehacer: la batería de verificadores es buena base. Todos los países.

## 8. Camino a 100
Ítems 1–2 (+15), respaldo (+15), CD con staging (+10), releases/changelog (+5), gate de dependencias y SBOM (+5), paralelización y entornos efímeros (+5), despliegue progresivo y migraciones expand/contract (+5).

## 9. Competitividad
Los competidores SaaS (NetSuite, D365, Odoo SaaS) publican releases versionadas, SLA de respaldo y RPO/RTO; aquí no existe ninguna de las tres (confianza media).

## 10. Fortalezas
CI con verificaciones de sistema real (arranque, 19 mercados, aprovisionamiento, contrato de auth, aislamiento por app y por RLS, drift, migraciones sobre BD con tenant); permisos mínimos del workflow; acciones fijadas por SHA (`actions/checkout@3d3c42e…`); config de prod que falla al arrancar si faltan secretos (README §env).

## 11. No verificado
Configuración de branch protection/rulesets (API 403 con este token; inferido por los merges); infraestructura real de producción (fuera del repo); logs de `ai-eval.yml` (no consultados).
