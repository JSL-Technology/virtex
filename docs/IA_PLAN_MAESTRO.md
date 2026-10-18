# Virtex IA — Informe de arquitectura y plan maestro

> Documento de arquitectura y plan maestro de la capa de IA. La Fase 1 se implementa a partir de este informe.
> Criterio: la decisión más robusta, segura y escalable, **sin recortar en costo**.

---

## 0. Contexto

Virtex es un ERP multiempresa. Está hecho con Nx, con la API en NestJS sobre Fastify y el cliente web en Angular 20. Usa PostgreSQL 16 con RLS obligatoria, Redis 7 y BullMQ, almacenamiento local o S3, y planes SaaS con feature flags. Hoy **no tiene nada de IA**, pero ya existe casi toda la plomería que hace falta:

- colas y crons multiempresa (`runAsTenantJob`);
- almacenamiento y subida de archivos;
- circuit breaker (`opossum`);
- feature flags y cuotas por plan.

Vamos a construir **una plataforma de IA compartida** y, encima, las funciones en orden de valor:

1. predicción (qué se vende más, dónde y cuándo se agota);
2. detección de anomalías;
3. autocompletado de productos desde una foto;
4. después, lenguaje natural, flujo de caja, conciliación, copiloto y lo demás.

### Huecos encontrados en el código (se cierran en la Fase 1)

| Hueco                                                                                                         | Archivo                                                                                    | Solución                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El producto no tiene `barcode` ni `brand`, y la imagen nunca se sube (solo se previsualiza con `FileReader`). | `inventory/entities/product.entity.ts`, `client-web/.../product-form/product-form.page.ts` | Migración que añade `barcode`, `brand`, `attributes jsonb` y una tabla `product_images`. Subida real con `FastifyFileInterceptor` + `StorageService`.                                                                                                         |
| Las líneas de venta del POS están en una columna JSON (`pos_sales.items`).                                    | `pos/entities/pos-sale.entity.ts`                                                          | La historia de demanda sale del **libro de stock** (`stock_movements` de tipo `SALE_DISPATCH` / `SALE_RETURN`, indexado por empresa, almacén y fecha), unido a almacén → sucursal. Las facturas y el POS (con `jsonb_array_elements`) dan precio y descuento. |
| No hay pgvector ni ningún servicio Python.                                                                    | —                                                                                          | Se añade la extensión `vector` y el servicio `apps/ai-engine` (ver §2).                                                                                                                                                                                       |

---

## 1. Principio rector: cada problema con su herramienta

| Tipo de problema                                                               | Herramienta correcta                               | Por qué NO la otra                                                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Números futuros** (demanda, caja, quiebres de stock)                         | Modelos estadísticos y de ML para series de tiempo | Un LLM no da intervalos de confianza calibrados, no es reproducible y "alucina" cifras. |
| **Rarezas** (fraude, errores, duplicados)                                      | Reglas + estadística robusta + ML no supervisado   | Un LLM no escala a millones de transacciones ni da un puntaje estable.                  |
| **Ver, leer, entender y redactar** (fotos, facturas, preguntas, explicaciones) | LLM multimodal (Claude)                            | Un modelo clásico no entiende lenguaje ni imágenes arbitrarias.                         |
| **Buscar "parecidos"** (duplicados, búsqueda semántica)                        | Embeddings + pgvector                              | —                                                                                       |

Regla de oro: **el LLM explica y orquesta; los números los calcula el modelo cuantitativo.** Cuando el copiloto dice "el producto X se agota en 7 días", esa cifra sale de la tabla de pronósticos, no del LLM.

---

## 2. Arquitectura

```
                     ┌──────────────────────────── NestJS API ─────────────────────────────┐
Angular client-web ─►│ ai/  ai-gateway · forecasting · anomalies · product-vision · insights│
                     │      guards: JWT, permisos, @CheckFeature, @CheckPlanLimit, RLS      │
                     └──────┬───────────────────────────┬────────────────────────┬─────────┘
                            │ BullMQ (Redis)            │ Claude API             │ Voyage embeddings
                            ▼                           ▼  (+ fallback)          ▼
                ┌──────────── apps/ai-engine (Python) ────────────┐       pgvector (Postgres)
                │ consumidor BullMQ (paquete oficial `bullmq` py) │
                │ forecast · anomalías · backtesting · registro   │──► tablas ai_* (RLS)
                │ de modelos · GPU opcional para modelos base     │
                └─────────────────────────────────────────────────┘
```

### 2.1 Decisiones y por qué

- **Un servicio Python aparte (`apps/ai-engine`).** El mejor software de pronóstico solo existe en Python:
  - Nixtla `statsforecast`, `mlforecast`, `neuralforecast` y `hierarchicalforecast`;
  - LightGBM y scikit-learn;
  - los modelos base de series de tiempo Chronos-Bolt y TimesFM.

  Reimplementarlo en TypeScript daría menos precisión y más código propio. Se despliega como un contenedor más (con Dockerfile, que hoy no existe en el repo) y escala horizontalmente por cola.

- **Comunicación por BullMQ, nunca HTTP síncrono.** Python usa el paquete oficial `bullmq`, compatible con las mismas colas de Redis. Se registra en `shared/jobs/queue-catalogue.ts`. Si el motor cae, el ERP sigue funcionando y la UI muestra la última predicción válida (**modo degradado**).
- **Multiempresa y seguridad en el motor:**
  - Se crea el rol Postgres `virtex_ai_engine`, sin BYPASSRLS. Solo lee las vistas `ai_src_*` y escribe en las tablas `ai_*`.
  - Cada trabajo lleva `organizationId` (regla que ya exige `queue-tenancy.spec.ts`). El motor ejecuta `SET LOCAL app.current_organization = …` por transacción, igual que `tenant-connection.interceptor.ts`, así que **la RLS aísla al motor igual que a la API**.
  - Las tablas `ai_*` copian la plantilla RLS de la migración `1789010000000-WorkflowEngine.ts` y pasan `verify:rls`, `verify:tenant-scope` y `verify:rls-runtime`.
- **Orquestación desde NestJS:**
  - Un `@Cron` con `scheduler-lock.service.ts` dispara el reentrenamiento nocturno, escalonado por hash de empresa, usando `runAsTenantJob` (sin él, la RLS devuelve cero filas en silencio).
  - Hay disparos incrementales por evento con `@nestjs/event-emitter`, por ejemplo tras cerrar un turno de POS.
- **Planes:** se añaden `ai_forecasting`, `ai_anomalies`, `ai_vision` y `ai_assistant` a `SAAS_FEATURE_KEYS` (`saas/saas.config.ts`). Las rutas se protegen con `@CheckFeature`. El consumo de LLM se mide con `@CheckPlanLimit(SaasResource.AI_CREDITS)`.
- **Permisos:** `ai.permissions.ts` define `AI_FORECAST_VIEW`, `AI_ANOMALY_VIEW`, `AI_ANOMALY_RESOLVE` y `AI_VISION_USE`. Se registran en `shared/permissions.ts` y `config/roles.config.ts`.

---

## 3. Plataforma compartida: `ai-gateway` (base de todo lo demás)

Es el **único** punto del sistema que llama a un LLM o a un servicio de embeddings.

- **SDK oficial `@anthropic-ai/sdk`.** La clave `ANTHROPIC_API_KEY` se valida en `config/env.validation.ts` y es obligatoria en producción si la IA está activa. Nunca llega al navegador.
- **Ruteo por función.** `ai-routing.config.ts` define para cada función su modelo, su `effort`, su `max_tokens`, su timeout y su fallback. Cambiar de modelo es configuración, no código.
- **Resiliencia:**
  - reintentos del SDK con backoff y circuit breaker con `opossum` (ya instalado);
  - fallback server-side de Claude ante rechazos (`fallbacks: "default"`);
  - si todo falla, la función se degrada a modo manual.
- **Gobernanza y auditoría.** La tabla `ai_requests` guarda empresa, usuario, función, modelo, tokens, costo, latencia, `stop_reason`, hash del prompt y resultado. Con eso hay:
  - costos por empresa;
  - facturación por uso;
  - integración con `audit`;
  - un panel "uso de IA" para el administrador.
- **Privacidad:**
  - se envían los datos mínimos, nunca datos de otra empresa;
  - se quita el EXIF de las imágenes (GPS);
  - cada empresa puede apagar la IA;
  - se respeta la residencia de datos con `inference_geo` donde aplique.
- **Seguridad contra prompt injection.** El texto de documentos, fotos o correos es _dato_, nunca instrucción. Las acciones del agente pasan por el mismo sistema de permisos del usuario y siempre con confirmación (§8).
- **Costo y latencia:**
  - caché de prompts (system prompt y catálogos estables primero);
  - Batch API para trabajos nocturnos (por ejemplo, las narrativas de anomalías) a mitad de precio.
- **Evaluación continua (`apps/ai-engine/evals` y `ai/evals`).** Conjuntos de prueba con resultados esperados por función. Ningún cambio de prompt o modelo se despliega sin superar la evaluación.

---

## 4. Modelos elegidos y justificación

### 4.1 LLM (Claude)

| Uso                                                                                                                          | Modelo                                    | Effort          | Por qué                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foto → producto, foto → factura (extracción)                                                                                 | **Claude Opus 5.5** (`claude-opus-5-5`)   | `high`          | Es el modelo general más capaz para uso interactivo, con visión de alta calidad para etiquetas, texto en español, tablas y facturas arrugadas. Los **structured outputs** (`output_config.format` con JSON Schema) garantizan JSON válido con exactamente los campos del formulario. Como el costo no es restricción, se usa el mejor en lugar de Haiku. |
| Control del ERP por lenguaje natural, copiloto interactivo                                                                   | **Claude Opus 5.5**                       | `medium`–`high` | Uso de herramientas (tool use) muy confiable y latencia aceptable para chat. Fable 5.1 puede tardar minutos por turno, lo que no sirve para una conversación en vivo.                                                                                                                                                                                    |
| Análisis profundos asíncronos: informe mensual del gerente, simulación "¿qué pasa si…?", plan de caja, auditoría inteligente | **Claude Fable 5.1** (`claude-fable-5-1`) | `high`/`xhigh`  | Es el modelo más capaz de Anthropic para razonar en tareas largas. Como corre en segundo plano, su latencia no importa y lo que cuenta es la calidad.                                                                                                                                                                                                    |
| Narrativas de alertas y clasificación masiva                                                                                 | **Claude Opus 5.5** vía Batch API         | `low`           | Calidad máxima a mitad de precio, sin urgencia.                                                                                                                                                                                                                                                                                                          |

Detalles técnicos que se respetan:

- pensamiento adaptativo (no se puede desactivar en Opus 5.5);
- `tool_choice: auto` con `strict: true` (Opus 5.5 y Fable 5.1 rechazan el uso forzado de herramientas);
- revisar siempre `stop_reason` (por ejemplo `refusal`) antes de leer la respuesta;
- streaming en respuestas largas.

**¿Por qué Claude y no otro proveedor?** Tiene SDK oficial en TypeScript, que encaja directo en NestJS; structured outputs y uso estricto de herramientas, clave para operar un ERP sin errores de formato; visión de primer nivel; buen español; y disponibilidad en Anthropic API, AWS Bedrock y Google Vertex. Eso evita quedar atado a una sola nube: el gateway puede cambiar de backend por configuración.

### 4.2 Embeddings

**Voyage AI (`voyage-multimodal-3` para imagen + texto, `voyage-3-large` para texto; o la versión vigente al implementar), guardados en pgvector con índice HNSW.**

- Anthropic no ofrece embeddings propios y recomienda Voyage.
- El modelo multimodal permite comparar _la foto_ con el catálogo para detectar productos duplicados.
- pgvector vive dentro de Postgres, así que **la RLS también protege los vectores**. Un vector DB externo rompería el aislamiento entre empresas.

### 4.3 Pronóstico de demanda (`apps/ai-engine`)

Como el costo no importa, se usa un **ensamble con selección por backtesting para cada serie** (producto × sucursal) en lugar de un solo modelo:

| Familia                  | Modelos                                                                                                                                                                                              | Para qué serie                                                                      | Justificación                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estadísticos clásicos    | AutoETS, AutoARIMA, AutoTheta, MSTL, SeasonalNaive (statsforecast)                                                                                                                                   | Toda serie con historia                                                             | Robustos, rápidos e interpretables. Capturan la estacionalidad semanal y anual. Son la línea base obligatoria.                                                              |
| Demanda intermitente     | Croston SBA, TSB, ADIDA, IMAPA                                                                                                                                                                       | Productos con muchos días en cero (la mayoría en un ERP)                            | Los modelos clásicos fallan con ceros; estos están diseñados para ese caso.                                                                                                 |
| ML global                | **LightGBM** (mlforecast) con lags, medias móviles, día de semana, feriados por país (desde el módulo `jurisdictions`), precio, descuento, promociones, quincena y día de pago, sucursal y categoría | Empresas con suficientes series                                                     | Un solo modelo aprende patrones entre miles de series. Es el enfoque ganador de la competencia **M5** (retail de Walmart: producto × tienda, exactamente nuestro problema). |
| Deep learning            | **NHITS / TFT** (neuralforecast), opcionales para empresas grandes                                                                                                                                   | Catálogos grandes con historia larga                                                | Capturan efectos no lineales y covariables futuras (promociones planificadas).                                                                                              |
| Modelos base (zero-shot) | **Chronos-Bolt** (Amazon) y **TimesFM** (Google), en el motor con GPU opcional                                                                                                                       | Productos nuevos o con poca historia (arranque en frío) y como miembro del ensamble | Pronostican sin entrenar con los datos de la empresa. Resuelven el arranque en frío, que es el punto débil de los modelos clásicos.                                         |

Además:

- **Demanda censurada.** Los días con stock en 0 (reconstruidos desde `stock_movements`) se marcan para no aprender "se vendió 0" cuando en realidad faltó mercancía. Ese es el error más común de los ERP que "predicen".
- **Reconciliación jerárquica** (`hierarchicalforecast`, MinT): producto × sucursal ↔ sucursal ↔ empresa, y producto ↔ categoría. Así las cifras cuadran en todos los niveles.
- **Probabilístico.** Cuantiles P10, P50 y P90 con _conformal prediction_, que da cobertura garantizada.
- **Selección y ensamble** por validación cruzada temporal (métricas MASE, WAPE y pinball loss). Se guarda la precisión de cada serie para decirle al usuario cuánto confiar.
- **Registro de modelos:** la tabla `ai_model_runs` guarda versión, métricas, hash de los datos y fecha, para reproducibilidad y para retroceder a una versión anterior si hace falta.

**Qué produce:**

- `ai_forecasts`: horizonte de 90 días, diario y por cuantil.
- `ai_inventory_insights`:
  - días de cobertura;
  - **fecha probable de quiebre**;
  - punto de reorden y stock de seguridad con el nivel de servicio elegido;
  - **cantidad sugerida de compra** (respeta el lead time real calculado desde `purchase-order-receipt`);
  - **ranking de productos con más venta proyectada por sucursal**;
  - exceso e inventario inmóvil;
  - sugerencias de **transferencia entre sucursales** (sobra en A y falta en B).

### 4.4 Detección de anomalías

Son cuatro capas complementarias, de mayor a menor precisión:

1. **Reglas deterministas.** Precisión alta y explicación inmediata:
   - facturas de proveedor duplicadas (mismo NCF, monto, fecha o proveedor);
   - descuentos fuera de la política;
   - anulaciones o devoluciones excesivas por cajero o terminal;
   - ventas bajo costo;
   - ajustes de inventario grandes;
   - movimientos fuera de horario;
   - cambios de precio bruscos;
   - asientos en días no hábiles.
2. **Series de tiempo.** El real se compara con el pronóstico, y si cae fuera del intervalo P1–P99 es una anomalía. A eso se suman STL y una puntuación z robusta (MAD) para ventas por sucursal, merma, devoluciones y gastos.
3. **ML no supervisado transaccional.** **Isolation Forest** + **ECOD** (PyOD) en ensamble, sobre variables de cada transacción: monto, hora, usuario, descuento, método de pago, sucursal y frecuencia. Funciona desde el primer día, sin necesidad de ejemplos etiquetados.
4. **Pruebas forenses.** Ley de Benford sobre montos y búsqueda de montos redondos repetidos o justo bajo el umbral de aprobación.

Cada alerta incluye puntaje, severidad, **evidencia estructurada** y una **explicación en español** que redacta Claude a partir de esa evidencia (el LLM explica, no decide). El **feedback** del usuario ("útil" o "falso positivo") ajusta los umbrales por empresa y, con suficientes etiquetas, entrena un clasificador supervisado (LightGBM) que reordena las alertas. Las alertas se integran con `notifications`, `audit` y `workflow-engine`, por ejemplo para abrir una tarea de revisión.

### 4.5 Autocompletado de producto desde foto

**Flujo híbrido**, más robusto que usar solo el LLM:

1. El usuario sube una o varias fotos en `product-form.page.ts`, a través de `vx-file-input`. El archivo pasa por `FastifyFileInterceptor` (solo imágenes, con límite de tamaño), se verifica el tipo MIME real, se quita el EXIF, se normaliza a 1568 px como máximo y se guarda con `StorageService` en S3.
2. **Código de barras.** Se lee en el navegador con ZXing y en el servidor como respaldo. Primero se busca en el catálogo propio; después en Open Food Facts o GS1, si la empresa lo habilita.
3. **Claude Opus 5.5 + structured outputs.** El prompt incluye la imagen y el **contexto de la empresa**: sus categorías, unidades de medida, impuestos y marcas, puestos como _enums_ del schema. Así **el modelo elige entre valores válidos en vez de inventarlos**.
4. **Salida:** `name`, `description`, `brand`, `categoryId`, `unitOfMeasure`, `barcode`, `kind`, `taxTreatment` y `taxRate` sugeridos, `attributes` (talla, color, peso, volumen, material) y la **confianza de cada campo**.
5. **Duplicados.** El embedding multimodal se compara con el catálogo en pgvector. Si la similitud es alta, se muestra "¿Es este producto existente?".
6. **Precio y costo.** Nunca los sugiere el LLM. Salen de datos propios: el costo de la última compra o factura de proveedor y el margen típico de la categoría.
7. La UI rellena los campos con la marca **"Sugerido por IA"** y su confianza. **Nada se guarda sin confirmación humana.** El SKU se genera con la regla existente.

---

## 5. Frontend (Angular)

- **Formulario de producto.** Botón "Crear desde foto" (cámara o archivo, varias fotos), estado de carga, chips de "sugerido" y alerta de duplicado. Se reutiliza `vx-file-input` y se respeta `VX_FORM_A11Y` y `vx-draft-shell`.
- **Inventario › Predicciones:**
  - ranking por sucursal;
  - gráfico de historia + pronóstico con banda P10–P90;
  - días de cobertura y fecha de quiebre;
  - órdenes de compra y transferencias sugeridas, con un botón para crear el borrador.
- **Anomalías:** bandeja con filtros por severidad y módulo, evidencia, explicación y botones de feedback y "crear tarea".
- **Administración › IA:** consumo y costo, activar o desactivar funciones, nivel de servicio objetivo.
- **i18n** con el pipeline existente (`npm run i18n:build` / `i18n:verify`) y diseño con los tokens del design system (`lint:design-system`).

---

## 6. Datos y migraciones nuevas

- **`products`:** `barcode` (único por empresa cuando existe), `brand`, `attributes jsonb`.
- **`product_images`:** con `storage_key`, `is_primary` y `embedding vector(1024)`.
- **Extensión `vector`.**
- **Vistas de solo lectura para el motor:** `ai_src_daily_demand` (desde `stock_movements` + almacén → sucursal), `ai_src_stock_daily`, `ai_src_prices`, `ai_src_lead_times` y `ai_src_transactions`.
- **Tablas de resultados:** `ai_requests`, `ai_model_runs`, `ai_forecasts`, `ai_inventory_insights`, `ai_anomalies` y `ai_anomaly_feedback`. Todas con RLS forzada y política `tenant_isolation`. Las tablas hijas se clasifican en `shared/tenancy/tenant-table-classification.ts`.
- **Rol `virtex_ai_engine`** con permisos mínimos.

---

## 7. Hoja de ruta completa (todas las funciones del documento)

| Fase          | Funciones                                                                       | Modelos                                                                                                                                                                                                                                            | Reutiliza                           |
| ------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **1 (ahora)** | ai-gateway, foto → producto, predicción de demanda e inventario, anomalías      | Opus 5.5 (visión), Voyage + pgvector, ensamble statsforecast/LightGBM/Chronos, Isolation Forest/ECOD                                                                                                                                               | —                                   |
| 2             | **Control del ERP por lenguaje natural** (consultar y actuar)                   | Opus 5.5 + tool use estricto. Cada herramienta envuelve un endpoint existente y **hereda los permisos del usuario**; las acciones que escriben requieren confirmación. Búsqueda de herramientas (tool search) para escalar a cientos de endpoints. | gateway, permisos, `search`         |
| 2             | Facturas de proveedor desde foto o PDF → borrador de factura de proveedor       | Opus 5.5 visión + structured outputs; validación de NCF/e-CF con `einvoicing`                                                                                                                                                                      | gateway, `accounts-payable`         |
| 2             | Redacción de correos con tonos; soporte y capacitación integrados               | Opus 5.5 (bajo effort) + documentación indexada en pgvector (RAG)                                                                                                                                                                                  | gateway, `mail`                     |
| 3             | **Predicción de flujo de caja**                                                 | Mismo motor de pronóstico sobre CxC y CxP (probabilidad de pago por cliente con LightGBM y su historial) + recurrentes; simulación Monte Carlo para el riesgo de déficit; Fable 5.1 para la narrativa y el plan                                    | ai-engine, `treasury`, `accounting` |
| 3             | **Conciliación bancaria automática**                                            | Coincidencia determinista (monto, fecha, referencia) → coincidencia aproximada → LightGBM de coincidencia entrenado con conciliaciones pasadas → Opus 5.5 solo para los casos ambiguos                                                             | `reconciliation`                    |
| 3             | Cobranza inteligente                                                            | Modelo de probabilidad y fecha de pago + priorización + correos redactados                                                                                                                                                                         | ai-engine, gateway                  |
| 4             | **Copiloto del gerente**, dashboards generados por IA, simulación de escenarios | Fable 5.1 asíncrono sobre las tablas `ai_*` y los reportes existentes                                                                                                                                                                              | todo lo anterior                    |
| 4             | Calidad y limpieza de datos; migración y onboarding con IA                      | Embeddings para duplicados de clientes y productos + Opus 5.5 para mapear columnas de Excel a entidades (`data-transfer`)                                                                                                                          | `data-transfer`                     |
| 5             | Agentes que ejecutan procesos (órdenes de compra, cotizaciones)                 | Opus 5.5 con tool runner + `workflow-engine` para aprobaciones humanas                                                                                                                                                                             | `workflow-engine`                   |

La gobernanza (auditoría, presupuestos, modo degradado, evaluaciones) se construye en la Fase 1, así que todas las fases posteriores son sostenibles desde el día uno.

---

## 8. Seguridad (resumen)

- **Aislamiento entre empresas:** RLS en todas las tablas `ai_*`, en los vectores y en el motor Python. Hay pruebas `verify:*` en CI.
- **Mínimo privilegio:** rol `virtex_ai_engine`; la clave del LLM vive solo en el servidor.
- **El LLM nunca ejecuta nada sin pasar por los permisos del usuario.** Las escrituras exigen confirmación y las operaciones sensibles usan la verificación reforzada (step-up) existente.
- **Prompt injection:** el contenido externo se trata como dato. Las herramientas tienen schemas estrictos y validación del lado del servidor.
- **Archivos:** validación de MIME real, límite de tamaño, EXIF eliminado y URLs firmadas de S3.
- **Trazabilidad:** auditoría completa en `ai_requests` + `audit`, y cada empresa puede apagar la IA.

---

## 9. Entrega de la Fase 1 (orden de implementación)

1. Migraciones (campos de producto, `product_images`, pgvector, vistas `ai_src_*`, tablas `ai_*` con RLS, rol del motor) + clasificación de tenancy.
2. `apps/backend/api/src/app/ai/`:
   - `ai.module.ts`, `ai.permissions.ts`;
   - `gateway/` (cliente Claude, ruteo, circuit breaker, registro de uso, cuotas);
   - `embeddings/` (Voyage + pgvector);
   - `product-vision/` (endpoint `POST /ai/products/from-image`);
   - `forecasting/` y `anomalies/` (encolado, lectura de resultados, feedback);
   - registro en `app.module.ts`, `queue-catalogue.ts`, `SAAS_FEATURE_KEYS`, `env.validation.ts` y `.env.example`.
3. `apps/ai-engine/` (Python 3.12, `uv`, Dockerfile, pytest):
   - `worker.py` (consumidor BullMQ);
   - `db.py` (sesión por empresa con `SET LOCAL`);
   - `forecasting/` (características, modelos, backtest, ensamble, reconciliación, conformal, insights);
   - `anomalies/` (reglas, series de tiempo, Isolation Forest/ECOD, Benford);
   - `evals/`.
4. Cliente web:
   - "Crear desde foto" en `features/inventory/product-form`;
   - páginas de Predicciones y Anomalías;
   - servicios en `core/api/`;
   - i18n.
5. Documentación: este informe, sección del motor en `docs/DEPLOYMENT.md` y `docker-compose` de desarrollo con el motor.

### Archivos existentes a reutilizar

- `shared/tenancy/tenant-job.ts` (`runAsTenantJob`) y `shared/tenancy/tenant-context.ts`
- `queues/queues.module.ts`, `shared/jobs/queue-catalogue.ts` y el procesador de ejemplo `journal-entries/recurring-entries.processor.ts`
- `shared/scheduler/scheduler-lock.service.ts`
- `storage/storage.service.ts`, `common/interceptors/fastify-file.interceptor.ts` y el ejemplo de avatar en `users/users.controller.ts`
- `saas/guards/feature-flag.guard.ts`, `saas/decorators/plan-limit.decorator.ts` y `saas/saas.config.ts`
- `security/decorators/permissions.decorator.ts`
- `inventory/stock-ledger.service.ts` y `supply-chain/entities/stock-movement.entity.ts`
- La plantilla RLS de la migración `1789010000000-WorkflowEngine.ts`
- `client-web/.../shared/components/file-input/file-input.component.ts`

---

## 10. Verificación

- **Backend:** Jest para el gateway (SDK simulado, fallbacks, circuit breaker, registro y cuotas), el autocompletado (el schema usa los enums de la empresa, nada se guarda sin confirmación, rechazo de archivos no imagen) y los permisos y feature flags. `npx nx test api` y `npx nx lint api`.
- **Seguridad y multiempresa:** `npm run verify:security`, `verify:rls`, `verify:rls-runtime` y `verify:tenancy` contra `docker-compose.test.yml` (Postgres + Redis). Prueba específica: el motor con la empresa A no ve filas de la B.
- **Motor:** pytest con series sintéticas (estacional, intermitente, con quiebres de stock y tendencia). Se verifica que:
  - el backtest elige un modelo razonable;
  - el ensamble mejora la línea base en WAPE;
  - los intervalos P10–P90 cubren alrededor del 80 %;
  - la demanda censurada se trata bien.

  Anomalías inyectadas permiten medir precisión y recall.

- **Evaluación de visión:** un conjunto de fotos de productos de prueba con sus campos esperados, midiendo la exactitud por campo.
- **De punta a punta:**
  - tenant demo (`npm run demo:tenant`) → reentrenamiento → ver Predicciones y Anomalías en la app (skill `run`);
  - crear un producto desde una foto;
  - `npm run i18n:verify` y `npm run lint:design-system`.

### Requisitos que el usuario deberá proveer

- `ANTHROPIC_API_KEY` y `VOYAGE_API_KEY` (las funciones quedan desactivadas sin ellas, sin romper el ERP).
- Infraestructura para un contenedor más (`ai-engine`); una GPU es opcional y solo acelera Chronos/TimesFM.
- Postgres con la extensión `pgvector` disponible (la tienen RDS, Cloud SQL, Supabase, Neon, Render y Railway).

---

## 11. Estado de la implementación — Fase 1

Lo que está construido, probado y en este repositorio, y en qué se apartó del plan, con el motivo.

| Pieza                                                                                                                                                                                                                | Estado | Dónde                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| Migración `AiPlatform` (campos de producto, `product_images`, tablas `ai_*`, vistas `ai_src_*` con `security_invoker`, rol `virtex_ai_engine`, pgvector opcional)                                                    | ✅     | `apps/backend/api/src/app/database/migrations/1789030000000-AiPlatform.ts`                                     |
| Gateway de IA (SDK oficial, cuota `ai_credits` antes de cada llamada, circuit breaker, fallback del servidor ante rechazos, structured outputs validados en servidor, registro de costo)                             | ✅     | `ai/gateway/`                                                                                                  |
| Foto → producto (sharp: EXIF/GPS fuera, orientación, 1568 px; schema con los enums del inquilino; GTIN; duplicados por código, nombre e imagen)                                                                      | ✅     | `ai/product-vision/`, `inventory/product-images.service.ts`                                                    |
| Subida real de fotos de producto (también sin IA)                                                                                                                                                                    | ✅     | `POST /inventory/images`                                                                                       |
| Motor Python: historia censurada, Syntetos-Boylan, backtest por serie, ETS/Theta/naive estacional, Croston SBA/TSB/ADIDA/IMAPA, LightGBM global, combinación top-2, bandas conformales, MinT, política de reposición | ✅     | `apps/ai-engine/src/virtex_ai_engine/forecasting/`                                                             |
| Anomalías: duplicados, venta bajo costo, anulaciones de caja, ajustes grandes, ventas por sucursal (z robusta), Isolation Forest + ECOD, Benford (MAD + chi²), ajuste por feedback                                   | ✅     | `apps/ai-engine/src/virtex_ai_engine/anomalies/`                                                               |
| Pantallas: formulario con foto, Predicciones, Anomalías                                                                                                                                                              | ✅     | `apps/core/client-web/src/app/features/ai/`                                                                    |
| Pruebas                                                                                                                                                                                                              | ✅     | 37 de API, 27 del motor (6 de integración como el rol del motor contra la base migrada, en CI), 22 del cliente |

**Desviaciones, medidas y no supuestas:**

- **AutoARIMA fuera del conjunto de candidatos.** Medido: unos 6 s por serie diaria frente a 0,2 s de ETS; con él, 62 series tardaban 253 s, y sin él 7,8 s, con el mismo WAPE mediano. En miles de productos habría ocupado un worker durante horas.
- **NHITS/TFT (deep learning) quedan para empresas que lo justifiquen.** El ensamble actual ya incluye un modelo global (LightGBM), que es lo que ganó la M5. Las redes se añaden como candidato cuando haya catálogos con historia larga que lo requieran.
- **Chronos-Bolt es opcional** (`pip install .[foundation]` y `AI_ENGINE_FOUNDATION_MODELS=1`): arrastra PyTorch. Sin él, los productos nuevos se pronostican con su propia historia corta y una banda amplia.
- **MinT usa `wls_struct`**: no necesita residuos dentro de muestra y es estable con demanda intermitente.
- **Escritura del motor sin `COPY`.** PostgreSQL rechaza `COPY FROM` bajo RLS para un rol sin BYPASSRLS, que es justamente la garantía buscada; se inserta por lotes con `unnest`.
- **Explicaciones de anomalías bajo demanda** (cuestan un crédito y se guardan) en lugar de en lote nocturno: la mayoría de los hallazgos se entienden por su evidencia.

### 11.1 Cierre de huecos de la Fase 1

Huecos que la primera entrega dejó abiertos, uno por uno, y cómo quedó cada uno:

**1. LightGBM sin feriados ni precio.** Lo resuelve `forecasting/exogenous.py`:

- Feriados del país de la empresa y sus vísperas (`holidays`).
- Índice de precio respecto a la mediana del propio producto, a partir de `ai_src_daily_prices` (líneas de factura y del POS).
- Tasa de descuento y días de promoción.
- Sucursal y categoría, como variables estáticas.

En el horizonte, el precio se mantiene en el último valor y el descuento en cero. Si una promoción ya está planificada, puede pasarse como dato conocido.

Resultado en la prueba sintética: el WAPE de LightGBM bajó de **0,358 a 0,283**.

**2. Sin banco de pruebas.** Ahora existe `virtex-ai-benchmark --organization <uuid>` (o `--synthetic`), un backtest de origen móvil:

- Lee los datos de la empresa con el rol del motor y no escribe nada.
- Compara el ensamble del motor, LightGBM con y sin variables externas, naive estacional, Prophet y CatBoost.
- Mide WAPE, MASE, sesgo, cobertura P10–P90 y tiempo.
- Prophet y CatBoost son opcionales (`pip install .[benchmark]`); si faltan, salen como `skipped`.

Resultado en datos sintéticos (60 series, 2 cortes):

| Candidato                       | WAPE  | MASE | Tiempo |
| ------------------------------- | ----- | ---- | ------ |
| LightGBM con variables externas | 0,331 | 0,73 | 1,9 s  |
| CatBoost                        | 0,331 | 0,73 | 2,0 s  |
| Ensamble del motor              | 0,334 | —    | 27 s   |
| Prophet                         | 0,365 | —    | 12 s   |
| Naive estacional                | 0,501 | 1,00 | —      |

El ensamble del motor tiene además una cobertura de 0,80. **La decisión de modelo en producción debe salir de correr esta herramienta con los datos reales de cada empresa**, no de esta tabla.

**3. Precio y costo sin historial.** La tabla `product_price_history` registra cada cambio, con quién y cuándo. La escribe `InventoryService.update` en la misma transacción que el cambio.

**4. Detectores de anomalías limitados.** Se añadieron nueve controles (`anomalies/detectors.py`). Cada uno se prueba con datos que contienen exactamente la anomalía y con datos parecidos que no deben marcarse.

| Control                        | Qué detecta                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Cobro duplicado                | Mismo cliente con la misma referencia, o el mismo monto y fecha.                                          |
| Proveedor pagado de más        | Factura de proveedor saldada por encima de su total, pagada dos veces o pagada después de anularse.       |
| Cruce OC / recepción / factura | Facturado sin recibir, facturado por encima de lo pedido, o facturas que suman más que la orden.          |
| Pico de devoluciones           | Tasa de devolución por encima de la del propio producto y de la empresa.                                  |
| Cambio de precio o costo       | Cambio del 50 % o más, o precio por debajo del costo. Es más grave si ocurre fuera de horario.            |
| Precio facturado anómalo       | Lejos de la mediana del producto (z robusta sobre el logaritmo).                                          |
| Descuento fuera de norma       | Fuera de la práctica habitual de la empresa.                                                              |
| Documento emitido alterado     | Factura, factura de proveedor o cobro emitido que se borra, o cuyo importe, fecha o contraparte se edita. |
| Actividad fuera de horario     | Horas raras aprendidas por empresa y en su zona horaria.                                                  |

El detector de documentos alterados lee solo metadatos del audit trail a través de la vista barrera `ai_src_document_changes`: nombres de campos, nunca valores.

**5. La IA no avisaba.** Cuando el motor completa un trabajo, todas las réplicas de la API reciben el evento `completed` de BullMQ:

- La corrida se reclama con un `UPDATE` condicional sobre `notified_at`. Probado con cuatro reclamos concurrentes: un solo aviso.
- Un barrido cada 3 horas cubre los eventos perdidos.
- El evento se define en `contracts/`: los riesgos de quiebre llegan a quien ve predicciones y las anomalías nuevas HIGH/CRITICAL a quien ve anomalías, en su idioma.

**6. Código de barras y Open Food Facts.** El formulario escanea con la cámara usando `BarcodeDetector` y, si el navegador no lo tiene, ZXing cargado al vuelo; si no hay cámara, el código se escribe a mano.

`GET /ai/products/barcode/:code` busca primero en el catálogo propio. Open Food Facts solo se consulta si `AI_OPEN_FOOD_FACTS_ENABLED=true`: sale únicamente el código, con 3 s de timeout y caché de un día.

La foto ahora también lee el fabricante, y el formulario avisa de que precio y costo quedan pendientes.

**7. Sin pantalla de administración.** Ahora existe **Ajustes › Inteligencia artificial**, alimentada por `GET /ai/overview`. Muestra:

- disponibilidad de cada función y por qué está o no (el plan o el servidor);
- créditos del plan;
- costo del mes por función;
- últimas corridas con su precisión, y botón para ejecutar;
- pendientes por revisar.

**8. Lead time por proveedor invisible.** La página de Predicciones muestra, por proveedor, la mediana y el P90 de días entre pedido y recepción, más la tasa de entregas a tiempo. Se calculan con las recepciones del último año, las mismas con que el motor dimensiona los puntos de reorden.

Pruebas del motor: 45, de las cuales 6 son de integración como el rol del motor contra la base migrada.

**Siguiente:** Fase 2 — control por lenguaje natural sobre este mismo gateway, con herramientas que heredan los permisos del usuario, y facturas de proveedor desde foto/PDF.

## 12. Estado de la implementación — Fases 2 a 5

Construido, probado y en este repositorio. Cada pieza que necesita un modelo pasa por el gateway (créditos, registro, circuit breaker); las cifras las calculan servicios y modelos deterministas, y toda acción que escribe deja un borrador o una solicitud de aprobación.

| Fase | Pieza | Dónde |
| ---- | ----- | ----- |
| 2.1 | Copiloto: tool use en streaming (SSE), herramientas registradas por cada dominio con sus permisos y su alcance por sucursal, borradores que se confirman | `ai/copilot/`, `contracts/copilot/`, `*.copilot-tools.ts` |
| 2.2 | Factura de proveedor desde foto o PDF, adjuntos, validador de NCF/e-NCF, RNC, aritmética y duplicados | `accounts-payable/bill-capture.service.ts`, `localization/fiscal/ncf.ts` |
| 2.3 | Notas con tono (cordial/formal/firme) con verificación de cifras; ayuda integrada (`search_help`) | `ai/gateway` (`compose`), `ai/help/` |
| 3.1 | Flujo de caja proyectado: Monte Carlo en el motor, banda P10–P90, riesgo de déficit, plan de caja escrito, escenarios | `apps/ai-engine/.../cashflow/`, `ai/cashflow/` |
| 3.2 | Conciliación: OFX y camt.053, mapeo de columnas de CSV (encabezados y, si hace falta, asistente), puntuación con razones y emparejamientos aprendidos, confirmación automática opcional, desempate por el asistente | `reconciliation/` |
| 3.3 | Cobranza: lista priorizada con la probabilidad del flujo de caja, acción y tono sugeridos, recordatorios con la factura adjunta, llamadas y promesas, herramienta del copiloto y acción de workflow | `collections/` |
| 4.1 | Informe mensual del gerente (día 1 y a pedido) y explicación de escenarios | `ai/reports/`, `ai/cashflow/scenario-comparison.builder.ts` |
| 4.2 | Duplicados de clientes, proveedores y productos; importación con mapeo de columnas | `ai/data-quality/`, `data-transfer/column-mapping.ts` |
| 5 | Agente de reposición, cotizaciones desde el mensaje de un cliente (copiloto) y bitácora de agentes | `procurement/replenishment/`, `ai/agents/` |

**Desviaciones respecto al plan, con su motivo:**

- **Ayuda sin embeddings.** La búsqueda usa texto completo de PostgreSQL en español, con un segundo intento por cualquier palabra cuando la frase entera no coincide. Para unos pocos cientos de secciones da los mismos resultados sin depender de Voyage ni de pgvector. Los artículos viajan con la API y se sincronizan al arrancar, así que no hay un paso de indexado que olvidar en el despliegue.
- **Ranking de conciliación aprendido en la API, no en el motor.** La señal útil es qué cuentas de contrapartida usó la empresa para el mismo tipo de descripción, y se lee de los emparejamientos confirmados en cada consulta. Un modelo entrenado aparte tendría que reentrenarse y desplegarse para aprender lo mismo.
- **Sin tolerancia por comisiones bancarias.** El monto debe coincidir exactamente. Una conciliación que acepta diferencias pequeñas por diseño puede ocultar un error real; la comisión sigue resolviéndose con una regla que crea su asiento.
- **Duplicados con trigramas en la aplicación**, porque `pg_trgm` no siempre está instalado, y sin embeddings de nombre. Se agrupa por identificación fiscal, contacto, código y las palabras más distintivas del nombre, para no comparar todo con todo. Nada se fusiona: fusionar mueve documentos y saldos, y es una decisión contable.
- **PDF del informe del gerente con la impresión del navegador**, con una hoja de estilo de impresión propia, en lugar del renderizador de documentos de la API.
- **Agente de cotizaciones como capacidad del copiloto.** El copiloto busca al cliente y los productos y propone `draft_quote` a precios de catálogo. Lo que no logra identificar lo lista en lugar de adivinarlo.
- **Facturas de proveedor y saldos iniciales importables, con el contrato ampliado.** El contrato de importación era «una fila, un registro». Ahora admite dos ganchos opcionales:
  - `checkFile`: reglas que abarcan varias filas.
  - `createAll`: confirma el archivo entero, todo o nada.

  Con eso se añadieron dos conjuntos:
  - **`opening_balances`** (`journal-entries/`): el archivo es un solo asiento `OPENING_BALANCE`.
    - Debe cuadrar al centavo; no se cuadra contra patrimonio.
    - Todas las filas llevan la misma fecha.
    - Las cuentas deben admitir movimientos.
    - No acepta el mismo archivo dos veces: la clave de idempotencia es su contenido.
    - Rechaza las cuentas de control de cuentas por cobrar, cuentas por pagar e inventario, y las cuentas bancarias, porque sus saldos vienen de su propio auxiliar.
  - **`vendor_bills`** (`accounts-payable/`): cada fila es una factura de una línea y entra por `AccountsPayableService` como borrador.
    - Busca al proveedor por su identificación fiscal.
    - Aplica las mismas validaciones de NCF y de duplicado que el formulario, y detecta además los duplicados dentro del propio archivo.
    - Para las facturas anteriores al arranque se usa como cuenta de gasto la de patrimonio de saldos iniciales, como explica la pantalla de importación.

**Verificación:**

- En cada entrega pasan typecheck, lint y las pruebas de API, cliente y motor.
- Se ejecutaron `check:schema-drift`, `verify:rls`, `verify:tenant-scope`, `verify:boundaries` (línea base intacta), `verify:boot`, i18n y `lint:design-system`.
- Las piezas con base de datos se prueban contra PostgreSQL migrado: cobranza, conciliación, duplicados e importación.
