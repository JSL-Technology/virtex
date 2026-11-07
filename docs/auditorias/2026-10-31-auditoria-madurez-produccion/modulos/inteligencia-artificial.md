# Ficha — Inteligencia artificial (T17)

Auditor: familia F11 · Fecha: 2026-10-31/11-01 · Tenant: qa-mx (víctima qa-b) · HEAD `495719fc`

> **Sin hallazgos CRÍTICOS de seguridad confirmados.** Los dos riesgos de mayor peso son de gobierno de datos (envío a terceros por defecto — IA-01) y de verificación (copiloto no ejecutable en este entorno: sin clave y plan Starter — IA-05).

## 1. Identificación
- **Backend** `apps/backend/api/src/app/ai`: 140 archivos, ~11,6 k LOC TS, **68 endpoints** en 13 controladores (`ai`, `ai/copilot`, `ai/copilot/my-data`, `ai/cashflow`, `ai/close-assistant`, `ai/agents`, `ai/data-quality`, `ai/settings`, `ai/reports/manager`, `ai/provenance`, `mcp`, `mcp/oauth`, `.well-known`), 19 entidades en `entities/` + 3 en `mcp/entities/` (22), 24 specs. Artículos de ayuda md (es/en/pt).
- **ai-evaluation**: `apps/backend/api/src/ai-evaluation` (fuera de `app/`), ejecutado por `.github/workflows/ai-eval.yml` (semanal + manual, requiere secreto `ANTHROPIC_API_KEY`; sets bill_capture, copilot, injection, narratives).
- **Motor Python** `apps/ai-engine`: 33 archivos, ~4,7 k LOC; previsión (statsforecast/modelo global/foundation), anomalías, flujo de caja; worker BullMQ; 58 tests en 8 archivos; `Dockerfile` (python:3.12-slim, usuario no root).
- **Consumidores en otros módulos** (vía `AiAssistPort`): captura de facturas de proveedor (`accounts-payable/bill-capture.service.ts:308`), correo entrante de facturas (`accounts-payable/inbox/bill-mail.handler.ts`) y pedidos (`sales/inbox/order-mail.handler.ts:79`), conciliación (`reconciliation/reconciliation-assist.service.ts:90,117`), import (`data-transfer.service.ts:184`), cobranza. Herramientas del copiloto registradas por cada dominio: 25 `read`, 4 `draft` (`draft_quote`, `draft_invoice`, `draft_purchase_order`, `draft_payment_reminder`).
- **Frontend** `features/ai`: 63 archivos, ~5 k LOC, 17 specs.
- Proveedores: Anthropic (`@anthropic-ai/sdk`), Voyage (embeddings de imagen, opt-in). Países: transversal; la ayuda se filtra por mercado.
- ¿Núcleo para vender? No; diferenciador.

## 2. Estándar de referencia (resumen)
(a) Básicas: asistente conversacional con datos del ERP respetando permisos; captura OCR/IA de facturas de proveedor con revisión humana; degradación cuando no hay proveedor; control de costos. Avanzadas: agentes que proponen acciones, previsión de demanda/caja, detección de anomalías, conectores MCP para agentes externos, narrativas.
(b) Invariantes: la IA nunca supera los permisos ni el tenant del usuario; ninguna escritura sin confirmación humana (o limitada a borradores revisables); contenido externo (documentos, correos) tratado como dato, no instrucción; trazabilidad (qué generó la IA); presupuesto/cuotas por tenant; transparencia y base legal para el envío de datos a subencargados; evaluación continua (evals) de calidad e inyección.
(c) Líderes: Dynamics 365 Copilot y NetSuite (Text Enhance / SuiteAnalytics Assistant) operan con los permisos del usuario y exigen confirmación para acciones; Microsoft documenta que Copilot respeta el modelo de seguridad de Dataverse y que la IA se puede desactivar por entorno (confianza media, documentación pública de Microsoft "Responsible AI FAQ for Dynamics 365"). Odoo AI ofrece OCR de facturas con validación humana (confianza media). En la UE/LatAm los líderes publican la lista de subencargados y ofrecen activación explícita por administrador (confianza media).
(d) Construcción: gateway único (cuotas, circuit breaker, ledger de costos), registro de herramientas aportado por cada dominio con permisos declarados, propuestas persistidas con confirmación atómica, motor de ML aislado con rol de BD propio.

## 3. Resultado
- **Madurez: 58** (50–64, confianza media: revisión estática amplia; flujos LLM no ejecutables sin clave/plan).
- **Preparación comercial: 55 — Piloto controlado** (críticas 1 y 2 cumplen; 3 cumple en revisión estática y en las rutas probadas, no verificable extremo a extremo en el copiloto).
- Eje más débil: 11 UX (403 sin explicación de plan) y 9 Pruebas (evals dependen de un secreto; motor Python no verificado en main).
- Hallazgos críticos abiertos: 0. Altos: 3.

## 4. Doce ejes
| Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 62 (55–70, media) | Integración real con Anthropic (`gateway/ai-gateway.service.ts:147-160`), `GET /ai/status` responde honesto `{"vision":{"enabledByPlan":true,"available":false}...}`; motor Python real; 4 herramientas draft reales. No pude ejecutar ninguna llamada LLM. | Demostración E2E con proveedor; previsión/anomalías visibles en plan base o upsell claro |
| 2 Corrección | 65 (58–72, media) | Propuestas: re-`propose` al confirmar y rechazo si cambió (`copilot.service.ts:559-600`), transición atómica (`:685`); `compose` rechaza cifras que no están en los hechos (`ai-gateway.service.ts` `numbersNotInFacts`). Correo entrante crea **borradores** de factura sin confirmación (`bill-mail.handler.ts:89`). | Idempotencia probada del correo entrante; evals de exactitud de captura con umbral en CI |
| 3 Multi-país | 55 (45–62, baja) | Ayuda filtrada por país (`ai.copilot-tools.ts:89-91`); captura valida NCF (DO) (`bill-mail.handler.ts:149`); sin evidencia de validación RFC/CFDI (MX) o CUFE (CO) en la captura (no verificado a fondo). | Validadores de documento por país en la captura |
| 4 Arquitectura | 72 (65–78, media) | Gateway único con breaker (opossum), créditos y presupuesto antes de cada turno (`:353-357`); registro de herramientas por dominio (`contracts/copilot/copilot-tools.contract.ts`) sin importar dominios; puerto `AiAssistPort`. | Separar `ai` en submódulos con contratos (copilot, engine, mcp) |
| 5 Higiene | 60 (52–66, media) | Contratos en `contracts/`; pero `ai` lee tablas de otros con SQL directo (p. ej. `organizationFiscalIdentity`, lecturas de caja `company-wide.ts`). `ai-evaluation` fuera de `app/`. | Lecturas solo vía contratos de dominio |
| 6 Código | 68 (60–74, media) | Código cuidado y comentado; `any` limitado; comentarios muy extensos y autojustificativos. | Menos prosa, más tipos |
| 7 Robustez | 62 (55–68, media) | Throttle por ruta, `maxTurns` 8, timeouts 90 s, breaker; trabajo pesado en worker. Correo: si la IA no está disponible lanza error para reintento (`bill-mail.handler.ts:71`) — riesgo de reintentos indefinidos si nunca hay clave (no verificado límite de cola). Throttler global 20 req/min/IP (`app.module.ts:269`, medido por coordinador) choca con el streaming de copiloto en oficinas tras NAT. | Cuotas por usuario/tenant en vez de IP; DLQ explícita |
| 8 Seguridad | 64 (56–70, media) | Tenant y usuario siempre del principal (`copilot.service.ts:339`, todas las consultas con `organizationId`+`userId`); re-chequeo de permiso por herramienta (`:387`, `toolAllowed`); escrituras = propuestas confirmadas (`:563`); marca `afterExternalText` en propuestas tras leer texto externo (`:343,415`); MCP sin token → `{"error":"invalid_token"}` (probado); MCP de agentes externos solo propone (`:243-256`). Riesgos: envío a terceros opt-out (IA-01); enmascarado por nombre de clave, no por contenido (IA-02). | Opt-in explícito con DPA/subencargados; DLP por contenido |
| 9 Pruebas | 55 (45–62, media) | 24 specs back + 17 front + 58 tests Python; `ai-eval.yml` con set `injection`, pero falla sin secreto y no bloquea PR; en `main` el paso de tests del motor (`ci.yml:257-270`) no se ejecuta porque CI cae antes en `verify:tenant-scope` (run 41107900677). No ejecuté pytest (presupuesto). | Evals con modelo simulado en cada PR; CI verde |
| 10 Operabilidad | 60 (52–66, media) | Ledger `ai_requests` con costo, prompt hash, modelo servido; alertas de presupuesto (`ai-settings.service.ts:165`); `/ai/usage`, `/ai/overview`. Sin métricas exportadas ni sonda pública. | Métricas/alertas de proveedor y latencia |
| 11 UX | 50 (42–58, baja) | F2 vio 403 en Predicciones/Anomalías/Reporte gerencial: causa = **gating por plan** `saas.feature_disabled` (ver IA-04). | Ocultar o mostrar upsell según `/ai/status` |
| 12 Competitividad | 65 (55–72, baja) | Amplitud notable (copiloto con propuestas, MCP OAuth, caja probabilística, anomalías, captura por foto/correo) frente a Alegra/Siigo; comparable a anuncios de Odoo/NetSuite. | Madurez operativa y pruebas en producción |

Promedio simple ≈ 61; madurez 58 (≤ min(62,65,64)).

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | Cumple | Sin proveedor: `ServiceUnavailableError('ai.not_configured')` (`ai-gateway.service.ts:313,451`); `/ai/status` `available:false` |
| 2 | Integridad escrituras | Cumple (reservas) | Propuestas atómicas; correo entrante crea borradores sin confirmación (diseño, solo DRAFT) |
| 3 | Autorización/aislamiento | Cumple en estático; parcial en ejecución | Rutas con `@HasPermission` + gating de plan; MCP rechaza sin token; copiloto no ejecutable (plan Starter, sin clave) |
| 4 | Validación servidor | Cumple | DTOs + esquemas estrictos `strict: true` en herramientas |
| 5 | E2E sin 500 | No verificado | No hay E2E de UI (coordinador); smoke API sin 500 |
| 6 | Cumplimiento por país | N/A (parcial) | Solo NCF DO verificado en captura |
| 7 | Pruebas en CI | No cumple | CI de main rojo; evals no bloquean |
| 8 | Auditoría | Cumple | `ai_requests`, `ai_record_provenance`, `ai_pending_actions` |
| 9 | Migraciones | Cumple | Global sin deriva (pgvector omitido localmente: tabla de embeddings no creada) |
| 10 | Observabilidad | Parcial | Ledger, sin métricas |
| 11 | UI/i18n | No cumple | 403 de plan mostrado como error (F2) |
| 12 | Documentación | Cumple | `docs/DEPLOYMENT.md §7`, artículos de ayuda |

## 6. Hallazgos
**IA-01** · IA · Eje 8/3 · Seguridad (datos personales) · **Alta** · `ai/entities/ai-organization-settings.entity.ts:23` (`language_models default true`), `settings/ai-settings.service.ts:72` (`languageModels: true`). El envío de datos del ERP (documentos de proveedores completos en captura, respuestas de herramientas, correos) a Anthropic está **activado por defecto** en cuanto el operador configura la clave; no hay registro de consentimiento del administrador ni mención de subencargados en `legal/` (busqué `anthropic|voyage|subencargad|terceros` en `apps/backend/api/src/app/legal`: 0 coincidencias). Forma correcta: opt-in explícito por organización con aceptación registrada (quién/cuándo/versión del texto), lista pública de subencargados y región de procesamiento. Impacto: bloquea venta a clientes grandes/regulados (verificar con abogado: LFPDPPP MX, Ley 172-13 DO, Ley 1581 CO). Esfuerzo M.

**IA-02** · IA · Eje 8 · Seguridad · Media · `copilot/copilot-history.ts:93-121`. `maskIdentifiers` enmascara por **nombre de clave** (regex `tax_?id|rnc|rfc|email|phone…`); nombres de personas, direcciones, notas y cualquier campo con otra clave salen en claro; la captura de imágenes/PDF no se enmascara. Forma correcta: clasificación por contenido o allow-list de campos enviados por herramienta. Deuda/riesgo. Esfuerzo M.

**IA-03** · IA · Eje 2/8 · Integridad · Media · `accounts-payable/inbox/bill-mail.handler.ts:89`. Un correo externo genera facturas de proveedor en BORRADOR sin intervención humana (nunca aprobadas, `:45`). Es razonable, pero un remitente malicioso puede llenar la bandeja de borradores; no verifiqué control de remitentes permitidos ni deduplicación por hash. Forma correcta: lista de remitentes, cuota diaria, deduplicación. Esfuerzo S.

**IA-04** · IA/SaaS/UX · Eje 11 · UX · **Alta** · Endpoints `GET /ai/forecasts/summary`, `/ai/anomalies`, `/ai/reports/manager`, `/ai/cashflow`, `/ai/copilot/*`. **Causa de los 403 vistos por F2**: no es permiso, es **plan**. Probado con qa-mx (ADMINISTRATOR, `*`): todas responden `403 {"code":"saas.feature_disabled","params":{"featureKey":"ai_forecasting"|"ai_anomalies"|"ai_manager_reports"|"ai_cashflow"|"ai_assistant"}}`. La BD confirma: los tenants QA están en plan **Starter**, que solo incluye `ai_vision` (`saas_plan_features`); Professional/Enterprise incluyen las 9 funciones IA. El portal muestra igualmente las páginas y el error. Forma correcta: el menú/manifest debe consultar `GET /ai/status` (ya expone `enabledByPlan`) y mostrar upsell en vez de error. Impacto: fricción y percepción de producto roto. Esfuerzo S.

**IA-05** · IA · Eje 9 · Pruebas · **Alta** · `.github/workflows/ai-eval.yml` (falla sin secreto, semanal, no bloquea PR); `ci.yml:257-270` (tests del motor) no se ejecutan en main porque el job cae antes. No hay prueba automática que demuestre, contra el modelo o un doble determinista, que una inyección en un documento capturado no provoca llamadas a herramientas fuera de alcance. El diseño lo mitiga (herramientas solo del tenant/usuario; escritura solo por confirmación), pero no está medido en CI. Esfuerzo M.

**IA-06** · IA · Eje 7 · Robustez · Media · Throttler global 20 req/min/IP (`app.module.ts:269`, coordinador) + throttles por ruta: en una oficina tras NAT el copiloto y el resto del ERP comparten 20 req/min. Forma correcta: cuotas por usuario/tenant. Esfuerzo S.

**IA-07** · IA · Eje 8 · Seguridad · Baja · `mcp/mcp-oauth.controller.ts` `register`/`authorize`/`token`/`revoke` son `@Public()` con throttle (registro dinámico de clientes OAuth abierto, como exige MCP). `GET /api/v1/.well-known/oauth-authorization-server` → 404 bajo el prefijo (probablemente servido fuera de `/api/v1`, no verificado). Verificar con el equipo la limpieza de clientes huérfanos. Esfuerzo S.

## 7. Camino mínimo a producción
1. IA-01 opt-in + registro de consentimiento + subencargados (M) — todos los países.
2. IA-04 gating de UI por plan (S).
3. CI verde y evals con doble determinista en PR (M, depende de CICD-01).
4. IA-03 controles de correo entrante (S).
Retocar, no rehacer.

## 8. Camino a 100
IA-01 (+6 seg., M) → IA-05 evals de inyección en PR (+6 pruebas, M) → IA-04 (+10 UX, S) → DLP por contenido IA-02 (+4, M) → validadores fiscales por país en captura (+8 multi-país, L) → métricas de proveedor/latencia (+6 operabilidad, S) → cuotas por usuario (+4 robustez, S).

## 9. Competitividad
Faltantes básicos: activación/consentimiento explícito; disponibilidad en plan base (hoy solo visión en Starter). Avanzados presentes: copiloto con propuestas confirmables, MCP con OAuth para agentes externos (raro en ERPs LatAm), caja probabilística P10, anomalías con feedback, captura por correo. Frente a Alegra/Siigo/CONTPAQi (sin copiloto agentivo comparable, confianza baja) es diferenciador; frente a Dynamics/NetSuite, faltan garantías documentadas (Responsible AI, residencia de datos). Nota 65 (55–72, baja).

## 10. Fortalezas a preservar
Registro de herramientas por dominio con permisos y `branchScope` obligatorio; escrituras como propuestas con re-verificación al confirmar; marca de texto externo; presupuesto en dinero + créditos de plan; breaker que no se abre por errores 4xx; degradación honesta `ai.not_configured`; motor Python con rol de BD propio y contenedor no root.

## 11. No verificado
Ninguna llamada LLM (sin clave, no buscada); copiloto y MCP con token (plan Starter bloquea `ai_assistant`); pytest del motor (no instalé venv por presupuesto; CI lo tiene pero no corre en main); evals; frontend no ejecutado en navegador. IDOR sobre conversaciones de qa-b no ejecutable (feature bloqueado); revisado estáticamente (`organizationId`+`userId` en todas las consultas).

Cobertura honesta: ~35 % de archivos backend leídos (gateway, copiloto, contrato, settings, herramientas, correo), 12 de 68 endpoints ejecutados, 0 pantallas.

<!-- RESUMEN: modulo=inteligencia-artificial; madurez=58; prep=55; veredicto=Piloto controlado; eje_debil=UX/Pruebas; criticos=0; altos=3; camino_min=M -->
