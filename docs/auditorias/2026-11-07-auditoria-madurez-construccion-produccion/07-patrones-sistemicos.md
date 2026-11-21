# 07 — Patrones sistémicos

Problemas que se repiten en varios módulos. Cada uno apunta a una convención o a un proceso que falta, y se corrige una vez con una regla, un verificador en CI o una pieza de plataforma, no módulo por módulo. Están ordenados por impacto.

## SP-01 · Construido pero no conectado (la causa más frecuente de "funcionalidad falsa")

Código real, con pruebas, que ningún flujo de usuario invoca. Desde fuera el usuario ve la promesa; por dentro no ocurre nada.

| Caso | Evidencia |
|---|---|
| Regímenes de factura electrónica CFDI, DIAN, SUNAT, SRI, SII, NF-e y AFIP | `FiscalRegimeRegistry` sin consumidor fuera de `einvoicing.module.ts` (FAC-EINV-01, verificado) |
| Estados comparativos | `comparative-reporting.service.ts` no está en `providers` ni tiene ruta (FIN-FR-01) |
| Revaluación cambiaria | Sin forma de dar moneda a una cuenta: 0 de 1.240 cuentas con moneda, y el cierre la marca "hecha" (FINB-01, FIN-AC-03) |
| Listas de precios | No se aplican en factura, cotización ni POS (FAC-PL-01) |
| Landed cost y bins | CRUD que ningún proceso consume (CMP-21, INV-23) |
| Consolidación, intercompañía, manufactura, proyectos, customer-service | Backend sin pantalla ni menú (INVT-01); manufactura completa órdenes sin mover inventario (INV-20) |
| Vista `sales_cube_view` | La borró una migración y nunca se recreó; `GET /bi/sales` da 500 (IA-B05) |
| `/metrics` | Inaccesible incluso para el administrador (PLT-OBS-01) |

**Corrección única**: una regla de revisión y un verificador en CI de "capacidad declarada = capacidad alcanzable". Cada entrada de `fiscal-coverage.ts`, cada opción de menú y cada servicio `@Injectable` con lógica de dominio debe tener un camino de invocación desde un controlador o un job, probado por una prueba de integración del flujo. Lo que no lo tenga se retira o se declara `not-implemented`.

## SP-02 · La República Dominicana como regla implícita

DO es el piloto y sus reglas se filtran a mercados que no las tienen.

- El plan de cuentas de todos los países hispanos trae AFP/SFS/TSS, INFOTEP, Propina Legal e ISC (`coa-builder.ts:152,367-393`; FIN-COA-03, LOC-02, verificado en BD de qa-mx-a).
- Brasil pide "série B/E" (NCF) en el formulario de factura (LOC-03).
- La nómina "genérica" está modelada sobre la TSS: campos afp, sfs, srl, infotep (JUR-01).
- El catálogo base en español usa "ITBIS" y "RNC", e incluso aparece "RNC" en en/pt (LOC-04, I18N-02).
- La validación de identificadores rechaza un RNC sin tipo como "Cédula" (CMP-16).

**Corrección única**: el catálogo base (plan de cuentas, términos, campos) debe ser neutro, y lo dominicano debe ser un paquete de país como cualquier otro. Añadir un verificador que falle si un texto o un código de cuenta con vocabulario de un país aparece en el aprovisionamiento de otro. `verify:markets` ya aprovisiona los 19 mercados: hay que añadirle aserciones de contenido, no solo de cantidad.

## SP-03 · Reglas fiscales y laborales como código, sin vigencia

- Las tasas de IVA/ITBIS/IGV de 19 países son constantes en `country-tax-schemes.ts`. La tabla `taxes` no tiene `effective_from/to` (LOC-06, FAC-TX-03).
- Los regímenes de retención DO están en código, sin vigencia (CMP-05).
- Contraejemplo dentro del propio repo: las tablas `payroll_statutory_references` y `tax_jurisdictions` (US) sí tienen vigencia. Pero el histórico sembrado en nómina es incorrecto (NOM-02) y lo consagra una prueba (`dominican-statutory-data.spec.ts:29`).

**Corrección única**: un modelo de reglas por jurisdicción con vigencia (tasa, base, tope, desde/hasta, fuente oficial). Toda regla se lee de él en la fecha del documento, nunca "la actual". Las pruebas de los valores deben citar la fuente oficial y la fecha de publicación, en lugar de copiar lo sembrado.

## SP-04 · El servidor confía en valores calculables que envía el cliente

| Valor aceptado sin recalcular | Caso |
|---|---|
| ITBIS de factura de proveedor | 900 sobre 1.000 aceptado y cargado a deducible (CMP-02) |
| Tasa e importe en divisa por línea de asiento | 1 USD a 999 = 100 DOP (FIN-JE-01) |
| Impuesto de venta "Fijo 50" | Tratado como ITBIS 50 % (FAC-TX-01) |
| Deducción de nómina negativa | Sube el neto sin pasar por ISR ni TSS (NOM-03) |
| Tasa de novedad sobre el límite del concepto | Comisión de 3.000.000 (NOM-05) |
| `taxWithheld` en US | Se guarda 0 en silencio (CMP-24) |
| `totalBilled` del cliente | Escribible por API (TES-11) |

**Corrección única**: una convención de dominio. Todo importe derivado (impuesto, retención, contravalor, neto) se calcula en el servidor a partir de entradas primarias. Si el cliente lo envía, el servidor compara con tolerancia y rechaza o marca la diferencia; nunca lo persiste tal cual. Se verifica con pruebas de propiedad por cálculo.

## SP-05 · Validación de entrada sin DTO o con DTO laxo, y errores de dominio que salen como 500

- Endpoints sin clase DTO, donde la whitelist global no actúa: `push-notifications.controller.ts:22-31` permitió una **escritura entre tenants** (PLT-NOT-01, crítico verificado). `datasheets` acepta `Partial<entidad>` (PLTB-DS-02). Cuatro rutas de auth sustituyen el `ValidationPipe` global (IAM-A2).
- Errores de dominio convertidos en 500:
  - límite del plan SaaS (FAC-INV-01, PLT-DT-01);
  - cupo de facturas con la transacción abortada por atrapar el 23505;
  - cantidad en notación científica (CMP-06);
  - fecha 2026-02-30 (FINB-14);
  - enum inválido o id malformado (PLTB-DS-01/02);
  - extracto de 20.000 líneas que supera los parámetros de Postgres (TES-03).

**Corrección única**:
- Regla de lint o verificador: ningún `@Body()` sin clase DTO y ningún `@UsePipes(new ValidationPipe())` local.
- `ParseUUIDPipe` obligatorio en todo `:id`.
- Un filtro de excepciones que trate cualquier `QueryFailedError` no mapeado como defecto con alerta.
- Los límites de negocio, como el plan SaaS, se lanzan como errores de dominio (403/409/422), nunca dentro de una transacción ya abierta.

## SP-06 · Aislamiento entre inquilinos que depende de la memoria del desarrollador

Los mecanismos son de primer nivel: guard global deny-by-default, RLS con verificadores en CI y un trigger de mismo inquilino en las FKs. Pero no cubren lo que queda fuera de su modelo:

- tablas de datos de usuario sin `organization_id`, como `push_subscription`, con 0 políticas;
- una FK sin guarda (`customer_portal_accounts.customer_id`; la prueba existe y está en rojo);
- un empleado vinculable a un usuario de otro inquilino (NOM-22);
- una cuenta de gasto ajena aceptada en un borrador de factura de proveedor (CMP-25).

En este entorno la API corre como superusuario y RLS no aplica. En producción el arranque lo impide (`tenant-isolation.check.ts`, IAM), y eso es correcto.

**Corrección única**: `verify:rls` debe exigir que toda tabla con FK a `users` u `organizations` tenga columna de inquilino y política, o una exención documentada. `same-tenant-references.spec.ts` debe bloquear el merge (hoy está en rojo y se fusionó igual).

## SP-07 · Concurrencia tratada caso por caso

Donde se pensó, está bien resuelto y verificado en vivo:
- pagos a proveedor y cobros (`FOR UPDATE`);
- salidas de stock (sin sobreventa con 20 concurrentes);
- numeración de asientos y NCF;
- idempotencia por `Idempotency-Key`;
- conversión de cotización a factura.

Donde no se pensó, se rompe:
- doble aprobación concurrente que puede contabilizar dos veces (PLTB-WF-02, verificado);
- carrera calcular/aprobar en nómina (NOM-04);
- presupuesto de IA sobrepasable (IA-07);
- unicidad del NCF de proveedor solo con un lock de aplicación (CMP-04);
- consumo de anticipos (TES-18).

**Corrección única**: una regla de construcción. Toda transición de estado de un documento financiero se hace con `UPDATE … WHERE status = :esperado` (o un lock pesimista) dentro de la transacción y comprueba las filas afectadas. Toda unicidad de negocio lleva un índice único en BD. Hacen falta pruebas de concurrencia en las transiciones que contabilizan.

## SP-08 · Fronteras de módulo erosionadas

- `tools/verify/module-boundaries.mjs`: **1.237 violaciones**, entre ellas 492 imports de internos ajenos, 108 transacciones que abarcan tablas de otro módulo, 29 registros de entidades ajenas y 14 ciclos entre agrupaciones.
- El trinquete solo impide que suban; el ritmo de bajada es de 2 en el último periodo.
- Ejemplos funcionales:
  - customers escribe directamente en `invoices` (TES-14);
  - las entidades de stock están dentro de supply-chain (CMP-22);
  - `shared/common` importa identidad, organizaciones, localización y seis dominios (PLT-SH-01).

**Corrección**: dentro del monolito modular, cada módulo debe exponer una fachada pública (puerto) y se debe prohibir importar sus internos. El verificador debe pasar de trinquete a meta con fecha por agrupación, empezando por los ciclos (14) y las transacciones cruzadas (108), que son los que impiden razonar sobre la integridad.

## SP-09 · Auditoría de negocio con agujeros sistemáticos

- `audit_logs` es append-only, con trigger y REVOKE verificados.
- El subscriber solo ve `save()`: las transiciones hechas con `repository.update()` no quedan registradas. Ejemplo: una cotización en INVOICED con traza solo de `CREATE:DRAFT` (PLT-AUD-01).
- No se auditan usuarios, roles ni membresías (PLT-AUD-02).
- Tampoco se auditan las tasas de cambio, los presupuestos ni la publicación o revocación de extensiones (FINB-05/24, PLTB-EXT-02).
- La auditoría guarda cédula y NSS en claro (NOM-20).
- Una consulta de balanza escribe una fila READ por petición (PLTA): ruido sin valor.

**Corrección única**: auditar en la capa de dominio con un evento por transición, no en el ORM. Hace falta una lista explícita de operaciones sensibles con su prueba de "deja traza", y el enmascarado de los campos cifrados antes de auditarlos.

## SP-10 · Procesos pesados síncronos y listados sin límite

- La importación masiva es síncrona, con un máximo de 5.000 filas (PLT-DT-02).
- La importación de extractos es síncrona: 5.000 filas tardan 11 s y 20.000 fallan (TES-03).
- `applyRules` tiene N+1 (TES-05).
- `GET /accounts-payable` no está paginado (CMP-07).
- La UI de conciliación pinta 7.000 filas sin paginar.
- La vista analítica es global y de refresco completo (FIN-AR-02).

**Corrección única**:
- Paginación obligatoria con un tope en el contrato de API, verificada por un test genérico sobre todos los `@Get()` de listado.
- Todo proceso de más de N filas debe ir a la cola BullMQ que ya existe, con estado consultable e idempotencia.

## SP-11 · Capacidades básicas detrás de funciones de pago, y menú que ofrece lo que el plan no incluye

- La cobranza básica requiere la función de IA `ai_collections` (TES-13).
- El menú ofrece funciones de IA, consolidación e informes que el plan Starter no tiene, y cada página dispara 403 (IA-01/02).
- Que un recurso no declarado en un plan cuente como ilimitado (IAM-P4) es la regla opuesta, que tampoco es segura.

**Corrección**: separar en `saas.config` las capacidades básicas de las diferenciadoras. El menú debe filtrarse por plan, y no solo por permiso.

## SP-12 · Proceso de entrega: se fusiona con la rama en rojo

- La rama principal falla en typecheck y en tres suites de api (`03-resultados-de-ejecucion.md`).
- Dos de esos fallos son las pruebas de los dos últimos arreglos de seguridad fusionados: portal de cliente CS-01 y cadena de confianza e-CF EINV-03. Es decir, se fusionaron cambios cuyas pruebas nunca pasaron.

Además:
- `verify:invoicing`, que corre en CI, contacta el servicio real de la DGII (FAC-EINV-02).
- Los crons de reintento e-CF corren en todo entorno sin gating (PLTA).
- Ese contacto con la DGII se repitió en esta misma auditoría al ejecutarlo.

**Corrección**:
- Protección de rama: CI verde obligatorio antes de fusionar (ver `modulos/ci-cd-infra.md`).
- Los efectos externos (autoridades fiscales, pasarelas, correo) detrás de un único interruptor por entorno, apagado por defecto fuera de producción, con dobles de transporte para las pruebas.

## SP-13 · Comentarios como fuente de verdad

El código está muy comentado con la historia de cada corrección: "audit 2026-10-31, LOC-01", "H-03 FIX", y otras. Es útil como contexto, pero varias fichas encontraron comentarios que prometen más de lo que el código cumple:

- `data-transfer.service.ts` dice "todo o nada" y no se cumple (PLT-DT-01);
- `fiscal-coverage.ts` define `needs-credentials` como "construido y probado", y los adaptadores no están conectados.

El propio CI tiene un comentario que reconoce este riesgo. **Corrección**: las afirmaciones de comportamiento van en pruebas o verificadores, no en comentarios. Lo que un comentario promete y ninguna prueba fija debe considerarse no verificado.
