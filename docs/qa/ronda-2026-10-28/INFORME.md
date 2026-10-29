# Informe de pruebas E2E exploratorias — Virtex ERP · Ronda 2026-10-28

**Fecha:** 28/29-10-2026 · **Rama:** `ccr-70984013-xq4s0b` (base `b9af36ff`, 218 commits después de la ronda anterior) · **Rol:** QA E2E exploratorio (uso real de la aplicación en navegador; el código solo se consultó para confirmar la causa de un síntoma ya observado).
**Archivos:** [`MATRIZ_COBERTURA.md`](MATRIZ_COBERTURA.md) (cada elemento por página) · [`PROGRESO.md`](PROGRESO.md) (bitácora de la sesión, más detalle por paso) · [`harness/`](harness/) (scripts Playwright reproducibles) · [`evidence/`](evidence/) (capturas citadas) · ronda anterior: [`../INFORME.md`](../INFORME.md).

---

## 1. Resumen ejecutivo

Desde la ronda anterior (28-09) la aplicación dio un salto grande. **De los 9 defectos críticos previos, 8 están corregidos y 1 parcialmente** (POS): ya renderizan todas las páginas, F5 funciona, se crean clientes y proveedores, hay asientos manuales, cierre de período con confirmación, la recepción de compras mueve stock y contabiliza, borrar maestros con documentos está bloqueado, y la nómina se paga. Ajustes ya no tiene secciones "en desarrollo", desaparecieron las pantallas mock (importar/exportar reales) y se agregaron cotizaciones, inventario multi-almacén, activos fijos, presupuestos, aprobaciones con bandeja, app POS separada, riel de módulos con favoritos y menú contextual.

Quedan **2 críticos nuevos** y varios altos, concentrados en las **costuras entre módulos**:

- **Ninguna factura emitida se puede anular ni corregir con nota de crédito**: ambos botones fallan con 400 porque la UI no envía `invoiceId`.
- **Las ventas del POS no llegan a contabilidad**: mueven stock pero no generan ingreso, ITBIS, caja ni costo (ni al vender ni al cerrar el turno Z), y no consumen NCF. Balanza, estado de resultados, presupuesto y 607 las ignoran.
- Además: asientos con fecha futura crean años completos de períodos en silencio; modificar un asiento no corrige nada; el 606 queda bloqueado por una factura de proveedor aceptada sin NCF; la importación de estados bancarios falla; DataSheets no dibuja la cuadrícula; los formularios de pago leen saldo bancario RD$0.00; el step-up sigue bloqueando a usuarios en uso normal; y todo usuario invitado aterriza en "Acceso denegado".

| Severidad | Nº (nuevos o persistentes) |
|---|---|
| Crítica | 2 |
| Alta | 11 |
| Media | 15 |
| Baja | 10 (agrupan ~25 detalles) |

**Re-verificación de la ronda anterior (45 hallazgos):** 30 corregidos · 11 parcialmente · 3 persisten · 1 no re-verificado (§4).

**Cobertura:** 119/119 rutas sin parámetro inventariadas en estado vacío y recorridas con datos; 28/28 secciones de Ajustes; 1,592 interacciones en la matriz (1,373 ok · 7 con falla · 212 no probadas con razón · 90 %); ~70 flujos guiados con 4 roles; app POS completa (§8).

---

## 2. Entorno y condiciones

- **Entorno:** local de desarrollo (nunca producción), igual que la ronda anterior: Postgres 16 + Redis 7 nativos, `npm ci` + `npm run migration:run`, API NestJS :3000 (`DEV_SEED=true`), cliente Angular :4200, POS :4300. Chromium headless (Playwright).
- **Usuarios:** `dev@virtex.local` (admin sembrado, empresa "Virtex Dev", DO) y cuatro invitados activados en la sesión: `qa3-admin2` (Administrador), `qa3-vendedor` (Vendedor), `qa3-contador` (Contador), `qa3-miembro` (Miembro).
- **Datos:** todo lo creado lleva prefijo **QA3-** con valores no adivinables (p. ej. `QA3-7734-Widget ergonómico`, `QA3-8812-Comercial Ñandú SRL`, `QA3-JE-2290`), y se rastreó en listas, detalles, reportes, exportaciones y en la base.
- **Efectos externos:** ninguno. Sin SMTP la API guarda cada correo en `tmp/mail-outbox/` (se usó como buzón de prueba para leer invitaciones y la factura enviada). Sin certificado DGII, sin Stripe, sin proveedor de IA.
- **Incidencias del entorno:** el contenedor se reinició dos veces durante la sesión; se relevantaron los servicios sobre la misma base (datos intactos) y la pasada automática se reanudó donde quedó. Google (reCAPTCHA, fuentes) no es alcanzable: la app degrada sola.
- **Cambios de la pasada automática sobre datos no-QA (revertidos):** retiró la categoría preexistente "General", cambió el almacén predeterminado y activó "Confirmar automáticamente" en conciliación. Los tres se restauraron desde la UI y se verificaron.
- **Throttling:** entre scripts se limpiaron los contadores de step-up/throttler en el Redis local (`harness/reset-throttle.sh`), siempre **después** de registrar el hallazgo R3-A08.

---

## 3. Hallazgos

Formato: **Módulo y flujo · Categoría · Severidad**, pasos, esperado vs real, evidencia (capturas en `evidence/`, scripts en `harness/`).

### 3.1 Críticos

#### R3-C01 · Ventas — una factura emitida no se puede anular ni corregir
- **Categoría:** desconexión frontend-backend · **Severidad:** crítica
- **Pasos:** Facturas → FAC-00000002 (B0200000001) → "Anular" → motivo → Anular. Repetir con "Nota de crédito" → cantidad 1 → motivo → "Emitir nota de crédito".
- **Esperado:** nota de crédito B04/E34 y reversión de stock y asientos. **Real:** ambas vías → `POST /invoices/:id/credit-note → 400 VALIDATION_FAILED {invoiceId: is_defined}`; la UI muestra "invoice es obligatorio." Ningún comprobante emitido puede corregirse; el único camino de corrección fiscal está roto (con rangos B04/E34 vigentes).
- **Evidencia:** `anul-Anular-1.png`, `nc-1.png`, `harness/54-anular.cjs`, `55-nc.cjs`.

#### R3-C02 · POS → Contabilidad/Fiscal — las ventas del punto de venta no se contabilizan
- **Categoría:** flujo cruzado / desconexión · **Severidad:** crítica
- **Pasos:** POS (:4300) → abrir turno (fondo 2,000) → vender en efectivo, tarjeta, transferencia y mixto → anular una → cerrar turno con arqueo (Reporte Z). Revisar asientos, Balanza, ER, Presupuesto vs real y 607.
- **Esperado:** asiento por venta o por cierre de turno (Caja/Bancos, Ingresos, ITBIS, Costo/Inventario) y comprobante fiscal (B02/E32). **Real:** el stock baja (42→38, `SALE_DISPATCH` con referencia "POS main") pero **no existe ningún asiento**: Ingresos por ventas = 3,500 (solo las 2 facturas), faltan 3,750 de ventas + 675 de ITBIS + ~2,085 de costo. El ticket se identifica con un prefijo de UUID (`21B77C37`), sin NCF; el 607 no las incluye. Inventario físico y mayor quedan descuadrados.
- **Evidencia:** `posc-z.png`, `rep-reports_financial-statements_trial-balance.png`, `pre-3-variacion.png`, `fr-607.png`, `harness/61b-pos-cobro.cjs`, `62-pos-turno.cjs`, `63-pos-cierre.cjs`.

### 3.2 Altos

| ID | Módulo / flujo | Cat. | Pasos → esperado vs real | Evidencia |
|---|---|---|---|---|
| R3-A01 | Contabilidad / asiento manual | bug | Nuevo asiento con fecha **01/05/2031** → Guardar. Esperado: rechazo o advertencia (la ronda anterior respondía 403). Real: 201, contabilizado como GENERAL-**2031**-000001 y el sistema **crea en silencio los 12 períodos de 2031 abiertos**; aparecen en Períodos y en el asistente de cierre. | `je-4-fecha-futura.png`, `30-asiento.cjs` |
| R3-A02 | Contabilidad / modificar asiento | bug (integridad) | Abrir GENERAL-2031-000001 → fecha 28/10/2026 + razón → Guardar. Esperado: el asiento queda en 2026. Real: el original sigue en 2031 ("Modified") y **la reversión se fecha en 2026** junto al nuevo, así que en 2026 se anulan entre sí: Bancos 2026 = 50,354 (esperado 48,854) y 2031 conserva el cargo. La corrección no corrige. | `jem-2-con-razon.png`, `31-asiento-mod.cjs` |
| R3-A03 | Compras / lista de proveedores | desconexión | Crear proveedor (mínimo y completo) → Proveedores. Real: la columna **"Nombre de la empresa" vacía** en todas las filas; el proveedor mínimo es una fila en blanco (la lista lee `companyName`, la API devuelve `name`). Las OC sí encuentran el nombre. | `com-sup-4-completo.png` |
| R3-A04 | Compras → Fiscal (606) | bug (fiscal) | Factura de proveedor desde la OC **sin NCF** → se acepta y contabiliza tomando 468 de ITBIS como crédito fiscal. Nota de débito con NCF B04 sobre ella. Declaraciones › 606 octubre → `422`: "1 nota(s) de crédito de proveedor con NCF modifican una factura sin NCF… Registra el NCF de la factura". La factura contabilizada **no permite editar el NCF** → 606 de octubre bloqueado sin salida. Terminología: la UI dice "Nota de débito", el error "nota de crédito de proveedor". | `fr-606.png`, `26-factura-prov.cjs`, `80-fiscal-returns.cjs` |
| R3-A05 | Tesorería / conciliación | bug | Importar estado de cuenta → cuenta QA3-6620 → CSV (columnas entradas/salidas, o monto con signo) → fechas y saldos → Importar. El mapeo y la vista previa funcionan, pero `POST /reconciliation/statements → 400 BAD_REQUEST` genérico; UI: "No se pudo leer el archivo: No pudimos completar la operación. Vuelve a intentarlo." El aviso "Selecciona el archivo" sigue visible tras elegirlo. | `rec-5-fechas-saldos.png`, `81-conciliacion.cjs` |
| R3-A06 | Análisis / DataSheets | estilo/bug | DataSheets → Nuevo libro. Real: **la cuadrícula no se dibuja** (área en blanco) y el panel Propiedades/Importar/Gráficos aparece como HTML sin estilos (botones nativos, cajas vacías). El editor es inutilizable. | `ds-nuevo.png`, `ds-importado.png` |
| R3-A07 | Tesorería / pagos (proveedores y nómina) | bug | Pagar factura de proveedor o "Marcar como pagada" una nómina con el banco QA3-6620 (saldo real RD$50,354 visible en Posición de efectivo). Real: el selector muestra **RD$0.00** y el diálogo afirma "La cuenta tiene RD$0.00 y quedará en −RD$2,301.00": aviso de sobregiro falso en cada pago. | `ndp-pg-4-registrar.png`, `noma-Marcar como pagada-qa3-admin2.png` |
| R3-A08 | Seguridad / step-up (persiste A-02) | bug/UX | Admin2, sin ningún error de contraseña: abrir nómina, aprobar, abrir otra vez, pagar (~6 confirmaciones correctas en 3 min). Real: "Demasiados intentos. Tu cuenta ha sido bloqueada temporalmente por seguridad." Cada acción protegida hace antes un 401 `invalid_step_up_token_scope`. | `43-nom-pagar.cjs` (salida en PROGRESO) |
| R3-A09 | Usuarios / activación (persiste M-02) | bug | Invitar 4 usuarios → abrir el enlace del buzón → contraseña válida → Guardar. Real: los 4, **incluido el Administrador**, aterrizan en "Acceso denegado" (`/unauthorized`). La primera experiencia de cada usuario nuevo es un error. | `act-qa3-admin2.png`, `51-activar.cjs` |
| R3-A10 | Compras → Inventario / nota de débito | flujo cruzado | ND-2026-000001 por 1 unidad devuelta con contrapartida 1140 Inventarios. Real: asiento correcto pero **sin movimiento de existencias** (42 uds): Balance general Inventarios 28,550 vs Existencias 29,200 (diferencia exacta 650). | `rep-inventory_stock.png`, `rep-reports_financial-statements_balance-sheet.png` |
| R3-A11 | Fiscal / emisión | bug (fiscal) | La empresa sembrada no tiene RNC. Emitir B01/B02 → el sistema lo permite: PDF con "RNC:" vacío y encabezado del 607 sin RNC del emisor. Debería bloquear la emisión (el checklist fiscal sí lista otros requisitos). | `fac-4-emitir-rnc.png`, `fr-607.png` (PDF y 607 transcritos en PROGRESO) |

### 3.3 Medios

| ID | Módulo / flujo | Cat. | Descripción (pasos → real) |
|---|---|---|---|
| R3-M01 | Ventas / detalle de factura | bug | FAC-00000001: 2 × 1,250 con 10 % de descuento. La línea muestra **Total 2,905.00** (ignora el descuento) y el documento TOTAL 2,655.00. El PDF y el asiento sí son correctos (`facmas-B_squeda_sobre_documento.png`). |
| R3-M02 | Transversal / fechas | bug | "Hoy" no coincide entre pantallas: inventario inicial, saldo de apertura bancaria, recibos, ajustes y el CSV de POS usan la fecha **UTC (29/10)**, mientras factura y kárdex usan la hora de RD (28/10). A fin de mes moverá documentos al período siguiente. El pago de nómina se fecha al **31/10** (fin de período), no al día real del pago. |
| R3-M03 | Ajustes / fiscal | AI/consistencia | "Facturación electrónica" dice "Este producto no implementa un régimen de facturación electrónica para tu país", mientras "Comprobantes fiscales (RD · DGII)" ofrece e-CF y certificado. Los errores de factura remiten a "Ajustes → Facturación Electrónica" (la sección equivocada). |
| R3-M04 | Permisos / UI | permisos | El Vendedor ve "Anular" y "Nota de crédito" (→ 403 al usarlos). Vendedor: `GET /treasury/payment-methods → 403` al crear factura. Contador: `GET /dimensions → 403` al abrir Nuevo asiento y el Balance general. El backend sí aplica permisos (§6). |
| R3-M05 | i18n | idioma/clave | Claves crudas: «Product id» es obligatorio, «Account id» es obligatorio, "validation.fields.email no es un correo…", "validation.fields.phone…"; roles en la lista de usuarios ADMINISTRATOR/SELLER/ACCOUNTANT/MEMBER (el selector los muestra en español); Tickets POS con método `mixed/transfer/card/cash`; exportaciones con `ASSET`, `CURRENT_ASSET`, `DEBIT`, `Posted`, `Draft`, `Pending`; "Cliente general" (ERP) vs "Consumidor final" (POS). |
| R3-M06 | Controles internos (persiste M-08) | seguridad | Quien crea una OC la aprueba (sin SoD). En nómina la SoD existe, pero pide primero la contraseña de step-up y solo después dice "Quien aprueba la nómina no puede ser quien la calculó". |
| R3-M07 | Compras / requisición | bug (flujo) | REQ-2026-000001 aprobada (desde la bandeja). El ciclo de vida muestra "Convertida en orden" como siguiente etapa, pero el documento **no ofrece ninguna acción** para convertirla. |
| R3-M08 | IA / análisis | UX | Predicciones y Flujo de caja proyectado: "Recalcular" → 202 → "Calculando…" indefinido (los trabajos esperan al servicio `apps/ai-engine`, no documentado en "Ejecutar en local"), mientras Ajustes › IA dice "Disponible". Informe del gerente: "falló · Vuelve a intentarlo" y "Redactar con IA": "inténtalo de nuevo", cuando la causa es que la IA no está configurada (reintentar no sirve). El copiloto sí lo explica bien. |
| R3-M09 | Notificaciones (persiste B-02) | flujo cruzado | La campana dice "No hay notificaciones" pese a aprobaciones pendientes, nómina aprobada/pagada, invitaciones y facturas vencidas. |
| R3-M10 | Monedas / tipos de cambio | bug | "Importar" y "Registrar tasa" no hacen nada (ni red, ni diálogo, ni cambio). |
| R3-M11 | Contabilidad / asistente de cierre | bug | En "Cierre de período", los enlaces "Resolver" de los pasos pendientes llevan a **Inicio** en lugar del paso a resolver. |
| R3-M12 | RR.HH. / departamentos | validación | Se acepta un departamento duplicado (mismo nombre y centro de costo): quedan dos "QA3-1180-Operaciones". |
| R3-M13 | Análisis / mapa de relaciones | bug | Buscar por e-NCF "B0100000001" → "Ningún documento coincide" (por FAC-00000001 sí). El resultado muestra estado "Cerrado" para una factura "Cobrada". |
| R3-M14 | Contabilidad / activos fijos | UX | La depreciación de agosto y septiembre se registra en **un** asiento fechado 30/09 titulado "Depreciación mensual 2026-09". |
| R3-M15 | Validación y feedback | UX | Validaciones solo de servidor y mensajes poco específicos: precio 99,999,999,999,999 → "Uno de los valores numéricos está fuera del rango permitido" (sin decir cuál); nombre >255 sin aviso en cliente; mes 13 en nómina solo lo valida el servidor; "Registrar rango" e-NCF vacío no da ningún feedback; saldo inicial bancario negativo se acepta sin aviso; transferencia en borrador acepta 500 uds con 38 disponibles. |

### 3.4 Bajos
- **R3-B01 · Feedback inconsistente:** guardar producto, cliente, proveedor y borrados muestran toast de éxito; recibo, OC (enviar/aprobar/marcar enviada), perfil e invitación no muestran nada. SKU duplicado: el toast repite la frase dos veces y el campo SKU no se marca pese a `fieldErrors`.
- **R3-B02 · Ordenamiento desigual:** Facturas y otras listas ordenan (en servidor), pero Kárdex, Plan de cuentas y Balanza no; la balanza tampoco permite profundizar a la cuenta.
- **R3-B03 · Capitalización:** "Enero **De** 2026", "Pagos **Al** Exterior" en Declaraciones fiscales.
- **R3-B04 · Barra de factura:** Anterior/Siguiente no se deshabilitan con una sola factura; "Personalizar formulario" abre Ajustes › Comprobantes fiscales.
- **R3-B05 · Etiquetas:** el error obligatorio concatena la ayuda («DocumentoCifrado. Déjalo en blanco para no cambiarlo.» es obligatorio, incoherente en un alta); importación: "Columnas obligatorias: **nombrepais**".
- **R3-B06 · Modales:** "Invitar usuario" es un `div.modal` sin `role=dialog` dentro de Ajustes; Escape cierra todo Ajustes.
- **R3-B07 · Cambio de contraseña:** pide step-up **y** contraseña actual; con la actual errónea dice "Correo o contraseña incorrectos".
- **R3-B08 · Detalles de listas:** filas de tablas sin menú contextual (el menú lateral sí lo tiene); seleccionar productos no ofrece acciones masivas; "Retirar" categoría sin confirmación; "Nuevo almacén" vacío no da mensaje; catálogo de bancos vacío.
- **R3-B09 · POS:** terminal "Caja **main**" (id crudo); cierre con sobrante de 475 sin pedir justificación; la impresión del ticket (iframe) no pudo verificarse con el arnés.
- **R3-B10 · Exportaciones:** unos CSV usan `sep=;` y `;`, otros `,`; el CSV de POS fecha en UTC.

---

## 4. Re-verificación de la ronda anterior

| ID previo | Estado | Observación actual |
|---|---|---|
| C-01 páginas en blanco (dockview 8) | ✅ corregido | dockview 6.6.1 en el lockfile; todas las rutas renderizan |
| C-02 F5 congela | ✅ corregido | recarga en <1 s con sesión |
| C-03 borrar cliente borra facturas | ✅ corregido | bloquea con dependencias y ofrece "Desactivar" (cliente, producto, proveedor, departamento) |
| C-04 no se crean clientes/proveedores | ✅ corregido | 201 en mínimo y completo (pero R3-A03) |
| C-05 sin asientos manuales | ✅ corregido | 201 (pero R3-A01/A02) |
| C-06 cierre de período 500 | ✅ corregido | confirmación, cierre, bloqueo 403 en cerrado, reabrir con motivo |
| C-07 recepción OC sin stock | ✅ corregido | recepción parcial, stock y asiento 1140/2115 |
| C-08 POS no vende | ◐ parcial | vende y mueve stock; **no contabiliza** (R3-C02) |
| C-09 nómina impagable | ✅ corregido | selector de cuenta y asiento 2140/1120 (pero R3-A07) |
| A-01 step-up con contraseña mala expulsa | ✅ corregido | "…incorrecta." y reintento |
| A-02 step-up bloquea en uso normal | ❌ persiste | R3-A08 |
| A-03 detalle nómina "Cargando" | ✅ corregido | |
| A-04 perfil no guarda | ✅ corregido | PATCH 200 (sin toast) |
| A-05 cuentas no editables | ✅ corregido | campo "Motivo del cambio" |
| A-06 saldo inicial bancario imposible | ✅ corregido | contrapartida de patrimonio elegible |
| A-07 tipo de documento 403 | ✅ corregido | |
| A-08 URLs relativas / workspace | ✅ corregido | las pestañas persisten entre sesiones |
| A-09 barra de factura muerta, sin NC/anular | ◐ parcial | barra funcional (imprimir, PDF, correo, Excel, búsqueda, ayuda, copiar); NC/Anular rotos (R3-C01) |
| A-10 importar/exportar/DataSheets mock | ◐ parcial | importar/exportar reales; DataSheets roto (R3-A06) |
| A-11 bandeja de aprobaciones vacía | ✅ corregido | con aviso de SoD |
| A-12 moneda NULL / USD | ✅ corregido | asientos en DOP, dashboard RD$ |
| A-13 asientos no se abren, exportar muerto | ◐ parcial | abren (directo en modo edición, sin vista de lectura); todos los Exportar descargan |
| A-14 rol detrás del modal | ✅ corregido | |
| A-15 errores silenciosos | ◐ parcial | SoD, cierre, POS con mensajes; importar estado bancario genérico (R3-A05) |
| A-16 2FA y estructura muertos | ✅ corregido | asistente 2FA de 4 pasos; estructura carga |
| A-17 mensajes genéricos / claves | ◐ parcial | rangos NCF, SKU y depto. claros; claves crudas en otros (R3-M05) |
| M-01 menú no filtra por rol | ◐ parcial | riel filtrado; acciones no permitidas visibles (R3-M04) |
| M-02 activación → Acceso denegado | ❌ persiste | R3-A09 (los requisitos de contraseña ya se explican) |
| M-03 cambio de contraseña sin la actual | ✅ corregido | (R3-B07) |
| M-04 validaciones (150 %, débito+crédito…) | ◐ parcial | impuesto >100 y débito+crédito rechazados; categorías filtradas; R3-M15 |
| M-05 porcentajes fraccionales | ✅ corregido | Desc.% e ITBIS en % |
| M-06 listas no se refrescan | ✅ corregido | |
| M-07 recibo aplica saldo total | ✅ corregido | (aviso de sobregiro falso: R3-A07) |
| M-08 creador aprueba su OC | ❌ persiste | R3-M06 |
| M-09 Ajustes "en desarrollo" | ✅ corregido | 28/28 secciones operativas |
| M-10 uso del plan en 0 | ✅ corregido | "Facturas 2" |
| M-11 diálogos sin estilos | ✅ corregido | (DataSheets: R3-A06) |
| M-12 "sesión expirada" ante credenciales malas | ✅ corregido | "…incorrectos" |
| M-13 extensiones: step-up y luego 403 | ⚪ no re-verificado | el formulario de registro no se pudo localizar con el arnés |
| M-14 plantillas/repositorio | ✅ corregido | mensaje claro de duplicado; "Nueva carpeta" en línea |
| M-15 cédula en claro | ✅ corregido | oculto tras "Ver los datos sensibles" |
| M-16 README del seed | ✅ corregido | documenta `DEV_SEED`/`DEV_SEED_PASSWORD` (falta `apps/ai-engine`: R3-M08) |
| M-17 inglés/enums | ◐ parcial | tipos de cuenta y búsqueda en español; R3-M05 |
| B-01 listas no ordenan | ◐ parcial | R3-B02 |
| B-02 detalles varios | ◐ parcial | rentabilidad, "Por defecto", invitación duplicada y actividad corregidos; notificaciones persisten (R3-M09) |

---

## 5. Flujos cruzados entre módulos

| # | Flujo | Resultado |
|---|---|---|
| 1 | Factura (B01, desc. 10 %) → CxC/Ingresos/ITBIS + Costo/Inventario → stock → balanza/ER/BG/rentabilidad/607 | ✅ cuadrado (salvo total de línea en pantalla, R3-M01) |
| 2 | Cobro parcial + total → factura Cobrada → banco → antigüedad cuadra con el mayor | ✅ |
| 3 | Cotización → enviada → aceptada → factura borrador | ✅ |
| 4 | OC → aprobación → enviada → recepción parcial → stock + asiento → factura de proveedor 3-way → pago | ✅ (sobregiro falso R3-A07; sin NCF R3-A04) |
| 5 | Requisición → bandeja de aprobaciones (SoD) → aprobada | ✅ · ❌ no se convierte en OC (R3-M07) |
| 6 | Tesorería: saldo inicial → asiento de apertura | ✅ |
| 7 | Inventario: transferencia entre almacenes y ajuste → kárdex + asiento | ✅ |
| 8 | Activo fijo → depreciación → asiento | ✅ (agrupación de meses R3-M14) |
| 9 | Presupuesto → variaciones con datos reales | ✅ |
| 10 | Nómina: calcular (verificada a mano) → SoD → aprobar → asiento → pagar → banco | ✅ (step-up R3-A08, saldo R3-A07) |
| 11 | Importar clientes CSV → aparecen en Clientes y en facturación | ✅ |
| 12 | Usuario invitado → activación → permisos por rol en UI y API | ◐ permisos OK; aterrizaje en "Acceso denegado" (R3-A09) |
| 13 | Maestros con documentos → eliminación | ✅ bloqueada con detalle |
| **14** | **POS → Contabilidad / Fiscal (607)** | ❌ **sin asientos ni NCF (R3-C02)** |
| **15** | **Factura emitida → Nota de crédito / Anulación → stock y asientos** | ❌ **imposible (R3-C01)** |
| **16** | **Nota de débito a proveedor (devolución) → Inventario** | ❌ **no mueve existencias; mayor ≠ submayor (R3-A10)** |
| **17** | **Factura de proveedor sin NCF → 606** | ❌ **606 bloqueado sin forma de corregir (R3-A04)** |
| **18** | **Modificación de asiento → balances del período** | ❌ **la corrección se neutraliza (R3-A02)** |
| **19** | **Asiento con fecha futura → Períodos / Cierre** | ❌ **crea 12 períodos 2031 en silencio (R3-A01)** |
| **20** | **Tesorería (saldo) → formularios de pago** | ❌ **leen RD$0.00 (R3-A07)** |
| **21** | **Banco → conciliación (importar estado)** | ❌ **400 (R3-A05)** |
| **22** | **Eventos de negocio → Notificaciones** | ❌ **vacías (R3-M09)** |

---

## 6. Observaciones positivas (verificadas)

- **Motor contable sólido:** todos los asientos automáticos (venta, costo a promedio 695.24, cobros, recepción, factura de proveedor, ND, pago, ajuste, transferencia, depreciación, nómina) cuadran y usan las cuentas correctas; los reportes son coherentes entre sí y exportan.
- **Datos reales, sin mocks:** cada valor QA3 apareció exactamente donde debía (listas, detalle, PDF, correo, 607, CSV, búsqueda global, rentabilidad, presupuesto, cobranza). Los historiales ficticios de la ronda anterior desaparecieron; los estados vacíos son reales.
- **Nómina DO verificada a mano:** AFP 2.87 % = 1,865.50; SFS 3.04 % = 1,976.00; ISR anual (733,902 → 53,130.60/12) = 4,427.55; neto 56,730.95; aportes patronales AFP 7.10 % y SFS 7.09 %.
- **Seguridad observable:** API 403 para cada rol fuera de su alcance; riel filtrado por rol; SoD en nómina y requisiciones; step-up en dinero, datos de compensación y SSO; XSS escapado (correo de factura y búsqueda); sesión expirada → login con `returnUrl`; logout revoca (API 401); cookies httpOnly; credenciales malas con mensaje correcto.
- **Validación clara en formularios:** resumen "Revisa N punto(s)" con enlaces; rangos NCF (solapado con detalle, vencido, prefijo); sobre-recepción; ND mayor que lo debido; residual > costo; cotización vencida; período cerrado.
- **POS bien resuelto en caja:** escáner, aparcar/recuperar, efectivo insuficiente bloqueado, cambio, pagos mixtos, anulación con motivo que repone stock, reportes X/Z y arqueo.
- **Vista móvil (390 px):** sin scroll horizontal; tablas con scroll interno.

---

## 7. Scorecard por módulo (1–10)

Ejes: **Mad** = madurez · **Rob** = robustez · **Seg** = seguridad observable · **UX** = usabilidad · **Comp** = competitividad frente a Odoo, NetSuite y SAP B1. (Entre paréntesis, el valor de la ronda anterior.)

| Módulo | Mad | Rob | Seg | UX | Comp | Sustento (un ejemplo observado por eje) |
|---|---|---|---|---|---|---|
| **Plataforma / Login / Usuarios** | 7 (4) | 6 (2) | 7 (6) | 6 (4) | 6 (4) | **Mad:** 2FA, SSO, sesiones, favoritos, riel. **Rob:** F5 y render corregidos; activación → Acceso denegado (R3-A09). **Seg:** 403 por rol y revocación OK; step-up bloquea en uso normal (R3-A08). **UX:** búsqueda y "Crear nuevo" con atajos; notificaciones vacías (R3-M09). **Comp:** Odoo/NetSuite invitan y aterrizan en el inicio sin error. |
| **Ventas / Facturación** | 7 (5) | 4 (3) | 6 (6) | 7 (5) | 5 (4) | **Mad:** cotización→factura, PDF/correo/Excel, cobranza priorizada. **Rob:** NC y anulación rotas (R3-C01). **Seg:** Vendedor limitado por la API, pero ve botones no permitidos (R3-M04). **UX:** barra completa; total de línea erróneo (R3-M01). **Comp:** Odoo/SAP B1 corrigen con NC desde la factura en un clic. |
| **POS** | 7 (3) | 3 (1) | 6 (5) | 8 (4) | 4 (2) | **Mad:** turnos, X/Z, mixto, aparcar. **Rob:** vende, pero no contabiliza ni numera (R3-C02). **Seg:** anulación con motivo y permiso de supervisor. **UX:** atajos F2–F9, escáner, errores claros. **Comp:** el POS de Odoo asienta la sesión al cerrar y emite comprobante. |
| **Compras / Proveedores** | 7 (5) | 5 (3) | 5 (5) | 5 (4) | 6 (4) | **Mad:** recepción parcial, 3-way, ND, aprobaciones. **Rob:** lista sin nombres (R3-A03); ND no mueve stock (R3-A10). **Seg:** creador aprueba su OC (R3-M06). **UX:** requisición sin conversión (R3-M07). **Comp:** NetSuite/SAP B1 exigen NCF/folio y devuelven stock en la nota. |
| **Inventario** | 7 (4) | 6 (4) | 6 (5) | 6 (5) | 6 (3) | **Mad:** multi-almacén, transferencias, ajustes, kárdex, valoración promedio. **Rob:** borrados bloqueados; borrador acepta cantidad > disponible. **Seg:** ajuste con confirmación y motivo. **UX:** claves «Product id» (R3-M05). **Comp:** cerca del básico de Odoo; sin lotes/series ni rutas. |
| **Tesorería / Finanzas** | 6 (4) | 4 (3) | 6 (6) | 5 (5) | 5 (3) | **Mad:** conciliación con aprendizaje, flujo proyectado, transferencias. **Rob:** importar estado 400 (R3-A05); saldo RD$0.00 en pagos (R3-A07). **Seg:** step-up en movimientos de fondos. **UX:** proyección "Calculando…" eterna (R3-M08). **Comp:** Odoo concilia feeds bancarios de punta a punta. |
| **Contabilidad** | 8 (6) | 4 (3) | 6 (6) | 6 (4) | 7 (5) | **Mad:** asientos, recurrentes, plantillas, dimensiones, activos, presupuestos, cierre asistido. **Rob:** fecha futura crea períodos (R3-A01); modificación neutralizada (R3-A02). **Seg:** cierre/reapertura con motivo auditado. **UX:** asiento se abre en edición, no lectura. **Comp:** conceptos al nivel de NetSuite; integridad de correcciones por debajo. |
| **RR.HH. / Nómina** | 7 (6) | 7 (4) | 6 (7) | 6 (4) | 7 (5) | **Mad:** cálculo DO correcto, SUIR, salario en el alta. **Rob:** calcular→aprobar→pagar completo. **Seg:** SoD y step-up, pero bloquea por exceso (R3-A08). **UX:** depto. duplicado (R3-M12). **Comp:** más localizado para RD que Odoo estándar. |
| **Reportes / Análisis / Fiscal** | 7 (6) | 5 (6) | 6 (6) | 6 (6) | 6 (5) | **Mad:** declaraciones 606–609 con estado, mapa de relaciones, calidad de datos. **Rob:** 606 bloqueado (R3-A04); DataSheets roto (R3-A06); POS fuera de reportes. **Seg:** 403 a roles sin permiso. **UX:** exportaciones reales pero formatos dispares (R3-B10). **Comp:** NetSuite ofrece drill-down desde la balanza (aquí no). |
| **Configuración / Administración** | 8 (3) | 7 (3) | 7 (5) | 6 (4) | 7 (3) | **Mad:** 28 secciones operativas. **Rob:** perfil, plan y estructura funcionan. **Seg:** 2FA de organización, auditoría, SSO tras step-up. **UX:** contradicción e-CF (R3-M03). **Comp:** comparable a la configuración de Odoo. |
| **Workspace (Inicio, búsqueda, documentos, datos)** | 7 (4) | 7 (4) | 7 (7) | 7 (6) | 6 (4) | **Mad:** importar/exportar reales, favoritos, menú contextual. **Rob:** workspace persiste. **Seg:** búsqueda segura ante inyección. **UX:** bandeja de aprobaciones útil; notificaciones vacías. **Comp:** el importador con validación previa es comparable al de Odoo. |

---

## 8. Cobertura

- **Rutas:** 154 en los manifiestos; **119 sin parámetro** inventariadas en estado vacío (`inventory.json`) y recorridas con datos (`clicks.json`). Las 35 con parámetro se cubrieron abriendo registros desde su lista o en los flujos (factura, cotización, OC, recepción, requisición, factura/pago/ND de proveedor, asiento, cuenta, empleado, nómina, activo, presupuesto, ajuste, transferencia, mapa de relaciones).
- **Ajustes:** 28/28 secciones abiertas; a fondo: Mi perfil, contraseña, 2FA, Comprobantes fiscales (rangos), Usuarios (invitar), Plan, Estructura, IA.
- **Matriz:** **1,592 interacciones → 1,373 ok · 7 con falla · 212 no probadas (90 % probadas)**. Las fallas que viven en flujos (anular, POS, 606…) están en §3, no en la matriz. Las no probadas, todas con razón en la matriz: 76 deshabilitadas en su estado; 50 no concluyentes por el límite de tasa que provoca el ritmo del arnés (a ritmo humano no se reproduce: `101-ratelimit.cjs`); 36 limitaciones del arnés (controles duplicados por el encabezado fijo); 46 acciones destructivas no ejecutadas por regla o falsos positivos de esa regla; 4 de archivo (cubiertas en flujos).
- **Formularios con casos completos** (vacío, inválido, límite, largo, especiales, válido, doble clic según aplique): producto, cliente, proveedor, factura, recibo, rango NCF, cuenta bancaria, OC, recepción, factura de proveedor, ND, pago, asiento (incl. fecha futura y período cerrado), cuenta contable, departamento, empleado, nómina, invitación, activación, perfil, contraseña, cotización, transferencia, ajuste, activo fijo, presupuesto, requisición, impuesto, importación CSV, conciliación, login.
- **Roles:** Administrador ×2, Vendedor, Contador, Miembro (UI + API).
- **Estados:** vacío, con datos, error (400/403/409/422/500), por rol, sesión expirada, tras logout, móvil 390 px, tema oscuro.

### No probado (con razón)
| Qué | Razón |
|---|---|
| Firma/envío e-CF a DGII y certificado .p12 | Sin certificado; efecto externo real (autoridad fiscal). |
| Suscripción/pago del plan | Pasarela real; sin garantía de sandbox. |
| Envío real de correo | Sin SMTP: se verificó el correo generado en el buzón local (`tmp/mail-outbox`). |
| SSO con IdP real, verificación DNS | Requiere IdP/DNS externos. |
| Copiloto, informe del gerente, "Redactar con IA", plan de cierre | Sin proveedor de IA en el entorno (se verificó el mensaje de "no configurada"). |
| Predicciones y flujo proyectado (resultado) | Requieren `apps/ai-engine` (servicio Python no levantado; no documentado en la guía local). |
| Completar 2FA | Exige TOTP y dejaría al usuario de prueba bloqueado tras 2FA; se probó la apertura del asistente. |
| Fusionar/eliminar cuentas, eliminar impuestos y conceptos preexistentes, "Verificar y procesar" del cierre | Regla: destructivas solo sobre datos QA de la sesión, o irreversibles sobre el período en curso. |
| Registro de extensiones (M-13) | El formulario no se pudo localizar con el arnés; no re-verificado. |
| Impresión del ticket POS | Se imprime por iframe oculto; el arnés no intercepta `print` dentro del iframe. |
| Desktop (Electron) | Fuera del alcance de esta sesión (navegador). |

---

## 9. Reproducibilidad
Scripts en `harness/` (Playwright, CommonJS): `node <script>.cjs` con API, web y POS levantados como en §2. `01-inventory.cjs` (inventario), `08-click-all.cjs` (pasada de clics, `RESUME=1` para continuar), `gen-matriz.cjs` (regenera la matriz con las reclasificaciones manuales), y los flujos numerados `10-…` a `102-…` citados en cada hallazgo. `db-asientos.sh [desde]` y `db-stock.sh` son las consultas de verificación a la base local usadas para contrastar cada acción de la UI con lo persistido.
