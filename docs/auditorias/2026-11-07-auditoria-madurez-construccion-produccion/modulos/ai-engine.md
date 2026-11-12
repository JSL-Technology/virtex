# Ficha: `ai-engine` (motor Python de pronósticos de demanda, caja y detectores de anomalías) — familia IA

## 1. Identificación
- **Código:** `apps/ai-engine/` (Python ≥3.11 <3.14; Dockerfile `python:3.12-slim`, usuario no root `engine`). 4.725 líneas: `anomalies/detectors.py` (999, 26 funciones/clases), `cashflow/model.py` (322), `benchmark.py` (313), `forecasting/models.py` (279), `anomalies/pipeline.py` (261), `forecasting/pipeline.py` (216), `cashflow/pipeline.py` (203), `worker.py` (170), `db.py` (46).
- **Integración:** cola BullMQ (Redis) → `worker.py` reclama la corrida en `ai_model_runs` (`UPDATE … WHERE status='QUEUED'`, `worker.py:33-40`), lee las 21 vistas `ai_src_*` y escribe `ai_forecasts`, `ai_inventory_insights`, `ai_anomalies`, `ai_cashflow_*`. Latido en Redis (`virtex:ai-engine:heartbeat`). La API marca como fallidas las corridas atascadas >30 min (`engine-runs.service.ts:175-192`, con prueba).
- **Dependencias fijadas:** `requirements.lock` (217 líneas: statsforecast 2.0.1, lightgbm 4.7.0, pandas 3.0.6, numpy 2.5.4, psycopg 3.3.6…).
- **Pruebas:** 8 archivos en `tests/` (unitarias de detectores, pronóstico, exógenas, caja, controles, contrato de lectura, benchmark; integración con BD como rol propio).
- **¿Núcleo?** No; alimenta funciones de plan pro/enterprise.

## 2. Estándar de referencia
- (a) Básicas: pronóstico por SKU/almacén con intervalos, método de respaldo para series intermitentes, backtesting; detectores con explicación y retroalimentación; ejecución aislada por inquilino; reintentos idempotentes. Avanzadas: reconciliación jerárquica, exógenas (feriados, precios), modelo global, benchmark reproducible.
- (b) Invariantes: un trabajo de un inquilino nunca lee/escribe otro; corridas idempotentes; nada se presenta como pronóstico sin suficiente historia.
- (c) Referencias: Nixtla statsforecast (AutoETS/Croston/ADIDA para intermitentes) es práctica común (alta, documentación pública); NetSuite Demand Planning usa promedio móvil/estacional simple (media); SAP IBP con ML (media). No verificado hoy en web.
- (d) Construcción: rol de BD propio sin BYPASSRLS, `set_config` local a la transacción, vistas `security_invoker`, contratos de lectura versionados.

## 3. Resultado
- **Madurez: 62 (55–68, confianza media: no se ejecutó el motor contra datos reales ni la integración con BD).**
- **Preparación comercial: 55. Veredicto: Piloto controlado.**
- Eje más débil: 1/12 (calidad de pronóstico no demostrada en datos reales; motor apagado en este entorno, `engine.online:false`).
- Críticos abiertos: ninguno.

### Pruebas ejecutadas
- Instalación en venv del scratchpad (`pip install -r requirements.lock`, sin `-e`, sin efectos en el repo; `git status --ignored apps/ai-engine` vacío). `PYTHONPATH=src pytest -p no:cacheprovider` → **52 pasan, 7 omitidas** (`test_integration_db.py`: "no test database configured"; necesitan la contraseña del rol `virtex_ai_engine`, que CI sí define en `ci.yml:298-305`).
- **Aislamiento verificado en BD real (`SET ROLE virtex_ai_engine`, solo SELECT):** rol `rolsuper=f, rolbypassrls=f`. Sin `app.current_organization`: `invoices` → 0 filas, `ai_src_document_changes` → 0. Con la org de qa-do-a: `invoices` 2 filas de 1 org (total BD: 24 de 5 orgs); `ai_src_document_changes` 109 filas de 1 org; `audit_logs` directo → *permission denied*. Políticas `tenant_isolation` con `USING` y `WITH CHECK` en `ai_forecasts`/`ai_model_runs`; `relforcerowsecurity=t`.
- 20 de 21 vistas `ai_src_*` son `security_invoker=true`; `ai_src_document_changes` es `security_barrier` (se ejecuta con privilegios del dueño `postgres`) y filtra explícitamente por `current_setting('app.current_organization')` (ver IA-E02).

## 4. Ejes
| # | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 58 (48–66, media-baja) | Modelos reales (statsforecast, LightGBM global, IsolationForest+robusto, `detectors.py:320-346`); benchmark con datos sintéticos (`benchmark.py:222`). Sin ejecución sobre datos de clientes. | Backtest documentado sobre datos reales anonimizados; métricas por segmento. |
| 2 Corrección | 65 (56–72, media) | Reclamo condicional de la corrida; reintento devuelve a `QUEUED` con intentos restantes (`worker.py:58-90`); semillas fijas (`random_state=0`, `seed=7`). | Prueba de idempotencia de reescritura de resultados por corrida. |
| 3 Multi-país | 55 (45–62, baja) | Exógenas (feriados) en `forecasting/exogenous.py`; no verificado qué calendarios por país existen. | Feriados por país como datos versionados. |
| 4 Arquitectura | 70 (62–76, media) | Contrato de lectura vía vistas (`test_read_contract.py`), pipelines separados por dominio, config tipada. `detectors.py` 999 líneas. | Partir detectores. |
| 5 Higiene | 75 (68–82, media) | Aislado tras vistas; solo escribe tablas `ai_*`. Tiene SELECT directo sobre 23 tablas base (necesario por `security_invoker`). | — |
| 6 Calidad código | 68 (60–74, media) | Tipado, docstrings; sin linter Python en CI (no se encontró ruff/flake8 en `ci.yml`). | ruff + mypy en CI. |
| 7 Robustez | 66 (58–72, media) | Pool de conexiones 4; latido; recuperación de corridas atascadas en la API; imagen pesada (numba/lightgbm). Sin límite de tiempo por trabajo visible en `worker.py`. | Timeout por trabajo y por inquilino; límite de series. |
| 8 Seguridad | 78 (70–84, media-alta) | Rol propio sin BYPASSRLS, `set_config(...,true)` local a la transacción (`db.py:33-38`), UUID validado, RLS forzada; verificado con SET ROLE. | Convertir `ai_src_document_changes` a función/vista invoker con grant mínimo (IA-E02). |
| 9 Pruebas | 66 (58–72, media) | 59 tests; integración como rol propio en CI; detectores probados con datos que contienen lo que deben encontrar. CI global en rojo por otros módulos. | Pruebas de regresión de precisión con umbral. |
| 10 Operabilidad | 60 (52–68, media) | Logging estándar; métricas en `ai_model_runs.metrics`; `engine_version` registrado. Sin logs estructurados con org/run id verificados. | JSON logs con org/run. |
| 11 UX | N/A | Sin interfaz propia (la UI está en `ai`). | — |
| 12 Competitividad | 60 (50–68, baja) | Superior a promedios móviles de NetSuite/Odoo en método; sin evidencia de precisión. | Publicar MAPE/MASE por segmento. |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | Cumple | Modelos reales, sin constantes. |
| 2 Integridad | Cumple | Reclamo atómico; RLS con WITH CHECK. |
| 3 Aislamiento | Cumple | Verificado con `SET ROLE virtex_ai_engine`. |
| 4 Validación | Cumple | UUID validado; parámetros SQL ligados. |
| 5 Humo | No verificado | Motor no corre en este entorno. |
| 6 País | N/A | — |
| 7 Pruebas CI | Cumple con reservas | Job en `ci.yml:285-305`; CI global en rojo. |
| 8 Auditoría | Cumple | `ai_model_runs` con estado/métricas/versión. |
| 9 Migraciones | Cumple | Rol y vistas por migración. |
| 10 Observabilidad | Cumple con reservas | Latido + corridas; logs sin correlación verificada. |
| 11 UI | N/A | — |
| 12 Documentación | Cumple | `README.md`, docstrings. |

## 6. Hallazgos
- **IA-E01** · ai-engine (ejes 1, 12) · competitividad/pruebas · **Media** · `benchmark.py`, `tests/test_benchmark.py` · La calidad del pronóstico solo se mide con series sintéticas; no hay umbral de precisión que falle CI ni reporte sobre datos reales. Correcto: conjunto de backtest anonimizado y umbral MASE. M.
- **IA-E02** · ai-engine (eje 8) · seguridad (defensa en profundidad) · **Baja** · vista `ai_src_document_changes` (`reloptions={security_barrier=true}`, dueño `postgres`) · Lee `audit_logs` con privilegios del dueño; el aislamiento depende solo del `WHERE organization_id = current_setting(...)` del propio SQL, no de RLS. Hoy correcto (verificado: 0 filas sin contexto, 1 org con contexto). Correcto: función `SECURITY DEFINER` con `search_path` fijo o vista invoker sobre una tabla con RLS. S.
- **IA-E03** · ai-engine (eje 7) · robustez · **Baja** · `worker.py:122-150` · Sin tiempo máximo por trabajo; un inquilino grande puede ocupar el worker; la API lo marca fallido a los 30 min pero el proceso sigue. Correcto: timeout cooperativo y cancelación. S.
- **IA-E04** · ai-engine (eje 6) · calidad · **Baja** · `ci.yml` · Sin lint/typecheck Python. S.

## 7. Camino mínimo a producción
1. Desplegar y monitorizar latido + corridas en un piloto pro (S). 2. Backtest con umbral (IA-E01, M). 3. Timeout por trabajo (S). Retocar.

## 8. Camino a 100
IA-E01 (+10), feriados por país como dato (+4), timeout y límites (+3), lint/mypy (+2), logs estructurados (+3), IA-E02 (+1).

## 9. Competitividad
Métodos de clase (Croston/ETS/LightGBM global, reconciliación) por encima de lo que ofrecen Odoo/QuickBooks/Alegra de serie (confianza baja). Falta evidencia pública de precisión.

## 10. Fortalezas
Rol de BD propio sin BYPASSRLS verificado; contexto de inquilino local a la transacción; contrato de lectura por vistas invoker; pruebas de integración como el rol real en CI; dependencias fijadas.

## 11. No verificado
Ejecución del worker (Redis/BullMQ) y resultados sobre datos reales; 7 pruebas de integración (sin contraseña del rol local); calendarios de feriados por país.
