# 00 — Resumen ejecutivo

Auditoría de madurez, construcción y preparación para producción de Virteex ERP. Commit `495719fc` (rama `ccr-835c4594-wrjtxj`), 2026-10-31 / 11-01. Solo diagnóstico: no se modificó código, configuración ni datos del repositorio.

## Resumen (15 líneas)

1. **Veredicto del producto: No listo para producción en ningún país.** Preparación del núcleo: DO 35, US 25, MX/CO 15, resto 10–15.
2. Hay base de ingeniería real: más de 3.400 pruebas que pasan con BD real, migraciones reproducibles sin deriva, autorización global de denegación por defecto sin endpoints huérfanos, CSRF, cookies RS256, i18n con fuente única y partida doble que nunca se descuadró en 3.086 asientos.
3. Pero **33 hallazgos críticos** abiertos en 54 módulos, de los que el coordinador re-verificó 17, y **129 altos**. Ningún módulo cumple las condiciones de «Listo»: 12 en piloto controlado y 42 no listos.
4. **Aislamiento entre tenants roto por referencias:** al menos seis endpoints aceptan ids de otro tenant (plan de cuentas, listas de precios, manufactura, WMS, proyectos, bloqueo de cuentas). En dos casos además devuelven sus datos.
5. **Integridad de saldos con concurrencia:** cobros aplicados dos veces, recepciones por encima de lo pedido, NCF consumidos de más y facturas duplicadas por reintento. Faltan bloqueos e idempotencia como convención.
6. **Contabilidad:** modificar un asiento contabilizado lo resta dos veces en todos los reportes y en el cierre anual, sin que la balanza lo detecte (GL-01).
7. **Dinero en coma flotante:** el redondeo falla en los empates (1,25 × 18 % → 0,22). Afecta a impuestos, e-CF y asientos.
8. **Multi-país mayormente nominal:** solo DO tiene cadena fiscal real. Los *builders* de e-factura de MX, CO, PE, CL, EC, AR y BR no están conectados, y el plan de cuentas dominicano se siembra en todos los países.
9. **Cumplimiento DO con fallos:** el 607 sale con columnas corridas, la nómina usa un salario mínimo cotizable de 2020, el POS no emite comprobante ni asiento y CxP retiene como servicio por defecto.
10. **Identidad:** la recuperación de contraseña devuelve 500 (oráculo de enumeración) y un editor de usuarios puede cambiar el correo de un administrador.
11. **Operación:** limitador fijo de 20 peticiones/min por IP para toda la API, sin salud pública, sin correlación, sin respaldo, sin IaC y con el CI de `main` en rojo en sus últimos 6 runs.
12. Hay **módulos fachada expuestos**: manufactura, WMS, proyectos, servicio al cliente, marketplace (con firma autoafirmada) y portal de proveedores.
13. Los informes previos del repositorio califican de «apto para producción» áreas en las que esta auditoría encontró críticos (ver `09` §5).
14. **Camino mínimo:** fase 0 de contención (S–M) y fase 1 de integridad del núcleo (M–L) para llegar a «Listo con reservas» en DO. Expandir a MX o CO es XL por país.
15. **Recomendación comercial:** vender solo en DO y como piloto acompañado tras las fases 0 y 1, retirar los módulos fachada y bloquear los países sin paquete fiscal.

## Hallazgos críticos de seguridad (reportados de inmediato)

| ID | Qué | Dónde | Estado |
|---|---|---|---|
| COA-01 | Cuenta contable con padre de otro tenant: escritura cruzada y lectura de la cuenta ajena | `chart-of-accounts.service.ts` create/findOne; también `POST /accounting/lock-account-in-period` | Reproducido y verificado |
| PL-01 | Lista de precios con `productId` ajeno devuelve el producto completo de otro tenant (SKU, precio, costo, stock) | `price-lists.service.ts:18-25`, `price-list-item.entity.ts:24` (`eager`) | Reproducido y verificado |
| MFG-02 / SCM-02 / PRJ-01 | BOM, órdenes, landed costs y proyectos aceptan ids de otro tenant | `manufacturing.service.ts:72-77,136-147`; `supply-chain.service.ts:204-207`; `projects.service.ts:300-307` | Reproducido por el auditor |
| USR-01 | Un usuario con `users:edit` cambia el correo de un ADMINISTRATOR | `users.service.ts:985-1015` | Reproducido y verificado |
| AUTH-01 | `forgot-password` responde 500 para cuentas existentes y 200 para inexistentes (enumeración); con USR-01 forma una cadena de toma de cuenta | `password-recovery.service.ts:5,232` | Reproducido por el coordinador |
| EXT-02 | La admisión de extensiones fija la firma como válida | `plugin-admission.service.ts:179-186` | Verificado |

## Panel de control

Ordenado por madurez. Notas 1–100; el rango y la confianza están en cada ficha. «Crít.» = hallazgos críticos abiertos en el módulo. «Camino» = esfuerzo del camino mínimo a producción.

| Ficha | Madurez | Prep. | Veredicto | Eje más débil | Crít. | Camino |
|---|---|---|---|---|---|---|
| `shell-portal-y-diseno.md` | 62 | 60 | Piloto controlado | Pruebas y verificabilidad | 0 | M |
| `internacionalizacion.md` | 62 | 60 | Piloto controlado | Multi-país y cumplimiento | 0 | M |
| `tareas-colas-cache.md` | 60 | 60 | Piloto controlado | Robustez | 0 | M |
| `suscripcion-saas.md` | 60 | 62 | Piloto controlado | 2 Corrección e integridad | 0 | M |
| `inteligencia-artificial.md` | 58 | 55 | Piloto controlado | UX/Pruebas | 0 | M |
| `importacion-exportacion.md` | 57 | 52 | No listo | Corrección e integridad | 0 | M |
| `flujos-y-aprobaciones.md` | 56 | 55 | Piloto controlado | Higiene/Arquitectura | 0 | M |
| `notificaciones.md` | 55 | 55 | Piloto controlado | Robustez | 0 | M |
| `dimensiones.md` | 55 | 55 | Piloto controlado | 9 Pruebas | 0 | S |
| `autenticacion-y-sesion.md` | 55 | 52 | No listo | 1 Autenticidad y completitud | 1 | M |
| `multitenencia-y-organizaciones.md` | 52 | 50 | No listo (ajustado por el coordinador | 8 Seguridad y aislamiento | 1 | M |
| `mapa-de-relaciones.md` | 52 | 50 | Piloto controlado | Pruebas/Seguridad (no verificado) | 0 | S |
| `correo-entrante.md` | 52 | 50 | Piloto controlado (confianza baja) | Pruebas | 0 | M |
| `archivos-y-documentos.md` | 52 | 50 | Piloto controlado | Autenticidad y completitud | 0 | M |
| `usuarios-roles-permisos.md` | 50 | 48 | No listo | 8 Seguridad y aislamiento | 1 | M |
| `tesoreria.md` | 50 | 42 | No listo | competitividad/autenticidad | 0 | M |
| `tablero-y-vista-general.md` | 50 | 45 | No listo | Corrección / UX | 0 | M |
| `presupuestos.md` | 50 | 52 | Piloto controlado | 12 Competitividad | 0 | M |
| `nucleo-tecnico-compartido.md` | 50 | 58 | No listo | Corrección e integridad | 1 | M |
| `monedas-tipos-de-cambio.md` | 50 | 46 | No listo | Multi-país y cumplimiento | 0 | M |
| `clientes.md` | 48 | 45 | No listo | autenticidad | 0 | M |
| `activos-fijos.md` | 48 | 45 | No listo | 3 Multi-país | 0 | M |
| `proveedores.md` | 45 | 42 | No listo | Completitud | 0 | M |
| `impuestos.md` | 45 | 42 | No listo | Multi-país y cumplimiento | 1 | M |
| `localizacion-reglas-pais.md` | 42 | 38 | No listo | Multi-país y cumplimiento | 1 | L |
| `hojas-de-datos.md` | 42 | 40 | No listo | Pruebas | 0 | M |
| `ventas-cotizaciones.md` | 40 | 38 | No listo | autenticidad | 0 | L |
| `recursos-humanos.md` | 40 | 38 | No listo | completitud | 0 | L |
| `inventario.md` | 40 | 42 | No listo | 2-Correccion e integridad | 2 | M |
| `facturacion-ventas.md` | 40 | 35 | No listo | multi-pais | 2 | M |
| `estados-financieros-y-reportes.md` | 40 | 45 | No listo | 2 Corrección | 1 | M |
| `escritorio.md` | 40 | 35 | No listo | Operabilidad | 0 | M |
| `compras.md` | 40 | 38 | No listo | Integridad | 1 | M |
| `cuentas-por-pagar.md` | 38 | 35 | No listo | Correccion e integridad | 2 | M |
| `asientos-mayor-y-cierre.md` | 38 | 45 | No listo | 2 Corrección e integridad | 1 | M |
| `reportes-fiscales-cumplimiento.md` | 35 | 30 | No listo | Multi-país y cumplimiento | 1 | M |
| `extensiones-marketplace.md` | 35 | 28 | No listo | Autenticidad | 1 | XL |
| `consolidacion-intercompania.md` | 35 | 30 | No listo | 1 Autenticidad (sin UI) | 0 | M |
| `cicd-infraestructura-gobernanza.md` | 35 | 25 | No listo | Correccion(pipeline rojo)/Operabilidad | 2 | M |
| `busqueda-global.md` | 35 | 35 | No listo | Rendimiento | 0 | S |
| `auditoria-rastro.md` | 35 | 45 | No listo | Corrección e integridad | 0 | S |
| `conciliacion-bancaria.md` | 32 | 28 | No listo | correccion-integridad | 2 | M |
| `punto-de-venta.md` | 30 | 25 | No listo | cumplimiento | 1 | L |
| `observabilidad.md` | 30 | 35 | No listo | Operabilidad | 0 | M |
| `nomina.md` | 30 | 25 | No listo | multi-pais/correccion | 3 | L |
| `cadena-de-suministro-wms.md` | 30 | 28 | No listo | 1-Autenticidad | 1 | L |
| `unidades-de-medida.md` | 28 | 30 | No listo | 1-Autenticidad | 0 | L |
| `plan-de-cuentas.md` | 25 | 30 | No listo | 8 Seguridad | 2 | L |
| `facturacion-electronica.md` | 25 | 20 | No listo | autenticidad | 1 | XL |
| `cobranza-cxc.md` | 25 | 30 | No listo | correccion | 1 | M |
| `proyectos.md` | 22 | 15 | No listo | Autenticidad | 1 | XL |
| `manufactura.md` | 15 | 12 | No listo | 1-Autenticidad | 1 | XL |
| `listas-de-precios.md` | 15 | 10 | No listo | autenticidad/seguridad | 1 | L |
| `servicio-al-cliente.md` | 10 | 5 | No listo | Autenticidad | 0 | XL |

Más el informe de integración `06-flujos-cruzados.md`, con 2 críticos (FLOW-01 y FLOW-02, citados también en compras y cobranza) y 4 altos.

## Matriz módulo × país

Ver `05-matriz-pais-modulo.md`. En síntesis: **ningún módulo con componente por país está listo en ningún país**. DO es el más cercano (núcleo 35), US el siguiente para contabilidad sin nómina (25), y MX, CO y el resto están entre 10 y 15 porque su e-factura obligatoria no existe y el plan de cuentas no es el suyo.

## Los diez mayores riesgos del producto

| # | Riesgo | Hallazgos | Consecuencia para el cliente |
|---|---|---|---|
| 1 | Referencias cruzadas entre tenants | MT-03: COA-01, PL-01, MFG-02, SCM-02, PRJ-01 | Un cliente lee o contamina datos de otro: incidente de privacidad y contractual |
| 2 | Saldos corrompidos por concurrencia o reintento | FLOW-01/02/03, INV-01 (fact.), COB-01, AP-04, GL-04 | CxC negativa, stock y CxP inflados, NCF perdidos ante la DGII |
| 3 | Reportes financieros erróneos tras modificar asientos | GL-01 | Estados financieros y cierre anual incorrectos sin ninguna alerta |
| 4 | Impuestos mal redondeados | IMP-01/NUC-01 | Diferencias de céntimo frente a la autoridad y rechazos de e-CF por validación de totales |
| 5 | Multi-país prometido y no entregado | LOC-01, EINV-01, COA-03, NOM-02 | Clientes de MX, CO, etc. sin comprobantes válidos ni contabilidad local: no pueden operar legalmente |
| 6 | Cumplimiento DO defectuoso | RFC-01 (607), NOM-01/03, AP-02, POS-01, EINV-03/04 | Declaraciones erróneas, retenciones indebidas, nómina subcotizada, ventas de POS sin comprobante |
| 7 | Toma de cuenta de administrador | USR-01 + AUTH-01 | Control del tenant por un usuario con permiso de edición |
| 8 | Rastro de auditoría inservible | AUD-01/02/03 | Sin autor ni IP en los documentos financieros: falla una auditoría externa o forense |
| 9 | Operación frágil en producción | Limitador 20/min/IP, OBS-01..03, COL-01, NOT-01, CICD-02 | Bloqueos por NAT, imposible diagnosticar, sin escalado horizontal, sin recuperación ante pérdida de datos |
| 10 | Proceso de calidad que no protege | CICD-01, P9 | El CI está en rojo y aun así se fusiona: cada cambio puede reabrir lo corregido |

## Madurez y preparación del producto

- **Núcleo mínimo para vender un ERP:** plan de cuentas (25), asientos y cierre (38), estados financieros (40), impuestos (45), facturación de ventas (40), e-factura (25), clientes (48), cobranza (25), compras (40), CxP (38), inventario (40), tesorería (50), conciliación (32), usuarios y permisos (50), autenticación (55), multitenencia (52). **Todos están «No listo».**
- **Madurez del producto:** ≈ **38/100** (rango 33–43, confianza media). Es un juicio, no un promedio: la acotan los ejes críticos del núcleo (integridad de saldos, aislamiento por referencias y cumplimiento). Está en la banda «parcial»: tiene funciones reales, pero un cliente real no podría operar sin incidentes.
- **Preparación comercial del producto:** DO 35 · US 25 · MX 15 · CO 15 · resto 10–15. **Veredicto: No listo** en todos.
- **Qué falta para llegar a 100:**
  - Integridad transaccional como convención (P2, P4).
  - Dinero exacto (P3).
  - Aislamiento a prueba de olvido (P1).
  - Paquetes de país como datos versionados y completos, empezando por DO y siguiendo con MX y CO (P5, P6).
  - Retirar o completar los módulos fachada (P7).
  - Operación de producción: observabilidad, límites, locks, respaldo, IaC (P10).
  - Calidad como compuerta: CI verde, E2E, invariantes y concurrencia (P9).
  - Para competir con NetSuite, Dynamics, Odoo y los líderes locales: pedidos y reservas, lotes y series, MRP real, consolidación con UI, feeds bancarios, SAML/SCIM, e-factura y reportes legales de cada país, y nómina multi-país.

## Hoja de ruta

Ver `08-hoja-de-ruta.md`.
- **Fase 0, contención (S–M):** CI verde y obligatorio, AUTH-01 y USR-01, validación de pertenencia y FK compuestas, API como `virtex_app`, limitador por usuario, retirar fachadas, bloquear países sin paquete, respaldo.
- **Fase 1, integridad del núcleo (M–L):** dinero exacto, vista canónica de movimientos (GL-01), bloqueos e idempotencia, máquinas de estado, auditoría con autor, POS fiscal, conciliación, CxP.
- **Fase 2, cumplimiento DO y operación.**
- **Fase 3, país por país.**
- **Fase 4, diferenciación.**

## Cobertura

Los 54 módulos tienen ficha con la rúbrica completa, y la verificación es parcial en todos (ver `09-cobertura-y-verificacion.md`). No se ejecutaron:
- recorridos de UI con interacción (solo la carga de las 77 rutas);
- pruebas con la API conectada como `virtex_app`;
- comportamiento multi-réplica;
- proveedores externos reales;
- pruebas Python del motor de IA.

El muestreo de altos re-verificados (≈7 %) no alcanzó el 30 % pedido: es una limitación declarada.

## Índice
`01-inventario-de-modulos` · `02-estandares-de-referencia` · `03-resultados-de-ejecucion` · `04-plataforma-transversal` · `05-matriz-pais-modulo` · `06-flujos-cruzados` · `07-patrones-sistemicos` · `08-hoja-de-ruta` · `09-cobertura-y-verificacion` · `modulos/` (54 fichas) · `progreso`
