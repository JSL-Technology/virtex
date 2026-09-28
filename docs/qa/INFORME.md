# Informe de pruebas E2E exploratorias — Virtex ERP

**Fecha:** 28-09-2026 · **Rama:** `claude/e2e-qa-all-modules-lo7usn` (base `4d26bfce`) · **Rol:** QA E2E exploratorio (uso real de la aplicación en navegador, no lectura de código).
**Archivos relacionados:** [`MATRIZ_COBERTURA.md`](MATRIZ_COBERTURA.md) (cada elemento por página) · [`PROGRESO.md`](PROGRESO.md) (bitácora de la sesión) · [`harness/`](harness/) (scripts reproducibles) · [`evidence/`](evidence/) (capturas citadas).

---

## 1. Resumen ejecutivo

La aplicación **no es utilizable tal como está en la rama**: con la dependencia `dockview-angular@8.3.1` (subida el día anterior en `657c5f5d`) **ninguna página muestra su contenido**, y cualquier recarga (F5) o enlace directo con sesión abierta **congela la pestaña del navegador**. Para poder evaluar el resto se instaló localmente la versión anterior (6.6.1) y se navegó siempre dentro de la SPA (ver §2).

Con esas dos condiciones, el núcleo contable está **bien diseñado y en general correcto**: una venta genera CxC/Ingresos/ITBIS y Costo/Inventario cuadrados; los cobros, la factura de proveedor y su pago, el ajuste de inventario y la nómina (AFP, SFS, ISR verificados a mano) se contabilizan bien y se reflejan en balanza, estados financieros, antigüedad de saldos y rentabilidad. El backend aplica permisos por rol y segregación de funciones en nómina.

Pero hay **9 defectos críticos** que rompen flujos esenciales, entre ellos:

- **Eliminar un cliente borra en cascada sus facturas fiscales (con e-NCF) y sus cobros**, dejando los asientos huérfanos y la cartera descuadrada contra el mayor.
- **No se pueden crear clientes ni proveedores desde la UI**, **ni registrar asientos manuales**, **ni cerrar un período**, **ni cobrar en el POS**, **ni pagar una nómina**; y **la recepción de una orden de compra no mueve stock ni contabilidad**.

Además aparecen fallos sistémicos: desalineación de contratos front-back (el cliente envía campos que el DTO rechaza), errores del servidor que la UI no muestra (fallos silenciosos), un step-up de seguridad que bloquea al usuario en uso normal, pantallas mock (Importar/Exportar datos, DataSheets) y un 55 % de Ajustes marcado "en desarrollo".

| Severidad | Nº |
|---|---|
| Crítica | 9 |
| Alta | 17 |
| Media | 17 |
| Baja | 2 (agrupan ~15 detalles) |

**Cobertura:** 89/89 rutas sin parámetro visitadas + 20 secciones de Ajustes + login, activación y cierre de sesión; **986 interacciones registradas** en la matriz (**95 % probadas**; 45 no probadas, todas con su razón) y **~55 flujos guiados** (formularios con casos válidos, vacíos, inválidos, límite, texto largo y caracteres especiales; flujos cruzados; 4 roles). Detalle en §8.

---

## 2. Entorno y condiciones de la prueba

- **Entorno:** confirmado con el usuario: levantar en local (nunca producción). Postgres 16 + Redis 7 nativos, `npm run migration:run`, API NestJS en :3000 y cliente Angular en :4200 (`nx serve`). Chromium headless (Playwright 1.56).
- **Usuarios:** administrador sembrado `dev@virtex.local` (empresa "Virtex Dev", DO). Para activar el seed hubo que exportar `DEV_SEED=true` y una `DEV_SEED_PASSWORD` de 12 o más caracteres (el README dice que es automático: ver M-16). Se invitaron y activaron `qa-vendedor` (SELLER), `qa-contador` (ACCOUNTANT), `qa-miembro` (MEMBER) y `qa-accountant` (2.º ADMINISTRATOR).
- **Datos:** todo lo creado lleva el prefijo **QA-/qa-**. Las acciones destructivas solo se ejecutaron sobre esos datos, salvo el intento de cierre de enero de 2026, un período vacío de la base local creada para esta sesión.
- **Efectos externos:** no hubo. El correo sale a `127.0.0.1:587` (sin SMTP; los jobs quedan fallidos en la cola local, desde donde se leyeron los enlaces de invitación como si fuera un buzón de prueba). No se configuraron Stripe ni certificado DGII. reCAPTCHA y Google Fonts no son alcanzables desde el contenedor, lo cual es una limitación del entorno: la app degrada tras 8 s.
- **Condición 1 (QA C-01):** con `dockview-angular@8.3.1` nada se renderiza. Se instaló `dockview-angular@6.6.1` con `--no-save` (sin tocar `package.json` ni el lockfile). **Todo lo demás se probó con 6.6.1.**
- **Condición 2 (QA C-02):** como recargar congela la app, la navegación se hizo dentro de la SPA (`history.pushState`, barra lateral y enlaces).
- **Throttling:** para no esperar ventanas de 15 min, entre scripts se limpiaron los contadores de throttling y de step-up en el Redis local (`harness/reset-throttle.sh`). Esto no altera el hallazgo A-02, que se observó antes de cualquier limpieza.

---

## 3. Hallazgos

Formato de cada hallazgo: **Módulo y flujo · Categoría · Severidad**, luego pasos, esperado frente a real, y evidencia. Las capturas están en `evidence/`.

### 3.1 Críticos

#### C-01 · Plataforma (todas las páginas) — ninguna página renderiza su contenido
- **Categoría:** bug (dependencia) · **Severidad:** crítica
- **Pasos:** `npm ci` en la rama → `nx serve api` + `nx serve client-web` → iniciar sesión → abrir cualquier página (Inicio, Impuestos, Facturas…).
- **Esperado:** el contenido de la página. **Real:** la pestaña se abre pero el panel queda en blanco. El `app-tab-wrapper` no crea el componente (`compRef` nulo, `mountedSig` vacío). Con `dockview-angular@6.6.1` todo vuelve a funcionar.
- **Evidencia:** `evidence/00-after-login.png`, `evidence/02-spa-masters_taxes.png`. El commit `657c5f5d` ("bump 5 CI-verified dependency updates", #101) subió `dockview-angular` de 6.6.1 a 8.3.1 mientras `dockview` quedó en 6.6.1.

#### C-02 · Sesión/Navegación — recargar (F5) o abrir una URL con sesión activa congela la pestaña
- **Categoría:** desconexión frontend-backend · **Severidad:** crítica
- **Pasos:** iniciar sesión → pulsar F5 en cualquier página, o abrir `/e/virtex-dev/masters/taxes` en otra pestaña.
- **Esperado:** la misma página. **Real:** el hilo principal queda al 92 % de CPU y la página no responde (ni captura de pantalla). La pila capturada vía CDP muestra el router serializando URLs en bucle. `POST /auth/login` devuelve `organizations:[{slug:"virtex-dev"}]`, pero `GET /auth/session` devuelve `organizations: []`, así que el guard de empresa redirige a la misma URL indefinidamente.
- **Evidencia:** `harness/02-freeze-repro.cjs`, `03-freeze-isolate.cjs` y `04-freeze-stack.cjs` (salidas en PROGRESO). También explica que tras activar una cuenta invitada el usuario vea "Acceso denegado" (M-02).

#### C-03 · Maestros/Integridad — eliminar un cliente borra en cascada sus facturas fiscales y cobros
- **Categoría:** bug (integridad de datos) · **Severidad:** crítica
- **Pasos:** Clientes → fila `QA-Cliente-01` (con FAC-00000001 cobrada y FAC-00000002 pendiente, ambas con e-NCF E32) → Eliminar → confirmar.
- **Esperado:** rechazo ("tiene documentos") o archivado. **Real:** `DELETE /customers/:id → 200`. La tabla `invoices` queda en 0 y `customer_payments` en 0, mientras los 12 asientos siguen en el mayor. La antigüedad de CxC muestra "El submayor no cuadra… Diferencia −DOP 2,360.00". El reporte 607 de septiembre sale vacío. Además, se eliminó un **producto con facturas y OC** (`DELETE /inventory/:id → 200`) y un **departamento con un empleado asignado, sin pedir confirmación** (`204`); el empleado quedó con un departamento inexistente ("—").
- **Evidencia:** `evidence/f-del-contacts_customers-QACliente01.png`, `evidence/x-post-borrado-invoices.png`, `evidence/x-post-borrado-reports_aging_receivables.png`, `evidence/x-post-borrado-hcm_employees.png`.

#### C-04 · Ventas y Compras — no se pueden crear clientes ni proveedores desde la UI
- **Categoría:** desconexión frontend-backend · **Severidad:** crítica
- **Pasos:** Clientes → Añadir cliente → llenar solo "Nombre" y "País" → Guardar. Lo mismo en Proveedores.
- **Esperado:** alta del registro. **Real:** el formulario envía `"email":""`, `"identityDocumentTypeCode":""` (y otros vacíos). `POST /customers` responde `400` (`email: is_email`, `identityDocumentTypeCode must be longer than or equal to 1`). La UI solo muestra "Error al crear el cliente." Tampoco se puede elegir un tipo de documento, porque el selector está vacío (A-07). Si se eliminan los `""` interceptando la petición, la API responde 201: el defecto es del cliente.
- **Evidencia:** `evidence/f-cli-3-valido.png`, `evidence/f-prov-minimo.png`, `harness/12-cliente-minimo.cjs` y `20-proveedor.cjs`. *Para seguir probando, cliente y proveedor QA se crearon con ese workaround.*

#### C-05 · Contabilidad — no se pueden registrar asientos manuales
- **Categoría:** desconexión frontend-backend · **Severidad:** crítica
- **Pasos:** Asientos → Nuevo asiento → Libro Principal, Diario General, descripción, 5900 D 1 500 / 1120 C 1 500 → Guardar asiento.
- **Esperado:** asiento contabilizado. **Real:** `POST /journal-entries → 400 ledgerId: whitelist_validation` (el cliente envía un campo que el DTO no admite). Toast genérico: "No se pudo crear el asiento contable."
- **Evidencia:** `evidence/f-je-6-valido.png`, `harness/24-flow-asiento.cjs`.

#### C-06 · Contabilidad — cierre de período imposible, sin mensaje y sin confirmación
- **Categoría:** bug + UX · **Severidad:** crítica
- **Pasos:** Períodos contables → "Cerrar período" en enero de 2026 (vacío).
- **Esperado:** confirmación y cierre. **Real:** no hay diálogo de confirmación pese a ser irreversible. `POST /accounting/close-period → 500 INTERNAL_ERROR`; el log muestra "Fallo en la depreciación de activos fijos: fixed_assets.depreciation_journal_deprec_not_found_create" (la empresa aprovisionada no tiene diario DEPREC). **La UI no muestra nada.** Intentar cerrar marzo antes que enero responde 400, lo cual es correcto, pero también sin mensaje. Ningún período de una empresa nueva puede cerrarse.
- **Evidencia:** `evidence/f-per-2-cerrar-enero.png`, `harness/27-cierre-periodo.cjs`.

#### C-07 · Compras → Inventario/Contabilidad — la recepción de una OC no mueve stock ni genera asiento
- **Categoría:** bug (flujo cruzado) · **Severidad:** crítica
- **Pasos:** OC `PO-2026-000001` (10 × QA-Producto-01 a 550 + ITBIS) → Enviar a aprobación → Aprobar → Marcar como enviada → Registrar recepción.
- **Esperado:** stock +10, movimiento de inventario y asiento Inventario/Mercancía recibida. **Real:** la OC queda "Recibida · Recibido 10", pero el stock sigue en 48, hay 0 filas en `stock_movements` y no se crea ningún asiento. Tampoco hay recepción parcial ni diálogo de cantidades.
- **Evidencia:** `harness/23-po-recepcion.cjs` (salida en PROGRESO), `evidence/f-po-3-Registrar recepción.png`.

#### C-08 · POS — no se puede cobrar ninguna venta
- **Categoría:** desconexión frontend-backend · **Severidad:** crítica
- **Pasos:** Ventas → Punto de venta → buscar "QA-Producto" → añadir → Cobrar.
- **Esperado:** venta registrada y stock descontado. **Real:** la UI calcula "Impuestos (18 %) DOP 180 · Total DOP 1,180", pero el servidor calcula el impuesto en 0 y responde `POST /pos/sales → 409 pos.totals_changed {subtotal:1000,tax:0,total:1000}`. La UI no muestra ningún mensaje y la imagen del producto aparece rota.
- **Evidencia:** `evidence/f-ws-pos-venta.png`.

#### C-09 · Nómina → Tesorería — una nómina aprobada no se puede pagar
- **Categoría:** desconexión frontend-backend · **Severidad:** crítica
- **Pasos:** Nómina 09/2026 aprobada → "Marcar como pagada" → step-up.
- **Esperado:** elegir cuenta bancaria y registrar el pago. **Real:** la UI no ofrece selector de cuenta; `POST /payroll/runs/:id/pay → 400 payroll.paying_payroll_requires_selecting_bank_account`. No se muestra ningún mensaje.
- **Evidencia:** `evidence/f-nom-Marcar como pagada.png`.

### 3.2 Altos

| ID | Módulo / flujo | Cat. | Pasos → Esperado vs Real | Evidencia |
|---|---|---|---|---|
| A-01 | Seguridad / step-up | bug | Acción protegida (p. ej. crear cuenta bancaria) → escribir **una** contraseña errónea. Esperado: "contraseña incorrecta" y reintento. Real: `POST /auth/step-up 401` → el interceptor lo trata como sesión vencida, hace `/auth/refresh` y **reenvía el intento fallido** (cuenta doble); el usuario es **expulsado al login** (`/es/auth/login?reason=expired`) con el diálogo flotando; si ya hubo intentos en la ventana, el intento correcto recibe **429 "Tu cuenta ha sido bloqueada temporalmente"**. | `A01-stepup-1-error.png`, `A01-stepup-2-bloqueo.png` |
| A-02 | Seguridad / step-up | bug/UX | Uso normal de admin sin ningún error: cuenta bancaria, pago, empleado, salario… Real: el presupuesto (5 intentos/5 min por usuario y 5/15 min por endpoint) **cuenta también los intentos correctos** → "Demasiados intentos… bloqueada". Las peticiones paralelas abren **2 diálogos apilados** que hay que confirmar dos veces. Crear un salario exige 3 step-ups con alcances distintos. | `f-nom-crear.png` |
| A-03 | Nómina / detalle | bug | Abrir Nómina 09/2026 → step-up. Real: todas las llamadas responden 200, pero la vista queda en **"Cargando" para siempre**; solo al cerrar y reabrir la pestaña se ve el contenido. Tras aprobar (201) sigue mostrando "CALCULADA". | `f-nom-abrir.png` |
| A-04 | Ajustes / Mi perfil | desconexión | Cambiar nombre → "Guardar cambios" **deshabilitado sin explicación** (Teléfono es obligatorio, sin asterisco ni mensaje). Con teléfono: `PATCH /users/profile → 400 email: whitelist_validation`. El usuario no puede editar su perfil. | `f-set-perfil-nombre.png` |
| A-05 | Contabilidad / plan de cuentas | desconexión | Editar cualquier cuenta → Guardar. Real: `PATCH → 400 reasonForChange required`, y **no hay campo de motivo** en ninguna pestaña (General, Mapeos, Reglas, Avanzado). Ninguna cuenta es editable. | `harness/54-coa-editar.cjs` |
| A-06 | Tesorería / cuenta bancaria | bug | Nueva cuenta con saldo inicial. Real: "Cuenta de contrapartida" **siempre vacía** (filtra cuentas de patrimonio dentro de una lista ya reducida a cuentas de banco) → imposible registrar saldo inicial. Al volver el saldo a 0 los campos siguen obligatorios (validadores pegados). "Cuenta contable" ofrece 1160, 1210 y 1230 como si fueran cuentas de dinero. Moneda sin DOP por defecto; IBAN "###" aceptado. | `A06-contrapartida-vacia.png` |
| A-07 | Clientes/Proveedores / tipo de documento | permisos | Abrir "Nuevo cliente". Real: `GET /localization/identity-document-types → 403` **incluso para el administrador (*)**; el selector "Tipo de documento" queda vacío. También lo dispara la búsqueda global. | `inv-ventas-contacts_customers_new.png` |
| A-08 | Plataforma / URLs relativas | desconexión | `WorkspaceSyncService` (`/api/v1/me/workspace`), `me/jobs`, `lifecycles` y `datasheets/import/modules` llaman a `localhost:4200` en lugar de la API: GET devuelve `index.html` con 200 y PUT devuelve 404. El espacio de trabajo nunca se persiste y la consola registra "no se pudo leer/guardar el espacio de trabajo". | `harness/05-panel-dom.cjs` |
| A-09 | Ventas / detalle de factura | bug/UX | En la barra, **14 de 16 botones no hacen nada**: Primero, Anterior, Siguiente, Último, Avanzar, Imprimir, Enviar por correo, Búsqueda, PDF, Excel, Word, Parametrizaciones y Ayuda. Tampoco se llama a `window.print` ni a `window.open`. "Copiar de" tampoco responde; "Copiar a" sí. **No existe Anular ni Nota de crédito.** En "Nueva factura" el buscador de Artículo tiene **ancho 0 px** (solo se usa por teclado) y el aviso "Revisa 1 punto(s)" queda pegado tras corregir. | `f-fac-3-linea.png`, `harness/42-,43-*.cjs` |
| A-10 | Datos / Importar-Exportar, DataSheets | dato mock | "Exportaciones recientes" e "Importaciones recientes" muestran historiales ficticios de julio 2025 (usuarios "Admin Principal", "Ana Pérez"; estados "Completed/Failed"). **"Generar archivo" e "Importar datos" no llaman al backend.** DataSheets trae libros de ejemplo ("Estado de Resultados Q1 — Juan Pérez", "Laptops") con fecha "ahora" que no abren. | `f-ws-export-csv.png`, `f-ws-import-csv.png` |
| A-11 | Workspace / Aprobaciones | bug (flujo cruzado) | OC y requisición en "Por aprobar". Real: **Centro de Aprobaciones y Mi trabajo: "No tienes nada pendiente"**. Las aprobaciones solo se hacen desde cada documento. | `f-ws-aprobaciones.png` |
| A-12 | Moneda (transversal) | bug | Los asientos de cobros, pagos y nómina se guardan con `currency_code NULL` y la lista de asientos los muestra en **USD**. El Dashboard muestra "EBITDA USD 1,600" y "FCF −USD 25,000" en una empresa DOP. Nueva OC, requisición y lista de precios usan USD por defecto. | `x-post-factura-dashboard.png` |
| A-13 | Contabilidad / consulta | bug | En Asientos, el número y "Más acciones" **no abren nada**: no hay forma de ver un asiento. Editar diario → `GET /journals/:id 404`. Libro Mayor sin selector de cuenta (solo se llega desde el Plan de cuentas). "Exportar" no descarga en Libro Diario, Plan de cuentas, Libro Mayor ni Historial de ventas. | `harness/49-verificar-clics.cjs` |
| A-14 | Usuarios / invitar | UX | "Rol" en Invitar usuario: el desplegable se abre **detrás del modal** (solo se ve una línea); con el ratón no se puede elegir y "Enviar invitación" queda deshabilitado. Solo funciona por teclado. | `f-zindex-rol.png` |
| A-15 | Transversal / errores silenciosos | UX | Errores del servidor sin ningún mensaje en la UI: cierre de período (400/500), aprobar nómina por quien la calculó (403, regla correcta), pagar nómina (400), POS (409), departamento vacío, nómina duplicada (409). | ver C-06, C-08, C-09 |
| A-16 | Ajustes / seguridad y estructura | bug | "Activar" 2FA no hace nada (ni red ni diálogo). "Estructura Empresarial" se queda en "Cargando subsidiarias…" **sin hacer ninguna petición**. | `f-set-2fa-aislado.png` |
| A-17 | Transversal / mensajes | UX | Errores genéricos que ocultan la causa: SKU duplicado (409), nombre >255 (400) → "Error al crear el producto."; rango NCF solapado (409) → "No se pudo registrar el rango.". Claves de traducción sin resolver: «[[taxRate]]», «[[product]]», «[[expenseAccountId]]», «[[identityDocument]]», «[[startDate]]», «[[dateColumn]]», `[[payroll.parameters.key_label.MIN_WAGE…]]`. | `f-prod-3-largo-especiales.png`, `f-com-po-2-valido.png` |

### 3.3 Medios

| ID | Módulo / flujo | Cat. | Descripción (pasos → real) |
|---|---|---|---|
| M-01 | Roles | permisos/UX | El riel lateral muestra **todos los módulos a todos los roles** (Compras, Tesorería, RR.HH., Administración a MEMBER), aunque luego muestre "Acceso denegado". MEMBER ve el botón "Nueva factura de venta". SELLER recibe 403 en `/currencies` al crear una factura (selector de moneda vacío; aun así la emite en DOP). *El backend sí aplica los permisos: ver §6.* |
| M-02 | Usuarios / activación | UX | En set-password, una contraseña débil deja el botón deshabilitado **sin decir los requisitos**. Guardar tarda 8 s sin indicador (timeout de reCAPTCHA). Tras activar, el usuario **aterriza en "Acceso Denegado"** (ver C-02). |
| M-03 | Mi perfil / contraseña | seguridad | Cambiar la contraseña **no pide la actual** (solo "Nueva" y "Confirmar"). Con una débil o no coincidente, el botón no hace nada y no muestra mensaje. |
| M-04 | Validaciones | bug | Se acepta un impuesto de **150 %**. Una línea de asiento con débito **y** crédito pasa el cliente. Nombre de producto de más de 255 caracteres: solo lo valida el backend. Teléfono "abc" e IBAN "###" se aceptan. "Tasa" 5000 en concepto de nómina → **500** (numeric overflow) en vez de 400. Se guardó una cuenta EXPENSE con categoría CURRENT_ASSET (las categorías no se filtran por tipo). |
| M-05 | Porcentajes | UX | "Desc. %" (factura) e "ITBIS" (OC) esperan fracción (0.18). Escribir "10" deja el campo inválido sin mensaje y el resumen en 0.00. Escribir "18" en la OC calcula **impuestos 99,000 sobre 5,500**. |
| M-06 | Refresco de datos | bug | Listas y detalles abiertos no se actualizan tras cambios hechos en otra pestaña: facturas en "parcial" tras cobrarlas, lista de recibos, historial salarial ("Sin salario registrado" tras un 201), nómina "CALCULADA" tras aprobar. |
| M-07 | Cobros y pagos | UX | En el recibo, al añadir una factura se aplica **el saldo total** y no el monto recibido ("No aplicado −1,360"). En pago a proveedores, el chip de la factura muestra "· · DOP 5,000.00" (sin número ni proveedor). El banco quedó en **−2,640** sin ningún aviso de sobregiro. |
| M-08 | Controles internos | seguridad | Quien crea una OC puede aprobarla (sin segregación; en nómina sí existe). Cambiar el stock desde la ficha de producto (46 → 999) contabiliza en silencio un ajuste de **571,800** sin pedir motivo ni confirmación. "Cerrar período" sin confirmación (C-06). |
| M-09 | Madurez | UX | **11 de 20 secciones de Ajustes "EN DESARROLLO"** (Contabilidad, Multimoneda, Impuestos, Cierre fiscal, Intercompañía, Secuencias, Aprobaciones, Inventario, Seguridad, Integraciones, SMTP). Cierre anual "no disponible". Manufactura, WMS, Proyectos y Compras avanzadas "PRÓXIMAMENTE". Los accesos de Inicio "Nueva cotización" y "Reportes" llevan a "módulo en construcción" (títulos "New", "Reports"). Unidades de medida no tiene botón de alta. "Nueva sucursal" y "Solicitar permiso" no hacen nada. |
| M-10 | Facturación y plan | bug | "Uso de recursos" muestra 0/∞ en facturas, clientes, etc. con datos reales. "PLAN ACTUAL Enterprise" junto a "Sin suscripción activa". Límites en inglés ("invoices/mes"). |
| M-11 | Estilos | estilo | El componente de diálogo (confirmaciones y step-up) **se ve sin estilos**: elementos sueltos sobre el fondo desenfocado. Líneas de la factura de proveedor sin estilos (etiquetas pegadas "DescripciónCant.PrecioCuenta…", inputs apilados). Formulario de almacén con etiquetas pegadas. En Importaciones, las tarjetas desbordan el panel. |
| M-12 | Login | UX | Con credenciales incorrectas se muestra "Tu sesión no es válida o expiró. Inicia sesión de nuevo." (debería ser "correo o contraseña incorrectos"). |
| M-13 | Extensiones | permisos/UX | Registrar extensión como admin del inquilino → pide step-up y **luego** responde 403 (requiere rol de plataforma). El formulario no debería mostrarse, o debería avisar antes. |
| M-14 | Documentos | bug | Subir una plantilla con el mismo nombre que un archivo del repositorio → 400 "ya existe en la carpeta" (comparten espacio de nombres). "Nueva carpeta" no abre ningún diálogo. |
| M-15 | RR.HH. / empleado | UX/seguridad | La cédula del placeholder ("001-1234567-8") es rechazada por el backend (422). En la ficha, el documento se muestra **en claro** bajo la nota "Cifrado. Déjalo en blanco para no cambiarlo." El alta de empleado no tiene salario (se registra después con otro step-up). Departamento vacío: Guardar no da ningún mensaje. |
| M-16 | Documentación | bug | El README dice que el usuario de desarrollo se siembra solo y con `dev12345`. En realidad requiere `DEV_SEED=true` y una `DEV_SEED_PASSWORD` de al menos 12 caracteres. |
| M-17 | i18n | estilo | Enums y textos en inglés en una UI en español: roles (ADMINISTRATOR, SELLER…), tipos y categorías de cuenta (ASSET, CURRENT_ASSET…), cargos (CEO, MANAGER…), estados de lista de precios (Draft/Active), grupos de búsqueda (Invoices/Products/Customers), "Upload File", "Choose File", accesibilidad del gráfico ("Chart with 7 data points…"), fechas "Sep 28, 2026, 7:55 AM". "Por defecto: Aceptar" en Libros. |

### 3.4 Bajos
- **B-01 · Listas (transversal, UX):** ningún encabezado de tabla ordena. Se verificó en Impuestos, Monedas, Plan de cuentas, Balanza, Facturas y otras.
- **B-02 · Detalles menores:**
  - Monedas: columna "Moneda base" vacía, incluso para DOP.
  - Rentabilidad por cliente: el nombre aparece duplicado ("X — X").
  - "Editar libro mayor" tiene el subtítulo "Define un nuevo libro".
  - El combobox de artículo usa `id="null"`.
  - El toast tapa el botón de cerrar del modal.
  - Sesiones activas: dispositivo "on", ubicación inferida "Santo Domingo" en localhost.
  - "Nuevo banco" abre "Nueva cuenta bancaria".
  - Invitar dos veces el mismo correo → 201.
  - La campana no muestra ninguna notificación pese a los eventos y no se cierra con Escape.
  - Las filas de "Actividad reciente" no navegan.
  - Solo la columna "Período" es enlace en Nóminas.
  - El 606 incluye una factura de proveedor **sin RNC**: el sistema permitió registrarla sin identificación fiscal.

---

## 4. Flujos cruzados entre módulos

| # | Flujo | Resultado |
|---|---|---|
| 1 | Factura de venta → Contabilidad (CxC/Ingresos/ITBIS; Costo/Inventario) → Inventario (stock) → Balanza/ER/BG/Antigüedad/Rentabilidad/Actividad | ✅ correcto y cuadrado |
| 2 | Cobro parcial + total → factura "Cobrada" → Bancos/CxC → Tesorería (saldo) → Antigüedad | ✅ (con workaround de la cuenta bancaria, A-06) |
| 3 | Factura de proveedor → aprobación → CxP; pago → CxP/Bancos → 606 | ✅ asientos correctos · ⚠️ 606 sin RNC, sobregiro sin aviso |
| 4 | Nómina calcular → aprobar (2.º admin) → asiento de nómina cuadrado | ✅ |
| 5 | Stock inicial / ajuste de stock → asiento | ✅ (ajuste silencioso, M-08) |
| 6 | Configuración fiscal (rango e-NCF) → emisión de factura E32 | ✅ |
| 7 | Rol SELLER → emitir factura → contabilidad/stock | ✅ (403 en /currencies) |
| **8** | **Compras: recepción de OC → Inventario/Contabilidad** | ❌ **no mueve stock ni asienta (C-07)** |
| **9** | **Nómina aprobada → Tesorería (pago)** | ❌ **imposible (C-09)** |
| **10** | **Maestro de clientes → Facturas/Cobros/Contabilidad** | ❌ **borrar el cliente elimina facturas y cobros; CxC descuadra con el mayor (C-03)** |
| **11** | **Maestro de productos/departamentos → documentos/empleados** | ❌ **se borran con dependencias (C-03)** |
| **12** | **POS → Ventas/Inventario** | ❌ **no se puede vender (C-08)** |
| **13** | **Tesorería (saldo inicial) → Contabilidad** | ❌ **imposible registrar saldo inicial (A-06)** |
| **14** | **OC/Requisición "Por aprobar" → Centro de Aprobaciones / Mi trabajo** | ❌ **bandeja vacía (A-11)** |
| **15** | **Cobros/Pagos/Nómina → moneda del asiento → Asientos/Dashboard** | ❌ **moneda NULL → se muestra USD (A-12)** |
| **16** | **Cierre de período → Activos fijos (depreciación)** | ❌ **500 por falta de diario DEPREC (C-06)** |
| **17** | **Usuarios (invitación/activación) → acceso a la app** | ❌ **tras activar: "Acceso denegado" (M-02/C-02); el menú no se filtra por rol (M-01)** |
| **18** | **Eventos de negocio → Notificaciones** | ❌ **ninguna notificación generada (B-02)** |

---

## 5. Usabilidad (UI/UX), con evidencia

- **Consistencia de términos:** "Cliente" se ve y significa lo mismo en Ventas, Recibos y Reportes ✅. En cambio se mezclan español e inglés (M-17) y las monedas son inconsistentes: DOP en factura, USD en OC/requisición/lista de precios/dashboard (A-12).
- **Mensajes de error:**
  - Los formularios con validación de cliente son buenos: resumen "Revisa N punto(s)" con enlaces a cada campo (cuenta bancaria, factura, empleado); rango NCF invertido: "El número final no puede ser menor que el inicial"; balanza con fechas invertidas: mensaje claro.
  - Fallan cuando el error viene del servidor: mensajes genéricos (A-17), claves sin traducir (A-17), silencio total (A-15), o mensajes engañosos (M-12).
  - El conteo "Revisa 4 punto(s)" no coincide con la cantidad listada, y el aviso sigue visible tras corregir.
- **Feedback de carga y confirmación:**
  - Buen indicador "Sin cambios / Sin guardar" en cada formulario.
  - Buen aviso "Cambios sin guardar" al cerrar una pestaña.
  - Buenas confirmaciones con texto claro al eliminar un impuesto, una lista de precios o un documento, y al aprobar la nómina.
  - En contra: "Cargando" infinito (A-03, A-16), 8 s sin indicador en set-password (M-02), eliminaciones sin confirmar (departamento, concepto) y cierre de período sin confirmar.
- **Navegación:** el riel, los submenús y las pestañas tipo escritorio son claros, y "Volver/Avanzar", el popout y "Crear nuevo" funcionan. En contra: el menú no filtra por rol (M-01), hay callejones sin salida (Libro Mayor sin selector, U. de medida sin alta, asientos que no se pueden abrir, "en construcción" desde Inicio), el F5 congela la app (C-02) y las listas no ordenan (B-01).

---

## 6. Observaciones positivas (verificadas)

- **Contabilidad automática sólida:** todos los asientos generados por el sistema cuadran y usan las cuentas correctas. La nómina dominicana (AFP 2.87 %, SFS 3.04 %, ISR con escala anual) se calculó bien. Los reportes (balanza, ER, BG, flujo, antigüedad con conciliación contra el mayor, rentabilidad) son coherentes entre sí y **exportan CSV**. 606/607 se descargan.
- **Seguridad observable:**
  - El backend rechaza con 403 los endpoints fuera del rol (SELLER, ACCOUNTANT, MEMBER; 11 sondas directas por rol).
  - Segregación de funciones en nómina.
  - XSS almacenado escapado: nombre `<img src=x onerror=alert(1)>` sin ejecución en listas, búsqueda ni diálogo de confirmación.
  - Búsqueda con `' OR 1=1 -- <script>` sin error.
  - Límite de 5 intentos de login con mensaje claro.
  - Cierre de sesión que revoca (la API responde 401 y "atrás" no reabre la app).
  - Sesión expirada → login con `?reason=expired`.
  - Contraseñas de step-up para acciones de dinero.
- **Validación de negocio correcta:** rango e-NCF solapado rechazado; cierre fuera de secuencia rechazado; SKU y categoría duplicados rechazados; nómina duplicada rechazada; balanza con rango invertido; cuenta con estructura de segmentos bloqueada si ya hay cuentas.

---

## 7. Scorecard por módulo (1–10)

Ejes: **Mad** = madurez · **Rob** = robustez · **Seg** = seguridad observable · **UX** = usabilidad · **Comp** = competitividad frente a Odoo, NetSuite y SAP B1.

| Módulo | Mad | Rob | Seg | UX | Comp | Sustento (un ejemplo observado por eje) |
|---|---|---|---|---|---|---|
| **Plataforma / Login / Usuarios** | 4 | 2 | 6 | 4 | 4 | **Mad:** 2FA no activa (A-16). **Rob:** F5 congela (C-02); v8.3.1 en blanco (C-01). **Seg:** 403 por rol y rate-limit OK, pero step-up bloquea (A-01/02) y cambio de contraseña sin la actual (M-03). **UX:** rol oculto tras el modal (A-14); "sesión expirada" ante credenciales malas (M-12). **Comp:** Odoo/NetSuite recargan sin problema, invitan con un clic y filtran el menú por rol. |
| **Ventas / Facturación** | 5 | 3 | 6 | 5 | 4 | **Mad:** sin anular ni nota de crédito; barra muerta (A-09). **Rob:** borrar un cliente borra sus facturas (C-03); clientes no se crean (C-04). **Seg:** SELLER limitado por el backend. **UX:** buen resumen de errores, pero artículo de ancho 0 y Desc.% fraccional (M-05). **Comp:** Odoo/SAP B1 impiden borrar socios con documentos y ofrecen NC/PDF/correo desde la factura. |
| **POS** | 3 | 1 | 5 | 4 | 2 | **Rob:** ninguna venta posible (C-08). **UX:** interfaz limpia, pero imagen rota y error mudo. **Comp:** el POS de Odoo vende sin conexión. |
| **Compras / Proveedores** | 5 | 3 | 5 | 4 | 4 | **Mad:** OC con ciclo completo de estados. **Rob:** la recepción no mueve stock (C-07); proveedores no se crean (C-04). **Seg:** creador aprueba su OC (M-08). **UX:** ITBIS fraccional (M-05), tabla de factura de proveedor sin estilos (M-11). **Comp:** NetSuite/SAP B1 hacen recepción parcial con 3-way match. |
| **Inventario** | 4 | 4 | 5 | 5 | 3 | **Mad:** sin movimientos, almacenes con existencias ni U. de medida funcional (M-09). **Rob:** borra productos con documentos (C-03). **Seg:** ajuste de stock sin motivo (M-08). **UX:** formulario de producto claro. **Comp:** Odoo gestiona multi-almacén, rutas y trazabilidad. |
| **Tesorería / Finanzas** | 4 | 3 | 6 | 5 | 3 | **Mad:** conciliación con mapeo manual; saldo inicial imposible (A-06). **Rob:** nómina impagable (C-09); sobregiro sin aviso (M-07). **Seg:** step-up en movimientos de fondos. **UX:** recibo aplica saldo total (M-07). **Comp:** Odoo concilia con reglas y feeds bancarios. |
| **Contabilidad** | 6 | 3 | 6 | 4 | 5 | **Mad:** multilibro, segmentos, auditoría, checklist de cierre; motor de asientos correcto (§6). **Rob:** sin asientos manuales (C-05), sin cierre (C-06), cuentas no editables (A-05). **Seg:** cierre sin confirmación. **UX:** asientos que no se pueden abrir, mayor sin selector (A-13). **Comp:** conceptos al nivel de NetSuite, pero la operación diaria está bloqueada. |
| **RR.HH. / Nómina** | 6 | 4 | 7 | 4 | 5 | **Mad:** cálculo legal DO correcto, SUIR, historial salarial versionado. **Rob:** detalle "Cargando" (A-03); concepto → 500 (M-04). **Seg:** SoD calcular/aprobar ✅, datos sensibles tras step-up ✅. **UX:** 3 step-ups para dar de alta un salario (A-02). **Comp:** más localizado que Odoo estándar para RD, pero sin pago integrado (C-09). |
| **Reportes / Análisis** | 6 | 6 | 6 | 6 | 5 | **Mad:** estados financieros coherentes y exportables. **Rob:** dashboard en USD (A-12). **Seg:** 403 para roles sin permiso. **UX:** filtros de fecha claros; DataSheets mock (A-10). **Comp:** menos que el reporting de NetSuite, pero correcto. |
| **Configuración / Administración** | 3 | 3 | 5 | 4 | 3 | **Mad:** 11/20 secciones "en desarrollo" (M-09). **Rob:** perfil no se guarda (A-04), estructura en carga infinita (A-16), uso del plan en 0 (M-10). **Seg:** extensiones con step-up y luego 403 (M-13). **UX:** modal de ajustes claro. **Comp:** Odoo/NetSuite ofrecen configuración completa y operativa. |
| **Workspace (Inicio, búsqueda, documentos, datos)** | 4 | 4 | 7 | 6 | 4 | **Mad:** Importar/Exportar mock (A-10). **Rob:** workspace nunca persiste (A-08). **Seg:** búsqueda segura ante inyección. **UX:** búsqueda global útil y rápida; bandejas vacías (A-11). **Comp:** Odoo tiene importación CSV real con mapeo y vista previa. |

---

## 8. Cobertura

- **Rutas:** 89/89 rutas sin parámetro visitadas y todos sus elementos enumerados (`inventory.json`). Las 18 rutas con parámetro se cubrieron abriendo el registro desde su lista o en los flujos (detalle de factura, CxP, OC, requisición, empleado, nómina, producto, cliente, cuenta contable, libro mayor por cuenta, libro, diario → 404). `datasheets/:id` no se pudo abrir (A-10).
- **Ajustes:** 20/20 secciones abiertas. Probadas a fondo: Mi perfil, Perfil de la empresa, Estructura, Personalización, Facturación y plan, Facturación electrónica (rangos e-NCF y 606/607), Usuarios (invitar, validaciones, roles), Roles, SSO. Las 11 "en desarrollo" solo tienen contenido informativo.
- **Interacciones por elemento:** **986 registradas → 777 ok · 164 con falla · 45 no probadas (95 % probadas)**. Desglose por página y elemento en [`MATRIZ_COBERTURA.md`](MATRIZ_COBERTURA.md). La matriz combina la pasada 1 (estado vacío), la pasada 2 (estado con datos) y las correcciones de la verificación manual: más de una decena de falsos negativos del arnés (exportaciones CSV sin tráfico de red, cambio de pestaña, enlaces que enfocaban una pestaña ya abierta) se reclasificaron tras verificarlos a mano, y los artefactos del arnés se marcaron como tales.
- **Formularios probados** (vacío, inválido, límite, largo, especiales y válido):
  - Ventas y compras: producto, cliente, proveedor, factura, recibo, OC, factura de proveedor, pago, requisición, lista de precios.
  - Contabilidad y tesorería: rango NCF, cuenta bancaria, asiento, cuenta contable.
  - RR.HH.: departamento, empleado, concepto, nómina, salario.
  - Maestros y administración: categoría, almacén, impuesto, invitación, set-password, perfil, contraseña, extensión.
  - Sesión: login.
- **Estados:** vacío, con datos, error (400/403/404/409/500), por rol (4 roles), sesión expirada, tras cierre de sesión.

### No probado (con razón)
| Qué | Razón |
|---|---|
| Firma y envío de e-CF a DGII; certificado .p12 | Sin certificado y con efecto externo real (autoridad fiscal). Solo se registraron rangos y se descargaron 606/607. |
| Suscripción y pago del plan (Stripe) | Pasarela real; no se garantiza modo sandbox. |
| Envío real de correos (invitaciones, factura por correo) | Sin SMTP; se verificó el encolado y se leyó el enlace desde la cola local. "Enviar por correo" de la factura no hace nada (A-09). |
| SSO OIDC con un IdP real y verificación DNS de dominios | Requiere IdP y DNS externos. Solo se abrió la sección (con step-up). |
| reCAPTCHA real | Google no es alcanzable desde el contenedor; la app degrada tras un timeout de 8 s. |
| Descargar SUIR | El detalle de nómina volvió a quedar en "Cargando" tras el step-up (A-03). |
| Pagar nómina / cierre de períodos posteriores | Bloqueados por C-09 y C-06. |
| Venta POS completa, anulación y nota de crédito | Bloqueados por C-08; no existen en la UI (A-09). |
| Eliminar impuestos, cuentas o datos preexistentes (ITBIS 18/16/0 %…) | Regla de la prueba: destructivas solo sobre datos QA (probado con QA-Impuesto). |
| 26 controles "deshabilitado en este estado" | Se habilitan con datos o selección: los de formularios se cubrieron en los flujos; el resto queda listado en la matriz. |
| 5 controles de Plan de cuentas/Balanza tras re-render | Limitación del arnés; los equivalentes se verificaron a mano (filtros, encabezados, filas, Editar). |
| Responsive / móvil (botón "Menú") | Fuera del alcance de esta sesión (escritorio 1440×900). |
| Selector de empresa multi-inquilino | Solo existe una empresa; la acción de crear subsidiaria está bloqueada (A-16). |
| Desktop (Electron) y app POS independiente (`apps/pos`, :4300) | No se levantaron; se probó el POS integrado del portal. |

---

## 9. Reproducibilidad
Todos los scripts están en `docs/qa/harness/` (Playwright y CommonJS). Uso: `PW_PATH=<ruta a playwright> node <script>.cjs`, con la API y la web levantadas como en §2. `gen-matriz.cjs` regenera la matriz desde los JSON de las pasadas.
