# Qué le falta a Virteex para producción y venta en República Dominicana

**Fecha:** 2026-10-31
**Base:** rama de trabajo sobre `main` (último commit `495719fc`, 2026-10-30)
**Método:** lectura estática del código (backend, portal, POS, escritorio, CI y `docs/`), comparada
con lo que exige operar y vender un ERP/POS en RD. Actualiza `docs/ESTADO_MVP_REPUBLICA_DOMINICANA.md`
(2026-09-11), que ya quedó desfasado en varios puntos: la nómina existe y el RLS ahora se aplica.
No se ejecutaron pruebas en esta sesión. No es un dictamen fiscal ni legal: los requisitos de la
DGII, la TSS y la Ley 172-13 deben confirmarse con un contador y un abogado locales.

---

## 1. Veredicto

El núcleo está para producción: e-CF emisor, contabilidad de partida doble, CxC/CxP, inventario,
compras, tesorería con conciliación, nómina con TSS y regalía, multi-empresa con RLS, autenticación
endurecida y un CI que prueba contra Postgres y Redis reales.

**No está listo para vender todavía.** Hay cuatro bloqueantes duros:

1. **El POS no emite comprobante fiscal.** Una venta de caja genera un ticket interno, sin e-NCF,
   sin QR y sin envío a la DGII (`pos/pos.service.ts`, `apps/pos/src/app/domain/receipt.ts`). En RD
   el POS es la puerta de entrada del producto para comercios y colmados, y vender sin E32 es
   vender sin comprobante.
2. **Falta el lado receptor del e-CF.** Todo emisor electrónico tiene que recibir e-CF de sus
   proveedores por los servicios públicos que define la DGII (autenticación por semilla,
   recepción, acuse de recibo ARECF y aprobación comercial entrante). Hoy solo existe
   `POST einvoicing/received/approval`, autenticado, para que el usuario apruebe a mano. No hay
   endpoint público.
3. **No consta la certificación DGII** (set de pruebas TesteCF → CerteCF) con un certificado real.
   Sigue pendiente desde septiembre.
4. **No hay cómo cobrar la suscripción en RD ni facturarla con e-CF.** El cobro del SaaS va solo
   por Stripe (`payment/adapters/stripe-payment.adapter.ts`), que no abre cuentas de comercio a
   empresas dominicanas, y los planes tienen precio de vitrina en USD
   (`saas/entities/plan.entity.ts:29`). Además, Virteex, como empresa dominicana, tiene que emitir
   e-CF a sus propios clientes por la suscripción.

Después vienen las declaraciones DGII que faltan (IT-1, IR-17, IR-3), los procesos comerciales
básicos (pedido, conduce, factura recurrente) y la operación de producción (despliegue,
respaldos, monitoreo, soporte).

---

## 2. Lo que ya existe (inventario verificado)

| Área                                                                                                                                                                                                                                          | Estado                    | Evidencia                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| e-CF emisor (E31–E47, B01/B02/B04): firma XAdES, semilla/token, envío, E32 a Factura de Consumo, sondeo, conciliador, idempotencia por trackId, anulación de rangos, QR y código de seguridad                                                 | ✅ Completo               | `einvoicing/` (~9.000 LOC), `tools/verify/ecf-conformance.ts`           |
| Formatos 606/607/608/609 en TXT con `\|` y registro de presentaciones                                                                                                                                                                         | ✅                        | `compliance/reports/dr-reports.ts`, `fiscal-report-filings.service.ts`  |
| RNC/cédula con dígito verificador, ITBIS, retenciones ITBIS/ISR                                                                                                                                                                               | ✅                        | `localization/fiscal/`                                                  |
| Contabilidad: asientos, plantillas, recurrentes, cierres de período y de año, presupuestos, centros de costo, dimensiones, consolidación, intercompañía, activos fijos, multimoneda                                                           | ✅                        | `accounting`, `journal-entries`, `consolidation`, `fixed-assets`…       |
| Ventas: cotizaciones, facturas, NC/ND, listas de precios, cobros, anticipos, cobranza                                                                                                                                                         | ✅ Parcial                | `sales/` solo tiene `quotes`; ver §4                                    |
| Compras: requisiciones, órdenes, recepciones, facturas de proveedor, lotes de pago, portal de proveedores                                                                                                                                     | ✅                        | `procurement`, `accounts-payable`                                       |
| Inventario: almacenes, ubicaciones, movimientos, transferencias, ajustes, costos de importación (landed cost), WMS                                                                                                                            | ✅ Parcial                | sin lotes, series ni vencimientos                                       |
| Tesorería: bancos (catálogo DO), cuentas, transferencias, importación de extractos (CSV y formatos bancarios), conciliación con reglas y asistida por IA                                                                                      | ✅                        | `treasury`, `reconciliation`                                            |
| **Nómina RD**: conceptos, novedades, cálculo con SFS/AFP/SRL/INFOTEP, tabla ISR, horas extra, regalía pascual, prestaciones (preaviso, cesantía, vacaciones), contabilización, volante propio, novedades TSS, autodeterminación, archivo SUIR | ✅ Nuevo desde septiembre | `payroll/` (~4.400 LOC), `hcm/`                                         |
| POS separado: turnos, X/Z, arqueo, cobro mixto, anulación con supervisor, idempotencia                                                                                                                                                        | ✅ Sin e-CF               | `apps/pos`, `pos/`                                                      |
| Multi-empresa: RLS forzado y comprobado al arrancar, guard de CI para `find()` sin tenant, sucursales y acceso por sucursal                                                                                                                   | ✅                        | `shared/tenancy/tenant-isolation.check.ts`, `branch.entity.ts`          |
| Seguridad: Argon2, passkeys, 2FA, CSRF `__Host-`, step-up, revocación, auditoría                                                                                                                                                              | ✅                        | `auth/`, `audit/`                                                       |
| Plataforma: flujos de aprobación, motor de workflows, documentos, correo entrante, notificaciones, búsqueda global, importación/exportación de datos, BI, IA (copiloto, MCP, agentes), extensiones en sandbox, escritorio Electron, PWA       | ✅                        | varios                                                                  |
| Legal: páginas de términos, privacidad y seguridad versionadas, aceptación registrada                                                                                                                                                         | ✅ Estructura             | `legal/`, `legal_acceptances`; el texto lo tiene que revisar un abogado |

---

## 3. Bloqueantes para vender (P0)

### P0-1. e-CF desde el POS

- Al cerrar la venta, emitir un E32 (o un E31 si el cliente da RNC) usando el mismo pipeline de
  `einvoicing`: numeración, firma, envío al resumen de Factura de Consumo bajo el umbral, y de
  forma asíncrona para no frenar la caja.
- Imprimir en el ticket el e-NCF, el código de seguridad, el QR de timbre y la fecha de firma.
- **Contingencia.** Si no hay internet o la DGII no responde, la venta tiene que poder emitirse y
  transmitirse después. El POS de hoy solo _muestra_ que está sin conexión
  (`connectivity.service.ts`): no guarda ventas para enviarlas más tarde. Hace falta una cola local
  (IndexedDB) con reenvío idempotente; el `idempotency.ts` actual sirve de base.
- Las anulaciones de ventas ya emitidas tienen que salir como NC E34, no como un simple sello
  «anulado».
- Impresión térmica directa (ESC/POS de 58/80 mm, apertura de gaveta). Hoy se imprime con
  `window.print()` desde un iframe.

### P0-2. Receptor e-CF

- Endpoints públicos con el contrato de la DGII: semilla y validación de semilla del receptor,
  recepción del e-CF y respuesta con el ARECF firmado, y recepción de la aprobación comercial.
- Bandeja de «comprobantes recibidos» que cree el borrador de factura de proveedor con el NCF ya
  cargado para el 606, y que dispare la aprobación o el rechazo comercial (la lógica de
  `ecf-lifecycle.service.ts` ya existe).
- La URL del receptor tiene que estar registrada ante la DGII como parte de la certificación.

### P0-3. Certificación DGII

- Conseguir un certificado digital de un emisor piloto y correr el set de pruebas de TesteCF y
  CerteCF. Eso incluye las pruebas de receptor, así que depende de P0-2.
- Hacer el piloto con al menos un contribuyente real antes de abrir ventas.
- Decidir el modelo comercial: certificar cada cliente como emisor con su propio certificado (lo
  que el código soporta hoy con la bóveda por inquilino), o además registrar a Virteex como
  **proveedor de servicios de facturación electrónica** autorizado por la DGII, que es lo que un
  SaaS necesita para vender «facturación electrónica» como servicio y que trae obligaciones
  propias.

### P0-4. Cobro y facturación de la suscripción en RD

- Un adaptador de pasarela local (Azul, CardNet o similar) detrás de `PaymentGateway`, más
  transferencia o depósito con conciliación manual como alternativa.
- Precios en DOP y cálculo de ITBIS sobre la suscripción.
- Emitir el e-CF de Virteex hacia cada cliente. El propio sistema puede usarse para eso
  (dogfooding).
- Ciclo de vida de la suscripción: prueba, renovación, impago, suspensión con período de gracia y
  reactivación. Hay que revisar que `allow-inactive-subscription` y los planes cubran el impago
  real.

---

## 4. Brechas funcionales que el mercado dominicano va a pedir (P1)

### Fiscal y tributario

| Falta                                                             | Por qué                                                                                                                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IT-1** (declaración mensual de ITBIS)                           | Es la declaración que el contador presenta cada mes. Está listada en `country-profiles.ts:730`, pero no hay generador. Debería salir del 606/607 ya calculado. |
| **IR-17** (retenciones) e **IR-3** (retenciones a asalariados)    | Las retenciones ya se calculan (en facturas de proveedor y en nómina). Falta el reporte o declaración.                                                         |
| IR-2 / IR-1 anuales, anticipos, activos (ACT)                     | Útiles para el contador. Pueden ir en una fase posterior.                                                                                                      |
| Proporcionalidad del ITBIS y su conciliación entre 606/607 e IT-1 | Es un error frecuente en auditorías de la DGII.                                                                                                                |
| Validación de RNC contra el padrón DGII (nombre/razón social)     | Hoy solo se valida el dígito verificador. Autocompletar el nombre del cliente ahorra trabajo y errores.                                                        |

### Nómina y RR. HH.

| Falta                                                                         | Por qué                                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Validar el layout del archivo SUIR contra la especificación oficial de la TSS | El código lo deja aislado en `toSuirLine` y dice explícitamente que falta esta validación. |
| Archivo de pago de nómina por banco (Banreservas, Popular, BHD…)              | Así se paga la nómina en RD. Hoy no hay exportación bancaria ni en nómina ni en CxP.       |
| Solicitud y saldo de vacaciones, licencias y ausencias                        | Hoy las vacaciones solo aparecen dentro de la liquidación por prestaciones.                |
| Planillas del Ministerio de Trabajo (DGT-3, DGT-4)                            | Obligación anual o por cambios de personal.                                                |
| Asistencia y ponchado (opcional)                                              | Lo pide la PYME que paga horas extra.                                                      |

### Comercial y operación

| Falta                                                                 | Por qué                                                                                                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pedido de venta** y **conduce** (nota de entrega)                   | Hoy el flujo es cotización → factura. El distribuidor dominicano trabaja con pedido → conduce → factura, con despacho parcial. No hay entidades `sales_orders` ni de entrega. |
| **Facturación recurrente** (igualas, alquileres, servicios mensuales) | Solo hay asientos recurrentes. El segmento de servicios profesionales lo necesita.                                                                                            |
| **Lotes, series y fechas de vencimiento** en inventario               | Lo exigen farmacias, alimentos y repuestos. No existe en ninguna entidad de inventario.                                                                                       |
| Comisiones de vendedores                                              | Es habitual en distribución.                                                                                                                                                  |
| Cheques: impresión y control de chequeras                             | Todavía se usan mucho para pagar a proveedores en RD.                                                                                                                         |
| Envío de factura y estado de cuenta por WhatsApp                      | Es el canal real de cobro en RD. Hoy solo hay correo.                                                                                                                         |
| Portal del cliente (ver y descargar facturas, pagar)                  | Ya existe el de proveedores, falta el del cliente.                                                                                                                            |

---

## 5. Producción y operación (P0/P1 técnicos)

| Falta                               | Detalle                                                                                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Imagen y pipeline de despliegue** | Solo `apps/ai-engine` tiene Dockerfile. No hay imagen de la API, ni manifiesto de infraestructura, ni workflow de CD: CI construye y prueba, pero no despliega. `DEPLOYMENT.md` describe pasos manuales.                          |
| **Respaldos y recuperación**        | No hay política documentada (respaldo automático, PITR, restauración probada, RPO/RTO). En un ERP con contabilidad y comprobantes fiscales, que la DGII obliga a conservar 10 años, esto es obligatorio.                          |
| **Monitoreo y alertas**             | Hay `prom-client`, logs con pino y un `health` mínimo (50 LOC). Faltan rastreo de errores (Sentry o similar), tablero, alertas de colas BullMQ fallidas y alertas de **e-CF rechazados o pendientes**, que son la falla más cara. |
| Ambientes                           | Separar staging y producción. La configuración solo acepta `development`/`test`/`production`, y staging tendría que correr como `production` con sus propios secretos.                                                            |
| Pruebas de carga                    | No hay. Hay que medir, como mínimo, el cierre de mes y la hora pico del POS con varios inquilinos.                                                                                                                                |
| Escritorio                          | `electron-builder.json` no tiene firma de código ni auto-actualización. Sin eso, Windows SmartScreen bloquea el instalador.                                                                                                       |
| Residencia y latencia de datos      | Elegir una región cercana (us-east) y declararla en la política de privacidad.                                                                                                                                                    |

---

## 6. Legal, comercial y soporte (fuera del código, pero bloquean la venta)

- **Ley 172-13 (protección de datos personales):** revisar la política de privacidad, definir el
  procedimiento para atender solicitudes de los titulares, tener un acuerdo de tratamiento de datos
  (DPA) para clientes y decidir dónde se alojan los datos. La nómina guarda cédulas, salarios y
  cuentas bancarias.
- **Términos de servicio y SLA** revisados por un abogado dominicano. Incluir la responsabilidad
  sobre los comprobantes fiscales: quién responde si la DGII rechaza un e-CF.
- **Empresa operadora** con RNC, régimen fiscal y cuenta bancaria local para recibir los cobros
  (P0-4).
- **Soporte:** canal de soporte (WhatsApp Business y correo), base de conocimiento en español (el
  módulo `customer-service` tiene `knowledge_base_articles`, pero ~250 LOC), horario y escalamiento.
- **Onboarding:** un asistente de alta que deje al cliente facturando el primer día (certificado
  digital, rangos de e-NCF, plan de cuentas, saldos iniciales e importación de clientes, productos
  y saldos). La importación existe (`data-imports`), pero no como un recorrido guiado.
- **Material de venta:** página de precios en DOP, demo con datos de ejemplo
  (`tools/verify/demo-tenant.ts` sirve de base), y un programa para contadores, que en RD son el
  canal de distribución principal.

---

## 7. Hoja de ruta sugerida

| Fase                                          | Contenido                                                                                                                                | Salida                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **0 · Regulatorio** (en paralelo, empezar ya) | Certificado del piloto, receptor e-CF (P0-2), set de pruebas TesteCF/CerteCF (P0-3), decisión sobre proveedor de servicios autorizado    | Un e-CF emitido **y otro recibido** aceptados en CerteCF            |
| **1 · POS fiscal**                            | P0-1 completo, con contingencia sin conexión e impresión térmica                                                                         | Una venta de caja con E32 válido, también tras un corte de internet |
| **2 · Producción**                            | Imagen y CD, staging, respaldos con restauración probada, monitoreo y alertas fiscales, pruebas de carga                                 | Un despliegue reproducible y una restauración probada               |
| **3 · Comercialización**                      | P0-4 (pasarela local, DOP, e-CF propio), términos, privacidad y SLA, onboarding guiado, soporte                                          | Primer cliente de pago cobrado y facturado en RD                    |
| **4 · Contador**                              | IT-1, IR-17, IR-3, validación SUIR, archivo de pago bancario, padrón RNC                                                                 | Un contador cierra el mes completo sin salir del sistema            |
| **5 · Verticales**                            | Pedido y conduce, facturación recurrente, lotes/series/vencimientos, comisiones, cheques, WhatsApp, portal del cliente, vacaciones y DGT | Cobertura de distribución, farmacia y servicios                     |

Las fases 0 a 3 son el mínimo para empezar a cobrar. La 4 es lo que convence al contador, que es
quien recomienda el sistema. La 5 abre segmentos.

---

## 8. Estado tras la implementación (2026-10-31)

| Brecha | Estado | Dónde |
|---|---|---|
| P0-1 e-CF desde el POS | ✅ E32/E31 por venta, cobro y asiento, E34 al anular, ticket con e-NCF, código de seguridad y QR, contingencia sin conexión | `pos/pos-fiscal.service.ts`, `apps/pos`, `verify:pos-fiscal` |
| P0-2 Receptor e-CF | ✅ Semilla/token, recepción con ARECF firmado, ACECF entrante, bandeja «Comprobantes recibidos» | `einvoicing/ecf-receptor.controller.ts`, `docs/RECEPCION_ECF.md`, `verify:ecf-receptor` |
| P0-3 Certificación DGII | ⏳ Trámite: el código está listo; falta el certificado real y el set de pruebas | — |
| P0-4 Cobro en RD | ✅ Azul (Página de Pagos + DataVault), precios en DOP con ITBIS, renovación, e-CF propio por cobro | `payment/adapters/azul-payment.adapter.ts`, `verify:platform-billing` |
| IT-1, IR-17, IR-3 | ✅ Calculados casilla por casilla y descargables | `compliance/reports/dr-declarations.ts`, `payroll-declarations.service.ts` |
| Fix 607/608 con notas de crédito | ✅ La factura anulada por NC sigue en el 607; el 608 declara las anulaciones ANECF | `dr-reports.ts` |
| Archivo de pago de nómina por banco | ✅ GENERIC/BANRESERVAS/POPULAR/BHD (validar plantilla con cada banco) | `GET /payroll/runs/:id/bank-file` |
| Vacaciones y licencias | ✅ API (arts. 177 y 180) · ⏳ pantalla en el portal | `payroll/services/leave.service.ts` |
| Despliegue, respaldos, salud, alertas | ✅ | `deploy/`, `docs/DEPLOYMENT.md §0` |
| Pedido/conduce, facturación recurrente, lotes/series, comisiones, cheques, WhatsApp, portal del cliente, DGT-3/4 | ⏳ Pendiente (fase 5) | — |
| Legal (Ley 172-13, términos, SLA), soporte, onboarding guiado | ⏳ Fuera del código | — |
