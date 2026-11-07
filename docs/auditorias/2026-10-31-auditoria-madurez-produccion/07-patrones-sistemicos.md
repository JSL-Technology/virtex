# 07 — Patrones sistémicos

Problemas que se repiten en varios módulos. Apuntan a una convención o un proceso que falta y conviene corregirlos una sola vez, en la plataforma, en lugar de módulo por módulo.

## P1 — Referencias foráneas sin validar la organización (crítico)
- **Evidencia:** COA-01 (`parentId`, con lectura de la cuenta ajena) y `lockAccountInPeriod` (`accountId`) en contabilidad; PL-01 (`productId`, devuelve el producto ajeno completo); SCM-02 (`glAccountId`); MFG-02 (componentes y productos); PRJ-01 (`taskId`, `customerId`, `assignedToUserId`). Las lecturas directas por id sí están protegidas: más de 60 pruebas IDOR devolvieron 404.
- **Causa:** el filtro es manual (`where: { organizationId }`), solo se aplica al recurso principal y nunca a los ids que llegan dentro del DTO. RLS lo atraparía, pero la aplicación puede conectarse con un rol que la evita, y además las FK son simples (`id`) en lugar de compuestas.
- **Corrección única:** helper `assertOwnedBy` obligatorio para todo `*Id` de entrada; FK compuestas `(organization_id, id)`; API siempre como `virtex_app`; prueba genérica que recorra todos los DTO con `*Id` intentando ids de otro tenant. Esfuerzo M–L.

## P2 — Lectura, comprobación y escritura sin bloqueo ni idempotencia en documentos con saldo (crítico)
- **Evidencia:** FLOW-01/PRC (recepciones concurrentes reciben de más, `purchase-orders.service.ts:401-430`); FLOW-02/COB-01 (cobros concurrentes aplicados dos veces, `customer-payments.service.ts:253-261`); INV-01 de facturación (emisión concurrente de un borrador consume 5 NCF de más, `invoices.service.ts:280-292`); FLOW-03/INV-03 (`POST /invoices` ignora la Idempotency-Key); asiento manual sin `@Idempotent`; AP-04 (pago sin bloqueo); GL-04 (período sin bloqueo al contabilizar o cerrar); REC-04 (cierre de conciliación sin transacción ni bloqueo); 11 de 15 servicios que contabilizan desde otros módulos sin clave de idempotencia (GL-09).
- **Contraejemplo dentro del mismo repo:** cuentas por pagar y notas de débito sí usan `pessimistic_write` y bloqueos asesores; la numeración de asientos y las NC usan índices únicos. El patrón correcto existe, pero no es una convención.
- **Corrección única:** regla de arquitectura «todo cambio de estado o de saldo de un documento se hace con `SELECT … FOR UPDATE` del documento (y de sus aplicaciones) dentro de la transacción»; decorador `@Idempotent` obligatorio en todo POST que cree documentos fiscales, cobros, pagos, recepciones o asientos; pruebas de concurrencia genéricas (N peticiones paralelas → un solo efecto). Esfuerzo M.

## P3 — Aritmética monetaria en coma flotante (crítico)
- **Evidencia:** `common/money.ts:77-84` (`toCents` multiplica antes de redondear), que hace fallar los empates (IMP-01/NUC-01, reproducido); la tasa de cambio redondeada a 2 decimales con tolerancia 0 hace fallar la facturación en moneda extranjera (FLOW-05b); el POS calcula el impuesto con su propia lógica (POS-02); hay columnas `numeric(12,2)` para acumulados.
- **Corrección única:** aritmética decimal exacta (enteros de unidades menores calculados a partir de cadenas decimales, o una librería decimal) en un único módulo `money` usado por todos los cálculos, incluido el POS; tasas con 6–10 decimales; ampliar las columnas monetarias a `numeric(19,4)` o similar. Esfuerzo M.

## P4 — Estados de documento que los lectores no contemplan (crítico)
- **Evidencia:** GL-01 (los lectores de saldos filtran solo `Posted` y el original modificado pasa a `Modified` mientras su reversión sí cuenta, así que todos los reportes, el cierre anual, los presupuestos y la contabilidad electrónica MX restan dos veces); el dashboard suma `Modified` y no cuadra con los reportes (DSH-01); al anular una factura de proveedor no se considera la nota de débito (AP-01); anular un cobro infla el saldo sin tope (FLOW-05/COB-02); deshacer una conciliación deja vivo el asiento categorizado (REC-05).
- **Causa:** no existe una función central «¿este documento cuenta para el saldo?» ni una máquina de estados declarada con sus efectos.
- **Corrección única:** una vista o función canónica de movimientos contables vigentes que usen todos los lectores; máquinas de estado explícitas por documento con transiciones y efectos compensatorios probados. Esfuerzo M.

## P5 — País piloto filtrado como regla implícita (crítico para la venta multi-país)
- **Evidencia:** el plan de cuentas DO se siembra en todos los países (COA-03); `default: 'DOP'` en las entidades de nómina y `?? 'DOP'` en los parámetros; una nómina MX puede forzar `countryCode: 'DO'` (NOM-02); campos DO en el esquema genérico (`vendor_bills.ncf_modified`, `isr_retention_type`); unos 15 `?? 'USD'` repartidos; textos de asientos fijos en español (TES-07); el seeder de desarrollo con `|| 'DO'`; países «disponibles» sin paquete fiscal (LOC-01).
- **Corrección única:** paquete de país como datos versionados (plan de cuentas, impuestos, documentos, nómina, reportes) con un validador que impida activar un país sin paquete completo; eliminar todos los fallbacks de moneda y país; bloquear la emisión en países sin paquete. Esfuerzo L–XL.

## P6 — Reglas como constantes sin vigencia
- **Evidencia:** tasas, catálogos y regímenes en TS sin `effective_from`; 7 tablas de plantillas vacías; dos fuentes de verdad por país (`country-profiles.ts` y `contracts/country-pack`); un salario mínimo cotizable de 2020 sin versión posterior (NOM-01); un catálogo `taxes` sin naturaleza, cuentas ni vigencia (IMP-04).
- **Corrección única:** un motor de reglas con tablas versionadas por jurisdicción y fecha, alimentado por un proceso de actualización normativa con responsable y alertas de caducidad. Esfuerzo L.

## P7 — Módulos fachada o esqueleto expuestos como producto
- **Evidencia:** manufactura (CRUD aislado: una orden COMPLETED no mueve el kardex ni contabiliza), WMS (landed costs que no se aplican, bins sin existencias), proyectos y servicio al cliente (sin UI, sin flujo), consolidación sin UI, portal de proveedores (tabla sin endpoints), marketplace de extensiones (nominal, con admisión autoafirmada), FICA/FUTA sembrados sin uso, listas de precios que ningún documento usa, `CostingMethod` y `TrackingMethod` como columnas sin lógica, e-factura de 7 países con *builders* sin conectar.
- **Riesgo:** superficie de ataque sin dueño (MFG-02, SCM-02 y PRJ-01 salen de aquí) y promesa comercial falsa.
- **Corrección única:** retirar del catálogo, de la API pública y del README todo lo que no esté completo (detrás de feature flag desactivado), o completarlo. Esfuerzo S para retirar.

## P8 — Fronteras de módulo erosionadas
- **Evidencia:** 1.344 violaciones medidas (501 importaciones de internos, 242 dependencias prohibidas, 14 ciclos de dominio, 103 transacciones compartidas, 29 entidades ajenas registradas); el trinquete falla en HEAD (inventario y organizaciones). Nómina lee tablas de tesorería y contabilidad por SQL directo; CxP escribe `purchase_order_lines`; `StockMovement` y `StockLevel` viven en `supply-chain`; permisos de RR.HH. definidos dentro de payroll.
- **Corrección:** puertos públicos por módulo (la carpeta `contracts/` ya existe) y prohibir importar entidades ajenas; reducir el baseline por sprint. Esfuerzo L, continuo.

## P9 — Verificación que no verifica lo que importa
- **Evidencia:** CI de `main` en rojo en los 6 últimos runs; compuertas propias fallando en HEAD; `form-a11y` y `required-markers` fuera de CI; 29 verificadores ad hoc en lugar de E2E de UI; pruebas de nómina con tasas inventadas (NOM-08); módulos sin specs (datasheets, customer-service); cobertura de ramas 56 %; `nx test api` sin BD omite el 20 % de los tests en silencio; ninguna prueba de concurrencia en documentos con saldo; los informes de remediación declaran «resuelto» lo que esta auditoría encontró abierto.
- **Corrección:** CI verde como condición de merge (protección de rama); pruebas de invariantes por dominio (partida doble, kardex = mayor, CxC = auxiliar, numeración) sobre datos reales; E2E de flujos críticos; pruebas de concurrencia y de aislamiento genéricas. Esfuerzo M.

## P10 — Operación en producción no diseñada
- **Evidencia:** limitador global de 20 req/min por IP; sin salud pública; sin correlación ni tenant en los logs; sin lock distribuido en cron; WebSocket en memoria; sin respaldo ni RPO/RTO; sin IaC ni Dockerfile de la API y el portal; escritorio sin firma ni actualización; contratos de paginación en 4 formas y listados sin límite (13,8 MB en `GET /customers`).
- **Corrección:** checklist de preparación operativa (salud, métricas, correlación, límites por usuario y tenant, locks, respaldo probado, imágenes reproducibles) como requisito de salida. Esfuerzo M–L.

## P11 — Rastro de auditoría incompleto
- **Evidencia:** autor e IP nulos en todo el rastro automático (AUD-01); `audit_logs` mutable; roles, permisos, impuestos, documentos, OC, recepciones y requisiciones sin rastro; `unmatch` de conciliación borra sin rastro.
- **Corrección:** registrar `RequestContextModule` (o propagar el actor explícitamente), tabla de auditoría *append-only* (sin UPDATE ni DELETE para el rol de la aplicación, o un trigger) y una lista declarativa de operaciones sensibles con prueba de cobertura. Esfuerzo S–M.
