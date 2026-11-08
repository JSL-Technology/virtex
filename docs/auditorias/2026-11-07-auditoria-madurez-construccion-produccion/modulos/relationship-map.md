# Ficha de módulo: `relationship-map` (mapa de relaciones entre documentos)

Familia: PLTB · Auditor: PLTB · Fecha: 2026-11-07 · QA_SESSION=pltb · tenant qa-do-plt

## 1. Identificación
- Backend: `apps/backend/api/src/app/relationship-map/` (2.238 líneas).
  - `document-flow.service.ts` (633, construcción del grafo con SQL crudo parametrizado), `document-flow.catalog.ts` (308, catálogo de tipos/aristas), `contracts/document-flow.contracts.ts` (209), `relationship-map.controller.ts` (61). Pruebas: `document-flow.specs.ts` (550), `document-flow.service.spec.ts` (299), `document-flow.specs.spec.ts` (105).
  - Endpoints (`/relationship-map`, **solo lectura**): `GET types`, `GET search` (throttle 120/min), `GET :type/:id` (throttle 60/min).
- Frontend: `features/relationship-map` (no auditado por Playwright, presupuesto).
- Países: N/A. ¿Núcleo para vender? Capacidad de valor (equivalente al «Mapa de relaciones» de SAP B1); no bloquea venta base.

## 2. Estándar de referencia
Mapa de relaciones tipo SAP Business One: un permiso para entrar, y luego **filtrado por documento** según los permisos de módulo del usuario y su alcance de sucursal (una cadena cruza Ventas/Compras/Contabilidad/Nómina). Aislamiento por tenant en cada consulta, grafo con límites (profundidad/nodos/fan-out), sin fugas.

## 3. Resultado
- **Madurez (calibrada por el coordinador): **70 (64–76, confianza media-alta)**; el agente propuso 76–84.**
  - _Motivo de la calibración (Paso 9):_ Módulo de solo lectura correcto y aislado, pero su valor depende de la cobertura de vínculos entre documentos (muchos módulos aún sin integrar) y no se recorrió la UI con volumen. Se baja a la banda "apto con reservas".
  - Preparación 68 · **Piloto controlado**.
- ~~Madurez original: 76–84 (confianza media-alta).** Módulo de solo lectura bien diseñado: autorización en dos niveles (entrar + por documento), SQL crudo pero parametrizado, límites de grafo, throttling, pipes de validación. Buenas pruebas unitarias.
- **Preparación comercial: Listo con reservas.** Críticas (authZ, aislamiento) CUMPLEN y probadas. Reservas: rendimiento del grafo en cadenas grandes (hay mitigaciones: límites y aviso de `slow`), UI no verificada.
- **Eje más débil:** Rendimiento/escalabilidad (grafos profundos) y pruebas E2E con datos reales.
- **Hallazgos críticos abiertos:** ninguno.

## 4. Ejes (nota / evidencia / qué falta para 100)
1. Funcionalidad real (80, media-alta): `GET /types` devuelve catálogo real filtrado por permisos; `buildMap` arma el grafo desde datos. Sin mocks. Falta: E2E con una cadena real (cotización→factura→cobro).
2. Integridad (78, media): aristas se dibujan solo si ambos extremos pasan el filtro (consistencia del grafo documentada).
3. **AuthZ/aislamiento (86, alta) — PROBADO**: `RELATIONSHIP_MAP_VIEW` para entrar; filtrado por módulo/sucursal por documento. Tenant en cada SQL como parámetro (`$org`). En vivo: member → **403**; doc inexistente/ajeno → **404** `not_found` (sin leak).
4. Validación servidor (85, alta): `FlowDocumentTypePipe` (tipo desconocido → **400** limpio), `UuidParamPipe` en id, DTOs de query. Mejor manejo de errores que `datasheets`.
5. Multi-país: N/A.
6. Calidad (78, media): SQL crudo pero con identificadores desde catálogo interno (no entrada de usuario) y valores parametrizados; `escapeLike` en ILIKE.
7. Robustez/rendimiento (68, media): límites `FLOW_LIMITS` (searchPerType, fanOut, profundidad/nodos), batched (un statement por nivel, no N+1), aviso `slow` >1500 ms. Falta: medir con cadenas grandes reales.
8. **Seguridad (84, alta)**: sin inyección SQL (identificadores de catálogo, valores por binding, `ANY($1::uuid[])`); throttling en search/map; no expone datos de módulos sin permiso. Probado aislamiento.
9. Pruebas (80, alta): 3 specs (954 líneas) del servicio y el catálogo.
10. Operabilidad (72, media): log de rendimiento; falta correlación.
11. UX (no verificado): grafo en frontend no auditado con Playwright.
12. Competitividad (78): paridad con el mapa de relaciones de SAP B1 (diferenciador frente a ERP locales que no lo tienen). Fuente: código (confianza media-alta).

## 5. Compuertas de producción
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | CUMPLE | catálogo/grafo reales |
| 2 | Integridad | CUMPLE | aristas consistentes |
| 3 | AuthZ/aislamiento | CUMPLE | member 403; doc ajeno 404 (probado) |
| 4 | Validación servidor | CUMPLE | pipes de tipo/UUID (400 limpios) |
| 5 | Humo sin 500 | CUMPLE | types/search/map responden 200/400/404 |
| 6 | País | N/A | |
| 7 | Pruebas CI | CUMPLE | 3 specs del servicio/catálogo |
| 8 | Auditoría negocio | N/A | solo lectura |
| 9 | Migraciones | CUMPLE | global |
| 10 | Observabilidad | CUMPLE PARCIAL | log slow; correlación no verificada |
| 11 | UI sin bloqueos | NO VERIFICADO | |
| 12 | Documentación | CUMPLE PARCIAL | |

## 6. Hallazgos

**PLTB-RM-01** · relationship-map · eje 7 · Categoría: rendimiento · Severidad: **baja (verificar)**
- Ubicación: `document-flow.service.ts` `buildMap` (expansión por niveles).
- Qué: con cadenas muy grandes el grafo puede ser costoso; hay límites (`FLOW_LIMITS`) y aviso `slow`, pero no se midió con volumen real. Confirmar el comportamiento de truncado (`capFanOut`) y que la UI lo comunique.
- Forma correcta: prueba de carga ligera con una cadena larga; asegurar truncado explícito y mensaje al usuario.
- Esfuerzo: S (verificación).

## Pruebas ejecutadas (2026-11-07)
- `GET /relationship-map/types` (qa-do-plt) → **200**, catálogo (SALES_OPPORTUNITY, SALES_QUOTE searchable, SALES_INVOICE…).
- `GET /relationship-map/types` (qa-do-a-member) → **403** `you_do_not_have_permission_perform`.
- `GET /relationship-map/notatype/<uuid>` → **400** `unknown_document_type` (pipe de tipo).
- `GET /relationship-map/invoice/<uuid>` → **400** (tipo en minúscula no válido; el pipe exige la clave del catálogo).
- `GET /relationship-map/SALES_INVOICE/00000000-…-0001` → **404** `not_found` (doc inexistente/ajeno, sin fuga de datos).

## 7. Camino mínimo a producción
1. (S) Prueba de carga ligera de `buildMap` con cadena larga y verificación de truncado/UX (PLTB-RM-01).
2. (S) Correlación de logs.

## 8. Camino a 100
- +5 rendimiento verificado S; +4 E2E con cadena real M; +3 UI verificada M; +2 observabilidad S.

## 9. Competitividad
- Básica para segmento que viene de SAP B1 (lo esperan). Diferenciador frente a ERP locales que no ofrecen el mapa. Fuente: código (confianza media-alta).

## 10. Fortalezas a preservar
- Autorización en dos niveles (entrar + filtrado por documento según módulo/sucursal).
- SQL crudo seguro: identificadores desde catálogo, valores por binding, `escapeLike`, `ANY($::uuid[])`.
- Límites de grafo + throttling + batching (sin N+1).
- Manejo de errores limpio (400/404), a diferencia de `datasheets`.

## 11. Lo que no se pudo verificar
- E2E con una cadena de documentos real (presupuesto).
- Rendimiento con volumen grande (PLTB-RM-01).
- UI del grafo con Playwright.
