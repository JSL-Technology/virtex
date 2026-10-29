# Auditoría de UI y UX — Virtex ERP (ronda 3)

**Fecha:** 29-10-2026 · **Rama:** `ccr-15abe1bb-uvzy9x` (base `b9af36ff`) · **Tipo:** diagnóstico. No se modificó código de la aplicación.
**Archivos:** este informe · [`evidence/`](evidence/) (capturas, PDF y CSV citados) · [`evidence/survey/`](evidence/survey/) (las 77 pantallas en `es-light`, `es-dark` y `en-light`) · [`evidence/R/`](evidence/R/) (tamaños de pantalla y zoom) · [`harness/`](harness/) (scripts Playwright reproducibles, mediciones `survey-*.json`, `analysis-es-light.txt`, `responsive.json`) · [`PROGRESO.md`](PROGRESO.md) (bitácora).
**Rondas anteriores:** [`../ux/INFORME_UX_UI.md`](../ux/INFORME_UX_UI.md) (12-10-2026) y [`../INFORME.md`](../INFORME.md) (28-09-2026). Cuando un hallazgo ya figuraba allí, se indica como **regresión/persistente**.

> El resumen ejecutivo está en la §9, como pide el formato. Lectura rápida: §9 → §8 → §2.1.

---

## 1. Entorno

### 1.1 Cómo se levantó

| Paso | Qué se hizo | Resultado |
|---|---|---|
| Infraestructura | Docker no está disponible en el contenedor (`/var/run/docker.sock` no existe). Se usó el clúster nativo Postgres 16 (`pg_ctlcluster 16 main start`, usuario `postgres`/`postgres`, base `erp`) y `redis-server` 7.0 nativo. | OK |
| Dependencias | `npm ci --legacy-peer-deps` (el README no dice cómo instalar; ver E-01). | OK |
| Esquema | `npm run migration:run` | OK |
| API | `DEV_SEED=true DEV_SEED_PASSWORD=… npm run dev:api` → `http://127.0.0.1:3000/api/v1` | OK; siembra `dev@virtex.local` en «Virtex Dev» (DO) |
| Portal web | `npm run dev:web` → `http://localhost:4200` | OK, llega a la API |
| POS | `npm run dev:pos` → `http://localhost:4300` | OK, entra con la misma cuenta |
| Escritorio | `apps/desktop` (Electron) | **No levantado**: el contenedor no tiene servidor gráfico. No evaluado. |

A mitad de la sesión el contenedor se reinició (se perdieron los procesos y Redis); se volvieron a levantar con los mismos comandos y los datos de Postgres se conservaron.

### 1.2 Usuarios, empresas, idiomas, temas y tamaños

- **Empresa A — «Virtex Dev» (República Dominicana)**, sembrada; usuario `dev@virtex.local`, Administrador.
- **Empresa B — «QA-UX3 Comercializadora Ñandú & Hijos S.A. de C.V.» (México)**, creada **desde cero por el flujo de alta** como lo haría un prospecto (organización vacía). Administradora «María José O'Connor-Núñez».
- **Roles probados:** Administrador (A y B), **Vendedor** (invitado en B, rol operativo restringido), **Contador** (`dev@virtex.local` invitado a B; usado para cambiar de empresa).
- **Idiomas:** español (todo), inglés (las 77 pantallas). Portugués: no recorrido (ver §5).
- **Temas:** claro (77 pantallas) y oscuro (77 pantallas).
- **Tamaños:** 1440×900 (base), 1920×1080, 1366×768, 768×1024, 375×812 (móvil, DPR 2), y **zoom 150 % y 200 % emulados** como viewport CSS de 960×600 y 720×450 sobre 1440×900 (equivalente geométrico; no es el zoom nativo del navegador).
- **Navegador:** Chromium headless (Playwright). Mediciones con JavaScript en página y **axe-core 4.x** (`wcag2a/aa`, `wcag21a/aa`, `wcag22aa`).

### 1.3 Seguridad de la prueba y límites

- Solo local. Datos creados con prefijo `QA-`/`qa.`. Correos y SMS van a los buzones de desarrollo `tmp/mail-outbox` y `tmp/sms-outbox` (se leyeron de ahí los códigos e invitaciones). El proveedor de pagos es el simulado. No se cargó certificado fiscal ni se envió nada a SAT/DGII.
- **Volumen:** 322 clientes en la empresa B, creados por la **API real** (con validaciones) desde la sesión del navegador. La API limita a 20 altas por ventana; entre lotes de 15 se limpió el contador de *throttling* del Redis local. Eso es una ayuda de entorno, no salta validaciones. No se generó volumen de productos, facturas ni asientos (limitación).
- **Throttling:** muchos scripts comparten IP; se limpió el contador entre scripts. Los hallazgos de *throttling* (C-02, C-06) se reprodujeron **desde estado limpio**.
- **Sin reportar por no concluyente:** expiración de sesión por inactividad (se cerró a los 15,1 min con `reason=idle`; mi prueba no generaba eventos de ratón/teclado reales, así que es coherente con lo que promete el login). Un «Correo o contraseña incorrectos» que vi en un momento fue un error mío de contraseña (verificado en `audit_logs`), no del producto.

### 1.4 Hallazgos de entorno y documentación (fuera del alcance de UX, registrados)

- **E-01 · README sin paso de instalación.** «Ejecutar en local» va de la infraestructura a `migration:run` sin `npm ci`/`npm install`; solo la sección de Render menciona `npm install --legacy-peer-deps`.
- **E-02 · README y `.env.example` se contradicen.** El README dice «con `NODE_ENV` sin definir … arranca sin `.env`»; `.env.example` dice «OBLIGATORIO y sin valor por defecto … dejarlo sin definir … hace que la API se niegue a arrancar». (Con `nx serve` arrancó.)
- **E-03 · README desactualizado sobre pagos.** Dice que sin `STRIPE_*` el alta responde «Este plan no está disponible…»; en realidad el log indica `Payment provider: simulated. Checkouts complete without charging` y el alta se completa.
- **E-04 · Google Analytics en la app autenticada.** Durante el uso se observaron peticiones a `www.google-analytics.com` (bloqueadas por el proxy del contenedor) y no vi aviso de consentimiento. Revisar contra la normativa de privacidad de cada mercado (confianza media: no inspeccioné la configuración).

---

## 2. Hallazgos

Formato: **ID · título — severidad**. Categoría, contexto (rol · idioma · país · tamaño · tema), pasos, esperado vs. real, criterio, evidencia y propuesta. Nielsen = H1…H10. «Conf.» = confianza al citar a otros productos.

### 2.1 Críticos (8)

#### C-01 · México: la nómina se puede configurar entera y falla en el último paso — Crítica
- **Categoría:** bloqueo · contenido falso · **Contexto:** Administrador · es · MX · 1440 · claro.
- **Pasos:** Empresa B → RR.HH. y nómina › Parámetros de ley → Conceptos → Empleados › Nuevo empleado → Nóminas › Nueva nómina › Crear.
- **Esperado:** o bien la nómina mexicana funciona (IMSS, ISR, INFONAVIT), o bien el módulo dice desde el principio que México no está disponible y no ofrece configurarlo.
- **Real:** el módulo está visible y completo; el formulario de empleado pide **CURP y NSS (IMSS)**; «Parámetros de ley» afirma «Los valores de ley vienen precargados» pero está **vacío**; «Conceptos» está **vacío**; al crear la nómina: toast **«La jurisdicción de nómina "MX" no está soportada.»** (`POST /payroll/runs 400 payroll_jurisdiction_p1_not_supported`).
- **Criterio:** H1 visibilidad del estado, H5 prevención de errores, H9; la tarea principal «procesar una nómina» es imposible y se descubre tras el trabajo de alta de empleados.
- **Evidencia:** `evidence/T-nom-2-parametros-mx.jpg`, `T-nom-3-conceptos-mx.jpg`, `T-emp-1-form.jpg`, `T-nom-6-creada.jpg`.
- **Cómo debería ser:** gating por país en el manifiesto de módulos: si la jurisdicción no está soportada, el módulo aparece con un estado «Próximamente en México» (y enlace a la lista de espera) en lugar de formularios operativos; nunca el texto «vienen precargados» cuando no hay nada.

#### C-02 · Alta de empresa: un código de correo mal escrito bloquea en silencio la verificación del teléfono — Crítica
- **Categoría:** bloqueo · estados y feedback · **Contexto:** prospecto sin cuenta · es · MX · 1440 · claro.
- **Pasos (desde contadores limpios):** `/es/mx/auth/register` → completar paso 1 → en «Correo» teclear un código erróneo (000000) → teclear el correcto (avanza) → en «Teléfono» teclear el código SMS **correcto**.
- **Esperado:** el teléfono se verifica; si hay límite de intentos, un mensaje con el tiempo de espera.
- **Real:** la tercera petición `POST /auth/verify-public-code` (14 s después de la primera) responde **429** y la pantalla **no muestra nada**: seis casillas llenas, «Verificar» activo, sin error. Reproducido dos veces. Además la casilla enfocada se pinta en rojo, lo que parece un error cuando no lo es.
- **Criterio:** H1, H9; WCAG 3.3.1 (identificación de errores). El alta es la puerta de entrada comercial.
- **Evidencia:** `evidence/C-sms-429-silencioso.jpg`; registro de red en `harness/13-register-full.cjs` (ejecución con `WRONG=1`).
- **Relacionado:** con otro 429 (al reenviar el código de correo) la pantalla muestra la **clave cruda** `register.errors.code_send` debajo de «Enviamos un código…» (`evidence/R-09-clave-cruda-429.jpg`).
- **Cómo debería ser:** contadores por destino (correo y teléfono por separado), no por IP global; todo 429 con mensaje localizado («Demasiados intentos. Vuelve a intentarlo en 52 s») y cuenta atrás; foco sin estilo de error.
- **Bien resuelto en la misma pantalla:** cuando se agotan los SMS por número, la pantalla ofrece «Verificar el teléfono más tarde» o «Usar solo el correo» (`evidence/R-15-limite-sms-alternativas.jpg`).

#### C-03 · Conciliación bancaria: la importación del extracto falla con un error que no dice qué corregir — Crítica
- **Categoría:** bloqueo · contenido · **Contexto:** Administrador · es · MX · 1440 · claro.
- **Pasos:** Tesorería › Conciliación — manual › Importar estado de cuenta → cuenta «Caja general (MXN)» → archivo CSV de 2 filas (`harness/qa-extracto.csv`: Fecha, Concepto, Referencia, Monto; fechas dd/mm/aaaa) → columnas autodetectadas → Desde/Hasta octubre → saldos 0 y −8000 → Importar.
- **Esperado:** el extracto importado y la pantalla de emparejamiento; o, si algo no cuadra, qué campo o fila corregir.
- **Real:** «**No se pudo leer el archivo:** No pudimos completar la operación. Vuelve a intentarlo.» (`POST /reconciliation/statements 400 BAD_REQUEST` sin detalle). La misma pantalla muestra en «Primeras filas del archivo» que el archivo **sí se leyó**. Reintentar no cambia nada. No hay otro camino para conciliar.
- **Criterio:** H9 (mensajes que ayudan a recuperarse); «Conciliar una cuenta bancaria» es tarea principal.
- **Evidencia:** `evidence/T-conc-2-importar.jpg`, `T-conc-3-import-lleno.jpg`, `T-conc-4-tras-import.jpg`.
- **Límite:** probé un solo archivo; no investigué la causa de servidor (fuera de alcance). El problema de UX —error falso y sin acción— es independiente de la causa.
- **Cómo debería ser:** validación del lado del cliente antes de enviar (saldo inicial + movimientos = saldo final, fechas dentro del rango, formato) y errores por campo/fila; el servidor devolviendo el motivo localizado.

#### C-04 · Se pierde lo escrito si la sesión caduca en mitad de un formulario — Crítica
- **Categoría:** bloqueo (pérdida de trabajo) · **Contexto:** Administrador · es · DO · 1440 · claro.
- **Pasos:** Clientes › Nuevo cliente → escribir nombre y correo → caducar la sesión (borrar cookies, equivalente a expiración) → Guardar cliente → iniciar sesión de nuevo.
- **Esperado:** volver al formulario con lo escrito (o un aviso antes de perderlo).
- **Real:** toast «No hay sesión que renovar» (jerga técnica), redirección a login con «Tu sesión ha caducado», y tras entrar el formulario aparece **vacío**.
- **Inconsistencia:** las facturas en borrador sí sobreviven a recargas y cambios de empresa (§6) — el mecanismo existe pero no cubre todos los formularios.
- **Criterio:** H3, H5; práctica de SaaS (Xero, QuickBooks Online conservan el formulario y reabren la sesión en un diálogo) — conf. media.
- **Evidencia:** `evidence/N-6-sesion-expirada.jpg`, `N-7-tras-relogin.jpg`.
- **Cómo debería ser:** reautenticación en diálogo sobre la página (como ya hace el step-up), reintentando la petición; y autoguardado de borradores para todo formulario `WindowKind.DRAFT`.

#### C-05 · Un 429 al comprobar la sesión expulsa al usuario al login — Crítica
- **Categoría:** bloqueo · **Contexto:** Administrador · es · DO · 1440 · claro.
- **Pasos:** navegar por enlace directo/recarga por las pantallas (≈ 50 cargas de página en ~13 min desde una misma IP, como una oficina detrás de NAT).
- **Esperado:** la app reintenta o avisa «Demasiadas peticiones, reintentando…»; nunca cierra la sesión por un límite de tasa.
- **Real:** `GET /auth/session 429` → consola «No se pudo resolver la sesión (HTTP 429)» → **pantalla de inicio de sesión** en 15 pantallas seguidas (Balanza de comprobación … Departamentos), con la sesión en realidad válida.
- **Criterio:** H9; combinado con C-04, provoca pérdida de trabajo.
- **Evidencia:** `harness/survey-es-light.log` (entradas con `title= Iniciar sesión`), `harness/analysis-es-light.txt` (sección «API errs»).
- **Cómo debería ser:** tratar 429 y 5xx en `/auth/session` como error transitorio (reintento con espera y pantalla de «Reconectando»); solo 401 significa «sin sesión». Revisar que el límite de `/auth/session` no sea por IP.

#### C-06 · Móvil y tableta: contenido recortado e inalcanzable — Crítica
- **Categoría:** responsive · **Contexto:** Administrador · es · DO · 375×812 y 768×1024 · claro.
- **Pasos:** abrir Facturas, Nueva factura, Nuevo cliente, Nuevo asiento, Balance general en 375 px.
- **Esperado:** reflujo a una columna o desplazamiento horizontal dentro de la tabla.
- **Real:** no hay desbordamiento del documento (`scrollWidth = clientWidth`), pero los paneles **recortan**: en Facturas solo se ven 3 columnas (Total, Estado y Acciones quedan fuera, sin desplazamiento); en Nuevo asiento la columna **Crédito** es inalcanzable; en Nuevo cliente los campos se cortan por la derecha; en Balance el importe toca el borde. La barra superior pierde el avatar.
- **Criterio:** WCAG 1.4.10 Reflow (AA); calibración del encargo («si algo esencial queda inalcanzable, es crítico»).
- **Evidencia:** `evidence/R/movil375-*.jpg`, `harness/responsive.json`.
- **Cómo debería ser:** tablas con `overflow-x:auto` y primera columna fija, o vista de tarjetas por fila en < 640 px; formularios a una columna; líneas de documento como tarjetas apiladas.
- **Bien:** en 1366×768 y 1920×1080 todas las acciones primarias quedan visibles y no hay desbordamiento (`responsive.json`).

#### C-07 · La factura impresa desde el navegador saca la aplicación, no el documento — Crítica (documentos)
- **Categoría:** documentos generados · **Contexto:** Administrador · es · DO · Carta · claro.
- **Pasos:** abrir la factura emitida B0200000001 → imprimir la página (Ctrl+P / medio `print`).
- **Esperado:** solo el documento, con todos sus importes.
- **Real:** se imprimen la barra superior, el riel, el menú lateral y la barra de herramientas; la factura queda cortada **sin precios, impuestos ni total** (`evidence/D-factura-impresion.pdf`, `D-factura-impresion-1.jpg`).
- **Matiz:** el botón **PDF** sí genera un PDF limpio (`evidence/D-factura-api.pdf`), y «Imprimir» pide `/invoices/:id/print`. El fallo es para quien imprime con Ctrl+P, hábito universal en oficinas.
- **Criterio:** H2, práctica general (hoja de estilos `@media print`).
- **Cómo debería ser:** `@media print` que oculte el shell y muestre solo el documento; o interceptar Ctrl+P en documentos y redirigir a la vista de impresión.

#### C-08 · Datos de prueba de rango fiscal precargados y un PDF fiscal sin identificación del emisor — Crítica (fiscal)
- **Categoría:** datos mock · documentos · **Contexto:** Administrador · es · DO · 1440 · claro. **Persistente** (C-10 de la ronda anterior, parcialmente).
- **Pasos:** Ajustes › Comprobantes fiscales › Tipo B02 → los campos aparecen **rellenos**: Prefijo B02, Desde 1, **Hasta 1000**, **Vence el 31/12/2027**. Registrar → emitir factura → PDF.
- **Esperado:** campos vacíos (el rango lo autoriza la DGII y cada empresa tiene el suyo); y no permitir emitir sin RNC del emisor.
- **Real:** con un clic se registra un rango que nadie autorizó; la factura se emite y el PDF imprime **«RNC:» vacío** (`evidence/D-factura-api-1.jpg`), toast «Rango de **e-NCF** registrado» para un rango **tradicional (serie B)**, y el detalle etiqueta el NCF como «**e-NCF**: B0200000001».
- **Criterio:** valores falsos presentados como datos (calibración «muestra datos falsos»); exactitud fiscal.
- **Evidencia:** `evidence/T-do-6-rango.jpg`, `T-do-8-emitida.jpg`, `D-factura-api.pdf`.
- **Cómo debería ser:** campos vacíos con ejemplo en la ayuda; exigir RNC/RFC del emisor como prerrequisito de emisión (el banner de prerrequisitos ya existe: añadirlo ahí); etiquetas «NCF» o «e-NCF» según la serie.

### 2.2 Altos (15)

#### A-01 · El usuario invitado aterriza en «Acceso denegado» — Alta (**persistente**, M-02 ronda 1)
- **Contexto:** Vendedor recién invitado · es · MX · 1440.
- **Pasos:** Ajustes › Usuarios › Invitar (rol Vendedor) → abrir el enlace del correo → «Guardar contraseña».
- **Real:** `/unauthorized` — página fuera del shell (sin logo ni menú), «No tienes los permisos necesarios para acceder a este recurso» sin decir cuál; «Solicitar permiso» no tiene destino visible y «¿No sabes qué permisos necesitas?» es un párrafo, no un enlace. Solo «Volver al panel» funciona.
- **Criterio:** H9, H10; primera impresión de cada empleado nuevo.
- **Evidencia:** `evidence/T-vend-1-set-password.jpg`, `T-vend-2-primer-ingreso.jpg`.
- **Debería:** tras activar, ir a la pantalla de inicio de la empresa que invitó; la página de acceso denegado dentro del shell, nombrando el permiso que falta y quién puede concederlo.

#### A-02 · «Ir a la configuración fiscal» abre «Mi perfil» — Alta (**regresión** de A-01 ronda 2)
- **Contexto:** Administrador · es · DO y MX · 1440.
- **Pasos:** Nueva factura → banner «Para emitir comprobantes todavía falta…» → «Ir a la configuración fiscal».
- **Real:** abre Ajustes en **Mi perfil** (`#settings/e`), sin elemento activo en el menú de Ajustes; el banner remite a «Ajustes › **Facturación electrónica**», sección que en RD se llama «**Comprobantes fiscales**». Además, al seguir el enlace la URL pasa a `/overview` aunque la factura queda detrás.
- **Evidencia:** `evidence/T-do-4-config-fiscal.jpg`, `T-do-5-comprobantes.jpg`.
- **Debería:** enlace profundo a la sección exacta y nombre de sección idéntico al citado.

#### A-03 · Empresa mexicana con textos, impuestos y conceptos dominicanos — Alta
- **Contexto:** Administrador · es · MX · 1440.
- **Real (observado):**
  - Factura de venta MX, pestaña «Fiscal y cobro»: «Retenciones en la fuente — **ITBIS retenido** (% del impuesto)» (`T-fac-4-fiscal.jpg`).
  - Pago a proveedor MX: columna «**ITBIS retenido**» (`T-ap-6-pago-form.jpg`).
  - Factura de proveedor MX: «queda guardado con ella como evidencia para la **DGII**» (`T-ap-1-form.jpg`).
  - Proveedor MX, País: «Separa una compra local de un pago al exterior, que **el 609** reporta aparte» (`T-prov-1-form.jpg`).
  - Cliente/proveedor MX: tipo «Persona **jurídica**» (en México: persona **moral**); proveedor ofrece «Cliente del exterior».
  - Empleado MX: «Fondo de pensiones», «Seguro de salud» (conceptos AFP/ARS dominicanos) junto a CURP/NSS.
  - **Al cambiar de empresa** DO→MX, la factura MX muestra la columna «**ITBIS**» y el listado la columna «**e-NCF / NCF**» (`O-7-borrador-otra-empresa.jpg`): las etiquetas del país anterior quedan en caché.
- **Criterio:** H2 (correspondencia con el mundo real); el encargo exige no tratar a ningún país como caso por defecto.
- **Debería:** todas las etiquetas fiscales del paquete de país (`country-pack`) y se recargan al cambiar de empresa; prueba automática que recorra los formularios fiscales por país buscando términos de otros países.

#### A-04 · Formularios mexicanos sin los datos que exige el CFDI 4.0 — Alta
- **Contexto:** Administrador · es · MX.
- **Real:** el cliente no pide **régimen fiscal del receptor**; la factura no pide **uso del CFDI** ni **método de pago (PUE/PPD)**; la forma de pago de venta es una lista genérica («Efectivo», «Cheque»…) mientras la de compra usa el catálogo SAT («01 — Efectivo», «99 — Por definir»); el producto no pide **clave de producto/servicio** ni **clave de unidad SAT**. El propio alta dice «El SAT lo exige en cada CFDI 4.0».
- **Criterio:** Anexo 20 del SAT, CFDI 4.0 (conf. alta); H4 consistencia (venta vs compra).
- **Evidencia:** `T-cli-1-form.jpg`, `T-prod-1-form.jpg`, `T-fac-4-fiscal.jpg`, `T-ap-1-form.jpg`.
- **Nota:** el bloqueo de emisión por falta de CSD es legítimo y está bien explicado; este hallazgo es sobre lo que el usuario no puede capturar aunque tenga CSD.

#### A-05 · Errores de formulario solo con color y sin asociación accesible — Alta (**persistente**, A-03 ronda 2)
- **Contexto:** Administrador · es · MX/DO · 1440.
- **Pasos:** Nuevo cliente → RFC «MAL-123», correo «correo-invalido», teléfono «abc», días de crédito «−5».
- **Real:** RFC, correo y teléfono solo con **borde rojo**, sin texto; los días negativos no se marcan. En el alta, los errores tienen texto pero `aria-invalid` y `aria-describedby` son nulos y el foco se queda en el botón. El resumen «Revisa 1 punto(s) antes de guardar «Nombre del cliente» es obligatorio» no tiene puntuación entre frases.
- **Criterio:** WCAG 1.4.1, 3.3.1, 3.3.3, 4.1.2 (AA).
- **Evidencia:** `T-cli-3-invalidos.jpg`, `R-03-paso1-vacio.jpg`, `R-04-paso1-invalido.jpg`.
- **Debería:** mensaje por campo («El RFC debe tener 12 o 13 caracteres»), `aria-invalid` + `aria-describedby`, foco al primer error.

#### A-06 · Listados sin búsqueda ni paginación — Alta
- **Contexto:** Administrador · es · MX · 322 clientes.
- **Real:** Clientes carga y pinta **las 322 filas** (2,5 s) sin búsqueda, sin filtros y sin paginación. De 77 pantallas, solo **11** tienen campo de búsqueda: no lo tienen Clientes, Proveedores, Asientos, Cotizaciones, Recibos, Órdenes de compra, Requisiciones, Listas de precios, Departamentos ni Nóminas. Facturas sí lo tiene (no hay un patrón común).
- **Criterio:** H7 (eficiencia); todo ERP líder ofrece búsqueda + filtros + paginación/virtualización en listados maestros (Odoo, NetSuite, QuickBooks — conf. alta).
- **Evidencia:** `evidence/V-1-clientes-volumen.jpg`, `V-2-clientes-scroll.jpg`; `harness/volumen.log`.
- **Bien:** encabezado fijo al desplazar.

#### A-07 · La búsqueda ignora la «ñ» y muestra «null» — Alta
- **Contexto:** Administrador · es · MX · 322 clientes.
- **Real:** en el selector de cliente de la factura, «Pingüino» encuentra 17 y «pinguino» **0**, y ofrece «Crear el cliente «pinguino»» (riesgo de duplicados). En la búsqueda global, «nandu» no encuentra «Ñandú», pero «cafe» sí encuentra «Café» (incoherente). La búsqueda global muestra «Identificación fiscal: **null**» en los clientes sin RFC, y «RFC:» en los que lo tienen.
- **Criterio:** H2, H5; el español escrito sin tildes es habitual.
- **Evidencia:** `evidence/V-3-selector-cliente.jpg`, `S-busqueda-null.jpg`.
- **Debería:** normalización Unicode (NFD + quitar diacríticos, incluida ñ→n) en ambos lados; ocultar campos vacíos.

#### A-08 · Fechas: tres formatos y dos «hoy» distintos — Alta (**persistente**, M-05 ronda 2)
- **Contexto:** Administrador · es · DO y MX · 1440. Hora del servidor ≈ 00:30–02:00 UTC (≈ 20:30–22:00 en Santo Domingo, 18:30–20:00 en CDMX).
- **Real:**
  - Campos de fecha en **mm/dd/aaaa** («10/28/2026») en empresas de RD y MX; las vistas muestran **dd/mm/aaaa** («28/10/2026»); Aprobaciones muestra ISO («Esperando desde 2026-10-28»). En el Balance conviven «10/29/2026» (campo) y «Al 29/10/2026» (título).
  - Campos de mes nativos en inglés: «**September** 2026» (Ejecutar depreciación, Informe del gerente), «January 2026» (Análisis de variaciones).
  - **Día por defecto distinto según el documento**: factura de venta = 28/10 (zona de la empresa); recibo de cobro, factura de proveedor, asiento, ajuste de inventario y Balance = **29/10** (UTC). Un cobro registrado a las 20:30 en RD queda fechado al día siguiente — a fin de mes, en el período siguiente.
  - El saludo dice «Buenos días» a las 20:30 hora de la empresa.
- **Criterio:** H4; formatos de fecha por país; integridad de períodos.
- **Evidencia:** `T-fac-1-form.jpg`, `T-do-10-cobro-form.jpg`, `T-ap-1-form.jpg`, `T-je-1-form.jpg`, `T-rep-1-balance-mx.jpg`, `T-ap-5-bandeja.jpg`, `survey/es-light/accounting_fixed-assets_depreciation.jpg`.
- **Debería:** un componente de fecha propio (no el nativo) con el formato del país; «hoy» calculado siempre en la zona horaria de la empresa.

#### A-09 · Pantallas de reportes y tesorería con maquetación rota — Alta
- **Contexto:** Administrador · es · DO · 1440 · claro y oscuro.
- **Real (medido):**
  - **Sin margen interior**: Antigüedad de CxC y CxP, Posición de efectivo (Tesorería › Tablero), Conciliación bancaria y Cierre de período pegan título y controles al borde del panel; en Cierre de período la barra de progreso se corta («71%»).
  - **Cuatro tamaños de h1**: 24 px/600 (59 pantallas), 20 px/600 (12), **30 px/600** (4: las dos antigüedades, Tesorería, Cierre anual) y 24 px/700 (Parámetros de ley).
  - **Doble título** en Balance, Estado de resultados y Flujo de efectivo (h1 de 20 px + título del informe de 30 px).
  - Libro mayor: «Desde:» y «Hasta:» apilados a la derecha de «Cuenta», desalineados, con dos puntos que no usa ningún otro filtro.
- **Criterio:** H8, H4; medición.
- **Evidencia:** `survey/es-light/reports_aging_receivables.jpg`, `accounting_treasury.jpg`, `accounting_reconciliation.jpg`, `accounting_closing_checklist.jpg`, `accounting_general-ledger.jpg`; `harness/analysis-es-light.txt` (H1 estilos).
- **Debería:** una sola plantilla de página (cabecera, barra de filtros, cuerpo) usada por todo reporte.

#### A-10 · Una misma pantalla con hasta tres nombres — Alta (**persistente**, M-01 ronda 2)
- **Medición:** en **29 de 77** pantallas el nombre del menú, el de la pestaña/título del navegador y el h1 no coinciden. Ejemplos:

| Menú | Pestaña / título | h1 |
|---|---|---|
| Conciliación — manual | Conciliación de cuentas | Conciliación bancaria |
| Cierre de período | Listas de cierre | Cierre de período |
| Impuestos | Impuestos | Tasas de impuesto |
| Condiciones de pago | Términos de pago | Condiciones de pago |
| Formas de pago | Métodos de pago | Formas de pago |
| Plan de cuentas | Catálogo de cuentas | Catálogo de cuentas |
| Multilibros | Libros contables | Libros contables |
| Periodos contables | Periodos contables | **Períodos** contables |
| Tablero | Tesorería | Posición de efectivo |
| Todos los documentos | Repositorio de documentos | Repositorio de archivos |
| DataSheets | Hojas de datos | DataSheets |

- Además, «**Facturas**» aparece en Ventas y en Compras con el mismo nombre, y «**Antigüedad de saldos**» dos veces. Los botones de alta usan cinco verbos: «Nuevo/Nueva…», «Crear diario», «Crear nuevo libro», «Registrar pago», «Proponer ajuste»; la factura se llama «Nueva factura» (inicio), «Nueva factura de venta» (listado) y «Crear factura de venta» (formulario).
- **Criterio:** H4; Fiori: el título de la app y el de la página coinciden (conf. media).
- **Evidencia:** `harness/analysis-es-light.txt` (sección NOMBRES).

#### A-11 · El Vendedor ve indicadores financieros vacíos o falsos — Alta
- **Contexto:** Vendedor · es · MX · 1440.
- **Real:** el Inicio dispara 13 peticiones que responden **403** y aun así muestra la sección «Indicadores del negocio»: ROE, ROA, liquidez «—», «No se pudieron cargar los datos», y mensajes **falsamente negativos** como «No hay presupuesto definido para este período» y «Nada requiere atención ahora mismo». El acceso rápido «Reportes» lleva a un hub (no presente en el menú) que solo contiene «Calidad de datos».
- **Criterio:** H1; información engañosa. **Bien:** el menú oculta los módulos sin permiso (patrón de NetSuite/Odoo).
- **Evidencia:** `T-vend-3-panel.jpg`, `T-vend-4-kpis-403.jpg`, `T-vend-5-reportes.jpg`.
- **Debería:** los widgets declaran su permiso y no se muestran (o muestran «Requiere permiso de Contabilidad») si falta.

#### A-12 · Exportaciones solo en CSV, con valores internos en inglés y tres convenciones — Alta
- **Real:** «Exportar» descarga directamente CSV (sin elegir formato; no hay PDF ni Excel de los estados financieros). Balance: `sep=;`, categorías `CURRENT_ASSET`, `OWNERS_EQUITY`, «Generado el 2026-10-29T01:27:58.852Z». Facturas: `sep=;`, estado `Draft`. Plan de cuentas: separador **coma**, encabezados `snake_case` (`admite_movimientos`), tipos `ASSET`/`DEBIT`, `true`/`false`. Solo Facturas muestra el toast «Exportación completada».
- **Criterio:** H4; un contador exporta para Excel y para el auditor (conf. alta: Odoo/QuickBooks ofrecen PDF y XLSX de estados financieros).
- **Evidencia:** `evidence/T-exp-balance-sheet.csv`, `T-exp-invoices.csv`, `T-exp-chart-of-accounts.csv`.

#### A-13 · Claves crudas, interpolaciones sin resolver y enumeraciones sin traducir — Alta (**persistente**, M-07 ronda 2)
- `register.errors.code_send` (alta, ante un 429) — `R-09-clave-cruda-429.jpg`.
- «Formato esperado: **{{example}}**» al escribir un RFC inválido en el alta — `R-14-rfc-interpolacion.jpg`.
- Rol «**ADMINISTRATOR**» en la tabla de usuarios (el selector dice «Administrador») — `T-usr-1-usuarios.jpg`.
- «**Show password**» como nombre accesible del botón del ojo en el alta en español.
- «Caja **main**» en el POS — `P-1-pos.jpg`.
- Consola: `Missing translation: "common.skip_to_content"`, `charts.types.empty_chart`, y el gráfico del Inicio expone a lectores de pantalla «Chart with 7 data points…», «End of interactive chart» en inglés.

#### A-14 · Ajustes: tres diálogos apilados y gestión de foco incompleta — Alta
- **Real:** Configuración (modal) → Invitar usuario (modal) → Verificación de seguridad (modal): **tres capas** (`T-usr-3-invitado.jpg`). Al abrir Ajustes el foco no entra en el diálogo (queda en `body`) y al cerrarlo con Escape no vuelve al botón que lo abrió; el menú de Ajustes no marca la sección activa al llegar por enlace; las entradas se truncan («Comprobantes fisca…», «Estructura empresa…»).
- **Criterio:** WCAG 2.4.3; Fiori y Material desaconsejan diálogos sobre diálogos (conf. alta). **Bien:** el foco queda atrapado dentro del modal y Escape lo cierra.
- **Debería:** Ajustes como página de ancho completo (como Odoo/NetSuite), invitación en panel lateral.

#### A-15 · Factura de proveedor y pago: flujo con conocimiento oculto — Alta
- **Contexto:** Administrador · es · MX.
- **Real:** Nueva factura → elegir proveedor → descripción, cantidad, precio → **cuenta contable obligatoria en cada línea** (sin valor por defecto desde el proveedor o producto; el selector «Cuenta de gasto» ofrece cuentas de **activo**; buscar «Compras» no da resultados) → Guardar → queda en **Borrador** → «**Enviar a aprobación**» (confirmación genérica «Aceptar»; en realidad contabiliza de inmediato si no hay política) → «Pagar» → Registrar pago → aviso de sobregiro → reautenticación. **≈ 12 interacciones**; el impuesto por defecto de la compra es **0** (el desglose fiscal está oculto tras «Mostrar»). En la pantalla de pago la columna «Factura» muestra una **fecha** porque la factura no tiene número.
- **Criterio:** H6 (reconocer antes que recordar), H7.
- **Evidencia:** `T-ap-2-lleno.jpg` … `T-ap-9-tras-stepup.jpg`.
- **Bien:** la confirmación de sobregiro está bien redactada y la reautenticación reintenta sola el pago.

### 2.3 Medios (19)

| ID | Módulo · pantalla | Categoría | Hallazgo (esperado vs. real) | Criterio | Evidencia |
|---|---|---|---|---|---|
| M-01 | Transversal · listados vacíos | Inconsistencia | **9 implementaciones** de estado vacío (`empty-copy` 20, `empty-invite` 3, `empty-state` 2, `wfl__empty`, `wfr__empty`, `cf__empty`, `journal-empty`, `mr__empty`, y el genérico «Todavía no hay nada aquí» con icono de bandeja en **13** pantallas: Facturas, Proveedores, Productos, Asientos, Empleados…). Solo **2** ofrecen acción (Flujos de trabajo, Facturas de proveedor); Facturas de **venta** no, Facturas de **compra** sí. | H4, H10 | `survey/es-light/*.jpg`, `analysis-es-light.txt` |
| M-02 | Transversal · listados | Inconsistencia | «Estado:» con dos puntos solo en Facturas; «Filas por página» por defecto 25, 50 o 100 según la pantalla; mostrar archivados = «Incluir desvinculados» / «Incluir inactivos» / «Mostrar retiradas»; Categorías usa otra tabla (encabezados 14 px/700 vs 13 px/600, sin fondo, títulos centrados sobre datos alineados a la izquierda, acciones mezclando icono y texto «Retirar»). | H4, medición | `survey/es-light/inventory_categories.jpg` |
| M-03 | Transversal · campos | Diseño visual | **10 variantes** de campo: alturas 28/34/36 px, tamaño 13/13,6/14 px, radio 4/6 px, tres colores de borde (`#7f8794`, `#11151d`, `#d7dde8`). | Medición | `analysis-es-light.txt` |
| M-04 | Factura, menú, pestañas | Contenido · visual | Selectores truncados en la línea de factura a 1366 y 1440 («Gravadc», «16٪»); menú «Tickets de punto de v…», «Predicciones de dema…»; nombre de empresa «QA-UX3 Com…»; pestañas cortadas a mitad de palabra en el borde izquierdo («ones», «io de …») con un contador («7») sin etiqueta; a zoom 200 % la búsqueda global queda en «Bu». | H8 | `T-fac-1-form.jpg`, `R/1366-invoices_new.jpg`, `R/zoom200-*.jpg` |
| M-05 | Transversal | Accesibilidad | axe: `nested-interactive` (serio) en las pestañas Dockview, **62/77** pantallas, 678 nodos. Campos de línea sin etiqueta (cantidad, precio, descuento en factura; débito/crédito en asiento). Combobox «Cliente» y «Artículo» sin indicador de foco (5 de 40 paradas de Tab sin foco visible). Pasos del alta con nombre accesible «1»…«6» o vacío. Sin `autocomplete` (`given-name`, `family-name`, `email`, `new-password`) en el alta. En «Elige tu país» el orden de foco (países) no coincide con el visual (lista de espera arriba). Tema oscuro: etiqueta del módulo activo del riel a **2,26:1** en 65 pantallas. | WCAG 4.1.2, 1.3.1, 2.4.7, 1.3.5, 2.4.3, 1.4.3 | `survey-es-dark.json`, `harness/71-teclado.cjs` |
| M-06 | Alta · pasos 1, 4, 6 | Usabilidad · contenido | Lista de espera **encima** de «Elige tu país» (jerarquía invertida); «República Domi…» truncado; obligatorios sin marcar salvo «Régimen fiscal *» (todos lo son); «+52» repetido (selector y prefijo); el país vuelve a ser editable en «Fiscal» pese a «No podrás cambiarlo después»; planes en **inglés** (STARTER/PROFESSIONAL/ENTERPRISE) y en **US$** para una empresa mexicana, sin decir qué pasa tras los 30 días de prueba; tercera tarjeta huérfana; «Elige tu **P**lan». | H2, H8 | `R-01…R-16` |
| M-07 | Ventas · factura | Usabilidad | Emitir un comprobante fiscal (irreversible) no pide confirmación; en RD «Emitir factura» y «Guardar borrador» son **ambos botones primarios** violeta; «Cancelar» entre dos acciones; en el detalle de un borrador la acción «Emitir comprobante» está **al pie** del documento, no en la cabecera; el título muestra dos números (#FAC-00000001 y el NCF). | H5, H8 | `T-do-1-factura.jpg`, `T-fac-5-borrador.jpg`, `R/1366-invoices_new.jpg` |
| M-08 | Multiempresa | IA · feedback | La invitación a otra empresa solo se descubre por un «1» en el selector de empresa; la campana dice «No hay notificaciones». Al cambiar de empresa con un borrador sin guardar no hay aviso, y las pestañas de una empresa se trasladan a la otra (misma ruta reinterpretada con el otro inquilino). | H1, H5 | `O-1…O-9` |
| M-09 | Tesorería · importar extracto | Contenido | Antes de elegir archivo: «Escribe el nombre exacto de cada columna» (luego se autodetectan); error rojo **antes de interactuar** («**Indique** la columna…»: trato de *usted* en una app que tutea); «Umbral: 95 (aún sin historial para calibrarlo)» es jerga; cuenta por defecto «Caja general» para un extracto **bancario**. | H2, H10 | `T-conc-2-importar.jpg` |
| M-10 | Contabilidad · reportes | Inconsistencia | Período por defecto distinto: mes en curso (Libro mayor), año a la fecha (Estado de resultados, Balanza), enero–octubre (Análisis de variaciones), **enero** (Cierre de período). Importes con y sin símbolo en la misma tabla («0.00» vs «RD$0.00»; Tesorería «RD$0.00» y «0.00» en la misma fila). Negativos «-9,000.00» (guion) y «−0.00» (signo menos). | H4 | `survey/es-light/reports_*.jpg`, `T-rep-2-exportar-menu.jpg` |
| M-11 | Transversal | Contenido | Plurales con paréntesis: «punto(s)», «período(s) contable(s)», «cuenta(s)», «Quedan 0 asientos…»; «**Enero De 2026**» (Declaraciones) frente a «enero de 2026» (Períodos). | Guía de estilo | `survey/es-light/accounting_closing_annual-close.jpg`, `reports_fiscal-returns.jpg` |
| M-12 | Contabilidad · menú | IA | 27 entradas en un solo panel: a 900 px de alto desborda y la barra de estado desaparece; acciones como destinos («Ejecutar depreciación», «Cierre — anual» con raya); grupos mezclan reportes («Libro: diario») y maestros; el hub «Reportes» no tiene entrada en el menú. | H8; Fiori (agrupar por tarea) | `survey/es-light/accounting_*.jpg` |
| M-13 | POS | Inconsistencia | El POS parece otro producto: tema oscuro fijo y botón primario **azul** en lugar del violeta del ERP; «Caja main». | H4 | `P-1-pos.jpg` |
| M-14 | Idioma inglés | Contenido | Mezcla británico/estadounidense («Approvals **centre**», «Accounts receivable **aging**» en la pestaña y «**ageing**» en el h1); «Suppliers» y «Vendor bills» para lo mismo; datos sembrados por el sistema siguen en español en la interfaz inglesa (formas de pago «Tarjeta de crédito o débito», «AFP (fondo de pensiones)», «Libro principal», nombres de cuentas). | H4 | `harness/survey-en-light.json`, `survey/en-light/*.jpg` |
| M-15 | Transversal · avisos | Feedback | Los toasts aparecen arriba al centro **tapando** la barra de pestañas y la búsqueda; ante un 500 se muestran a la vez el aviso en la página **y** dos toasts con el mismo texto. | H8 | `T-fac-5-borrador.jpg`, `N-1-lista-500.jpg` |
| M-16 | Formularios | Usabilidad | *Placeholders* que parecen valores rellenos («Monterrey», «64000», «Neto 30», «Santo Domingo», «001-1234567-3»; el RFC de ejemplo es a la vez *placeholder* y ayuda). En Mi perfil los campos de contraseña muestran «••••••••» y parecen rellenos. | H5 | `T-cli-3-invalidos.jpg`, `T-do-4-config-fiscal.jpg` |
| M-17 | Cliente · condiciones | IA | «Términos de pago» es texto libre + «Días de crédito» numérico, en lugar de elegir del maestro «Condiciones de pago», que a su vez contiene una fila «**Sin nombre**» (0 días, 1 cliente). | H4 | `T-cli-1-form.jpg`, `survey/es-light/masters_payment-terms.jpg` |
| M-18 | Asiento manual | Usabilidad | El selector de cuentas ofrece cuentas de agrupación («1000 — Activo»); «Diario» no tiene valor por defecto (Diario general); buscar «Caja» no encuentra «Efectivo y Equivalentes». | H5 | `T-je-1-form.jpg`, `T-je-2-descuadrado.jpg` |
| M-19 | Inventario · ajuste | Usabilidad | Guardar deja el ajuste en Borrador; «Contabilizar» y «Anular» aparecen abajo, mientras arriba siguen «Cancelar/Guardar»: dos niveles de acciones sin indicar que el borrador no mueve existencias. | H1, H6 | `T-inv-3-ajuste-guardado.jpg` |

### 2.4 Bajos (8)

| ID | Hallazgo | Evidencia |
|---|---|---|
| B-01 | Riel: la etiqueta «Mi trabajo» toca los bordes de la píldora activa; «RR.HH. y nómina» en dos líneas; «Contabilidad» con letra más pequeña que el resto. | `001-after-login.jpg` |
| B-02 | Marca: el correo sale de `no-reply@**virteex**.local` y el README se titula «Virteex»; la app se llama «Virtex». «Privacidad **&** Términos» en español. | `tmp/mail-outbox` |
| B-03 | Saludo «Buenos días» a las 20:30 (hora de la empresa). | `R-18-primer-ingreso.jpg` |
| B-04 | Tras registrar un cobro desde la factura se vuelve al listado de recibos, no a la factura de origen. | `T-do-11-cobrado.jpg` |
| B-05 | Confirmaciones genéricas: «Aceptar» para «Enviar a aprobación»; «Verificación de seguridad — Acción protegida» no dice qué acción (pagar, invitar). | `T-ap-8-stepup.jpg` |
| B-06 | Aprobaciones dice «Al día.» y, debajo, «VENTAS 1 — Factura FAC-00000001 sin emitir». | `T-ap-5-bandeja.jpg` |
| B-07 | El contador de clientes (1, 322) junto al título solo existe en algunas listas (Clientes, Almacenes, Categorías, Diarios…), no en todas. | `survey/es-light/*` |
| B-08 | Detalle de factura: «Mapa de relaciones» fuera del grupo de herramientas y con otra altura. | `T-do-8-emitida.jpg` |

---

## 3. Mediciones de consistencia (Paso 3)

Fuente: `harness/survey-es-light.json` (77 pantallas, 1440×900, claro) y `harness/analysis-es-light.txt`.

| Dimensión | Cifra | Lectura |
|---|---|---|
| Familias tipográficas | **1** (Inter) | Bien |
| Estilos de h1 | **4** (24/600 ×59, 20/600 ×12, 30/600 ×4, 24/700 ×1) | Debería ser 1 |
| Estilos de h2 | 3 (17/600, 30/600, 15/600) | |
| Pantallas con un solo h1 | 76/77 (Inicio usa h1 con emoji; la pestaña de Inicio no expone título) | Bien |
| Botón primario | **1 variante** (`primary-button`, #5B37D9, 36 px, radio 6 px, 14 px/500) en 53 apariciones; en auth, `submit-button` 44 px/radio 10 px | Bien dentro de la app |
| Alturas de botones con texto | **8** (20, 24, 26, 28, 30, 32, 34, 36 px) | Excesivo |
| Radios de botón | 4 (6 px, 0, 9999 px, 999 px) | |
| Variantes de campo | **10** (alto 28/34/36; letra 13/13,6/14; radio 4/6; 3 colores de borde) | Debería ser ≤ 3 (normal, compacto, filtro) |
| Estilos de encabezado de tabla | **4** (13/600 con fondo ×9; 12/700 sin fondo ×3 — Parámetros de ley; 14/700 sin fondo — Categorías, Declaraciones; 14/600 — Tesorería) | Debería ser 1 |
| Implementaciones de estado vacío | **9** clases + genérico en 13 pantallas; con acción: 2 | |
| «Filas por página» por defecto | 3 valores (25, 50, 100) | |
| Nombres menú ≠ pestaña ≠ h1 | **29/77** pantallas | |
| Pantallas con búsqueda | **11/77** | |
| axe (claro) | 1 regla: `nested-interactive` 62/77 páginas, 678 nodos; **0 errores de contraste** | Bien en contraste |
| axe (oscuro) | `color-contrast` 65 páginas (riel activo 2,26:1); `nested-interactive` 77 páginas | |
| Texto < 12 px | 11,7 px en códigos de Formas de pago y Conceptos de nómina | |
| Objetivos < 24 px | checkbox 16×16 (Existencias, Categorías, Conciliación, Conceptos); «Resolver» 49×19; encabezados ordenables 20 px de alto | WCAG 2.5.8 |
| Botones solo icono sin nombre | 7 pantallas (Pagos, Notas de débito, Recepciones, Kárdex, Cierre anual, Libro mayor, Mayor de terceros) | WCAG 4.1.2 |
| Tiempo a red inactiva | media **2,6 s**, máx. 3,4 s | Aceptable |
| Claves crudas en pantalla (barrido) | 0 en las 77 pantallas en reposo; aparecen en errores (A-13) | |
| Desbordamiento horizontal del documento | 0 en 6 tamaños × 6 pantallas | Pero recorte interno (C-06) |

---

## 4. Resultado por tareas (Paso 4)

Clics = interacciones del camino más corto que encontré desde el menú, sin contar tecleo.

| Tarea | Rol / empresa | ¿Se completó? | Pasos | Bloqueos y confusiones | Mínimo razonable en un ERP líder |
|---|---|---|---|---|---|
| Crear y configurar una empresa | Prospecto / MX | **Sí, con riesgo** | 6 pasos, 2 códigos | C-02 (un error tipográfico bloquea en silencio), clave cruda, `{{example}}`, planes en inglés y USD | 3–4 pasos (QuickBooks, Xero: correo + empresa; el resto, después) — conf. media |
| Crear cliente | Admin / MX | Sí | 2 clics + campos | Errores solo con color (A-05); faltan datos CFDI (A-04) | Igual |
| Crear proveedor | Admin / MX | Sí | 2 clics + campos | Formulario distinto al de cliente; textos DGII/609 (A-03) | Igual |
| Crear producto | Admin / MX | Sí | 2 clics + campos | Sin clave SAT; acepta precio negativo y costo con 6 decimales sin aviso | Igual |
| Emitir factura | Admin / MX | **No (legítimo)** | — | Falta CSD; el banner lo explica bien, pero el enlace lleva a Mi perfil (A-02) | — |
| Emitir factura | Admin / DO | Sí | 6 clics + configurar rango (≈ 8) | Enlace equivocado (A-02), rango precargado (C-08), sin confirmación (M-07) | 1–2 clics tras configuración guiada |
| Cobrar factura | Admin / DO | **Sí, bien** | 3 clics desde la factura | Fecha por defecto de mañana (A-08); vuelve a recibos (B-04) | 2–3 clics |
| Registrar compra y pagarla | Admin / MX | Sí | ≈ 12 | Conocimiento oculto (A-15) | 4–6 (Odoo: Confirmar → Registrar pago) — conf. alta |
| Asiento manual | Admin / MX | Sí | ≈ 8 + campos | Sin diario por defecto, cuentas de agrupación (M-18) | Igual |
| Conciliar cuenta bancaria | Admin / MX | **No** | — | C-03 | Import + emparejar |
| Mover inventario (ajuste) | Admin / MX | Parcial (borrador) | 5 + Contabilizar | M-19 | Igual |
| Procesar nómina | Admin / MX | **No** | — | C-01 | — |
| Reporte financiero y exportar | Admin / MX | Sí (solo CSV) | 2 clics | A-12 | PDF/XLSX |
| Invitar usuario y limitar permisos | Admin / MX | Sí | ≈ 7 + reautenticación | 3 diálogos apilados (A-14); el invitado ve «Acceso denegado» (A-01) | Igual, sin el acceso denegado |
| Trabajar con permisos restringidos | Vendedor / MX | Sí | — | Menú correctamente filtrado; KPI engañosos (A-11) | — |
| Cambiar de organización | Contador / DO→MX | Sí | 2 clics | Invitación poco visible, etiquetas del país anterior (A-03, M-08) | 2 clics |
| Cambiar de idioma | Admin / DO | **Sí, bien** | 2 clics (menú de usuario) | — | Igual |

**Organización vacía (prerrequisitos):** el **mejor patrón del producto** es el banner de prerrequisitos de la factura («Para emitir comprobantes todavía falta: … Ir a la configuración fiscal»), y la creación de cliente **en línea** desde el selector («Crear el cliente «Ñandú»»). Faltan: (1) un *checklist* de puesta en marcha en el Inicio de una empresa vacía (Odoo y QuickBooks lo tienen — conf. alta); el Inicio muestra KPI a cero; (2) creación en línea en los demás selectores (producto en la factura, cuenta en compras, diario en asiento); (3) que el enlace del banner lleve al sitio correcto (A-02).

---

## 5. Matriz de cobertura

Leyenda: ✔ verificado · ◐ parcial · ✗ no cubierto. Columnas: **E** estados (vacío / datos / volumen / error) · **T** tamaños · **K** teclado · **A** accesibilidad (axe + manual) · **I** idioma (en) · **O** tema oscuro · **F** flujo de tarea.

| Módulo | Pantallas | E | T | K | A | I | O | F | Cobertura |
|---|---|---|---|---|---|---|---|---|---|
| Mi trabajo | 6 | ◐ vacío | ◐ Inicio | ✗ | ✔ | ✔ | ✔ | ◐ aprobaciones | 55 % |
| Ventas | 9 + formularios | ✔ (vacío, datos, 322 clientes, 500, lento) | ✔ | ✔ factura | ✔ | ✔ | ✔ | ✔ factura, cobro, cliente | 90 % |
| Compras | 8 + formularios | ◐ vacío/datos | ✗ | ✗ | ✔ | ✔ | ✔ | ✔ proveedor, factura, pago | 70 % |
| Inventario | 9 + formularios | ◐ | ✗ | ✗ | ✔ | ✔ | ✔ | ◐ producto, ajuste | 60 % |
| Tesorería | 5 + importación | ◐ | ✗ | ✗ | ✔ | ✔ | ✔ | ◐ conciliación (bloqueada) | 55 % |
| Contabilidad | 27 + formularios | ◐ | ◐ Balance, asiento | ✗ | ✔ | ✔ | ✔ | ◐ asiento, reportes, export | 60 % |
| RR.HH. y nómina | 6 + formularios | ◐ | ✗ | ✗ | ✔ | ✔ | ✔ | ◐ nómina MX (bloqueada) | 55 % |
| Análisis | 7 | ◐ vacío | ✗ | ✗ | ✔ | ✔ | ✔ | ✗ | 45 % |
| Alta / acceso | 8 pantallas | ✔ | ✗ | ◐ | ◐ | ✗ | ✗ | ✔ | 60 % |
| Ajustes (modal) | 25 secciones | ◐ Perfil, Comprobantes, Usuarios | ✗ | ✔ | ◐ | ✗ | ✗ | ◐ | 25 % |
| POS | app aparte | ◐ apertura | ✗ | ✗ | ✗ | ✗ | — | ✗ | 10 % |
| Escritorio | app Electron | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 0 % |

**Total aproximado:** 77/77 pantallas de menú con fichas 1, 2 (vacío), 6 y 7; formularios de las tareas principales con las siete fichas; **≈ 55 % de las verificaciones posibles**.

**No cubierto y por qué:**
- **Escritorio (Electron):** sin servidor gráfico en el contenedor.
- **POS (venta completa):** solo se abrió; no se abrió turno ni se cobró, por tiempo. La ronda anterior lo cubrió.
- **Portugués:** no recorrido por tiempo (inglés sí, completo).
- **Ajustes:** solo Perfil, Comprobantes fiscales y Usuarios de 25 secciones.
- **Cotizaciones, órdenes de compra, recepciones, requisiciones, transferencias, activos fijos, presupuestos, cierres, flujos de trabajo, DataSheets, copiloto IA, marketplace de extensiones:** solo estado vacío y medición; sin flujo.
- **Volumen** solo en clientes (322); no en productos, facturas ni asientos.
- **Zoom nativo del navegador:** emulado por geometría de viewport.
- **Lector de pantalla real:** solo árbol de accesibilidad vía axe y atributos ARIA; no se usó NVDA/VoiceOver.
- **Preferencia de movimiento reducido:** no verificada.
- **Texto largo y valores extremos** solo en cliente (nombre de 120 caracteres), producto (emoji, «», decimales, negativo) y proveedor.

---

## 6. Fortalezas a preservar

1. **Contraste en tema claro:** 0 incumplimientos de `color-contrast` en 77 pantallas; tipografía única (Inter); un solo botón primario dentro de la app.
2. **Resiliencia de red:** error 500 con mensaje y «Reintentar»; carga lenta con *skeleton*; sin conexión, indicador «Sin conexión» en la barra de estado, mensaje claro al guardar y **sin perder lo escrito** (`N-1…N-5`).
3. **Borradores persistentes:** una factura sin guardar sobrevive a recargas y a cambios de empresa, con punto de «sin guardar» en la pestaña y estado «Sin guardar / Sin cambios» en la cabecera.
4. **Prerrequisitos explicados:** el banner de la factura nombra exactamente qué falta para emitir (CSD en MX, rango NCF en RD).
5. **Reautenticación y confirmaciones bien hechas:** el step-up reintenta solo la acción; el aviso de sobregiro explica la consecuencia con cifras; el diálogo tiene `role=dialog`, `aria-modal` y título asociado.
6. **Cobro desde la factura** (corrige C-03 de la ronda 2): 3 clics, con la factura ya aplicada.
7. **Creación en línea** del cliente desde el selector de la factura; vencimiento calculado desde los días de crédito del cliente.
8. **Elección de país al inicio del alta** y aceptación de Términos obligatoria (corrigen C-06 y C-07 de la ronda 2); alternativas cuando no llega el SMS.
9. **Menú filtrado por permisos** para el rol restringido.
10. **Inglés completo** sin claves crudas en las 77 pantallas.
11. **Sin desbordamiento horizontal** en ningún tamaño; encabezados de tabla fijos; trampa de foco y Escape en modales.
12. **PDF de factura** limpio y legible.

---

## 7. Scorecard (1–10)

Calibración: 10 = a la altura o por encima de los líderes; 5 = utilizable en el camino feliz pero con bloqueos o inconsistencias que un cliente notaría en la primera semana.

| Eje | Nota | Justificación | Qué falta para 10 |
|---|---|---|---|
| **Completabilidad y ausencia de bloqueos** | **4** | 3 tareas principales no se completan (nómina MX C-01, conciliación C-03, emisión DO solo con datos precargados C-08); el alta falla en silencio ante un error común (C-02); pérdida de trabajo (C-04, C-05). Cobro, cliente, compra e idioma sí. | Cerrar C-01…C-05; prueba E2E por país de las 12 tareas del §4 en CI. |
| Consistencia visual y del sistema de diseño | 5 | Buena base (una fuente, un primario, tokens), pero 4 h1, 10 campos, 4 tablas, 9 estados vacíos, POS con otro primario (§3, M-01…M-03, M-13). | Componentes únicos de cabecera de página, tabla, campo y estado vacío; lint que impida variantes. |
| Usabilidad | 5 | Flujos con conocimiento oculto (A-15), sin búsqueda (A-06), búsqueda sin tildes (A-07), placeholders engañosos (M-16). | Defaults inteligentes, búsqueda y filtros en todo listado, creación en línea en todo selector. |
| Arquitectura de la información y orientación | 5 | 29/77 pantallas con nombres distintos (A-10), duplicados en menú, Contabilidad de 27 entradas (M-12), Ajustes como modal (A-14), invitación escondida (M-08). Bien: elemento activo del menú, título de pestaña correcto en todas las rutas. | Nomenclatura única desde el manifiesto; Contabilidad en submódulos; Ajustes como página. |
| Estados y retroalimentación | 6 | Fuerte en red y offline; débil en 429 (C-02, C-05), errores genéricos (C-03), KPI engañosos (A-11), toasts que tapan (M-15). | Manejo uniforme de 4xx/5xx con mensajes accionables. |
| Accesibilidad | 5 | Contraste claro perfecto; pero errores sin texto (A-05), foco en diálogos (A-14), campos sin etiqueta, `nested-interactive` en 62 páginas, contraste oscuro (M-05). | WCAG 2.2 AA en CI (axe + pruebas de foco) por pantalla y tema. |
| Responsive | **3** | Recorte de contenido esencial en móvil y tableta (C-06); escritorio 1366+ correcto. | Reflujo de tablas y formularios; prueba a 375/768 en CI. |
| Contenido e idioma | 4 | Fugas de RD en MX (A-03), CFDI incompleto (A-04), claves crudas (A-13), fechas (A-08), plurales «(s)» (M-11), inglés con variantes (M-14). | Paquete de país como única fuente de etiquetas fiscales; revisión lingüística por mercado. |
| Rendimiento percibido | 7 | 2,6 s de media hasta red inactiva; *skeletons*; 322 filas sin virtualizar en 2,5 s. | Paginación/virtualización, carga perezosa de widgets. |

**Global de UI/UX: 4/10** (no puede superar al eje de completabilidad).

**Por módulo** (consistencia · usabilidad · completabilidad):

| Módulo | Consistencia | Usabilidad | Completabilidad |
|---|---|---|---|
| Ventas (referencia) | 6 | 6 | 7 |
| Compras | 5 | 4 | 6 |
| Inventario | 6 | 5 | 6 |
| Tesorería | 4 | 4 | 2 |
| Contabilidad | 4 | 5 | 6 |
| RR.HH. y nómina | 5 | 5 | 1 (MX) |
| Análisis | 5 | 5 | n/e |
| Alta y acceso | 6 | 5 | 5 |
| POS | 3 (vs. ERP) | n/e | n/e |

**Módulo de referencia:** Ventas (factura, cliente, cobro): cabecera con estado de guardado, acciones a la derecha, banner de prerrequisitos y creación en línea. Se desvían más: Tesorería (maquetación A-09), Contabilidad (A-09, M-10, M-12) y Compras (A-15, A-03).

---

## 8. Prioridades

### 8.1 Problemas sistémicos (causas comunes)

1. **El paquete de país no es la única fuente de verdad** → A-03, A-04, C-01, C-08, A-08 (formatos), M-06. Toda etiqueta fiscal, catálogo, impuesto, retención, formato de fecha y disponibilidad de módulo debe salir del `country-pack` de la empresa activa y recargarse al cambiar de empresa. Sin «DO por defecto».
2. **Manejo de errores HTTP no centralizado** → C-02, C-03, C-05, A-13, M-15. Un interceptor único: 401 = reautenticar en diálogo; 429/5xx = transitorio con reintento y mensaje localizado; 400 = mostrar el detalle por campo; nunca una clave cruda.
3. **Sin plantilla de página ni componentes únicos** → A-09, A-10, M-01, M-02, M-03, M-04. Cabecera de página, barra de filtros, tabla, estado vacío y campo como componentes obligatorios, con *lint* que rechace variantes (como ya hace `lint:design-system` con colores).
4. **Formularios sin capa común de validación accesible y autoguardado** → A-05, C-04, M-16. Un `FormField` con mensaje, `aria-invalid`, `aria-describedby`, foco al primer error y borrador persistente para todo `WindowKind.DRAFT`.
5. **Fecha «de hoy» y formato no centralizados** → A-08. Un servicio de fecha con zona de la empresa y un selector propio.
6. **Nomenclatura no derivada del manifiesto** → A-10. El manifiesto debe dar una sola clave por pantalla para menú, pestaña, título del navegador y h1.

### 8.2 Los diez cambios de mayor impacto

1. Ocultar o marcar «no disponible» los módulos no soportados por país (nómina MX) — C-01.
2. Interceptor HTTP: 429 nunca cierra sesión ni deja la pantalla muda; errores con motivo — C-02, C-05, C-03.
3. Reautenticación en diálogo y autoguardado de formularios — C-04.
4. Reflujo móvil/tableta de tablas y formularios — C-06.
5. Hoja `@media print` y RNC/RFC obligatorio para emitir; rango fiscal sin valores precargados — C-07, C-08.
6. Paquete de país como única fuente de etiquetas fiscales + campos CFDI 4.0 — A-03, A-04.
7. Búsqueda, filtros y paginación en todos los listados, con búsqueda insensible a diacríticos — A-06, A-07.
8. Validación accesible en línea en todos los formularios — A-05.
9. Plantilla única de página y de reporte; un solo h1 — A-09, A-10.
10. Invitado aterriza en su empresa; acceso denegado dentro del shell y accionable; widgets que respetan permisos — A-01, A-11.

---

## 9. Resumen ejecutivo

1. Virtex tiene una base visual sólida (Inter, un primario, 0 errores de contraste en claro) y maneja bien la red: 500, lentitud y desconexión no hacen perder datos.
2. Pero **no está a la altura de los líderes**: nota global **4/10**, limitada por la completabilidad de tareas.
3. **8 críticos:** en México la nómina se configura entera y falla al final («jurisdicción MX no soportada»); la conciliación bancaria no importa el extracto y el error no dice por qué; un código de verificación mal escrito bloquea el alta sin mensaje; un 429 en la sesión expulsa al usuario al login; al caducar la sesión se pierde el formulario; en móvil/tableta hay columnas y campos inalcanzables; Ctrl+P imprime la app y no la factura; y el rango fiscal viene precargado y permite emitir sin RNC.
4. **15 altos**, con dos causas dominantes: el paquete de país no gobierna los textos (ITBIS, DGII y «609» en una empresa mexicana; faltan los datos del CFDI 4.0) y no hay plantilla común de página/listado (4 tamaños de h1, 29 pantallas con tres nombres distintos, 11/77 con búsqueda, 322 clientes sin búsqueda ni paginación).
5. Se corrigieron hallazgos previos (cobro desde la factura, país al inicio del alta, términos obligatorios); persisten «Ir a la configuración fiscal» → Mi perfil, el invitado en «Acceso denegado», fechas mm/dd y errores solo con color.
6. Prioridad: el paquete de país como única fuente, un interceptor HTTP único, formularios con validación accesible y autoguardado, y componentes únicos de página, tabla y estado vacío.
