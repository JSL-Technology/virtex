# Ficha: `ai` (copiloto, agentes, herramientas del copiloto, gateway de modelos, MCP + OAuth, embeddings/RAG, anomalías, caja, calidad de datos, informes narrativos, visión, procedencia, ajustes por inquilino, propuestas con aprobación humana) — familia IA

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/ai/` (96 archivos, 12.702 líneas incl. 36 artículos de ayuda .md es/en/pt). Piezas mayores: `copilot/copilot.service.ts` (859), `gateway/ai-gateway.service.ts` (699), `ai.controller.ts` (382), `product-vision/product-vision.service.ts` (359), `reports/reports.service.ts` (323), `mcp/mcp-oauth.service.ts` (257), `copilot/copilot.controller.ts` (242). 13 archivos `*.copilot-tools.ts` repartidos por módulo (1.396 líneas; 30 herramientas: 27 `read`, 3 `draft` — `draft_invoice`, `draft_quote`, `draft_purchase_order`), contrato en `contracts/copilot/copilot-tools.contract.ts`.
- **Endpoints:** `ai/*` (status, usage, overview, products/from-image, products/barcode, forecasts/*, anomalies/*), `ai/copilot/*` (conversaciones, mensajes, gráficos, propuestas confirm/reject, my-data), `ai/cashflow/*`, `ai/reports/manager`, `ai/data-quality/*`, `ai/agents/*`, `ai/close-assistant/*`, `ai/provenance/*`, `ai/settings`, `mcp`, `mcp/oauth/{register,authorize,consent,token,revoke,grants}`, `/.well-known/oauth-*`.
- **Tablas:** 25 `ai_*` (conversations, messages, pending_actions, charts, requests, organization_settings, record_provenance, knowledge_chunks, anomalies, forecasts, cashflow_*, reports, agent_runs, duplicate_suggestions, model_runs…) + 21 vistas `ai_src_*` para el motor + `mcp_oauth_{clients,codes,tokens}` + `product_embeddings` (pgvector, ausente en este entorno).
- **Frontend:** `features/ai/` (28 archivos, 3.847 líneas): panel del copiloto, propuestas, consentimiento MCP, calidad de datos, anomalías, informe del gerente, predicciones, caja; ajustes en `features/settings/system/ai/ai-settings.page`.
- **Evaluación:** `apps/backend/api/src/ai-evaluation/` (harness, graders, 4 conjuntos: bill-capture 6, copilot 9, injection 6, narratives 6) + `.github/workflows/ai-eval.yml` (manual/semanal, requiere secreto).
- **Países:** transversal; idioma de libros es/en/pt. **¿Núcleo para vender?** No (diferenciador); el ERP vende sin IA, pero se anuncia.
- **Condición del entorno:** sin `ANTHROPIC_API_KEY`, sin clave Voyage, sin pgvector, motor Python apagado, y **los 21 inquilinos QA están en plan `starter`** (solo `ai_vision`); `ai_assistant`, `ai_anomalies`, `ai_forecasting`, `ai_cashflow`, `ai_manager_reports` solo en `pro`/`enterprise` (`saas_plan_features`). No hay endpoint para cambiar de plan sin Stripe ⇒ **el copiloto, MCP, anomalías, pronósticos y caja no pudieron ejercitarse en vivo**; se evaluaron por código y por pruebas.

## 2. Estándar de referencia
- (a) Básicas: asistente conversacional que respeta permisos del usuario y aislamiento; acciones solo como propuesta con confirmación humana; trazabilidad de qué hizo la IA; límites de gasto por inquilino; opción de desactivar; degradación clara sin proveedor. Avanzadas: agentes/MCP para clientes externos con OAuth, RAG sobre documentación, detección de anomalías, pronósticos, captura de documentos, informes narrativos, evaluación continua (incl. inyección de prompt).
- (b) Invariantes: la IA nunca amplía permisos ni cruza inquilinos; nada se escribe sin confirmación; cifras de salidas narrativas trazables a hechos; el texto de terceros es dato, no instrucción; secretos/PII mínimos al proveedor.
- (c) Líderes: Microsoft Dynamics 365 Copilot y NetSuite (Text Enhance / SuiteAnalytics Assistant) ejecutan en el contexto de rol del usuario y requieren revisión humana (confianza media, conocimiento público, no verificado hoy); SAP Joule igual con "human in the loop" (media); Odoo AI (búsqueda/redacción, sin agentes con permisos finos, media). MCP + OAuth 2.1 con PKCE S256 y DCR es el estándar del protocolo MCP (alta: especificación MCP 2025-06).
- (d) Construcción de referencia: un único gateway (cuotas, contabilidad de costo, breaker, validación de salida), registro de herramientas declaradas por cada módulo con permiso explícito, propuestas persistidas con reclamo atómico, evaluación offline versionada que bloquea despliegues de prompt.

## 3. Resultado
- **Madurez: 58 (50–65, confianza media-baja: copiloto/MCP/anomalías/caja no ejecutables en vivo por plan y sin clave).**
- **Preparación comercial: 52. Veredicto: Piloto controlado** (compuertas críticas 1–3 cumplen por código + pruebas; la 3 queda "cumple con reservas" al no poder probarse en vivo el copiloto).
- Eje más débil: 11 (UX con plan sin IA: errores 403 en cada página, menú ofrece lo que no se tiene, estado vacío engañoso) y 9 (evaluación de inyección pequeña y fuera de la puerta de CI).
- Críticos abiertos: ninguno.

### Pruebas ejecutadas
- `GET /ai/status` (qa-do-a) → `languageModel.available:false`, `engine.online:false`, `vision.enabledByPlan:true/available:false`: el sistema **declara** la falta de proveedor; no hay mocks.
- Rutas con plan: `/ai/copilot/*`, `/ai/anomalies`, `/ai/forecasts/summary`, `/ai/cashflow`, `/ai/reports/manager` → **403 `saas.feature_disabled`** con `featureKey`. Sin clave, el código lanza `503 ai.not_configured` antes de cualquier red (`ai-gateway.service.ts:161,313,451`; `reports.service.ts:131-133`).
- AuthZ: `qa-do-a-member` → `PUT /ai/settings` 403, `GET /ai/agents/runs` 403, `POST /mcp/oauth/consent` 403; `GET /ai/data-quality/duplicates` 200 pero **solo `PRODUCT`** (filtrado por permiso de cada tipo ✓).
- Ajustes (qa-do-xflow): presupuesto 99.999.999 → 400 `ai.settings.budget_above_ceiling` (máx. 10.000); `organizationId` en el body → 400 whitelist ✓.
- Aislamiento: `GET /ai/provenance/reconciliation_match/<id de qa-do-tes>` con qa-do-b → `[]`; con el dueño → 1 fila ✓.
- MCP OAuth en vivo: `register` (cliente `QA-IA-agent`) 201; `authorize` S256 → 302 a `/oauth/consent`; `code_challenge_method=plain` → 400; `redirect_uri` no registrado → 400; `consent` con plan starter → 403; `POST /mcp` con token falso → 401 `invalid_token` + `www-authenticate` con `resource_metadata` ✓.
- Calidad de datos (qa-do-a): dos clientes `QA-IA Ferretería Duplicada SRL` / `QA-IA Ferreteria Duplicada S.R.L.` (correos distintos) → scan `found:0` (ver IA-04).
- Jest: `src/app/ai` + specs con BD (`DB_HOST`→`virteex_test`): 22+15 suites, 156+118 tests OK, 0 fallos.

## 4. Ejes
| # | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 62 (52–70, media-baja) | Sin mocks ni constantes: gateway real, `ai_requests` real, herramientas leen servicios reales; degradación explícita (503/403). No ejecutable en vivo (plan/clave). Duplicados por nombre no se detectan (IA-04). | Entorno de demo con plan pro y proveedor simulado local contractual; regla de duplicado por nombre idéntico. |
| 2 Corrección | 68 (60–75, media) | Propuestas: reclamo atómico (`copilot.service.ts:688-700`), preview re-calculado y comparado antes de crear (`:574-581`), prueba "two confirmations at once create one document". Códigos OAuth de un solo uso por UPDATE condicional (`mcp-oauth.service.ts:179-180`). Presupuesto: chequeo-antes-de-llamar, sobregiro posible en concurrencia (IA-07). Montos de productos con `Number()` en herramientas (`sales.copilot-tools.ts:125`). | Reserva de presupuesto transaccional; decimales en propuestas. |
| 3 Multi-país | 55 (45–62, media) | Idioma de libros por mercado (`organizationMarket`), ayuda es/en/pt; enmascarado por clave cubre `rnc/rfc/nit/ein/ssn/cedula`, **no `cpf/cnpj/cuit/ruc/curp/rut/dui`** (`copilot-history.ts:93`). | Regex/lista de identificadores por país como dato. |
| 4 Arquitectura | 74 (66–80, media) | Un solo gateway con entitlements+breaker+registro (`ai-gateway.service.ts:113-130`); registro de herramientas por puerto/contrato; MCP reusa la regla del copiloto (`mcp.service.ts:56-71`). `copilot.service.ts` 859 líneas. Permisos de herramienta declarados aparte de los del controlador (IA-08). | Derivar el permiso de la herramienta del caso de uso; partir copilot.service. |
| 5 Higiene | 80 (72–86, media) | `module-boundaries`: **0 violaciones** del módulo `inteligencia` (config `ai: 'inteligencia'`); herramientas viven en cada módulo dueño. | Mantener; escribir provenance vía puerto del dueño. |
| 6 Calidad código | 70 (62–76, media) | 15 warnings lint en `src/app/ai/`; comentarios extensos y coherentes con el código revisado. | 0 warnings; ficheros <500 líneas. |
| 7 Robustez | 68 (60–74, media) | Breaker + timeout 90 s + `maxRetries:2`; `ShortLivedConnections` en visión; throttle 20/min visión, 10/h registro DCR, 60/min token. Visión guarda la foto antes de saber si hay modelo (IA-06). | Pre-chequeo de disponibilidad; reserva de presupuesto. |
| 8 Seguridad | 72 (62–80, media-baja) | Herramientas filtradas por permiso + plan + sucursal y revalidadas en `confirm` (`copilot.service.ts:559-571`); conversaciones por `organizationId+userId`; RAG = solo ayuda global (`tenant-table-classification.ts:148`); embeddings con `organization_id` (`embeddings.service.ts:89`). OAuth: PKCE S256 obligatorio, tokens solo SHA-256, rotación con detección de reuso que revoca la familia, permisos re-leídos por petición (`mcp.service.ts:58-61`). No verificado en vivo el copiloto/MCP. `search_customers/search_suppliers` exentos de enmascarado (envían identificadores al proveedor). | Prueba e2e copiloto con member y doble inquilino en CI; enmascarado configurable también para búsquedas. |
| 9 Pruebas | 62 (54–70, media) | Specs de servicio con casos de autorización reales (`copilot.service.spec.ts:181-301`: herramienta no permitida, permiso retirado antes de confirmar, conversación ajena), OAuth (`mcp-oauth.service.spec.ts`). Mayoría con repos simulados. Evaluación: 6 casos de inyección con canario, fixtures de herramientas, **no corre en PR**, solo manual/semanal y falla sin secreto (`ai-eval.yml:13-18,44-48`). | ≥50 casos de inyección (indirecta en notas, nombres, adjuntos, multilingüe, exfiltración por URL/markdown); puerta obligatoria al cambiar prompt. |
| 10 Operabilidad | 70 (62–76, media) | Cada llamada en `ai_requests` con tokens/costo/latencia y solo huella del input; alertas de umbral de presupuesto con reclamo único (`ai-settings.service.ts:165-185`); procedencia de registros creados por IA (`recordAiProvenance`). | Panel de uso por feature/usuario con exportación; trazas con request id del proveedor en logs. |
| 11 UX | 50 (42–58, media) | Plan starter: `GET /ai/copilot/charts/pinned` → 403 **en cada página** (consola); hub de Reportes lista Anomalías/Informe del gerente/Predicciones/Flujo de caja no incluidos en el plan; Informe del gerente muestra "Todavía no hay informes" cuando la API dio 403; mensaje con clave cruda "La función ai_anomalies no está incluida en tu plan". | Ocultar/marcar "requiere plan Pro"; no llamar endpoints de plan ausente; nombres traducidos de features. |
| 12 Competitividad | 66 (58–74, baja) | Copiloto con permisos finos, propuestas confirmables, MCP OAuth, anomalías/pronósticos propios, informes narrativos con verificación de cifras (`ai-gateway.service.ts:294-296`): por encima de Odoo/Alegra/Siigo; comparable en diseño a D365/NetSuite pero sin evidencia de uso real. | Demostrable en vivo; evaluación pública de calidad. |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | Cumple | Sin mocks; degradación 403/503 explícita. |
| 2 Integridad | Cumple | Reclamo atómico de propuestas y códigos; preview revalidado. |
| 3 AuthZ/aislamiento | Cumple con reservas | Probado en vivo: settings, data-quality, provenance, OAuth consent; copiloto/MCP solo por código+spec. |
| 4 Validación servidor | Cumple | Whitelist DTO, techo de presupuesto, `asValidDto` en propuestas. |
| 5 Humo sin 500 | Cumple | Sin 500 en rutas `ai/*` probadas; 403 en consola en cada página (UX). |
| 6 Cumplimiento país | N/A | Transversal; enmascarado incompleto por país (IA-05). |
| 7 Pruebas en CI | Cumple con reservas | Specs en `ci.yml`; la evaluación de modelo no es puerta. CI global en rojo (otros módulos). |
| 8 Auditoría negocio | Cumple | `ai_requests`, `ai_record_provenance`, `ai_pending_actions` con decidedAt. |
| 9 Migraciones | Cumple | Global OK; embeddings condicionado a pgvector. |
| 10 Observabilidad | Cumple | Logs con org; `ai_requests`. |
| 11 UI/traducciones | No cumple | IA-01, IA-02. |
| 12 Documentación | Cumple | 12 artículos de ayuda ×3 idiomas. |

## 6. Hallazgos
- **IA-01** · ai/UX (eje 11) · UX · **Media** · `features/ai` panel → `GET /ai/copilot/charts/pinned` · Con plan sin `ai_assistant` cada página dispara un 403 y error de consola (Playwright, qa-do-fac: overview, reports, data-quality…). Correcto: consultar `/ai/status`/plan antes; no montar el panel. Riesgo operativo (ruido de monitoreo). S.
- **IA-02** · ai+analisis (eje 11) · UX · **Media** · `analisis.manifest.ts:44-62`, hub de Reportes, `manager-report.page` · El menú y el hub ofrecen funciones fuera del plan; Informe del gerente muestra estado vacío ante 403; anomalías/predicciones muestran la clave `ai_anomalies`. Correcto: gating por feature en manifiesto, estado "requiere plan". Brecha competitiva. S.
- **IA-03** · ai-evaluation (eje 9) · pruebas · **Alta** · `cases/injection.json` (6 casos), `ai-eval.yml` · La resistencia a inyección se mide con 6 casos y fixtures, solo manual/semanal y sin bloquear PRs; cubre canario y "no proponer borrador", no exfiltración por enlaces/markdown, texto en adjuntos/imágenes, otros idiomas, ni el camino MCP. Correcto: conjunto amplio versionado y puerta obligatoria al tocar `promptHash`. Riesgo operativo. M.
- **IA-04** · ai/data-quality (eje 1) · bug · **Media** · `data-quality/duplicate-matching.ts:33,103` · Nombre idéntico tras normalizar da `similarity*0.75 = 0.75 < MIN_SCORE 0.8`: dos clientes con el mismo nombre y sin otro dato común nunca se sugieren (probado: scan `found:0`). Correcto: nombre idéntico normalizado ≥0.85 o umbral por tipo. S.
- **IA-05** · ai/copilot (ejes 3, 8) · seguridad/multi-país · **Media** · `copilot-history.ts:93`, `copilot.service.ts:30` · Enmascarado por regex de clave omite `cpf, cnpj, cuit, cuil, ruc, curp, rut, dui, nis`; además `search_customers/search_suppliers` están exentos: identificadores fiscales y correos van al proveedor. Correcto: catálogo de identificadores por país como dato y enmascarado salvo campo buscado. S.
- **IA-06** · ai/product-vision (eje 7) · robustez · **Baja** · `product-vision.service.ts:126-136` · Guarda la imagen (`storeImage`) antes de que el gateway compruebe disponibilidad/presupuesto; sin clave queda una imagen huérfana por intento. Correcto: `assertCallAllowed`/`isAvailable` primero. S.
- **IA-07** · ai/gateway (eje 2) · integridad · **Media** · `ai-settings.service.ts:148-158`, `ai-gateway.service.ts:337-339,571` · El presupuesto en USD se comprueba antes de la llamada y el gasto se registra después: N peticiones concurrentes en el umbral pasan todas (sobregiro acotado por créditos del plan). Correcto: reservar costo estimado en transacción. M.
- **IA-08** · ai/herramientas (eje 4) · arquitectura · **Media** · 13 `*.copilot-tools.ts` · El permiso de cada herramienta se declara a mano en paralelo al `@HasPermission` del controlador equivalente (hoy coinciden: `list_quotes`=`INVOICES_VIEW` como `quotes.controller.ts:45`); no hay prueba que detecte divergencia. Correcto: prueba de paridad o derivación desde el caso de uso. S.
- **IA-09** · ai/MCP (eje 8) · seguridad · **Baja** · `mcp-oauth.controller.ts:52-56` · Registro dinámico público (10/h por IP) sin caducidad de clientes no usados ni límite global: crecimiento indefinido de `mcp_oauth_clients`. Correcto: purga de clientes sin grants tras N días. S.

## 7. Camino mínimo a producción (todos los países)
1. Gating de UI por plan y sin llamadas 403 (IA-01/02) — S.
2. Evaluación de inyección ampliada y como puerta en PR que toque prompts (IA-03) — M.
3. Enmascarado por país y para búsquedas (IA-05) — S.
4. Prueba e2e del copiloto/MCP con proveedor simulado local (fixtures) que cubra member vs admin y doble inquilino — M.
5. Reserva de presupuesto (IA-07) — M. Retocar, no rehacer.

## 8. Camino a 100
IA-03 (+6), e2e copiloto/MCP en CI (+6), UX por plan (+5), IA-05 (+3), IA-07 (+2), IA-04 (+2), paridad de permisos (IA-08, +2), partir copilot.service (+1), panel de uso/costos exportable (+2).

## 9. Competitividad
Básicas presentes (asistente con permisos, confirmación humana, límites, desactivar). Avanzadas presentes en código: MCP con OAuth, agentes, anomalías, pronóstico, captura de facturas de proveedor, informe narrativo con cifras verificadas. Diferenciador frente a Alegra/Siigo/CONTPAQi (confianza baja, sin verificar hoy). Brecha: evidencia de calidad (evals publicadas) y demostración en vivo.

## 10. Fortalezas a preservar
Gateway único con contabilidad y breaker; "draft solo propone" + preview revalidado + reclamo atómico; permisos re-leídos en cada petición MCP; tokens hasheados con detección de reuso; frontera de módulo limpia; validación de cifras en narrativas; degradación explícita sin inventar datos.

## 11. No verificado
Copiloto, MCP tools/call, anomalías, pronósticos, caja e informe del gerente en vivo (plan starter en todos los QA; sin clave — prohibido contactar proveedor). Calidad real de respuestas e inyección contra el modelo. RLS de tablas `ai_*` bajo rol de app (la API corre como superusuario). Confianza baja en ejes 1, 8, 12.
