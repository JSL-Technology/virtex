# Progreso de la auditoría

Última actualización: 2026-11-01 (sesión 1, cerrada).

## Estado: COMPLETA en rúbrica, parcial en verificación

| Paso | Archivo | Estado |
|---|---|---|
| 1 Inventario | `01-inventario-de-modulos.md` | Completo (54 unidades) |
| 2 Ejecución | `03-resultados-de-ejecucion.md` | Completo |
| 3 Estándares | `02-estandares-de-referencia.md` + sección 2 de cada ficha | Completo |
| 4 Plataforma | `04-plataforma-transversal.md` + 23 fichas T | Completo |
| 5–7 Módulos | `modulos/*.md` (54 fichas con bloque RESUMEN) | Completo |
| 6 País | `05-matriz-pais-modulo.md` | Completo |
| 8 Flujos cruzados | `06-flujos-cruzados.md` | Completo, salvo nómina (aprobación y pago) no probada |
| Patrones | `07-patrones-sistemicos.md` | Completo |
| Hoja de ruta | `08-hoja-de-ruta.md` | Completo |
| 9 Verificación | `09-cobertura-y-verificacion.md` | Completo: críticos re-verificados al 60 %; altos solo ≈7 % (por debajo del 30 % pedido) |
| Resumen | `00-resumen-ejecutivo.md` | Completo |

## Lo que una sesión siguiente debería hacer (sin repetir lo cubierto)

1. Completar el muestreo de altos hasta el 30 % (faltan ~30 re-verificaciones), sobre todo en F6–F11, que trabajaron con presupuesto acotado.
2. Recorridos de UI con interacción (Playwright) en los flujos principales de cada módulo núcleo, y accesibilidad.
3. Pruebas de aislamiento con la API conectada como `virtex_app` (RLS activa) y repetición de MT-03 en ese modo.
4. Nómina de punta a punta: aprobación por un segundo usuario (requiere aceptar una invitación), pago y anulación.
5. Pruebas Python del motor de IA (`apps/ai-engine`) y del copiloto con un plan que lo habilite.
6. Validar las cifras normativas marcadas («verificar con contador local») con fuentes oficiales: permitir dgii.gov.do y tss.gob.do en la red de la sesión.

## Para retomar el entorno
- `service postgresql start`; `redis-server --daemonize yes`.
- API: `NODE_ENV=development DEV_SEED=true DEV_SEED_PASSWORD=<12+> DB_HOST=localhost DB_USERNAME=postgres DB_PASSWORD=postgres DB_NAME=erp REDIS_HOST=localhost AUTH_THROTTLE_LIMIT=1000 node dist/apps/backend/api/main.js` (si no existe el build: `npx nx build api`).
- El limitador global fijo de 20 req/min por IP impide trabajar con varios clientes desde una IP. En esta sesión se neutralizó con un *preload* fuera del repositorio (ver `03` §8). Es un hallazgo, no una configuración soportada.
- Tenants QA en la base local: qa-a y qa-b (DO), qa-mx, qa-us, qa-co, qa-flows (DO), qa-load (DO, 20.000 clientes sintéticos). Si la base se pierde, recrearlos parametrizando `tools/verify/demo-tenant.ts` desde un directorio temporal.
