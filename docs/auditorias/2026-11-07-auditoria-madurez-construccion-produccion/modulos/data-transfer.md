# Ficha — data-transfer (importación/exportación masiva) + frontend data-imports / data-exports
Familia PLTA · 2026-11-07 · Diagnóstico. Archivos de prueba generados en `scratchpad/agents/plta/` (c50k.csv 50.000 filas, c4k.csv 4.000, bad.csv malformado).

## 1. Identificación
`apps/backend/api/src/app/data-transfer/` (6 archivos, 1.025 l.; 2 specs). Endpoints: `GET /data-transfer/datasets`, `GET /data-transfer/runs`, `GET /data-transfer/datasets/:dataset/template`, `POST /data-transfer/exports` (20/min), `POST /data-transfer/imports?dataset=&mode=validate|commit` (≤5 MB, .csv/.xlsx, 20/min), `POST /data-transfer/datasets/:dataset/column-mapping` (IA). Tabla `data_transfer_runs`. Registro de datasets por dominio (clientes, productos, plan de cuentas, facturas…). Límites: `MAX_IMPORT_ROWS = 5_000`, `MAX_EXPORT_ROWS = 100_000` (data-transfer.service.ts:49-51). Frontend: `features/data-imports`, `features/data-exports` (no probado en navegador). Núcleo: **alto** (migración de clientes al alta).

## 2. Estándar de referencia
(a) Plantillas por entidad y país, validación previa (dry-run) con errores por fila, importación atómica o reanudable con informe, trabajo en segundo plano para volúmenes grandes (≥100k filas), idempotencia (clave externa/upsert), exportación con neutralización de fórmulas, historial de ejecuciones. (b) Invariantes: lo que el informe dice importado es exactamente lo que existe; nunca datos a medias sin registro; mismo control de permisos que la creación manual. (c) NetSuite CSV Import Assistant (asíncrono, mapeos guardados, add/update), Dynamics Data Management (jobs asíncronos, staging), Odoo import (test + import, upsert por External ID) — confianza media (conocimiento general). (d) Staging + job en cola + transacción por lote + informe persistido.

## 3. Resultado
**Madurez 42 (35–50, confianza alta)**; preparación 42; **No listo** (compuerta 2 incumplida). Eje más débil: 2. Críticos: 0 (PLT-DT-01 alta: afecta solo al tenant propio, pero rompe la promesa de atomicidad).

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 50 | Validación real: 4.000 filas `mode=validate` → `VALIDATED` en 1,0 s; malformado → 400 `data_transfer.file_unreadable` ("Quoted field unterminated"); 50.000 filas → `FAILED too_many_rows (max 5000)` | Límite de 5.000 filas impide migraciones reales (clientes/productos de una pyme mediana) |
| 2 | **30 (25–38, alta)** | PLT-DT-01: commit de 4.000 clientes → **HTTP 500** tras crear **99** clientes (BD), sin fila en `data_transfer_runs` para el commit (solo FAILED 50k y VALIDATED 4k); reintento → 500 de nuevo | Transacción única o lote con informe PARTIAL persistido; límite de plan como refusal |
| 3 | 40 (media) | Plantilla de clientes para **qa-us-a (US)** trae ejemplo dominicano (`RNC`, `131-12345-7`, Santo Domingo, `pais=DO`) | Ejemplos/columnas por país |
| 4 | 60 | Registro de importadores por dominio (bien), pero `create` fila a fila cuando el dominio no ofrece `createAll` (service l.425-441) | `createAll` obligatorio |
| 5 | 60 | Llama a servicios de dominio vía registro | — |
| 6 | 65 | — | — |
| 7 | 40 | Todo síncrono en la request: exportación de hasta 100.000 filas se construye en memoria (`EXPORT_PAGE` 1.000) y la importación de 5.000 filas con un INSERT+transacción+`enforceLimit` por fila; sin cola | Job en BullMQ con progreso (ya existe infraestructura) |
| 8 | 70 (alta) | member → 403 `data_transfer.not_allowed_to_export`; permisos por dataset; neutralización CSV injection (`service.ts:633-640`, plantilla muestra `'+1 809 555 0100`); entrada `=HYPERLINK(...)` en nombre rechazada por validación de clientes (400) | Prueba de inyección extremo a extremo por dataset |
| 9 | 45 | 2 specs con mocks; ninguna cubre fallo a mitad de commit | Integración con BD y límite de plan |
| 10 | 45 | El commit fallido no deja run ni rastro; solo stack en log (`QueryFailedError: current transaction is aborted … UsageMetricRepository.incrementUsage … SaasService.enforceLimit … CustomersService.create`) | Run PARTIAL con fila de fallo |
| 11 | 50 (baja) | UI no probada; problemas recortados a 200 | — |
| 12 | 40 | Sin upsert/actualización masiva, sin mapeos guardados (mapeo IA sí), sin asincronía | — |

## 5. Compuertas
1 Parcial · **2 No cumple (PLT-DT-01)** · 3 Cumple · 4 Cumple · 5 **No cumple** (500 en commit) · 6 No cumple (plantilla DO para US) · 7 Parcial · 8 Parcial (runs) · 9 N/A · 10 Parcial · 11 No verificado · 12 Parcial.

## 6. Hallazgos
- **PLT-DT-01** · data-transfer/customers/saas · eje 2 · integridad de datos · **Alta** · `data-transfer/data-transfer.service.ts:425-441` + `customers.service.ts` (create → `SaasService.enforceLimit` → `UsageMetricRepository.incrementUsage`) · Pasos: qa-do-plt `POST /data-transfer/imports?dataset=customers&mode=commit` con c4k.csv → 500; `select count(*) from customers where organization_id='99b47813…'` → 100 (99 importados + consumidor final). El límite de plan aborta la transacción y el siguiente query revienta → 500 genérico en vez de `refusal`; el bucle fila a fila ya confirmó 99 filas; no se persiste el run. El usuario ve "error interno", no sabe qué quedó, y la ayuda dice "todo o nada" (comentario l.405 solo aplica a `createAll`). Además `POST /customers` manual en ese tenant → 500 (mismo origen: límite de plan como 500). · Forma correcta: validar el cupo del plan antes del commit; importar en una transacción o por lotes con run PARTIAL persistido; traducir el límite de plan a 402/409 de dominio. · Riesgo operativo / bloquea onboarding. · M.
- **PLT-DT-02** · data-transfer · eje 1/12 · competitividad · **Alta** · `data-transfer.service.ts:49` · 5.000 filas máx. y 5 MB: una migración típica (10–50k clientes/productos) exige partir en 10+ archivos a mano; sin upsert. · Importación asíncrona en cola, ≥100k filas, upsert por clave externa. · Bloquea venta a clientes medianos. · L.
- **PLT-DT-03** · data-transfer · eje 7 · rendimiento · Media · export síncrono hasta 100.000 filas en memoria dentro de la request (l.51-52,126). · Job + descarga diferida. · M.
- **PLT-DT-04** · data-transfer · eje 3 · multi-país · Media · plantilla de clientes (`GET /data-transfer/datasets/customers/template` con qa-us-a) con ejemplo DO (RNC, Santo Domingo). · Ejemplos por país del tenant. · S.

## 7. Camino mínimo
1. PLT-DT-01 (M). 2. Import/export asíncronos en cola con progreso (ya hay `sendToUser`) (M/L). 3. Plantillas por país (S). Retocar.
## 8. Camino a 100
Upsert y actualización masiva (+10, M); mapeos guardados (+4, S); staging con corrección en pantalla (+8, L); volumen 100k+ (+8, M).
## 9. Competitividad
Odoo/NetSuite permiten upsert por External ID y jobs asíncronos (confianza media) — básico para migraciones.
## 10. Fortalezas
Dry-run real; detección de delimitador y `sep=`; neutralización de fórmulas; permisos por dataset; throttling; mapeo de columnas asistido.
## 11. No verificado
xlsx; UI de importación/exportación; datasets distintos de clientes. Nota: el tenant qa-do-plt quedó con 99 clientes `QA-PLTA-Imp4k-*` y en el límite de plan (cualquier alta de cliente posterior da 500).
