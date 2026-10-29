# Bitácora — Auditoría UX/UI (2026-10-29)

## Hecho
- Infra: Postgres 16 (cluster nativo) + Redis 7 nativo (Docker no disponible en el contenedor). `npm ci --legacy-peer-deps`, `npm run migration:run`, API (`DEV_SEED=true`), web :4200, POS :4300.
- Inventario: 77 entradas de menú en 8 módulos (`harness/inventory.json`).
- Medición es-light 1440×900 (77 pantallas, axe-core, estilos computados) → `harness/survey-es-light.json`, `harness/analysis-es-light.txt`, capturas `evidence/survey/es-light/`.
- Medición en-light (77) → `harness/survey-en-light.json`.
- Alta de empresa MX vacía completa (6 pasos) → «QA-UX3 Comercializadora Ñandú & Hijos S.A. de C.V.».
- Tareas: cliente, producto, factura (MX borrador; DO emitida), cobro (DO), proveedor, factura de proveedor + aprobación + pago (MX), asiento manual (MX), invitar usuario Vendedor y recorrer su vista, exportar reportes (CSV), cambio de idioma (en↔es), aceptar invitación y cambiar de empresa, ajuste de inventario (borrador), conciliación (bloqueada), nómina (bloqueada en MX).

- Transversales: 6 tamaños/zoom × 6 pantallas, teclado (factura, ajustes), tema oscuro (77), volumen (322 clientes por API), 500/lento/offline/sesión caducada, PDF e impresión de factura, apertura del POS, búsqueda global.
- Reinicio del contenedor a mitad de sesión: se relevantaron Postgres, Redis, API, web y POS; datos de Postgres conservados.
- Informe: `INFORME_UX_UI.md`.

## No cubierto (ver §5 del informe)
- Escritorio (sin servidor gráfico), venta en POS, portugués, 22 de 25 secciones de Ajustes, flujos de cotización/OC/recepción/transferencia/activos/presupuestos/cierres/flujos de trabajo/IA.
