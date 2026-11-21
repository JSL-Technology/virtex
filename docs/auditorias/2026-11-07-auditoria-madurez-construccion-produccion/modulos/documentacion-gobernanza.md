# Ficha — documentacion-gobernanza

Familia FE · 2026-11-07/08. Excluí, como pide la rúbrica, los informes de auditoría previos (`docs/auditorias/**` ajenos, `AUDITORIA_*`, `docs/INFORME_AUDITORIA_MODULOS_2026.md`, `docs/MODULE_ANALYSIS.md`, `docs/qa/**`).

## 1. Identificación
- `README.md` (178 l.); `docs/*.md` técnicos: `DEPLOYMENT.md` (273), `ARQUITECTURA_UX_MODULAR.md`, `AUTH_SESSION.md`, `CICLO_DE_VIDA_DE_REGISTROS.md`, `TAB_ARCHITECTURE.md`, `INVENTARIO_Y_RACIONALIZACION.md`, `IA_PLAN_MAESTRO.md`, `MERGE_FROM_SPECIAL_ENIGMA.md`, `ESTADO_MVP_REPUBLICA_DOMINICANA.md`, `design-system.md`, `brand.md`, `extensions.md`, `pos.md`, `relationship-map.md`, `AUDITORIA_I18N.md` (no leído: informe), `docs/superpowers/{plans,specs}` (5 diseños). Total `docs/*.md` ≈ 5.410 líneas. `.env.example` 525 l.
- Ausentes (ls en la raíz): `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`; sin ADRs (`find -iname "*adr*" -o -iname "*decision*"` fuera de node_modules → 0).

## 2. Estándar de referencia
(a) Básico: README con arranque reproducible; guía de despliegue y operación (entornos, secretos, respaldo/restore, rollback, monitorización); registro de decisiones (ADR); convenciones de código y contribución; changelog/notas de versión; documentación funcional por país para el cliente (configuración fiscal inicial). (b) Invariante: lo que la documentación promete existe y está verificado. (c) Referencia: Michael Nygard ADRs / adr.github.io (confianza alta); "Keep a Changelog" + SemVer (alta); guías de implantación por país de Odoo/Alegra (media).

## 3. Resultado
- **Madurez: 45 (38–52, confianza media)**. Preparación: 40. **Veredicto: No listo** (compuerta 12 — documentación suficiente para operar — no cumple: sin respaldo/restore ni runbooks).
- Eje más débil: 10 (operación). Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Completitud | 40 (32–48, media) | Sin ADRs, CONTRIBUTING, CHANGELOG; DEPLOYMENT sin respaldo/rollback (grep 0); sin manual de usuario/implantación por país | ADRs, runbooks, guía de implantación por país |
| 2 Corrección (promesas verificadas) | 62 (55–70, media) | Verificado: los 12 scripts que cita el README existen en package.json (`dev:api`, `verify:markets`, `verify:auth-contract`…); «todas corren en CI» → cierto (pasos 21–38 de ci.yml); `public/serve.json` con cabeceras existe; DEV_SEED rechazado fuera de dev/test (`config/env.validation.ts:278-282`); fileReplacements de prod (`client-web/project.json:72-73`) como dice DEPLOYMENT §"What changed". Desactualizado: `ESTADO_MVP_REPUBLICA_DOMINICANA.md` (2026-09-11) afirma «nómina/TSS no existe» mientras el manifiesto `rrhh.manifest.ts` declara `payroll/runs`, `payroll/concepts`, `payroll/parameters` y cargan en el humo; README «~55 módulos ERP» sin decir que 7 dominios no tienen pantalla (consolidación, intercompañía, manufactura, proyectos, CRM, casos, portal de clientes) | Fechar/archivar documentos de estado; matriz real módulo→UI→país |
| 3 Multi-país | 35 (28–45, baja) | README/DEPLOYMENT no documentan qué está soportado por país (solo «los 19 mercados se aprovisionan») | Matriz de soporte por país pública |
| 4 Arquitectura | 58 (50–64, media) | `TAB_ARCHITECTURE.md`, `ARQUITECTURA_UX_MODULAR.md`, specs de superpowers; abundantes comentarios de diseño en código (p.ej. `app.routes.ts:244-268`) | ADRs en vez de decisiones enterradas en comentarios |
| 5 Higiene | 50 (42–58, media) | Mezcla de idiomas en docs y comentarios (README es, DEPLOYMENT en, comentarios es/en en el mismo archivo, p.ej. `ventas.manifest.ts:4-9` en inglés y `:43-47` en español) | Convención de idioma |
| 6 Calidad | 55 (48–62, baja) | Comentarios explicativos largos, a veces narran historia de QA (`QA M-09`, `QA C-06`) más que el contrato | — |
| 7 Robustez | N/A | — | — |
| 8 Seguridad | 55 (45–62, baja) | README documenta topología mismo-origen y cookies; no hay política de divulgación/SECURITY.md (ls raíz) | SECURITY.md |
| 9 Pruebas | 60 (52–66, media) | README §Verificación documenta verificadores reales | — |
| 10 Operabilidad | 30 (22–38, alta) | Sin respaldo/restore, rollback, monitorización, alertas, gestión de incidentes | Runbooks |
| 11 UX | N/A | — | — |
| 12 Competitividad | 35 (28–45, baja) | Sin documentación para el cliente final (ayuda, implantación) frente a centros de ayuda de Alegra/Odoo/QuickBooks | Centro de ayuda |

## 5. Compuertas
12 Documentación para configurar/operar: **No cumple** (FE-DOC-01). Resto N/A.

## 6. Hallazgos
- **FE-DOC-01** · eje 10 · documentación · **Alta** · `docs/DEPLOYMENT.md`. No documenta respaldo, restauración, rollback de migraciones, entornos (staging), monitorización ni respuesta a incidentes; para un ERP es requisito de venta (ver FE-CI-04). M.
- **FE-DOC-02** · eje 1/4 · gobernanza · **Media** · raíz del repo. Sin ADRs, CONTRIBUTING, CHANGELOG ni SECURITY.md: las decisiones (empresa en la URL, manifiestos, DO como piloto) solo constan en comentarios de código y mensajes de commit; sin changelog no hay notas de versión para clientes. S–M.
- **FE-DOC-03** · eje 2 · documentación · **Media** · `docs/ESTADO_MVP_REPUBLICA_DOMINICANA.md` (fecha 2026-09-11, rama `feat/merge-enigma-improvements`). Documento de estado obsoleto que contradice el código actual (nómina). Sin marca de vigencia, induce a error a quien evalúa. S.
- **FE-DOC-04** · eje 2/12 · documentación · **Media** · `README.md:3`. «~55 módulos ERP» sin aclarar que varios dominios solo existen como API (FE-NAV-01) ni qué se soporta por país. S.
- **FE-DOC-05** · eje 5 · higiene · **Baja** · mezcla es/en en docs y comentarios. S.

## 7. Camino mínimo a producción
Runbook de operación con respaldo/restore/rollback (M) → matriz de soporte por país y módulo (S) → archivar/fechar documentos de estado (S) → CHANGELOG + SECURITY.md (S).

## 8. Camino a 100
Runbooks (+15), ADRs retroactivos de las 10 decisiones mayores (+10), documentación funcional por país (+10), changelog/release notes (+8), convención de idioma (+3).

## 9. Competitividad
Los líderes publican centro de ayuda, notas de versión y guías de implantación por país; aquí no hay nada orientado al cliente (confianza media).

## 10. Fortalezas
README preciso y verificable (todo lo que cita existe y corre en CI); `.env.example` extenso; documentación de arquitectura de pestañas y UX modular; comentarios que explican el porqué.

## 11. No verificado
Contenido detallado de `IA_PLAN_MAESTRO.md`, `extensions.md`, `pos.md`, `relationship-map.md` frente al código (no contrastado línea a línea; lo cubren las familias IA/PLT/POS); promesa de detección de duplicados por foto (requiere pgvector, ausente en este entorno).
