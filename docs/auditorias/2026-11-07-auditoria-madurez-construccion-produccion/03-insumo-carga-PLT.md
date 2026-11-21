# Insumo — prueba de carga ligera local (familia PLTA) · 2026-11-07

**Alcance**: solo `localhost:3000` (API NestJS/Fastify, NODE_ENV=development, `dist/apps/backend/api/main.js`, un proceso, Postgres 16 y Redis locales, mismo host que el cliente). Script: `/tmp/claude-0/-home-user-virtex/18f6e197-474f-5038-b8e5-f1d402f375bd/scratchpad/agents/plta/load.mjs` (Node fetch, sesiones cookie+CSRF del cliente QA, `QA_SESSION=plta`). **300 peticiones por endpoint, concurrencia 10.** Resultado bruto: `…/agents/plta/load1.out`.

| Endpoint (tenant) | p50 ms | p95 ms | p99 ms | máx ms | req/s | Códigos |
|---|---|---|---|---|---|---|
| GET /journal-entries?page=1 (qa-do-fin, 40 asientos) | 85,1 | 149,1 | 199,8 | 233,2 | 107,9 | 200×300 |
| GET /invoices?page=1 (qa-do-fac) | 46,2 | 70,9 | 91,8 | 97,2 | 201,3 | 200×300 |
| GET /financial-reporting/trial-balance (qa-do-plt) | 83,1 | 120,6 | 176,7 | 178,2 | 115,2 | 200×300 |
| GET /search?q=QA-PLTA (qa-do-plt, ~100 clientes) | 44,9 | 57,8 | 66,9 | 71,8 | 221,4 | 200×300 |
| POST /documents/folders (qa-do-plt, con Idempotency-Key) | 35,3 | 56,7 | 68,8 | 79,1 | 268,2 | 201×300 |

**Errores**: 0 (ningún 4xx/5xx, ningún 429 con `THROTTLE_LIMIT` por defecto 600/min). RSS del proceso tras la prueba ≈ 540 MB.

## Lectura
- Con volúmenes mínimos (la base entera tiene 160 asientos) los tiempos son aceptables pero **no son evidencia de escalabilidad**: miden sobrecoste de framework (guards, interceptor de tenant que fija conexión por request, auditoría, i18n). `GET /journal-entries` ya tiene p50 85 ms con 40 filas; el coste por request es alto para un listado vacío/pequeño (≈40 ms por encima de `/invoices`).
- **Efecto colateral medido**: cada `GET /financial-reporting/trial-balance` escribe una fila `READ` en `audit_logs` (306 filas `trial_balance` para qa-do-plt tras la prueba). Un tablero que refresca informes infla la pista y añade un INSERT por lectura (ver ficha audit, PLT-AUD-04: sin índice compuesto ni retención).
- Cada POST de carpeta escribió además su fila de auditoría (308 filas `document_nodes`) — la auditoría transaccional no degradó la latencia de forma visible a este volumen.
- La búsqueda usa `ILIKE` sin índice trigram: 45 ms con ~100 clientes; crecerá linealmente (ficha search, PLT-SRCH-02).
- No probado: concurrencia >10, volúmenes reales (≥1M líneas de asiento), varias réplicas, exportaciones grandes (síncronas, ficha data-transfer PLT-DT-03), importación de 5.000 filas (1,0 s validar 4.000 filas; el commit fila a fila falló por límite de plan, PLT-DT-01).

## Datos creados
305 carpetas `QA-PLTA-LOAD-*` en qa-do-plt (no borradas, prefijo QA-PLTA); 99 clientes `QA-PLTA-Imp4k-*` de la prueba de importación.
