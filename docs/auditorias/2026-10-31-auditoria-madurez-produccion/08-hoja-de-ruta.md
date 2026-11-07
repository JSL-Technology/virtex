# 08 — Hoja de ruta

Orden recomendado: primero lo que desbloquea la venta (críticos y núcleo en el país piloto), luego lo que reduce el riesgo operativo y después lo que diferencia. Esfuerzo relativo: S / M / L / XL, sin estimar horas. Las referencias P1–P11 remiten a `07-patrones-sistemicos.md`.

**Objetivo de la fase 1:** llevar el núcleo a «Listo con reservas» en **República Dominicana**, y como mucho en **EE. UU. solo para contabilidad sin nómina**. Mientras tanto, los demás mercados se retiran o bloquean en el alta y en la emisión.

## Fase 0 — Contención inmediata (antes de cualquier cliente de pago)

| # | Acción | Hallazgos | Esfuerzo | Dependencias |
|---|---|---|---|---|
| 0.1 | Volver a poner el CI de `main` en verde y exigirlo como condición de merge (protección de rama); meter `form-a11y` y `required-markers` en CI. | CICD-01, P9 | S | — |
| 0.2 | Corregir la recuperación de contraseña (`import ms`) y la jerarquía en `adminChangeEmail`, y dar la misma respuesta a cuentas existentes e inexistentes. | AUTH-01, USR-01 | S | — |
| 0.3 | Validar la pertenencia de todo `*Id` entrante y añadir FK compuestas en las tablas afectadas; prueba genérica de referencias cruzadas. | P1: COA-01, PL-01, SCM-02, MFG-02, PRJ-01, lock-account | M | — |
| 0.4 | Conectar la API como `virtex_app` en todos los entornos no dev y bloquear el arranque si el rol tiene BYPASSRLS. Revisar la clasificación «sin RLS» de `users`, `roles`, `audit_logs`, etc. | MT-01, MT-02 | S–M | 0.3 |
| 0.5 | Sustituir el limitador global fijo por límites por usuario y tenant configurables, y unificar los dos `ThrottlerModule`. | NUC-03/OBS-07 | S | — |
| 0.6 | Retirar de la API pública, del menú y del README los módulos fachada (manufactura, WMS, proyectos, servicio al cliente, portal del cliente, marketplace, consolidación) hasta completarlos. | P7, CS-01, EXT-01/02 | S | — |
| 0.7 | Bloquear el alta y la emisión en países sin paquete fiscal real y corregir `fiscal-coverage.ts` para que diga la verdad. | LOC-01, P5 | S | — |
| 0.8 | Definir y probar respaldo y restauración (PITR, RPO/RTO). | CICD-02 | M | infraestructura |

## Fase 1 — Integridad del núcleo contable y documental (desbloquea la venta en DO)

| # | Acción | Hallazgos | Esfuerzo | Dependencias |
|---|---|---|---|---|
| 1.1 | Aritmética monetaria exacta en `common/money.ts`, usada también por el POS; tasas de cambio con 6+ decimales y tolerancia configurada; ampliar columnas monetarias. | P3: IMP-01, NUC-01, FLOW-05b | M | — |
| 1.2 | Vista canónica de movimientos vigentes; corregir GL-01 (`Modified`) en todos los lectores y en el dashboard; recalcular los cierres afectados. | P4: GL-01, DSH-01, BUD-01 | M | — |
| 1.3 | Bloqueos e idempotencia en documentos con saldo: recepciones, cobros, emisión de facturas, pagos, asientos manuales, cierre de período y de conciliación. | P2: FLOW-01/02/03, INV-01 (fact.), AP-04, GL-04, REC-04 | M | 1.2 |
| 1.4 | Máquinas de estado con efectos compensatorios: anulación de factura de proveedor con ND, anulación de cobro, deshacer conciliación. | AP-01, COB-02/FLOW-05, REC-05 | M | 1.3 |
| 1.5 | Rastro de auditoría con autor, IP y *append-only*, y cobertura de las operaciones sensibles. | P11: AUD-01/02/03 | S–M | — |
| 1.6 | Costo de venta recalculado al emitir; venta sin cuentas de costo → error, no aviso. | INV-01 (inv.), INV-03 | S | 1.1 |
| 1.7 | POS: emitir comprobante fiscal y contabilizar ingreso y costo por venta y por cierre de turno, usando el motor de facturación. | POS-01/02, INV-02 | L | 1.1, 1.3 |
| 1.8 | Conciliación: conciliación inicial y exclusión del asiento de apertura; importación CSV/OFX que funcione; respetar `autoConfirm`/`minScore`. | REC-01, FLOW-04, REC-03 | M | — |
| 1.9 | CxP: clasificación bienes/servicios explícita, catálogo de retenciones DO completo, número de factura de proveedor con unicidad y three-way match real (no facturar sin recepción). | AP-02/03/05, PRC-03 | M | — |
| 1.10 | Paginación obligatoria con un contrato único en todos los listados. | NUC-02, AP-09, carga §8 | M | — |

## Fase 2 — Cumplimiento DO completo y operación

| # | Acción | Hallazgos | Esfuerzo | Dependencias |
|---|---|---|---|---|
| 2.1 | Corregir el formato 607 y validar 606/608/609 contra los instructivos DGII; añadir IT-1 e IR-17. | RFC-01, RFC-03 | M | — |
| 2.2 | e-CF: rechazar certificados sin cadena de confianza válida, ambiente DGII por tenant, actualizar node-forge. | EINV-03/04 | S–M | — |
| 2.3 | Nómina DO: referencias estatutarias versionadas y actualizadas (salario mínimo cotizable y topes), corrección de la regalía y del INFOTEP, IR-3 e IR-13, archivos TSS validados; impedir reglas DO en tenants de otro país. Todo validado con un contador local. | NOM-01..05 | M | 2.5 |
| 2.4 | Observabilidad: liveness y readiness públicos, correlación (`x-request-id`), `organizationId`/`userId` en logs, métricas y alertas. | OBS-01..03 | M | — |
| 2.5 | Lock distribuido en cron, adaptador Redis para WebSocket, refresco analítico por tenant y sin DROP. | COL-01/02, NOT-01 | M | — |
| 2.6 | Imágenes reproducibles de API y portal, IaC mínima, versionado y releases; escritorio firmado y con actualización automática. | CICD-03..05, DESK-01/02 | M | — |
| 2.7 | Plan de cuentas DO revisado por un contador y plan US separado; activos fijos con libro fiscal. | COA-03, FA-02 | M | 2.8 |
| 2.8 | Paquete de país como datos versionados con validador de completitud. | P5, P6 | L | — |
| 2.9 | E2E de los flujos críticos y pruebas de invariantes de dominio en CI. | P9 | M | 0.1 |

## Fase 3 — Expansión de mercados (un país a la vez, sobre el paquete de 2.8)

Orden sugerido por tamaño de mercado y cercanía al estado actual: **MX** (CFDI 4.0 con PAC, código agrupador, REP, DIOT, IEPS y retenciones; XL), **CO** (DIAN, PUC, retenciones con base UVT y tercero por línea; XL), luego PE, CL, EC, AR y BR (XL cada uno). Cada país entra solo cuando su paquete pasa el validador de completitud y tiene E2E fiscal en CI.

## Fase 4 — Diferenciación y funciones avanzadas

Pedidos de venta y reservas, lotes, series y vencimientos con FIFO/estándar, landed costs aplicados, MRP real, presupuestos con escenarios, consolidación con eliminaciones completas y UI, feeds bancarios (Belvo, Fintoc, Plaid), SAML/SCIM, IA con consentimiento explícito (opt-in) y evaluación de inyección en CI, y un marketplace con firma verificada y APIs de datos.

## Dependencias críticas

```
0.1 CI verde ──► todo lo demás (sin CI verde no hay evidencia de que algo siga funcionando)
0.3 + 0.4 aislamiento ──► cualquier cliente real
1.1 dinero exacto ──► 1.6, 1.7, 2.1, 2.3 (todos los cálculos)
1.2 vista canónica ──► 1.3 ──► 1.4 (integridad de saldos)
2.8 paquete de país ──► 2.3, 2.7 y toda la fase 3
```
