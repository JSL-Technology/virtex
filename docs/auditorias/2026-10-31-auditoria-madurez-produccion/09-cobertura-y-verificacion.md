# 09 — Cobertura y verificación

## 1. Cobertura por módulo

Los **54 módulos del inventario tienen ficha** con la rúbrica completa: identificación, estándar, resultado, 12 ejes, compuertas, hallazgos, camino mínimo, camino a 100, competitividad, fortalezas y lo no verificado. Ningún módulo quedó sin tocar. Por la profundidad de lo realmente inspeccionado o ejecutado, todos son **completos en rúbrica y parciales en verificación**, en la medida que indica cada ficha en «Lo que no se pudo verificar». Resumen:

| Familia | Módulos | Código inspeccionado | Endpoints ejecutados | UI ejecutada |
|---|---|---|---|---|
| F1 Identidad | T01, T02, T04 | 35–60 % de archivos | 25–40 % de rutas; script sobre 100 % de controladores (autorización) | No |
| F2 Plataforma | T03, T05, T11–T14, T16, T19, T21 | 30–70 % | ~60 llamadas; 20 pruebas IDOR | 77/77 rutas del menú cargadas (solo carga) |
| F3 Localización | T06–T10 | ~50 % | impuestos, tasas, 607, Anexo 24, sales tax US | No |
| F4 Contabilidad | M01–M07 | 25–55 % | asientos, cierre, reversión, concurrencia de numeración, balanza, depreciación | No |
| F5 Ventas | M08–M14 | ~40 % | emisión, concurrencia de NCF, NC, cobros concurrentes, e-CF y DIAN, POS (turno) | No |
| F6 Compras | M15–M18 | 40–70 % (correo entrante solo estático) | ciclo OC→factura→pago, retenciones DO/CO, duplicados | No |
| F7 Inventario | M19–M22 | inventario ~65 %; resto 70–80 % | ~60 % de inventario; concurrencia de último stock; kardex vs mayor por SQL | No |
| F8 Tesorería | M23, M24 | ~75 % / ~55 % | 8/12 y 11/25 rutas | No |
| F9 Nómina | M25, M26 | ~55 % / ~35 % | 12/33 y 6 rutas; recibo DO rehecho a mano | No |
| F10 Flujos y otros | T15, T23, M27–M31 | lectura dirigida | pruebas puntuales de lo crítico | No |
| F11 IA, ext., CI | T17, T18, T20, T22 | lectura dirigida | estado de IA sin proveedor, publicación de extensiones, MCP sin token; estado del CI en GitHub | No |
| Flujos cruzados | 7 flujos | — | flujos 1, 2, 4, 5, 6 y 7 ejecutados; nómina parcial | No |

**No ejecutado en ninguna familia:**
- Recorridos de UI con interacción (formularios, estados de error) más allá de la carga de rutas.
- Pruebas con roles restringidos más allá de usuarios y roles.
- Comportamiento multi-réplica.
- Conexión de la API como `virtex_app` por HTTP.
- Proveedores externos reales: Stripe, S3, correo, autoridades fiscales y LLM, vetados por riesgo de efecto externo o por falta de credenciales.
- Pruebas Python del motor de IA.
- `migration:revert`.

Las notas que dependen de eso llevan la confianza rebajada en su ficha.

## 2. Cómo se trabajó (y sus límites)

- Coordinador más 11 auditores por familia y 1 de flujos cruzados, con una rúbrica y un entorno comunes. Durante la sesión hubo **tres cortes por límite de uso y tres reinicios del contenedor**. La segunda mitad de las familias trabajó con un presupuesto acotado de llamadas, por lo que su verificación por ejecución es menor (lo declaran en sus fichas).
- **Entorno:** PostgreSQL 16 local sin pgvector, Redis, API compilada en modo desarrollo conectada como superusuario (RLS inactiva por diseño del entorno: las pruebas de aislamiento miden la capa de aplicación), 8 tenants QA creados con el camino real de alta.
- **Intervención en el entorno (no en el código):** el limitador global fijo de 20 req/min por IP bloqueaba a los auditores, que comparten 127.0.0.1. Se neutralizó con un *preload* fuera del repositorio, salvo en `/auth/`. Por eso la limitación de tasa se evaluó por código y con la medición inicial, no por API.
- **No se modificó código, configuración ni datos existentes del repositorio.** Solo se crearon los archivos de esta carpeta. Los datos de prueba (prefijo `QA-`) se crearon en la base local del entorno; algunos quedaron con evidencia deliberada, como la lista de precios de PL-01 o la BOM de MFG-02.

## 3. Verificación por muestreo (Paso 9.1)

**Críticos: el coordinador re-verificó 17 hallazgos** contra el código, la base de datos o la ejecución:

| Hallazgo | Cómo se verificó | Resultado |
|---|---|---|
| IMP-01 / NUC-01 redondeo | mismo algoritmo ejecutado con 1,25×0,18 y 42,5×0,19 | **Confirmado** (22 y 807 céntimos) |
| FLOW-01 recepciones concurrentes | lectura de `purchase-orders.service.ts:401-430` | **Confirmado** (sin bloqueo) |
| FLOW-02 / COB-01 cobros concurrentes | `customer-payments.service.ts:253-261` frente a `accounts-payable.service.ts:386` | **Confirmado** |
| COA-01 `parentId` entre tenants | `chart-of-accounts.service.ts` (create sin validar el padre) | **Confirmado** |
| GL-01 `Modified` | `account-balances.service.ts:164` (solo `POSTED`) + `journal-entries.service.ts:1287` | **Confirmado** |
| PL-01 listas de precios | `price-lists.service.ts:18-25` + `eager: true` en `price-list-item.entity.ts:24` | **Confirmado** |
| INV-01 (facturación) NCF concurrentes | `invoices.service.ts:280-292` (lectura sin bloqueo) | **Confirmado** |
| AUTH-01 recuperación de contraseña | `POST /auth/forgot-password`: existente 500, inexistente 200 | **Confirmado por ejecución** |
| USR-01 cambio de correo de admin | `users.service.ts:985-1000` (sin actor ni jerarquía) | **Confirmado** |
| AUD-01 rastro sin autor | consulta a `audit_logs` (invoices 71/71 sin `user_id`) + `RequestContextModule` no registrado | **Confirmado** |
| AP-01 anulación con ND | `voidBill` solo comprueba pagos (`:1440-1448`) | **Confirmado** |
| AP-02 retención como servicio | `servicesAmount = dto.servicesAmount ?? subtotal` (`:271`) | **Confirmado** |
| NOM-01 salario mínimo cotizable | `payroll_statutory_references`: una fila, 10.000 DOP desde 2020 | **Confirmado** (la cifra correcta: verificar con contador) |
| REC-01 conciliación con apertura | `openingJournalEntryId` no se usa en conciliación | **Confirmado** |
| EXT-02 admisión autoafirmada | `plugin-admission.service.ts:179-186` + `.rego:7-8` | **Confirmado** |
| Limitador global 20 req/min por IP | `app.module.ts:269` + 429 medidos | **Confirmado por ejecución** |
| `GET /customers` sin límite | 20.001 filas, 13,8 MB, p50 2,5 s | **Confirmado por ejecución** |

**Re-verificados por código o datos de los auditores, sin repetirlos el coordinador:** COA-03 (plan DO en MX: el coordinador observó que los tenants DO, MX, US y CO reciben las mismas 56 cuentas), RFC-01 (607), POS-01/INV-02, INV-01 de inventario, MFG-02, SCM-02, PRJ-01, LOC-01, EINV-01, CICD-01 y CICD-02. El 60 % de los críticos se re-verificó y el resto quedó reproducido por el auditor con pasos documentados.

**Altos:** se re-verificaron 9 de 129 elegidos entre familias distintas: BUS-03 (`GET /search` sin `q` → 500, confirmado por ejecución), CS-01 (`customer-portal.controller.ts:27-31` devuelve `findAll` del tenant, confirmado), IA-01 (`language_models default: true`, confirmado), TES-02 (listado de cuentas bancarias con número completo; en la cuenta de caja probada los campos eran nulos, así que no es concluyente), OBS-03 (sin salud pública, confirmado), NUC-02 (contratos de paginación distintos, confirmado por ejecución), los dos fallos de `verify:*` (confirmados) y AP-02 (ya listado). **No alcanza el 30 % pedido por la rúbrica** (≈7 %): es una limitación declarada de esta sesión. Ningún hallazgo muestreado resultó falso positivo, salvo uno parcial: TES-02 no se pudo reproducir con datos.

**Falsos positivos encontrados:** ninguno entre los críticos. Una precisión: la alerta de `verify:security` sobre `legal.service.ts:59` es un falso positivo **del verificador** (tabla global de lista de espera); el hallazgo real es que la compuerta está rota y bloquea el CI.

## 4. Topes y coherencia (Paso 9.2 y 9.3)

- **Topes:** todos los módulos con críticos abiertos tienen madurez ≤59 y preparación ≤69. Todos los veredictos «Piloto controlado» corresponden a módulos sin críticos y con preparación entre 50 y 69. Ningún módulo cumple las condiciones de «Listo con reservas» o «Listo para producción».
- **Ajustes de calibración aplicados por el coordinador** (anotados al final de cada ficha):
  1. **Multitenencia**: de 70/72 «Listo con reservas» a **52/50 «No listo»**, por el hallazgo sistémico MT-03 (referencias cruzadas entre tenants reproducidas en seis módulos).
  2. **IMP-01 / NUC-01** de alta a **crítica** (cálculo fiscal incorrecto).
  3. **EXT-02** a **crítica** (control de seguridad falso presentado como real).
  4. **MFG-02, SCM-02 y PRJ-01** a **crítica** (escritura entre tenants, según la regla de severidad).
- **Orden por nota** (madurez, de mayor a menor): i18n 62 · shell 62 · tareas 60 · suscripción 60 · IA 58 · importación 57 · flujos 56 · autenticación 55 · dimensiones 55 · notificaciones 55 · multitenencia 52 · archivos 52 · correo entrante 52 · mapa 52 · … · listas de precios 15 · manufactura 15 · servicio al cliente 10. Comprobaciones de coherencia:
  - Los componentes transversales bien construidos y sin críticos (i18n, shell, colas, suscripción) encabezan, y los módulos fachada cierran la lista: coherente.
  - **Facturación (40) por debajo de IA (58)** es coherente: facturación tiene dos críticos abiertos y su e-factura fuera de DO no existe; la IA degrada con honestidad y no tiene críticos.
  - **Dimensiones (55) y presupuestos (50) por encima de asientos (38)**, aunque dependen de ellos: es coherente porque la madurez mide cada módulo dentro de su propio alcance. Sus fichas declaran que heredan GL-01, y su preparación real queda condicionada por M02.
  - **Autenticación (55) por encima de usuarios y roles (50)**: ambos con un crítico; la base de autenticación (CSRF, RS256, rotación) es más sólida. Coherente.
- **Control de 15 puntos:** las fichas que difieren más de 15 puntos del promedio de sus ejes lo explican por los topes (eje crítico bajo o crítico abierto).

## 5. Contraste con informes previos del repositorio (Paso 9.5)

Los informes previos se leyeron solo al final. Discrepancias principales:

| Informe previo | Afirma | Esta auditoría encuentra |
|---|---|---|
| `docs/INFORME_AUDITORIA_MODULOS_2026.md` | Motor de partida doble «Excelente / apto para producción»; cierres «Excelente»; derivación de saldos «fuente única de verdad» | La partida doble cuadra siempre (de acuerdo), pero **GL-01** hace que la modificación de un asiento reste dos veces en todos los reportes y cierres, y el dashboard usa otra fuente (no es única). El período no se bloquea al contabilizar (GL-04). |
| ídem | Conciliación «Sólido» | Una cuenta con saldo inicial nunca cierra (REC-01); la importación CSV/OFX está rota (FLOW-04); el autoemparejamiento ignora la configuración. |
| ídem | Aislamiento «correcto salvo una fuga puntual» | Las lecturas directas, de acuerdo. Pero hay **al menos seis vías de referencia cruzada** entre tenants (MT-03). |
| ídem | Compras, RR.HH. y WMS «solo esquema» | Compras y nómina ya tienen implementación real (el informe es anterior). WMS, manufactura y proyectos siguen siendo CRUD o fachada. |
| `docs/auditorias/2026-10-ANTES-Y-DESPUES.md` | Verificación «lint sin errores», «3.406 pruebas en verde» | Coincide en tests (aquí 3.409 en verde), pero omite que `verify:boundaries` y `verify:security` fallan y que el CI de `main` está en rojo. Las correcciones del ajuste de inventario sí se confirman: el ajuste y su reversión cuadran (FLOW 4). |
| `docs/auditorias/REMEDIACION.md`, `SCORECARD_JUSTIFICACION.md` («ESTADO: REMEDIADO») | Hallazgos de seguridad y autenticación remediados | Se confirman los controles de CSRF, cookies, rotación, step-up y autorización global (de acuerdo). Quedan abiertos AUTH-01 (recuperación rota) y USR-01, y la limitación de tasa está mal configurada. |
| README | «~55 módulos ERP», marketplace de extensiones firmadas, POS con ventas atómicas | 13 módulos de menú. El marketplace es nominal y no verifica firmas. Las ventas del POS sí son atómicas para el stock, pero no emiten comprobante fiscal ni asiento. |
| `fiscal-coverage.ts` (visible al cliente) | DO 606–609, contabilidad electrónica MX, determinación de impuestos en CL/PE/EC/AR «implementados» | El 607 está mal construido, el Anexo 24 no se genera en un tenant nuevo y los impuestos solo tienen la tasa general. |

En algunos puntos los informes previos señalan problemas que ya no lo son: la ausencia de migración base y la deriva de esquema (hoy las migraciones aplican desde cero sin deriva), los e2e falsos de Nx (sustituidos por verificadores reales) y el arranque con reCAPTCHA duplicado (corregido; la app arranca).
