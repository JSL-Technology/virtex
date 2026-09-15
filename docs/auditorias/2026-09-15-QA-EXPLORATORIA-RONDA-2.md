# QA exploratoria end-to-end — Virteex ERP (ronda 2)

> **Método.** Pruebas exploratorias sobre la **aplicación en ejecución**, no lectura de código.
> Instancia levantada desde este repositorio (PostgreSQL 16 y Redis 7 nativos, 
> migraciones aplicadas, API NestJS en `:3000`, cliente Angular en `:4200`), recorrida con
> Chromium real conducido por Puppeteer, registrando cada petición HTTP con su código y su cuerpo,
> los errores de consola y el DOM renderizado. **Cada cifra que muestra la interfaz se contrastó
> contra `psql` sobre la misma base de datos.**
>
> **Fecha:** 2026-09-14/15 · **Rama:** `claude/qa-erp-exploratory-testing-ulgay6`
> **Alcance:** 89 rutas del manifiesto · 9 módulos · 3 identidades (`ADMINISTRATOR` ×2, `SELLER`) ·
> 20 secciones del panel de Ajustes · 75 guiones de prueba · 75 capturas de pantalla.
>
> **Base de comparación:** el informe de la ronda anterior
> ([2026-09-QA-EXPLORATORIA-END-TO-END.md](2026-09-QA-EXPLORATORIA-END-TO-END.md)) y sus 22
> hallazgos, todos declarados corregidos en el PR #76. Esta ronda los reverifica y explora lo que
> aquella no pudo ejecutar: nómina completa, POS, tesorería, cobros y aprobaciones.

---

## 1. Resumen ejecutivo

El motor contable sigue siendo excelente y ahora hay **once costuras entre módulos que cuadran al
céntimo**, incluidas dos que la ronda anterior no pudo ni ejecutar: la nómina dominicana (AFP 2,87 %,
SFS 3,04 %, aportes patronales) y el cobro de un cliente. Los 22 hallazgos de la ronda anterior están
efectivamente corregidos: cero `[object Object]`, fechas correctas, antigüedad de pagar mostrando
proveedores, pestañas que conservan lo escrito, permisos que se explican al usuario.

Lo que aparece ahora es un patrón distinto y más caro: **la aplicación sabe hacer las cosas, pero
tres de sus flujos de dinero no se pueden completar desde la interfaz**, y en un caso el dinero se
mueve sin dejar rastro contable.

- Un asiento contable manual es **imposible**: el formulario envía un campo (`ledgerId`) que su
  propio endpoint rechaza. El mismo asiento, sin ese campo, se crea a la primera.
- Una venta en el **punto de venta descuenta inventario y no genera ningún asiento**: la cuenta
  1140 quedó en 33.300,00 mientras el almacén valía 32.400,00. Faltan 1.500 de ingreso y 270 de
  ITBIS por pagar.
- **No se puede registrar un cobro ni una cuenta bancaria** desde la interfaz: los dos botones de
  crear son enlaces que apuntan a su propia página.
- **No se puede dar de alta un cliente ni un proveedor sin correo electrónico**, aunque el campo no
  sea obligatorio: el formulario envía `""` y el API lo rechaza.

Ninguno de estos cuatro está en la lógica de negocio. Los cuatro están en el cableado entre pantalla
y endpoint — el mismo lugar donde estaba el 100 % de los hallazgos críticos de la ronda anterior.

| Severidad | Nº |
|---|---|
| Crítica | 4 |
| Alta | 9 |
| Media | 12 |
| Baja | 6 |
| Costuras entre módulos correctas | 11 de 15 |

---

## 2. Hallazgos críticos

### C-01 · Bug + desconexión front-back · El asiento contable manual es imposible: el formulario envía un campo que su propio API prohíbe

**Módulo y flujo:** Contabilidad › Asientos contables › Nuevo asiento (`/accounting/journal-entries/new`)

**Pasos para reproducir**
1. Entrar como administrador y abrir `/accounting/journal-entries/new`.
2. Elegir Libro «Libro Principal», Diario «Diario General», escribir una descripción.
3. Línea 1: cuenta `1110 — Efectivo y Equivalentes de Efectivo`, débito 100.
4. Línea 2: cuenta `4100 — Ingresos por Ventas`, crédito 100. Totales: 100,00 / 100,00.
5. Pulsar «Save entry».

**Esperado:** el asiento se registra (cuadra, cuentas imputables, período abierto).
**Real:** `POST /journal-entries` → **400** siempre. En pantalla: «Error — The journal entry could not be created.»

```
Petición que envía la propia pantalla:
{"date":"2026-09-14","ledgerId":"0610a30d-…","journalId":"c9175185-…",
 "description":"TEST-QA asiento valido",
 "lines":[{"accountId":"…","debit":100,"credit":0},{"accountId":"…","debit":0,"credit":100}]}

Respuesta:
{"statusCode":400,"code":"VALIDATION_FAILED",
 "fieldErrors":[{"property":"ledgerId","key":"validation.constraints.whitelist_validation"}]}
```

El DTO del endpoint **no admite `ledgerId`**, y el formulario lo declara obligatorio en pantalla
(«General Ledger *»). Control, mismo asiento sin ese campo:

```
POST /api/v1/journal-entries   (sin ledgerId)
→ 201  {"entryNumber":"GENERAL-2026-000004","ledgerId":"0610a30d-…","postedAt":"…"}
   ↑ el API asigna el libro él mismo
```

El motor funciona; la pantalla que lo expone es la que no puede usarlo. **Un contador no puede
registrar un solo asiento manual desde el producto.**

### C-02 · Bug · Las ventas del punto de venta descuentan inventario y nunca llegan a la contabilidad

**Módulo y flujo:** Ventas › Punto de venta (`/sales/pos`) → Contabilidad e Inventario

**Pasos para reproducir**
1. Abrir `/sales/pos` (el turno se abre solo: `GET /pos/shifts/active` → 200, `status: OPEN`).
2. Pulsar la tarjeta del producto «TEST-QA Monitor 24"» (1.500,00 DOP).
3. Pulsar «Charge». `POST /pos/sales` → **201**.

**Esperado:** igual que una factura: asiento de ingreso (Dr Caja / Cr Ingresos / Cr ITBIS) y asiento
de costo (Dr Costo / Cr Inventarios).
**Real:** el stock baja, la venta se guarda como `PAID`, y **no se genera ningún asiento**.

```
pos_sales:  1 fila, total 1.770,00, status PAID
products:   stock 37 → 36            ← el inventario sí se movió
journal_entries: ningún asiento con origen POS

Consecuencia medible, sobre la misma base:
  Cuenta 1140 «Inventarios» (mayor) .......... 33.300,00
  Valor físico del almacén (36 × 900) ........ 32.400,00
  Diferencia ..................................... 900,00  ← exactamente el costo de la venta POS

  Ingresos 4100 .............. 4.600,00  (3.000 factura 1 + 1.500 factura 2 + 100 asiento de control)
  → los 1.500,00 de la venta POS NO están
  ITBIS por pagar 2130 ......... 810,00  (540 + 270 de las dos facturas)
  → los 270,00 de ITBIS cobrados en el POS NO están
```

El desfase no se corrige con el uso: al cerrar la sesión de pruebas, tras once asientos y una tercera
factura, seguía siendo exactamente el costo de aquella venta.

```
Estado final de la misma base:
  1140 «Inventarios» (mayor) ....... 32.400,00
  Almacén (35 × 900) ............... 31.500,00
  Diferencia ........................... 900,00   ← la misma unidad vendida por el POS
```

Un comercio que venda por caja tendrá el mayor de inventario descuadrado a diario y declarará menos
ITBIS del que cobró. Las facturas del portal sí generan sus dos asientos: es el POS, no el motor.

### C-03 · Bug · No se puede dar de alta un cliente ni un proveedor sin correo electrónico

**Módulo y flujo:** Ventas › Clientes › Nuevo · Compras › Proveedores › Nuevo

**Pasos para reproducir**
1. Abrir `/contacts/customers/new`, escribir solo «Customer name» (el único campo con `*`).
2. Pulsar «Save customer».

**Esperado:** se crea el cliente. El correo no está marcado como obligatorio, y la migración
`CustomerContactOptional` hizo la columna nullable a propósito.
**Real:** `POST /customers` → **400**. En pantalla: «Error — Error creating the customer.», sin
señalar ningún campo.

```
REQ : {"companyName":"TEST-QA Cliente Sin Email","contactPerson":"","email":"","phone":"", …}
RESP: {"statusCode":400,"code":"VALIDATION_FAILED",
       "fieldErrors":[{"property":"email","key":"validation.constraints.is_email"}]}

Idéntico en proveedores:
REQ : {"name":"TEST-QA Proveedor Uno SRL","email":"", …}
RESP: fieldErrors: [{"property":"email","key":"validation.constraints.is_email"}]
      Pantalla: «Error creating the supplier.»
```

El formulario envía cadena vacía en lugar de omitir el campo. Un cliente de mostrador o un
proveedor sin correo —lo normal en el mercado al que apunta el producto— no se puede registrar, y
nada en pantalla dice por qué.

### C-04 · Bug · Los botones de «crear» de Tesorería y Cobros son enlaces a su propia página: el ciclo de cobro no se puede cerrar

**Módulo y flujo:** Tesorería (`/accounting/treasury`) · Ventas › Cobros (`/customer-receipts`)

**Pasos para reproducir**
1. Abrir `/customer-receipts` y pulsar «New Receipt» (clic real del ratón).
2. Observar la URL, el DOM y la red.

**Esperado:** abre `/customer-receipts/new`.
**Real:** nada ocurre. El control es un enlace cuyo `href` apunta a la página en la que ya estás:

```html
<a routerlink="new" class="primary-button" href="/customer-receipts"> … </a>
                                           ↑ debería ser /customer-receipts/new
```

```
«New Receipt»       (/customer-receipts)     → Δhtml=0  Δurl=ninguno  peticiones=0
«New bank account»  (/accounting/treasury)   → Δhtml=0  Δurl=ninguno  peticiones=0
Contraste, misma prueba:
«New List»          (/masters/price-lists)   → navega a /masters/price-lists/new
«Create journal»    (/accounting/journals)   → navega a /accounting/journals/new
```

Los formularios de destino existen y funcionan: escribiendo `/customer-receipts/new` en la barra de
direcciones registré un cobro de 3.540,00 DOP que la contabilidad trató **correctamente** (ver
costura ✅ en §5). Pero por la interfaz **no hay forma de cobrar una factura ni de dar de alta un
banco**: se pueden emitir facturas que nunca se podrán marcar como cobradas.

---

## 3. Hallazgos altos

### A-01 · Bug + desconexión front-back · «Mark as paid» de la nómina falla siempre: los sueldos se quedan como deuda

**Módulo y flujo:** RR.HH. y Nómina › Corrida aprobada › «Mark as paid»

**Pasos:** aprobar una corrida y pulsar «Mark as paid».
**Esperado:** pide la cuenta bancaria y asienta el pago (Dr Remuneraciones por Pagar / Cr Bancos).
**Real:** no pregunta nada, envía el cuerpo vacío y el API exige la cuenta.

```
POST /payroll/runs/…/pay        REQ: {}
→ 400 {"code":"payroll.paying_payroll_requires_selecting_bank_account"}
Pantalla: «Error — The operation could not be completed.»
```

Los 32.931,50 DOP quedan indefinidamente en «Remuneraciones y Prestaciones por Pagar». La costura
Nómina → Tesorería está cortada en el último paso, justo después de que todo lo anterior funcionara.

### A-02 · Permisos + UX · En una empresa con un solo administrador la nómina no se puede aprobar nunca

**Módulo y flujo:** RR.HH. y Nómina › Corrida calculada › «Approve»

El backend aplica segregación de funciones —quien calcula no puede aprobar— y hace bien. Pero:

```
POST /payroll/runs/…/approve
→ 403 {"code":"payroll.whoever_approves_payroll_cannot_whoever_calculated"}
Pantalla: «Error — The operation could not be completed.»
```

El botón «Approve» se le ofrece precisamente a la persona que no puede usarlo, y el mensaje no dice
que hace falta otra persona. Con un segundo usuario administrador la aprobación funciona a la
primera y el asiento es impecable (§5). El agravante: dar de alta a ese segundo usuario exige que
llegue un correo de invitación, y el producto no ofrece reenviarlo ni copiar el enlace (M-06), de
modo que un inquilino recién creado puede quedarse sin forma de aprobar su primera nómina.

### A-03 · Bug · El saldo inicial de una cuenta bancaria es imposible: su contrapartida no tiene opciones

**Módulo y flujo:** Tesorería › Nueva cuenta bancaria (`/accounting/treasury/bank-accounts/new`)

**Pasos:** rellenar nombre, banco, número, moneda DOP, cuenta contable `1120 — Bancos`, saldo inicial
50.000, fecha de apertura 2026-09-01; pulsar «Save».

**Esperado:** se crea la cuenta con su asiento de apertura.
**Real:** «Check 1 item(s) before saving — "Counterpart account" is required», y el desplegable de
contrapartida contiene **una sola entrada: «Select…»**.

```
Opciones leídas del DOM en «Counterpart account»: ["Select…"]
Con saldo inicial 0 el campo desaparece y la cuenta se crea (POST /treasury/bank-accounts → 201).
```

Es decir: se pueden registrar bancos, pero **nunca con su saldo real**. Y la vía alternativa —un
asiento manual de apertura— está cerrada por C-01.

### A-04 · Dato mock detectado · Importar y Exportar datos muestran un historial inventado, con botones de descarga muertos

**Módulo y flujo:** Espacio de trabajo › Importar datos · Exportar datos

**Pasos:** abrir `/data-imports` y `/data-exports`; observar la red (cero llamadas de datos).

```
/data-imports — filas dibujadas por el componente:
  Customers | clientes_julio.csv    | Jul 25, 2025 | Admin Principal | Completed  | 150 | 0
  Products  | catalogo_inicial.xlsx | Jul 22, 2025 | Admin Principal | Failed     |  80 | 15
  Customers | nuevos_contactos.csv  | Jul 20, 2025 | Ana Pérez       | Processing | 200 | 0

/data-exports:
  Customers | CSV  | Jul 26, 2025 | Admin Principal | Completed | [Download]
  Invoices  | XLSX | Jul 25, 2025 | Admin Principal | Completed | [Download]
  Sales     | CSV  | Jul 24, 2025 | Ana Pérez       | Failed    |

Peticiones al API en ambas pantallas: ninguna.
«Download» es <a href="#">: clic real → Δhtml=0, red=0, sin descarga, sin aviso.
```

Son registros de auditoría fabricados —importaciones que nunca ocurrieron, atribuidas a usuarios que
no existen— en las dos pantallas que un cliente usa para confiar en que sus datos entraron. La ronda
anterior limpió la ficción de los siete maestros (C-03 de aquel informe); estas dos quedaron.

### A-05 · UX · Un documento fiscal irreversible se emite con un solo clic y sin confirmación

**Módulo y flujo:** Ventas › Nueva factura › «Issue invoice»

**Pasos:** elegir cliente y producto, pulsar «Issue invoice» una vez; observar la pantalla cada 400 ms.

```
t=0,4 s … t=4,0 s   diálogos en pantalla: 0
POST /invoices → 201 inmediato
Resultado: FAC-00000002, NCF E320000000002 consumido, dos asientos publicados, stock descontado
```

No hay confirmación, ni resumen de efectos, ni aviso de que se consumirá un número fiscal. La
comparación interna es el argumento más fuerte: **una factura de proveedor en borrador —reversible—
sí pide confirmación**, con un texto excelente («The bill goes to approval and, if no policy holds
it, is posted immediately»), y la corrida de nómina también («Approving posts the accounting entry…
A mistake found afterwards can only be fixed by an adjustment run»). La única acción del producto
que no se puede deshacer ante la DGII es la única que no pregunta.

### A-06 · Robustez · La aplicación se autolimita: navegar entre dos pantallas recarga las demás hasta provocar 429, y los datos desaparecen sin avisar

**Módulo y flujo:** transversal (arquitectura de ventanas)

**Pasos para reproducir**
1. Abrir Contabilidad › Asientos y Contabilidad › Diario general (dos ventanas).
2. Alternar 12 veces entre Ventas › Facturas y Ventas › Clientes — dos pantallas que nada tienen
   que ver con asientos.
3. Volver a la ventana de Asientos.

```
Peticiones a /journal-entries disparadas por esa navegación: 24  (2 por cada cambio de pantalla)
De ellas rechazadas con 429: 7
Avisos mostrados al usuario mientras ocurría: ninguno
Al volver a Asientos: 0 filas y «The journal entries could not be loaded.» + «Try again»
```

Cada ventana abierta vuelve a pedir sus datos en **cada** cambio de ruta, aunque no esté visible. El
coste por navegación crece con las pestañas abiertas (medido: 4 peticiones con 2 pestañas, 8 con 9),
y el límite del propio API (20 peticiones/minuto por endpoint) se alcanza solo. La aplicación ociosa,
en cambio, no consulta nada en 75 s: el problema es exclusivamente el refresco de ventanas inactivas.

### A-07 · Bug fiscal · Las facturas de compra no capturan ITBIS: no hay crédito fiscal ni 606 completo

**Módulo y flujo:** Compras › Nueva factura de proveedor

Campos del formulario: proveedor, NCF, fechas, moneda, forma de pago (01–07 de la DGII), y por línea
descripción, cantidad, precio y cuenta de gasto. **No hay ningún campo de impuesto.**

```
Factura de 5.000,00 registrada y aprobada:
  COMPRAS-2026-000001 · Dr 5300 Alquileres 5.000,00 / Cr 2110 CxP 5.000,00
No existe línea de ITBIS pagado (crédito fiscal), ni cuenta 1150/«ITBIS Adelantado».
```

La venta modela el ITBIS con tres tratamientos (Taxed/Zero-rated/Exempt), dos tasas y cuatro
retenciones; la compra no modela ninguno. Sin ITBIS en compras no hay crédito fiscal que deducir ni
formato 606 completo, que es justo lo que el panel de Ajustes ofrece generar.

### A-08 · UX / seguridad observable · Una cuenta bloqueada por intentos fallidos dice «tu sesión ha expirado»

**Módulo y flujo:** Autenticación › Login

**Pasos:** fallar 5 veces la contraseña; después escribirla bien.

```
Base de datos:  failed_login_attempts = 5 · lockout_until = 2026-09-15 02:02:27+00  (15 minutos)
API:            401 {"code":"AUTH_USER_BLOCKED","messageKey":"errors.auth_user_blocked"}
Pantalla:       «Your session is not valid or has expired. Sign in again.»
```

El backend distingue perfectamente el caso; la pantalla muestra el mensaje de otro. Al usuario se le
pide hacer exactamente lo que va a seguir fallando, no se le dice que hay un bloqueo ni cuándo
termina. El mecanismo en sí (5 intentos, 15 minutos) es correcto.

### A-09 · UX / patrón · Los mensajes de error descartan el motivo preciso que el backend sí envía

**Módulo y flujo:** transversal

En los cinco fallos que provoqué a propósito, el API respondió con un código accionable y la pantalla
mostró una frase genérica:

| Acción | Código del API | Lo que ve el usuario |
|---|---|---|
| Asiento manual | `validation.constraints.whitelist_validation` (`ledgerId`) | «The journal entry could not be created.» |
| Cliente sin correo | `validation.constraints.is_email` (`email`) | «Error creating the customer.» |
| Proveedor sin correo | `validation.constraints.is_email` (`email`) | «Error creating the supplier.» |
| Aprobar nómina | `payroll.whoever_approves_payroll_cannot_whoever_calculated` | «The operation could not be completed.» |
| Pagar nómina | `payroll.paying_payroll_requires_selecting_bank_account` | «The operation could not be completed.» |
| Asiento en cuenta de cabecera | `journal_entries.account_code_p2_does_not_accept` (params: 1000, Activo) | «The journal entry could not be created.» |

Es llamativo porque el mismo producto hace lo contrario, y muy bien, en la validación de formulario
(«Check 2 item(s) before saving — "Currency" is required, "Ledger account" is required») y en el
límite de intentos («Too many attempts. Wait a moment before trying again»). El motivo se pierde
solo al cruzar la frontera del API.

---

## 4. Hallazgos medios y bajos

| Id | Módulo y flujo | Categoría | Sev. | Observación y evidencia |
|---|---|---|---|---|
| M-01 | Análisis › Panel financiero | UX / i18n | Media | El panel de alertas imprime las claves en crudo. `GET /dashboard/alerts` → `[{"messageKey":"dashboard.alerts.receivables_overdue","params":{"count":2,"amount":5310}}, {"messageKey":"dashboard.alerts.period_period_still_open_closing_date","params":{"period":"Enero 2026"}}]`; la pantalla muestra literalmente `dashboard.alerts.receivables_overdue`. Es la portada financiera del producto. |
| M-02 | Nómina › Parámetros legales | UX / i18n | Media | Una cabecera de columna se muestra como `payroll.parameters.key_label`. |
| M-03 | Ventas › Nueva factura (rol SELLER) | Permisos / UX | Media | Con rol vendedor, `GET /currencies` → **403** y el desplegable «Currency *» queda con **0 opciones**, sin ningún aviso. La factura se emite igualmente con la moneda de la organización (probado: FAC-00000003), pero un vendedor no puede facturar en otra divisa y el asterisco de obligatorio miente. |
| M-04 | Transversal › Barra lateral (rol SELLER) | Permisos / UX | Media | El vendedor ve los 9 módulos aunque sus permisos sean 7 (`customers:*`, `products:view`, `invoices:*`). Al entrar por URL a rutas ajenas el producto ahora **sí** explica («Access Denied — You do not have the permissions needed to reach this…», 4 de 4 rutas probadas), pero el menú sigue ofreciendo lo que no se puede abrir. |
| M-05 | Ventas › Punto de venta | UX | Media | Tras «Charge» el pedido desaparece y **no hay recibo, número de venta ni confirmación**: el cajero no tiene cómo saber si cobró. Tampoco hay importe entregado ni cálculo de cambio, ni selección de forma de pago (en Historial la venta sale con método «—» y el identificador es un trozo de UUID, «9b2cd1de»). |
| M-06 | Ajustes › Usuarios | UX | Media | La invitación se crea (estado «Pending») pero el correo falla en silencio (`mail_delivery_failed` en el log del API, 2 veces) y la pantalla no lo dice, no ofrece reenviar ni copiar el enlace. La única acción de la fila es un botón de icono **sin nombre accesible** (`title` y `aria-label` nulos). |
| M-07 | Autenticación › Login | Robustez | Media | El límite de intentos es **por IP, no por cuenta**: agotado el cupo con un correo, otros cinco correos distintos desde la misma IP fueron rechazados con 429. Y **cada reintento rearma el bloqueo**: reintentos cada 15–20 s devolvieron 429 durante más de 8 minutos, y un único intento tras 60 s de silencio total entró a la primera. El `retry-after` que envía (9 s, 27 s) no describe ese comportamiento. Una oficina detrás de una sola IP comparte el cupo de 5/minuto. |
| M-08 | Ajustes › Facturación electrónica | UX / i18n | Media | Con interfaz en inglés aparecen frases en español: «Requires: su certificado digital de la DGII», «Contabilidad, inventario, compras, tesorería y reportes financieros», el botón **«Descargar»** de los reportes 606/607 y el estado **«Activo»** en la tabla de rangos e-NCF. |
| M-09 | Ventas › Cobros | UX | Media | Guardé un recibo de 3.540,00 sin aplicarlo y el producto lo aceptó sin una palabra, aunque el cliente tenía dos facturas abiertas y una de ellas coincidía **exactamente** con el importe. El tratamiento contable es correcto (Cr «Anticipos de Clientes»), pero nadie avisa de que el dinero quedó como anticipo en lugar de cobrar la factura. |
| M-10 | Autenticación › Sesión | UX | Media | Perdida la sesión, el producto lleva al login **sin explicar por qué** («Access your workspace to continue»). Además la URL cambia de forma: `/auth/login` al entrar, `/en/auth/login` al ser expulsado. |
| M-11 | Nómina → Contabilidad | Estilo | Media | La descripción del asiento repite la palabra: «Nómina Nómina 08/2026». |
| M-12 | Análisis › Flujo de efectivo | UX | Media | Es el único estado financiero que lista **códigos de cuenta desnudos** («3150 36.000,00», «1140 −33.300,00»); balance, resultados y balanza muestran código y nombre. |
| B-01 | Inventario · Tesorería · Administración | UX | Baja | Cinco maestros son marcadores honestos («This module is under construction…»): almacenes, unidades de medida, bancos, métodos y términos de pago. La ficción de la ronda anterior desapareció, pero con ella la capacidad: sin almacenes no hay inventario multi-almacén, y `GET /warehouses` responde 404 (`/units-of-measure` sí existe y devuelve 0). |
| B-02 | Transversal › Pestañas | UX | Baja | El diálogo al cerrar una pestaña con cambios («You have unsaved changes in "New customer". What would you like to do?») ofrece **Cancel** y **Discard**, pero no **Save**. |
| B-03 | Administración › Proveedores | Navegación | Baja | `/masters/contacts/suppliers` muestra «under construction» mientras `/masters/suppliers` es la pantalla real y funcional: dos rutas para lo mismo, una de ellas vacía. |
| B-04 | Inventario › Nuevo producto | Accesibilidad | Baja | La etiqueta dice «Product Name *» pero el `input` no lleva `required`. La validación del cliente sí funciona y marca `aria-invalid` (hallazgo B-02 de la ronda anterior, corregido). |
| B-05 | Nómina › Nueva corrida | UX | Baja | El mes se propone como el **anterior** al actual (14/09/2026 → «Month 8»), sin decir que es el mes cerrado que se va a liquidar. |
| B-06 | Ajustes › Multimoneda | Dato | Baja | La organización sembrada para República Dominicana tiene **USD** como moneda base (`localeContext.currency: "USD"`, y «Dólar estadounidense … Yes» en el listado), mientras cada documento se emite en DOP. |

---

## 5. Costuras entre módulos

Ejecutadas de principio a fin por la interfaz y verificadas en el módulo de destino **contra la base
de datos**.

| Flujo | Resultado observado | Veredicto |
|---|---|---|
| Alta de producto con stock → Contabilidad | `GENERAL-2026-000001` · Dr 1140 Inventarios 36.000,00 / Cr 3150 Patrimonio 36.000,00 (40 × 900) | ✅ Correcto |
| Factura emitida → Inventario | stock 40 → 38 | ✅ Correcto |
| Factura emitida → Contabilidad (ingreso) | `VENTAS-2026-000001` · Dr CxC 3.540 / Cr Ingresos 3.000 / Cr ITBIS 540 | ✅ Correcto |
| Factura emitida → Contabilidad (costo) | `GENERAL-2026-000002` · Dr Costo 1.800 / Cr Inventarios 1.800 | ✅ Correcto |
| Factura emitida → Secuencia fiscal | NCF `E320000000001` consumido del rango registrado en Ajustes | ✅ Correcto |
| Venta → Antigüedad de cobrar | 5.310,00 en «Current»; subledger 5.310,00 = mayor 5.310,00, diferencia **0,00** | ✅ Correcto |
| Cobro registrado → Contabilidad | `COBROS-2026-000001` · Dr 1120 Bancos 3.540 / Cr 2170 Anticipos de Clientes 3.540 (recibo sin aplicar, tratamiento correcto) | ✅ Correcto |
| Factura de proveedor aprobada → Contabilidad | `COMPRAS-2026-000001` · Dr 5300 Alquileres 5.000 / Cr 2110 CxP 5.000 | ✅ Correcto |
| Compra → Antigüedad de pagar | Proveedor con 5.000,00; subledger = mayor, diferencia **0,00** (el C-04 de la ronda anterior, corregido) | ✅ Correcto |
| **Nómina → Contabilidad** | `NOMINA-2026-000001` · Dr Sueldos 35.000 + Dr Aportes Patronales 5.701,50 / Cr Neto 32.931,50 + AFP 3.489,50 + SFS 3.545,50 + SRL-INFOTEP 735 = **40.701,50 = 40.701,50** | ✅ Correcto |
| Todo lo anterior → Estados financieros | La balanza se declara cuadrada y lo está: en el momento de la comprobación, 49.950,00 / 49.950,00 por columna; margen bruto 41,3 % coherente con ingresos 4.600 y costo 2.700. Al cierre de la sesión, 11 asientos con 96.021,50 al debe y 96.021,50 al haber | ✅ Correcto |
| Rol SELLER → resto de módulos | 4 de 4 rutas prohibidas redirigen a `/unauthorized` con explicación | ✅ Correcto |
| **POS → Contabilidad** | Venta de 1.770,00 sin asiento; mayor de inventario 900,00 por encima del almacén | ❌ Falla · C-02 |
| **Nómina → Tesorería** | «Mark as paid» → 400; los 32.931,50 quedan como deuda | ❌ Falla · A-01 |
| **Ventas → Cobros** | No hay forma de registrar un cobro desde la interfaz (enlace muerto) | ❌ Falla · C-04 |
| **Tesorería → Contabilidad (apertura)** | No hay forma de dar saldo inicial a un banco | ❌ Falla · A-03 |
| Factura → DGII (e-CF) | No verificable sin certificado de firma | ⛔ Limitación |

Las once costuras contables encadenadas cuadran **todas**, y los dos informes de antigüedad concilian
contra su cuenta de control con diferencia 0,00. Las cuatro roturas son de superficie: un asiento que
no se dispara, un cuerpo de petición vacío, un `href` mal resuelto y un desplegable sin opciones.

---

## 6. Lo que está bien hecho

- **El motor de partida doble.** Once asientos publicados en la sesión, todos cuadrados, con ITBIS
  separado, costo de ventas perpetuo y asiento de inventario inicial.
- **La nómina dominicana es de primer nivel.** Sobre 35.000,00 DOP calculó AFP 1.004,50 (2,87 %),
  SFS 1.064,00 (3,04 %), ISR 0,00 (correcto: la base anualizada queda bajo el exento) y aportes
  patronales 5.701,50 (AFP 2.485 + SFS 2.481,50 + SRL 385 + INFOTEP 350). Historial salarial con
  vigencia («A raise adds a line with the date it takes effect; it never rewrites what a past
  payroll was computed on»), cálculo de prestaciones antes de despedir y descarga del SUIR.
- **Segregación de funciones real** en la nómina, no declarativa: el backend rechaza al mismo
  aprobador.
- **Diálogos de confirmación que explican consecuencias**, no que preguntan «¿está seguro?»:
  «Approving posts the accounting entry and closes the run to edits. A mistake found afterwards can
  only be fixed by an adjustment run.»
- **Ajustes de auditoría bien pensados:** solo ofrece años **cerrados** y lo explica («an open year
  takes an ordinary entry»); la acción se llama «Propose adjustment».
- **Conciliación visible al usuario:** los dos informes de antigüedad muestran subledger, mayor y
  diferencia, y afirman «The subledger agrees with its control account».
- **Validación de formulario ejemplar:** «Check 2 item(s) before saving» con el detalle por campo y
  `aria-invalid` en el campo inválido.
- **Pestañas con estado:** lo escrito sobrevive al cambio de ventana y cerrar con cambios avisa.
- **Step-up por acción protegida:** invitar a un usuario exige revalidar la contraseña
  («Security Verification — PROTECTED ACTION»).
- **Seguridad observable sólida:** `401` idéntico para buzón inexistente y contraseña incorrecta;
  `401` sin cookie en `/invoices` y `/customers`; límite de 5 intentos/minuto con mensaje claro;
  bloqueo de cuenta a los 5 fallos; número de cuenta bancaria enmascarado («••••4567»); documento de
  identidad del empleado cifrado («Encrypted. Leave blank to keep the current one»).
- **XSS neutralizado:** `<img src=x onerror=alert(1)>` como nombre de producto se almacena literal,
  se renderiza escapado y no inyecta ningún `<img>` (0 nodos) ni ejecuta nada.
- **Doble envío controlado:** dos clics inmediatos en «Save product» → un único `POST`, un registro.
- **Franqueza sobre lo no construido:** cinco maestros y cuatro módulos de hoja de ruta se declaran
  en construcción en lugar de fingir (salvo A-04).
- **Los 22 hallazgos de la ronda anterior están corregidos**, verificado uno a uno: cero
  `[object Object]` en 89 rutas, fechas correctas en documentos y estados financieros, turno de POS
  que abre, antigüedad de pagar mostrando proveedores, «New Account» llevando al formulario real,
  número de asiento en el diario general, botones de nómina que abren formulario, maestros sin
  ficción, `aria-invalid`, y ni un solo error de JavaScript en las 89 rutas —los únicos errores de consola
  fueron la carga del script externo de reCAPTCHA, inalcanzable en un entorno sin salida a Google
  (`ERR_CERT_AUTHORITY_INVALID`), que ya no bloquea el envío del formulario de login.

---

## 7. Scorecard por módulo (1–10, sobre lo observado)

Ejes independientes. Cada nota se sostiene en algo que vi en la aplicación, no en una impresión.

| Módulo | Madurez | Robustez | Seguridad | UX | Compet. |
|---|---|---|---|---|---|
| **Contabilidad** | 5 | 9 | 8 | 3 | 5 |
| **Análisis y Reportes** | 8 | 8 | 8 | 6 | 7 |
| **Ventas y Facturación** | 7 | 7 | 8 | 5 | 7 |
| **Punto de venta** | 3 | 4 | 7 | 3 | 2 |
| **Compras y Proveedores** | 6 | 7 | 8 | 6 | 5 |
| **Inventario** | 5 | 7 | 8 | 6 | 4 |
| **RR.HH. y Nómina** | 7 | 7 | 9 | 5 | 8 |
| **Tesorería** | 3 | 6 | 8 | 3 | 3 |
| **Autenticación y Usuarios** | 8 | 6 | 9 | 5 | 7 |
| **Configuración** | 6 | 7 | 9 | 6 | 5 |

**Contabilidad** — Madurez 5 y UX 3 porque el asiento manual, la operación más elemental del módulo,
es imposible (C-01); Robustez 9 porque todo lo que el motor sí ejecuta cuadra (once asientos,
balanza 49.950,00/49.950,00) y rechaza lo que debe rechazar (cuenta de cabecera 1000, asiento
descuadrado). Competitividad 5: Odoo y SAP Business One dan por sentado el asiento manual; aquí hay
que usar el API.

**Análisis y Reportes** — Balance, resultados, balanza y flujo de efectivo derivan consistentes de
los asientos y los dos informes de antigüedad concilian con diferencia 0,00, algo que NetSuite cobra
como módulo aparte. Bajan UX las claves i18n en crudo del panel financiero (M-01) y los códigos sin
nombre del flujo de efectivo (M-12).

**Ventas y Facturación** — El ciclo borrador → emisión con e-NCF funciona y el modelo fiscal (tres
tratamientos, dos tasas, cuatro retenciones, 12 tipos de comprobante) es más fino que el de Odoo para
República Dominicana. Penalizan la emisión sin confirmación (A-05) y que el ciclo no se pueda cerrar
con un cobro (C-04).

**Punto de venta** — Notas bajas con la evidencia más simple del informe: cobré 1.770,00 DOP y la
contabilidad no se enteró (C-02), y como cajero no obtuve recibo ni confirmación (M-05). Sin importe
entregado ni cambio, está por detrás de cualquier POS comercial.

**Compras y Proveedores** — Flujo proveedor → factura → aprobación → asiento correcto, con formas de
pago DGII y cuenta de gasto por línea, y confirmación que explica lo que va a pasar. Competitividad 5
por la ausencia total de ITBIS en compras (A-07), que en este mercado es requisito, no extra.

**Inventario** — Productos y categorías funcionan y el descuento de stock con la venta es atómico
(40 → 38). Bajan la madurez los almacenes en construcción (B-01) y, sobre todo, que el mayor de
inventario ya no coincida con el almacén por culpa del POS (C-02).

**RR.HH. y Nómina** — Lo mejor construido del producto en corrección de dominio: tasas dominicanas
exactas, historial salarial con vigencia, prestaciones, SUIR, segregación de funciones (Seguridad 9).
Baja UX por el mensaje genérico del 403 (A-02) y Madurez por el pago que nunca se puede asentar
(A-01).

**Tesorería** — Madurez y UX 3: no se puede crear una cuenta desde su propia pantalla (C-04), no se
puede darle saldo inicial (A-03) y tres de sus maestros están en construcción (B-01). Lo que sí
existe —posición de caja, transferencias, número enmascarado— está bien resuelto.

**Autenticación y Usuarios** — Seguridad 9 por lo verificado (paridad de errores, 401 sin cookie,
step-up, bloqueo de cuenta, permisos reales por rol). Robustez 6 y UX 5 por el bloqueo que se
prolonga con cada reintento y se comunica como «sesión expirada» (A-08, M-07), y por el menú que
ofrece a un vendedor módulos que no puede abrir (M-04).

**Configuración** — El panel fiscal resuelve bien un problema difícil (certificado, rangos e-NCF,
606/607) y fue el remedio que la propia factura ofreció y que funcionó a la primera. Bajan las
frases en español dentro de la interfaz en inglés (M-08) y que solo se llegue por el menú del avatar.

---

## 8. Flujos cruzados que fallaron

Los que ninguna auditoría por módulo puede detectar: cada módulo implicado pasa sus propias pruebas.

1. **POS → Contabilidad e Inventario.** El POS vende bien y el inventario baja bien; el asiento no
   existe. Resultado: 1140 en 33.300,00 contra 32.400,00 de almacén, 1.500,00 de ingreso y 270,00 de
   ITBIS fuera de los libros. *(C-02)*
2. **Nómina → Tesorería.** La corrida calcula, aprueba y asienta impecablemente; el pago nunca se
   puede registrar porque la pantalla no pide la cuenta bancaria que el API exige. *(A-01)*
3. **Ventas → Cobros → Tesorería.** Se pueden emitir facturas y verlas envejecer en el informe de
   antigüedad, pero no cobrarlas: el botón que abre el formulario de cobro apunta a su propia
   página. *(C-04)*
4. **Tesorería → Contabilidad (saldos de apertura).** Un banco solo se puede crear con saldo cero, y
   la vía alternativa (asiento manual de apertura) está cerrada por C-01. Ninguna de las dos puertas
   abre. *(A-03 + C-01)*
5. **Usuarios → Nómina.** La segregación de funciones exige dos personas; dar de alta a la segunda
   exige un correo que el producto no puede reenviar ni mostrar como enlace. Un inquilino nuevo puede
   quedar sin forma de aprobar su primera nómina. *(A-02 + M-06)*
6. **Permisos → Ventas.** El rol que debe facturar no puede leer el catálogo de monedas (403), así
   que su campo obligatorio «Currency *» aparece vacío. *(M-03)*

---

## 9. Alcance y límites de la prueba

**Lo que no pude probar, y por qué**

- **Envío real de e-CF a la DGII.** Requiere certificado de firma digital y salida a Internet. El
  panel acepta el certificado y los rangos; la emisión consume NCF correctamente, pero el diálogo con
  la DGII queda sin verificar.
- **Cobros con Stripe.** Sin credenciales (`STRIPE_SECRET_KEY` ausente, como documenta el README).
- **Aceptación de una invitación.** Sin SMTP el correo no sale y el token se guarda cifrado, así que
  el flujo no se puede completar por la interfaz. Para poder probar roles y la aprobación de nómina
  **activé dos usuarios escribiendo directamente en la base** (`qa-vendedor`, rol SELLER;
  `qa-contadora`, rol ADMINISTRATOR), copiando el hash de contraseña del usuario de desarrollo. Es un
  atajo del arnés de prueba, no un comportamiento del producto: queda dicho explícitamente porque
  afecta a cómo se llegó a los hallazgos A-02 y M-03.
- **Ajustes de auditoría de punta a punta.** La pantalla solo ofrece años fiscales **cerrados** y en
  la organización de prueba no hay ninguno. El formulario está completo y bien explicado; no pude
  proponer un ajuste real.
- **Conciliación bancaria.** Las pantallas cargan y consultan el API, pero no hubo extracto real que
  importar.
- **Aislamiento entre inquilinos.** Solo existió una organización; no ejercité el acceso cruzado
  entre tenants (el repositorio tiene verificadores propios para eso, `verify:tenancy` y
  `verify:rls`, que no forman parte de esta prueba de interfaz).
- **Marketplace de extensiones.** `/masters/extensions` carga y consulta `/extensions`,
  `/extensions/runtime` y `/extensions/consents` (200), pero sin ninguna extensión firmada
  disponible no hay instalación que probar.

**Datos de prueba creados** (prefijo `TEST-QA`, sobre base local efímera, nunca datos de cliente):
2 productos, 1 cliente, 1 proveedor, 1 categoría de departamento, 1 empleado con salario, 1 cuenta
bancaria, 3 facturas de venta (FAC-00000001 a 03, NCF E320000000001 a 03), 1 factura de proveedor
(B0100000001), 1 venta de POS, 1 recibo de cobro (REC-2026-000001), 1 corrida de nómina 08/2026,
1 rango e-NCF E32, 1 asiento manual por API y 2 usuarios activados por base de datos.
