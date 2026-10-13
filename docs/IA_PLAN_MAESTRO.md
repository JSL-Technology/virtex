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
