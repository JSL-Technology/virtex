# Informe de QA exploratoria end-to-end — Virteex ERP

> **Método.** Pruebas exploratorias sobre la **aplicación en ejecución**, no lectura de código.
> Instancia local levantada desde este repositorio (Postgres 16 + Redis nativos, migraciones
> aplicadas, API NestJS en `:3000`, cliente Angular en `:4200`), recorrida con un navegador
> Chromium real conducido por Puppeteer, registrando cada petición y respuesta HTTP, los errores
> de consola y el DOM renderizado. **Cada afirmación de la interfaz se contrastó contra `psql`
> sobre la misma base de datos.**
>
> **Fecha:** 2026-09-14 · **Rama:** `claude/qa-erp-exploratory-testing-1ttd0t`
> **Alcance:** 88 rutas del manifiesto de módulos + 20 secciones del panel de Ajustes · 9 módulos ·
> 2 roles (`ADMINISTRATOR`, `SELLER`) · 532 endpoints mapeados.
>
> **Informe navegable:** https://claude.ai/code/artifact/7d6f8b27-a5fa-4b40-a30c-a17e95ae5a67

---

## 1. Resumen ejecutivo

El motor contable es de calidad excepcional y las costuras entre módulos cuadran al céntimo. La
capa de interfaz que debería dar acceso a ese motor es donde el producto se rompe.

Emití una factura de 2.360 DOP y el sistema, sin intervención, descontó 2 unidades de inventario,
generó el asiento de ingreso (Dr CxC 2.360 / Cr Ingresos 2.000 / Cr ITBIS 360), generó el asiento
de costo (Dr Costo de Ventas 1.200 / Cr Inventarios 1.200), consumió el NCF `E320000000001`, y
actualizó balance general, estado de resultados y antigüedad de saldos. Todo cuadrado.

Y sin embargo, **un contador no puede usar el producto**: el formulario de asiento manual muestra
`[object Object]` en lugar del nombre de las 55 cuentas, el punto de venta no abre turno, siete
pantallas de datos maestros muestran registros que no existen, y varios botones de «Nuevo» no
responden.

**Ninguno de los hallazgos críticos toca la lógica de negocio.** Todos están en la capa de
presentación o en el cableado entre pantalla y endpoint.

| Severidad | Nº |
|---|---|
| Crítica | 4 |
| Alta | 6 |
| Media | 7 |
| Baja | 5 |
| Costuras entre módulos correctas | 10 de 15 |

---

## 2. Hallazgos críticos

### C-01 · Bug · El asiento contable manual es imposible: las 55 cuentas se muestran como `[object Object]`

**Módulo y flujo:** Contabilidad › Asientos contables › Nuevo asiento (`/accounting/journal-entries/new`)

**Pasos:** entrar como administrador, abrir la ruta, desplegar el selector «ACCOUNT» de cualquier línea.

**Esperado:** cada opción identifica su cuenta («1130 — Cuentas por Cobrar Comerciales»).
**Real:** las 55 cuentas aparecen como `[object Object]`.

```
Opciones leídas del DOM:
["Select an account","[object Object]","[object Object]","[object Object]", ...]

Ocurrencias de "[object Object]" por pantalla:
  /accounting/journal-entries/new .......... 110
  /accounting/audit-adjustments/new ........  40
```

Los nombres de cuenta se guardan como objeto localizado (`{"es": "Inventarios"}`) y esta pantalla
lo interpola sin resolver el idioma. Los selectores de Libro y Diario de esa **misma** pantalla
resuelven bien, y el listado del catálogo también: es este componente, no el modelo de datos.

### C-02 · Bug + desconexión front-back · El punto de venta nunca abre turno, y la pantalla no lo dice

**Módulo y flujo:** Ventas › Punto de venta (`/sales/pos`)

**Pasos:** abrir `/sales/pos` (intenta abrir turno automáticamente) y observar red y pantalla.

**Esperado:** el turno abre, o el cajero ve por qué no puede vender.
**Real:** `POST /api/v1/pos/shifts` responde **500 siempre**, sin ningún mensaje en pantalla. El POS
se dibuja operativo: «Current Order», totales, botón «Charge» e indicador «Connected».

```
QueryFailedError: null value in column "salesTotal" of relation "pos_shifts"
  violates not-null constraint

curl -X POST /api/v1/pos/shifts -d '{"terminalId":"TEST-QA-TERM-1","openingBalance":1000}'
  → HTTP 500 {"code":"INTERNAL_ERROR"}

La columna sí tiene default en la base:  salesTotal | numeric(14,2) | not null | 0
→ la entidad envía NULL explícito en lugar de omitir la columna.
```

### C-03 · Dato mock detectado · Siete pantallas de datos maestros muestran registros inventados y sus botones «Nuevo» son inertes

**Módulo y flujo:** Datos maestros (Almacenes, Bancos, Métodos de pago, Términos de pago, Monedas,
Sucursales, Unidades de medida) y Ventas › Historial.

**Pasos:** abrir `/masters/warehouses`; comprobar la red (cero llamadas) y la base
(`select count(*) from warehouses` → 0); pulsar «New warehouse».

**Esperado:** la pantalla refleja los datos de la organización y permite crear.
**Real:** muestra ficción codificada en el front; el botón de crear no abre modal, no navega y no
cambia un solo byte del DOM.

```
PANTALLA                        API        FILAS UI   FILAS REALES
/masters/warehouses ........... ninguna ...... 3 ...... 0
/masters/banks ................ ninguna ...... 4 ...... (sin endpoint, 404)
/masters/payment-methods ...... ninguna ...... 3 ...... (sin endpoint, 404)
/masters/payment-terms ........ ninguna ...... 4 ...... (sin endpoint, 404)
/masters/branches ............. ninguna ...... 2 ...... (sin endpoint, 404)
/masters/currencies ........... ninguna ...... 3 ..... 23   ← GET /currencies responde 200
/masters/units-of-measure ..... ninguna ...... 6 ...... 0   ← GET /units-of-measure responde 200
/sales/history ................ ninguna ...... 4 ...... 1

Historial de ventas, contenido literal:
  V-2025-001 | 20/07/2025 | Cliente Ejemplo S.R.L. | 350.00 | Tarjeta
  V-2025-002 | 20/07/2025 | Ana Pérez              | 120.50 | Efectivo
…mientras la única venta real (FAC-00000001, DOP 2.360,00) no aparece.
```

Monedas y unidades de medida son el caso fácil: el endpoint existe y devuelve datos distintos a los
dibujados. Bancos, métodos, términos y sucursales no tienen endpoint alguno.

### C-04 · Desconexión front-back · La antigüedad de cuentas por pagar muestra cuentas por cobrar

**Módulo y flujo:** Compras › Antigüedad de saldos (`/reports/aging/payables`)

**Pasos:** registrar y aprobar una factura de proveedor (5.000,00 DOP por pagar); abrir el informe.

**Esperado:** el proveedor con 5.000,00 pendientes.
**Real:** sale el *cliente* con 2.360,00 y la cabecera dice «Customer».

```
Llamada que hace /reports/aging/payables:
  GET /api/v1/customer-payments/aging     ← el de COBRAR
  → {"controlAccountBalance":2360, rows:[{"partyName":"TEST-QA Cliente…"

Endpoint correcto, que nadie invoca desde la interfaz:
  GET /api/v1/accounts-payable/aging
  → {"controlAccountBalance":5000, rows:[{"partyName":"TEST-QA Proveedor…","current":5000}],
     "controlAccountDifference":0}

/reports/aging/receivables llama exactamente a la misma URL: ambas comparten el de cobrar.
```

---

## 3. Hallazgos altos

### A-01 · Bug · Las fechas se muestran un día antes de lo guardado, incluidas las cabeceras de los estados financieros

**Módulo y flujo:** Ventas › Facturas · Compras › Facturas de proveedor · Análisis › Estados financieros

```
BD:  issueDate = 2026-09-14      dueDate = 2026-09-14
UI:  Date 09/13/2026             Due 09/13/2026

Balance general
  petición:  GET /financial-reporting/balance-sheet?asOfDate=2026-09-14
  cabecera:  "Balance Sheet As of 9/13/2026"

Estado de resultados
  petición:  ?startDate=2026-01-01&endDate=2026-09-14
  cabecera:  "Income Statement 12/31/2025 — 9/13/2026"

Pero Contabilidad › Asientos muestra 09/14/2026, correcto.
```

Un valor de sólo fecha se convierte a través de la zona horaria de la organización
(`America/Santo_Domingo`, UTC−4) y retrocede un día. No es global: el listado de asientos lo
muestra bien, lo que confirma que es por componente.

### A-02 · Bug · «New Account» lleva a una pantalla «en construcción»; el formulario real existe y está terminado

**Módulo y flujo:** Contabilidad › Catálogo de cuentas

```
Botón «New Account» → /accounting/account-form
   "Account Form — This module is under construction." · campos de formulario: 0

Ruta declarada en el manifiesto → /accounting/chart-of-accounts/new
   "New account — Fill in the account's details."
   campos: código, nombre, descripción, cuenta padre, tipo, naturaleza, categoría,
           imputable, activa · pestañas: General · Mappings · Rules · Advanced
```

### A-03 · Bug · Cuatro botones de «Nuevo» son inertes, y uno bloquea toda la nómina

**Módulo y flujo:** RR.HH. y Nómina › Corridas, Departamentos, Conceptos — y DataSheets

```
/payroll/runs        "New run"        → url igual, inputs 1→1, htmlΔ 0, red 0
/hcm/departments     "New department" → url igual, inputs 1→1, htmlΔ 0, red 0
/payroll/concepts    "New concept"    → url igual, inputs 1→1, htmlΔ 0, red 0
/datasheets          "New Book"       → url igual, inputs 1→1, htmlΔ 0, red 0

Contraste, mismas condiciones:
/inventory/categories "New Category"  → inputs 1→4 (abre formulario)
/masters/taxes        "New tax"       → navega a /masters/taxes/new
```

Consecuencia: **no se puede procesar una nómina**. El módulo tiene 26 endpoints y un modelo de
parámetros legales dominicanos bien pensado (AFP, ARS/SFS, escalas con vigencia por fecha), todo
inalcanzable por un botón que no escucha.

### A-04 · Desconexión front-back + UX · El sistema declara que la facturación está lista cuando emitir es imposible

**Módulo y flujo:** Ventas › Nueva factura, en una organización recién creada

```
GET /api/v1/invoices/context
  → {"ready":true,"missing":[], …}          ← afirma estar listo

POST /api/v1/invoices
  → 400 {"code":"compliance.no_active_ncf_sequence_type_type","params":{"type":"E32"}}

Lo que ve el usuario: «Error  The document could not be saved.»
```

El contrato de preparación miente y el mensaje visible descarta un código preciso y accionable. El
remedio existe en el producto (Ajustes › Facturación electrónica) pero nada lo sugiere. Creada la
secuencia, la emisión funciona a la primera.

### A-05 · UX / i18n · El panel de la DGII muestra una clave de traducción en crudo

```
GET /api/v1/einvoicing/invoices/{id}/status
  → {"status":"ERROR","messages":["einvoicing.do.organization_has_no_rnc_configured_fill"]}

Render en el documento:
  DGII status: Error
  Messages from the DGII:
  einvoicing.do.organization_has_no_rnc_configured_fill
```

### A-06 · Bug · El Diario general muestra un UUID donde debería ir el número de asiento

```
/accounting/journal-entries   ENTRY NO.  VENTAS-2026-000001     ✓
/accounting/daily-journal     ENTRY NO.  c560af1d-36b7-41b6-…   ✗
```

El diario general se imprime y se entrega a auditores; el número de asiento es su identificador legal.

---

## 4. Hallazgos medios y bajos

| Id | Módulo y flujo | Categoría | Sev. | Observación |
|---|---|---|---|---|
| M-01 | Transversal › Formularios | UX | Media | Salir de un formulario con cambios no avisa: el dato se pierde. Escribí «TEST-QA Sin guardar» en Nuevo cliente (cabecera «Unsaved»), navegué a Facturas y volví: campo vacío. Además abrió una **segunda** pestaña «New customer» en vez de reutilizar la abierta. |
| M-02 | Transversal › Idioma | UX / i18n | Media | Con interfaz en inglés aparecen literales en español: «Guardar Cambios» (Perfil de empresa), «Invitar Nuevo Usuario» y «Enviar Invitación» (diálogo de invitación), medidor de contraseña («Fuerte», «Al menos 12 caracteres»). En Períodos cada fila repite el nombre en dos idiomas: «January 2026 Enero 2026». |
| M-03 | RR.HH. › Nuevo empleado | Bug / UX | Media | Tras guardar con éxito (`201 POST /hcm/employees`) la cabecera sigue diciendo «Unsaved» y la URL sigue siendo `/hcm/employees/new`. Volver a pulsar «Save» hace lo correcto (`PATCH`, no duplica), pero se le dice al usuario que su trabajo no está guardado cuando sí lo está. |
| M-04 | Transversal › Permisos | Permisos / UX | Media | Un rol SELLER ve los 9 módulos en la barra lateral; al pulsar 6 de ellos no ocurre nada (misma URL, mismo submenú, sin aviso). Con carga directa de ruta prohibida redirige a `/overview` sin explicar. *La restricción se aplica bien; falta comunicarla.* |
| M-05 | API › Validación | Bug | Media | Omitir un campo obligatorio devuelve una restricción que no corresponde: sin `terminalId` → `validation.constraints.max_length`; sin `openingBalance` → `validation.constraints.max`. El campo señalado es correcto, el motivo no. |
| M-06 | API › Errores | UX / API | Media | Dos formatos de error conviven. `POST /pos/shifts` devuelve `fieldErrors` con propiedad y restricción; `GET /inventory/products` devuelve un 400 opaco (`{"code":"BAD_REQUEST","messageKey":"errors.http_400"}`) sin indicar qué falta, y tampoco registra el motivo en el log. |
| M-07 | Ventas ↔ Compras › Maestros | Estilo / UX | Media | Cliente: «Company Name*», email y teléfono **obligatorios**. Proveedor: «Supplier Name*», email y teléfono **opcionales**. La moneda es desplegable en la factura de venta y texto libre en la de compra, donde además se guarda vacía. |
| B-01 | RR.HH. › Nuevo empleado | UX / i18n | Baja | En una organización dominicana «Document type» ofrece «SSN / Passport / EIN» mientras el valor guardado es `CEDULA`. |
| B-02 | Transversal › Formularios | Accesibilidad | Baja | La validación se comunica bien visualmente («Check 3 item(s) before saving» con detalle por campo) pero ningún campo inválido recibe `aria-invalid`. |
| B-03 | Ventas › Nueva factura | UX | Baja | La fecha de vencimiento se inicializa igual que la de emisión (crédito cero) aunque el cliente tenga condiciones de pago. |
| B-04 | Autenticación › Sesión | UX | Baja | Al perderse la sesión, vuelve al login limpiamente pero sin mensaje: el usuario no sabe si caducó. |
| B-05 | Autenticación › Login | Robustez | Baja | Si el script de reCAPTCHA de Google no es alcanzable, el login espera 8 s en «Logging in» antes de enviar, sin aviso. *Observado sin salida a Internet; afectaría igual a una red que bloquee Google.* |

---

## 5. Costuras entre módulos

Ejecutadas de principio a fin y verificadas en el módulo de destino **contra la base de datos**.

| Flujo | Resultado observado | Veredicto |
|---|---|---|
| Alta de producto con stock → Contabilidad | GENERAL-2026-000001 · Dr Inventarios 30.000 / Cr Patrimonio 30.000 | ✅ Correcto |
| Factura emitida → Inventario | stock 50 → 48 | ✅ Correcto |
| Factura emitida → Contabilidad (ingreso) | VENTAS-2026-000001 · Dr CxC 2.360 / Cr Ingresos 2.000 / Cr ITBIS 360 | ✅ Correcto |
| Factura emitida → Contabilidad (costo) | GENERAL-2026-000002 · Dr Costo 1.200 / Cr Inventarios 1.200 | ✅ Correcto |
| Factura emitida → Secuencia fiscal | NCF E320000000001 consumido, estado PENDING | ✅ Correcto |
| Venta → Antigüedad de cobrar | TEST-QA Cliente · 2.360,00 en «Current» | ✅ Correcto |
| Venta → Estados financieros | Activo 31.160 · Utilidad 800 · Margen 40,0 % | ✅ Correcto |
| Factura de proveedor aprobada → Contabilidad | COMPRAS-2026-000001 · Dr Alquileres 5.000 / Cr CxP 5.000 | ✅ Correcto |
| Compra → Balanza de comprobación | 2110 y 5300 presentes; balanza cuadrada | ✅ Correcto |
| Rol SELLER → resto de módulos | 403 en 11 de 15 endpoints; 200 sólo en customers, invoices, inventory | ✅ Correcto |
| **Compra → Antigüedad de pagar** | Muestra el cliente (2.360), no el proveedor (5.000) | ❌ Falla · C-04 |
| **Factura emitida → DGII (e-CF)** | status ERROR con clave i18n sin traducir | ❌ Falla · A-05 |
| **POS → Inventario y Contabilidad** | No se puede abrir turno: 500 permanente | ⛔ Bloqueada · C-02 |
| **Nómina → Finanzas y Contabilidad** | No se puede iniciar una corrida: botón inerte | ⛔ Bloqueada · A-03 |
| **Maestros → todos los módulos** | Datos ficticios sin conexión con ningún módulo | ❌ Falla · C-03 |

Las cinco costuras contables encadenadas cuadran todas, y el endpoint de antigüedad de pagar hasta
concilia contra su cuenta de control (`controlAccountDifference: 0`). Las tres costuras rotas lo
están por motivos de superficie: un endpoint mal enlazado, un botón que no escucha y una
restricción de base de datos.

---

## 6. Lo que está bien hecho

- **El motor de partida doble.** Todos los asientos cuadran, con ITBIS separado, costo de ventas
  perpetuo y asiento de inventario inicial. Balanza, balance y resultados se derivan consistentes.
- **El diálogo de emisión** muestra precondiciones y efectos antes de emitir: «Fiscal sequence
  available — next: E320000000001 · Fiscal number to be consumed · Stock movements 1 lines». Mejor
  que Odoo o SAP Business One en ese punto.
- **La honestidad del borrador:** «This document is a draft. It has no fiscal document number and
  carries no weight with the tax authority.»
- **Step-up por acción:** invitar a un usuario exige revalidar contraseña («Security Verification —
  PROTECTED ACTION»), con vigencia de 10 minutos.
- **Renovación de sesión transparente:** `401 → POST /auth/refresh → 200 → reintento correcto`.
- **Permisos reales en el backend:** 403 en 11 de 15 endpoints para el rol SELLER, sin filtración.
- **XSS neutralizado:** `<img src=x onerror=alert(1)>` como nombre de producto se almacena literal
  y se renderiza escapado, sin ejecutar.
- **Doble envío controlado:** tres clics seguidos en «Save customer» → un único `POST`, un registro.
- **Franqueza sobre lo no construido:** 11 de las 20 secciones de Ajustes se marcan «IN
  DEVELOPMENT» y los 4 módulos de hoja de ruta declaran su estado. Contrasta con C-03, donde el
  producto sí finge.
- **Parámetros legales con vigencia:** nómina modela las tasas como hechos con fecha.
- **El hallazgo de la auditoría anterior está resuelto.** El inventario de Fase 1 (2026-09-06)
  reportaba 40 de 50 enlaces abriendo «En construcción». De las 88 rutas recorridas sólo 4 muestran
  marcador de posición, y son los 4 módulos declarados como hoja de ruta. Cero errores de
  JavaScript en las 88.

---

## 7. Scorecard por módulo (1–10, sobre lo observado)

| Módulo | Madurez | Robustez | Seguridad | UX | Compet. | Evidencia que sustenta la nota |
|---|---|---|---|---|---|---|
| Contabilidad | 8 | 9 | 8 | 3 | 7 | Motor impecable: 4 asientos, todos cuadrados. Pero asiento manual con `[object Object]` ×110 (C-01), «New Account» a pantalla vacía (A-02), diario con UUID (A-06). |
| Análisis y Reportes | 8 | 8 | 8 | 5 | 7 | Balanza, balance, resultados y antigüedad concilian (Activo 31.160; margen 40 %). Restan fechas corridas (A-01) e informe de pagar que muestra cobrar (C-04). |
| Ventas y Facturación | 7 | 7 | 8 | 5 | 7 | Ciclo borrador→emisión con e-NCF y diálogo de efectos superior al de sus competidores. Penalizan A-01, A-04 y un «Historial de ventas» inventado (C-03). |
| Compras y Proveedores | 7 | 7 | 8 | 5 | 6 | Flujo proveedor→factura→aprobación→asiento correcto, con formas de pago DGII (01–07) y cuenta de gasto por línea. El informe de antigüedad no sirve (C-04). |
| Autenticación y Usuarios | 8 | 8 | 9 | 6 | 7 | Lo más sólido: cookies `httpOnly`, CSRF, renovación transparente, step-up, SSO, roles reales. Baja por M-02 y B-04. |
| Inventario | 6 | 7 | 8 | 4 | 5 | Productos y categorías funcionan; descuento de stock atómico con la venta (50→48). Almacenes y UdM son ficción con botones muertos (C-03). |
| Configuración | 6 | 7 | 9 | 6 | 5 | 7 de 20 secciones operativas y 11 marcadas honestamente como no construidas. Sólo se llega por el menú del avatar. |
| RR.HH. y Nómina | 5 | 6 | 8 | 4 | 5 | Alta de empleado funciona y los parámetros legales con vigencia están bien modelados. Pero la nómina no es ejecutable (A-03). |
| Tesorería | 5 | 6 | 8 | 4 | 5 | Tesorería y conciliación cargan y consultan la API, pero tres de sus maestros son ficticios y sin endpoint (C-03). |

---

## 8. Alcance y límites de la prueba

**Lo que no pude probar, y por qué:**

- **Aceptación de invitación.** Sin SMTP no llega el correo, y el token se guarda como hash
  SHA-256, de modo que el valor almacenado no sirve para completar el flujo. *Un primer intento
  pareció revelar un fallo crítico; comprobar el hash antes de reportarlo evitó un falso positivo.*
  El flujo queda sin verificar en ninguno de los dos sentidos.
- **Cobros con Stripe.** Sin credenciales.
- **Envío real a la DGII.** Requiere certificado de firma y salida a Internet.
- **Conciliación bancaria.** Las pantallas cargan, pero no hubo extracto real que importar.
- **Corrida de nómina completa.** Bloqueada por A-03, no por falta de datos.

**Datos de prueba creados** (prefijo `TEST-QA`, sobre base local efímera, nunca datos de cliente):
2 clientes, 1 proveedor, 2 productos, 1 categoría, 2 empleados, 1 factura de venta (FAC-00000001),
1 factura de proveedor (B0100000001), 1 secuencia e-NCF y 1 usuario con rol vendedor.
