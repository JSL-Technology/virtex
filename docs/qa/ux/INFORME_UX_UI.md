# Auditoría QA de UX/UI y funcionalidad — Virtex ERP

**Fecha:** 12-10-2026 · **Rama:** `claude/qa-ui-ux-funcionalidad-rn9y42` (base `0d6c1d67`)
**Rol:** QA sénior con foco en UX/UI, usando la aplicación como un usuario real (sin revisar código para encontrar fallos; el código solo se consultó para confirmar la causa de un síntoma ya observado).
**Archivos:** este informe · [`evidence/`](evidence/) (capturas citadas) · [`evidence/survey/`](evidence/survey/) (captura de **cada pantalla** en 4 variantes) · [`harness/`](harness/) (scripts Playwright reproducibles y métricas `survey-*.json`).

---

## 1. Resumen ejecutivo

Virtex tiene una base visual moderna (tipografía Inter, paleta violeta coherente, iconografía Lucide, tema oscuro bien resuelto, foco de teclado visible, buen aviso sin conexión) y un núcleo contable sólido: emitir una factura genera su asiento, el cobro su asiento y el feed de actividad lo refleja en segundos. **Pero hoy no está lista para comercializarse en LatAm y EE. UU.** por cuatro bloques de problemas:

1. **Estabilidad:** la API **se cuelga para todas las empresas** tras unas pocas recargas o navegaciones (pool de conexiones agotado por transacciones que quedan abiertas). Lo provoqué **10 veces** en uso normal. Cuando ocurre, el usuario ve una **pantalla en blanco eterna**, sin mensaje.
2. **Flujos esenciales rotos o incompletos:** el botón **«Nuevo recibo» no hace nada** (no se pueden registrar cobros desde la interfaz), el **POS cobra sin pantalla de pago**, los **reportes financieros quedan «secuestrados»** por el Flujo de efectivo, y «Ir a la configuración fiscal» lleva a una sección equivocada.
3. **Atado a República Dominicana:** una empresa de EE. UU. recibe formas de pago «fijadas por la DGII», un cliente «Consumidor final», ejemplos «Santo Domingo», ningún impuesto de venta ni parámetro de nómina, y declaraciones solo para DGII/SAT. Cualquier país no reconocido en el alta **se convierte en RD en silencio**.
4. **Legal y confianza:** el alta se completa **sin aceptar Términos** (y no se guarda el consentimiento), los enlaces **Términos/Privacidad/Seguridad/Contacto no existen** (redirigen al login), y tras una «prueba gratuita» sin tarjeta se muestra **«Payment confirmed»**.

Además hay una deuda amplia de **consistencia** (3 diseños distintos para documentos hermanos, 4 estilos de estado vacío, 10 pantallas con nombres distintos en menú/título/pestaña), **accesibilidad** (contraste, controles anidados, errores comunicados solo por color) y **responsive** (en móvil el contenido se corta y el POS es inutilizable).

| Severidad | Nº | Significado |
|---|---|---|
| **Crítica** | 10 | Bloquea un flujo esencial, afecta a todos los usuarios, o tiene riesgo legal/fiscal. Bloquea el lanzamiento. |
| **Alta** | 20 | Impide o confunde una tarea frecuente, o rompe la adaptación por país. Corregir antes de vender. |
| **Media** | 24 | Inconsistencia o fricción notable; degrada la percepción de calidad. |
| **Baja** | 12 | Pulido, microcopy, detalles visuales. |

**Las 10 acciones de mayor retorno** (detalle en §5): (1) cerrar la fuga de transacciones y poner timeouts + pantalla de error; (2) arreglar «Nuevo recibo» y añadir «Registrar cobro» en la factura; (3) pantalla de pago en el POS; (4) separar la configuración por país (catálogos, impuestos, nómina, textos) y pedir el país en el alta en vez de asumir RD; (5) exigir y registrar la aceptación de Términos y publicar las páginas legales; (6) arreglar el estado de pestañas (límite, no recargar las ocultas, rutas que no se pisan); (7) un único componente de documento (factura/cotización/compra); (8) errores de formulario en línea y accesibles; (9) layout responsive real; (10) unificar nomenclatura y estados vacíos con un sistema de diseño documentado.

---

## 2. Alcance, entorno y método

- **Entorno local** (nunca producción): Postgres 16 + Redis 7, `npm run migration:run`, API NestJS `:3000` (`DEV_SEED=true`), cliente Angular `:4200`. Chromium (Playwright 1.56) a 1440×900 y 390×844 (móvil táctil).
- **Usuarios/empresas:**
  - `dev@virtex.local` — «Virtex Dev», **República Dominicana**, administrador (semilla).
  - Empresa nueva creada por el flujo de alta como un prospecto real: «QA Ñandú & Sons LLC», **EE. UU.** (EIN, Washington DC), usuaria «María José O'Connor-Núñez».
- **Idiomas:** español, inglés y portugués (cambio desde Ajustes › Mi perfil). **Temas:** claro y oscuro. **Formatos:** fechas, moneda (DOP/USD), números, teléfonos, identificadores fiscales.
- **Cobertura:**
  - Las **71 pantallas** del menú, en 4 variantes = **284 capturas** con medición automática (axe-core 4.10 para accesibilidad, texto truncado, fuentes < 11 px, objetivos táctiles, `h1`, errores de API/consola): `es-light`, `es-dark`, `us-en-light` (empresa de EE. UU.), `m-pt-light` (móvil en portugués).
  - **Flujos reales:** alta completa de empresa (6 pasos, con códigos de correo y SMS), login/errores/bloqueo/recuperación, crear cliente (vacío, inválido, caracteres especiales, XSS, emoji), crear producto y servicio, configurar rango NCF, crear y emitir factura, cobrar, cotización → aceptar → convertir en factura, proveedor y factura de proveedor, POS, eliminar cliente con documentos, búsqueda global, menú «Crear nuevo», atajos de teclado, navegación solo con teclado, cambio de tema e idioma, modo sin conexión, móvil.
- **Datos de prueba** con prefijo `QA-UX`/`qa.ux.`; ningún efecto externo (correo y SMS van a los buzones de desarrollo `tmp/mail-outbox` y `tmp/sms-outbox`).
- **Limitaciones:** Google Fonts y reCAPTCHA no son alcanzables desde el contenedor (no afecta a los hallazgos). Los campos de fecha nativos se muestran según el idioma del navegador headless (en-US); eso **es** parte del hallazgo M-05. Para seguir probando tras cada cuelgue de la API fue necesario reiniciarla (`harness/restart-api.sh`, registro en `harness/hangs.log`).
- **Regresión de la QA anterior (28-09):** confirmado que ya están corregidos el panel vacío por `dockview-angular`, el congelamiento al pulsar F5 y el borrado en cascada de facturas al eliminar un cliente (ahora el servidor lo bloquea).

Formato de cada hallazgo: **ID · título · severidad**, dónde ocurre, evidencia, qué pasa, **por qué es un problema** (principio, heurística de Nielsen «H#» o criterio WCAG 2.2) y **qué hacer**.

---

## 3. Hallazgos

### 3.1 Críticos

#### C-01 · La API deja de responder para todos tras unas pocas recargas o navegaciones — Crítica
- **Dónde:** global (backend). Se dispara al guardar el espacio de trabajo (pestañas abiertas) y al abrir reportes y documentos fiscales.
- **Evidencia:** [`C01-prueba-realista.txt`](evidence/C01-prueba-realista.txt), [`C01-pg_stat_activity.txt`](evidence/C01-pg_stat_activity.txt), [`harness/hangs.log`](harness/hangs.log) (8 cuelgues registrados automáticamente + 2 manuales; uno de ellos **navegando solo por el menú**, sin recargar).
- **Qué pasa:** con login + abrir Facturas + 3 recargas (F5) espaciadas 10 s, quedan **3 conexiones bloqueadas indefinidamente** y 1 transacción «idle in transaction». Cada recarga filtra ~1 conexión del pool (10). Al agotarse, **ninguna petición responde** (incluido `GET /auth/session` y la página de login) hasta reiniciar el servidor. En Postgres se ven 9 `UPDATE user_workspaces` esperando un bloqueo que retiene una transacción abierta (consulta a `ncf_sequences` / `RESET app.current_organization`). En el log coinciden los errores «No se pudo registrar la auditoría de balance_sheet… Query runner already released».
- **Por qué es un problema:** un solo usuario haciendo F5 tumba el servicio de **todas las empresas** (multi-tenant). Es una caída de producción garantizada, y además deja de registrarse la auditoría de lectura de reportes (cumplimiento).
- **Qué hacer:** (1) asegurar que toda transacción por petición se confirma/revierte en `finally`, también en interceptores de auditoría y en caminos de error; (2) no abrir transacción para lecturas; (3) serializar o hacer *upsert* idempotente del `PUT /me/workspace` (último en escribir gana, sin `SELECT … FOR UPDATE` largos) y **debounce** en el cliente; (4) `idle_in_transaction_session_timeout` y `statement_timeout` en Postgres; (5) prueba de carga en CI (50 recargas + 20 reportes) que falle si quedan transacciones abiertas.

#### C-02 · Pantalla en blanco infinita cuando la sesión no responde — Crítica
- **Dónde:** arranque de la app (cualquier URL con sesión).
- **Evidencia:** [`C02-pantalla-en-blanco-30s.png`](evidence/C02-pantalla-en-blanco-30s.png) (30 s después de cargar: `body` vacío). Observado en vivo durante C-01 en 20+ pantallas.
- **Qué pasa:** la app espera `GET /auth/session` sin límite de tiempo; no hay *spinner*, ni mensaje, ni reintento, ni redirección al login.
- **Por qué:** H1 (visibilidad del estado del sistema) y H9 (ayudar a recuperarse de errores). El usuario cree que la app «no existe» y no puede hacer nada.
- **Qué hacer:** *splash* con logo y *spinner* desde el primer byte (en `index.html`), timeout de 10 s con pantalla «No pudimos conectar — Reintentar / Ir al inicio de sesión», y reintento con backoff.

#### C-03 · No se pueden registrar cobros: «Nuevo recibo» no hace nada — Crítica
- **Dónde:** Ventas › Recibos.
- **Evidencia:** [`F-cobro-0-lista.png`](evidence/F-cobro-0-lista.png), [`F-cobro-2-tras-click.png`](evidence/F-cobro-2-tras-click.png). El botón es un enlace con `routerlink="new"` cuyo `href` resuelve a la **misma página** (`/customer-receipts`); el clic no produce navegación ni petición. El formulario existe en `/customer-receipts/new` ([`F-cobro-3-directo.png`](evidence/F-cobro-3-directo.png)) pero es inalcanzable.
- **Agravante:** la factura emitida **no ofrece «Registrar cobro»** ([`F-fac-9-totales.png`](evidence/F-fac-9-totales.png)) — solo «Nota de crédito» y «Anular».
- **Por qué:** cobrar es la segunda tarea más importante de un sistema de facturación; sin ello la cartera nunca baja.
- **Qué hacer:** corregir el enlace (ruta absoluta o `relativeTo`); añadir «Registrar cobro» en el detalle de la factura, en la fila del listado y en el panel «Próximos vencimientos»; prueba E2E «emitir → cobrar → estado Cobrada».

#### C-04 · El POS registra la venta sin pantalla de pago — Crítica
- **Dónde:** Ventas › Punto de venta.
- **Evidencia:** [`F-pos-3-carrito.png`](evidence/F-pos-3-carrito.png) → clic en «Cobrar» → [`F-pos-4-cobrar.png`](evidence/F-pos-4-cobrar.png) «Venta registrada.» de inmediato.
- **Qué pasa:** no se pregunta forma de pago (efectivo, tarjeta, mixto), monto recibido ni se calcula el cambio; no se emite ni ofrece imprimir ticket/comprobante.
- **Por qué:** en caja esto produce cuadres erróneos (todas las ventas quedan con una forma de pago supuesta) y no hay documento para el cliente. H5 (prevención de errores) y correspondencia con el mundo real (H2).
- **Qué hacer:** modal de pago con métodos, teclado numérico, «Recibido / Cambio», pagos mixtos, confirmación y «Imprimir / Enviar ticket». Atajo de teclado para caja rápida.

#### C-05 · Los reportes financieros quedan «secuestrados» por el Flujo de efectivo — Crítica
- **Dónde:** Contabilidad (Balance general, Estado de resultados, Análisis de variaciones, Cierres), Ventas/Compras (Antigüedad de saldos), Tesorería (Tablero, Conciliación).
- **Evidencia:** [`B-ruta-2-Balance_general.png`](evidence/B-ruta-2-Balance_general.png), [`B-ruta-3-Estado_de_resultados.png`](evidence/B-ruta-3-Estado_de_resultados.png), [`B-ruta-4-Antigüedad_de_saldos.png`](evidence/B-ruta-4-Antigüedad_de_saldos.png). Con clics reales en el menú: al pulsar «Balance general» la URL ni siquiera cambia y se muestra el Flujo de efectivo; al pulsar Ventas › Antigüedad de saldos, la app **salta al módulo Contabilidad**. 9 de 71 rutas afectadas en el recorrido (`survey-es-light.json`, título «Flujo de efectivo»).
- **Condición:** ocurre con el espacio de trabajo de un usuario que ya abrió muchas pestañas (uso normal tras unos días). En la empresa nueva de EE. UU. las mismas rutas sí funcionaron.
- **Por qué:** el usuario no puede consultar su balance ni su estado de resultados. H3 (control del usuario) y H4 (consistencia).
- **Qué hacer:** clave de pestaña por ruta completa (no por «tipo de reporte»); la pestaña de vista previa debe reemplazar su contenido al navegar; prueba de regresión con un workspace de 40 pestañas restaurado.

#### C-06 · Empresas fuera de RD reciben un producto dominicano — Crítica
- **Dónde:** empresa de EE. UU. creada por el alta.
- **Evidencia:**
  - Formas de pago: «*Fixed by the DGII for fiscal documents; they are not added or edited*» con los 7 códigos DGII ([`us-en-light-34`](evidence/survey/us-en-light/us-en-light-34-masters_payment-methods.png)). No se puede añadir ACH, Zelle, cheque, etc.
  - Impuestos: **vacío**, sin ningún *sales tax* ni guía por estado ([`us-en-light-58`](evidence/survey/us-en-light/us-en-light-58-masters_taxes.png)); en la factura la columna «Tax» es un campo libre en 0 ([`US-factura-form.png`](evidence/US-factura-form.png)).
  - Nómina: parámetros de ley **vacíos** (sin FICA, Medicare, FUTA, retenciones) y sin botón para añadirlos ([`us-en-light-67`](evidence/survey/us-en-light/us-en-light-67-payroll_parameters.png)).
  - Declaraciones: «*The product generates the DGII formats (Dominican Republic) and the SAT electronic accounting (Mexico)*» ([`us-en-light-53`](evidence/survey/us-en-light/us-en-light-53-reports_fiscal-returns.png)).
  - Cliente por defecto «**Consumidor final**» en una empresa en inglés ([`US-cliente-form.png`](evidence/US-cliente-form.png) / listado).
  - Factura en EE. UU. con «*Withholding at source*» y «*Designated withholding agent*» (conceptos latinoamericanos).
  - Perfil de empresa con ejemplos «*e.g. Santo Domingo*», «*e.g. Dominican Republic*» ([`L-1-perfil-en.png`](evidence/L-1-perfil-en.png)).
  - Si el país del visitante no se reconoce (en-GB, pt-PT, fr-FR…), el enlace de alta lleva a **`/…/do/auth/register`**: se asume RD en silencio (`harness/50-locales.cjs`).
- **Por qué:** el requisito de negocio es no estar atado a ningún país. Un cliente estadounidense no puede facturar con impuestos ni pagar nómina; percibe un producto «de otro país».
- **Qué hacer:** «paquete de país» completo y obligatorio por cada país vendible (impuestos por defecto, catálogos de formas de pago editables, plantillas de nómina, cliente genérico localizado, ejemplos/placeholder por país, reportes fiscales o un mensaje honesto «no disponible en tu país»); en el alta, **preguntar el país** con selector y bandera en lugar de inferirlo; ocultar módulos/campos que no apliquen al país (retenciones, NCF).

#### C-07 · El alta se completa sin aceptar Términos y no guarda el consentimiento — Crítica (legal)
- **Dónde:** registro, paso 6 «Plan».
- **Evidencia:** [`RF-en-us-6-plan.png`](evidence/auth/RF-en-us-6-plan.png) (casilla sin marcar) → clic en «Sign up» → [`RF-en-us-6a-sin-aceptar-terminos.png`](evidence/auth/RF-en-us-6a-sin-aceptar-terminos.png) cuenta creada. El cuerpo de `POST /auth/register-checkout` **no contiene ningún campo de aceptación** (nombre, correo, teléfono, empresa, EIN, dirección, plan… y nada más).
- **Por qué:** sin consentimiento expreso y fechado no hay contrato ni base legal para el tratamiento de datos (GDPR/CCPA/LGPD y leyes locales de LatAm). Riesgo legal directo.
- **Qué hacer:** deshabilitar «Registrarme» hasta marcar la casilla (con mensaje), enviar y persistir `termsVersion`, `privacyVersion`, fecha, IP; validar también en el servidor.

#### C-08 · Las páginas legales no existen — Crítica (legal)
- **Dónde:** pie de login/registro (Términos, Privacidad, Seguridad, Contacto) y casilla de aceptación del alta.
- **Evidencia:** `/terms`, `/privacy`, `/security`, `/contact` → redirigen a `/es/auth/login` ([`A-legal-contacto.png`](evidence/A-legal-contacto.png); salida de `harness/46-login-errores.cjs`).
- **Por qué:** se pide aceptar documentos que no se pueden leer; un usuario o un auditor lo detecta de inmediato. Además, «Contacto» roto elimina el canal de ayuda (H10).
- **Qué hacer:** publicar las cuatro páginas (localizadas por idioma y país), con versión y fecha; enlaces relativos al idioma (`/es/terms`).

#### C-09 · La cuenta bloqueada dice «Correo o contraseña incorrectos» con la contraseña correcta — Crítica
- **Dónde:** login tras 6 intentos fallidos.
- **Evidencia:** [`A-err-5-bloqueada-con-clave-correcta.png`](evidence/A-err-5-bloqueada-con-clave-correcta.png); el log del API registra «*Attempt on locked account — credentials VALID*»; no se envía correo de aviso ni de desbloqueo (buzón de desarrollo vacío).
- **Por qué:** el usuario legítimo cree que olvidó la contraseña, la restablece y sigue sin poder entrar; genera tickets de soporte y abandono. H9.
- **Qué hacer:** tras validar la contraseña, informar «Tu cuenta está bloqueada temporalmente; vuelve a intentarlo en N minutos o desbloquéala desde el enlace que te enviamos»; enviar correo de aviso con enlace de desbloqueo. (No revela nada a un atacante: solo se muestra con credenciales válidas).

#### C-10 · El rango de comprobantes fiscales se registra con datos ficticios precargados y no se puede corregir — Crítica (fiscal)
- **Dónde:** Configuración › Comprobantes fiscales (RD).
- **Evidencia:** el formulario viene **prellenado** (tipo, prefijo, desde 1, hasta 1000, vence 31/12/2027). Con un solo clic en «Registrar rango», sin tocar nada, quedó registrado **B01 1–1000** ([`F-ncf-2-registrado.png`](evidence/F-ncf-2-registrado.png)). La tabla de rangos **no tiene acciones** (ni editar ni eliminar). El aviso dice «Rango de **e-NCF** registrado» para una serie B (tradicional).
- **Por qué:** los rangos los autoriza la DGII; emitir con un rango inventado produce comprobantes inválidos ante la autoridad. H5 (prevención de errores).
- **Qué hacer:** formulario vacío con validación (desde < hasta, fecha futura, código de autorización obligatorio cuando aplique), resumen y confirmación; permitir anular un rango sin uso; mensajes «NCF» vs «e-NCF» según la serie.

### 3.2 Altos

#### A-01 · «Ir a la configuración fiscal» abre «Mi perfil» y cita una sección que no existe — Alta
- **Evidencia:** desde «Crear factura» ([`F-fac-1-form.png`](evidence/F-fac-1-form.png)) el enlace lleva a `#settings/e` y abre «Mi perfil» ([`F-ajustes-1-fiscal.png`](evidence/F-ajustes-1-fiscal.png)), sacando al usuario de la factura. El aviso dice «Ajustes › **Facturación electrónica**», pero el menú se llama «Comprobantes fiscales»; y **dentro** de esa sección vuelve a decir «ve a Ajustes › Facturación electrónica» (instrucción circular, [`F-ajustes-2-comprobantes-full.png`](evidence/F-ajustes-2-comprobantes-full.png)). También remite a «Contabilidad › Reportes › Declaraciones fiscales», ruta de menú que no existe.
- **Por qué:** H6 (reconocimiento) y H4; el usuario se pierde justo en el bloqueo que le impide facturar.
- **Qué hacer:** enlace a `#settings/fiscal`, abrir en panel lateral sin abandonar la factura, y nombres de ruta generados desde la misma fuente que el menú.

#### A-02 · Los datos del alta no aparecen en el Perfil de empresa — Alta
- **Evidencia:** en el alta se introdujeron dirección, ciudad, estado, ZIP y sector; en Configuración › Perfil de empresa aparecen **vacíos** (y País es texto libre obligatorio) ([`L-1-perfil-en.png`](evidence/L-1-perfil-en.png)). El EIN `12-9007988` se muestra como `129007988`.
- **Por qué:** pérdida aparente de datos, obliga a reescribir (H3, H5) y erosiona la confianza en la primera hora de uso.
- **Qué hacer:** persistir y mostrar los datos del alta; País como selector (bloqueado si determina el paquete fiscal); formato de identificador fiscal por país.

#### A-03 · Errores de formulario comunicados solo con color y en un toast que desaparece — Alta
- **Evidencia:** [`F-cliente-3-invalido.png`](evidence/F-cliente-3-invalido.png): los campos inválidos se marcan en rojo **sin texto debajo**; la explicación solo aparece en un toast «Revisa 4 punto(s)…» que se cierra solo. «Revisa «Teléfono»» no dice qué está mal. Un nombre con solo espacios no se marca.
- **Por qué:** WCAG 1.4.1 (uso del color) y 3.3.1/3.3.3 (identificación y sugerencia de errores); H9. Usuarios daltónicos o con lector de pantalla no saben qué corregir.
- **Qué hacer:** mensaje en línea bajo cada campo (con icono), `aria-invalid` + `aria-describedby`, resumen persistente arriba con enlaces a cada campo, foco al primer error; recortar espacios antes de validar; pluralización correcta («Revisa 4 campos»).

#### A-04 · Pestañas sin límite: 40+ abiertas, ilegibles y recargándose en segundo plano — Alta
- **Evidencia:** [`survey/es-light/es-light-35-accounting_journal-entries.png`](evidence/survey/es-light/es-light-35-accounting_journal-entries.png) (40 pestañas, títulos «Exist…», «Categ…»). Al abrir «Nueva factura» se disparan peticiones de **12 pantallas ajenas** (flujo de efectivo, asientos, requisiciones, periodos…). `GET /organizations/branches/mine` se pide 3-5 veces por carga, y a las ~30 navegaciones el servidor responde **429 Too Many Requests**.
- **Por qué:** carga cognitiva (H8), rendimiento y contribución directa a C-01 y C-05.
- **Qué hacer:** límite configurable (p. ej. 12) con cierre LRU de pestañas no fijadas, ancho mínimo legible y menú de desbordamiento con búsqueda; montar perezosamente las pestañas ocultas (no pedir datos hasta activarlas); deduplicar peticiones idénticas en vuelo.

#### A-05 · Tres diseños distintos para documentos hermanos — Alta
- **Evidencia:** factura de venta ([`F-fac-1-form.png`](evidence/F-fac-1-form.png)), cotización ([`F-cot-1-form.png`](evidence/F-cot-1-form.png)) y factura de proveedor ([`F-fprov-1-form.png`](evidence/F-fprov-1-form.png)): distinta estructura (tarjeta+barra de herramientas+pestañas vs formulario plano vs tarjetas apiladas), columnas distintas (artículo+descripción juntos vs separados; «CUENTA DE GASTO»), encabezados en MAYÚSCULAS solo en compras, buscador de cliente con placeholders distintos, moneda como combo en uno y *select* en otro, eliminar línea con «×» o con papelera, totales visibles o no.
- **Por qué:** H4 (consistencia); el usuario reaprende cada documento; triplica el coste de mantenimiento.
- **Qué hacer:** un componente «Documento comercial» (cabecera, líneas, totales, pestañas fiscales) parametrizado por tipo.

#### A-06 · Emitir un comprobante fiscal no tiene confirmación y compite con «Guardar borrador» — Alta
- **Evidencia:** [`F-fac-4-lineas.png`](evidence/F-fac-4-lineas.png): «Emitir factura» y «Guardar borrador» son **dos botones primarios** iguales; al pulsar «Emitir» se consume el NCF de inmediato, sin resumen.
- **Por qué:** acción irreversible (solo se corrige con nota de crédito). H5 y jerarquía visual.
- **Qué hacer:** «Emitir» como único primario; «Guardar borrador» secundario; diálogo de confirmación con cliente, total, tipo de comprobante y aviso de irreversibilidad.

#### A-07 · El cobro se guarda como anticipo sin aplicar sin advertirlo — Alta
- **Evidencia:** [`F-cobro-7-parcial.png`](evidence/F-cobro-7-parcial.png): hay que «pulsar una factura para añadirla» (chip «+ FAC-00000001»); si no se hace, el cobro de 3,000 queda como «No aplicado» y la factura sigue «Por cobrar»; el toast solo dice «Cobro registrado.». Antes de elegir cliente, la pantalla afirma «Este cliente no tiene facturas con saldo pendiente» ([`F-cobro-4-cuenta-bancaria.png`](evidence/F-cobro-4-cuenta-bancaria.png)). «Cuenta bancaria *» es obligatoria también para efectivo (opción «Caja general»), y en Tesorería no existe «Cuentas bancarias».
- **Por qué:** H5/H1; genera saldos falsos en antigüedad de cartera.
- **Qué hacer:** aplicar automáticamente a la factura más antigua (editable); advertir antes de guardar un anticipo; mensaje «Elige un cliente para ver sus facturas»; renombrar a «Cuenta de caja o banco» y exponer su gestión en Tesorería.

#### A-08 · Eliminar un cliente con documentos falla con un error genérico — Alta
- **Evidencia:** [`F-del-1-confirmacion.png`](evidence/F-del-1-confirmacion.png) → [`F-del-2-resultado.png`](evidence/F-del-2-resultado.png) «No se pudo eliminar el cliente.» El servidor sí explica el motivo (`DELETE_BLOCKED`: 2 facturas, 1 cobro, 1 cotización), pero la UI lo descarta.
- **Por qué:** H9. El usuario no sabe por qué ni qué alternativa tiene.
- **Qué hacer:** comprobar dependencias **antes** de confirmar; mostrar «Este cliente tiene 2 facturas, 1 cobro y 1 cotización; puedes desactivarlo» con botón «Desactivar».

#### A-09 · Móvil: el contenido se corta y el POS es inutilizable — Alta
- **Evidencia:** [`survey/m-pt-light/m-pt-light-01-overview.png`](evidence/survey/m-pt-light/m-pt-light-01-overview.png) (tarjetas y avatar cortados), [`m-pt-light-07-invoices.png`](evidence/survey/m-pt-light/m-pt-light-07-invoices.png) («Linhas por págin…»), [`m-pt-light-11-sales_pos.png`](evidence/survey/m-pt-light/m-pt-light-11-sales_pos.png) (dos columnas comprimidas, total cortado), [`M-3-menu-ventas.png`](evidence/M-3-menu-ventas.png) (tabla con columnas fuera de pantalla). 14 de 71 pantallas sin `h1` en móvil.
- **Por qué:** el contexto de uso en LatAm es mayoritariamente móvil (dueños consultando ventas, vendedores en calle). Guía §6 «Adaptación al contexto».
- **Qué hacer:** contenedor principal con `min-width: 0` y *padding* de 16 px; tablas → tarjetas apiladas por debajo de 640 px; POS en una sola columna con carrito en hoja inferior; cabecera con menú de usuario accesible.

#### A-10 · Verificación de teléfono obligatoria sin alternativa y con error opaco — Alta
- **Evidencia:** [`E-sms-no-enviado-sin-causa.png`](evidence/auth/E-sms-no-enviado-sin-causa.png): «*The verification SMS could not be sent. Try again*». El servidor devolvió `403 auth.verification_code_could_not_sent_number` (límite por número). No hay «verificar más tarde», llamada de voz, WhatsApp ni contacto.
- **Por qué:** cada fallo de SMS (frecuente en LatAm por operadoras) es un registro perdido. H9.
- **Qué hacer:** mensaje con causa y tiempo de espera; alternativas (voz/WhatsApp/correo); permitir continuar y verificar después.

#### A-11 · «Payment confirmed» tras prometer prueba gratuita sin tarjeta — Alta
- **Evidencia:** subtítulo del alta «Start your 30-day free trial»; en el plan no se pide tarjeta; la pantalla final dice **«Payment confirmed.»** ([`RF-en-us-6a-sin-aceptar-terminos.png`](evidence/auth/RF-en-us-6a-sin-aceptar-terminos.png)), con un fondo distinto al del resto del alta. Además «STARTER» está preseleccionado mientras «PROFESSIONAL» es el «RECOMMENDED».
- **Por qué:** confianza (guía, principio «Confianza»: explicar costes antes de comprometer). Un usuario cree que se le cobró.
- **Qué hacer:** «¡Tu prueba de 30 días está activa! No se te cobrará hasta el DD/MM»; explicar qué pasa al terminar la prueba; preseleccionar el plan recomendado o no preseleccionar.

#### A-12 · Registro de EE. UU. con datos dominicanos y traducciones erróneas — Alta
- **Evidencia:** [`R-en-us-registro.png`](evidence/auth/R-en-us-registro.png): teléfono por defecto **República Dominicana**, ejemplo «809 555 5555», nombres de país en español en la UI inglesa. Desde México: selector «República Dominicana» con prefijo **+52** ([`C03-registro-mexico-vuelve-al-login.png`](evidence/C03-registro-mexico-vuelve-al-login.png)). Paso fiscal: «**Status**» en vez de «State», el *select* no se marca en rojo como los demás y «*We verify the check digit against IRS*» (el EIN no tiene dígito verificador) ([`RF-en-us-4b-fiscal-vacio.png`](evidence/auth/RF-en-us-4b-fiscal-vacio.png)). Paso empresa: pide **Fax**.
- **Por qué:** primera impresión del producto en el mercado de EE. UU.; H2 (lenguaje del usuario).
- **Qué hacer:** país del teléfono = país del alta; nombres de país con `Intl.DisplayNames` en el idioma activo; «State»; texto honesto sobre la validación; eliminar Fax.

#### A-13 · El alta falla en silencio cuando no carga la lista de países — Alta
- **Evidencia:** durante la inestabilidad de la API, `/es/mx/auth/register`, `/es/co/…` y `/es/ec/…` redirigieron al login **sin ningún mensaje**, y el enlace «Regístrate» se generó una vez como `/es/es/auth/register` (país «España», no soportado) → login (`harness/07-register-countries.cjs`, `06-register.cjs`). Con la API estable, las mismas URL funcionan ([`C03-registro-colombia-url-directa.png`](evidence/C03-registro-colombia-url-directa.png)).
- **Por qué:** cualquier fallo transitorio convierte el botón de captación en un bucle mudo hacia el login. H9.
- **Qué hacer:** si el país no es soportado o no se pudo cargar, mostrar una página «Elige tu país» (o «Aún no estamos en tu país — avísame») en vez de redirigir.

#### A-14 · Atajos de teclado en conflicto con el navegador y con AltGr — Alta
- **Evidencia:** [`K-atajos-dialogo.png`](evidence/K-atajos-dialogo.png): Ctrl+W, Ctrl+Shift+T, Ctrl+Tab, Ctrl+Shift+A, Ctrl+, … son atajos reservados de Chrome/Edge (Ctrl+W/Ctrl+T no se pueden interceptar: cierran la pestaña del navegador). Muchos usan **Ctrl+Alt**, que en Windows con teclado español/latinoamericano es **AltGr** (se usa para escribir `@ [ ] { } \`). En la prueba automatizada AltGr+] no cerró pestañas (era la última), por lo que se reporta como **riesgo** a verificar con teclado físico.
- **Por qué:** H4 (estándares de la plataforma); un usuario puede cerrar trabajo sin guardar.
- **Qué hacer:** en web, usar combinaciones libres (p. ej. `Alt+Shift+…`), no capturar atajos con foco en campos de texto, y reservar Ctrl+W/T solo para la app de escritorio.

#### A-15 · Declaraciones fiscales marca como «Vencida» meses anteriores a la existencia de la empresa — Alta
- **Evidencia:** [`es-light-53-reports_fiscal-returns.png`](evidence/survey/es-light/es-light-53-reports_fiscal-returns.png): 32 chips rojos «Vencida» (enero–agosto 2026) en una empresa sin operaciones.
- **Por qué:** alarma falsa y desensibilización (*alert fatigue*); un contador puede creer que debe multas.
- **Qué hacer:** empezar en el primer período con actividad o desde la fecha de alta; estado «No aplica» para meses previos.

#### A-16 · Reportes contables: falsos positivos, códigos sin nombre y layout roto — Alta
- **Evidencia:** Balanza de comprobación muestra «✓ La balanza cuadra» **sin movimientos** ([`es-light-51`](evidence/survey/es-light/es-light-51-reports_financial-statements_trial-balance.png)); el Flujo de efectivo lista **solo códigos** de cuenta («3150», «1140», «1130»…) sin nombre ([`es-dark-52`](evidence/survey/es-dark/es-dark-52-reports_financial-statements_cash-flow.png)); ambos reportes sin márgenes, contenido pegado/cortado en el borde derecho, título sin estilo de página y cuerpo en **tipografía serif** distinta al resto.
- **Por qué:** H1 y H2; la información financiera debe ser legible por el dueño, no solo por el contador.
- **Qué hacer:** «Sin movimientos en el rango» en lugar de «cuadra»; «1130 · Cuentas por cobrar»; usar la plantilla de página estándar; tipografía de la app (serif solo en la vista de impresión, si se desea).

#### A-17 · La factura emitida muestra dos números y etiquetas fiscales erróneas — Alta
- **Evidencia:** [`F-fac-7-emitida.png`](evidence/F-fac-7-emitida.png): título «Factura de venta **#FAC-00000001**», toast «Factura **B0200000001** emitida», y «**e-NCF:** B0200000001» para un comprobante tradicional. La vista previa no muestra el RNC del emisor ni el del cliente, ni el tipo de comprobante («Factura de Consumo»).
- **Por qué:** H4/H2; al cliente y a la DGII les importa el NCF; dos identificadores generan errores al conciliar y al responder reclamos.
- **Qué hacer:** NCF como identificador principal visible (el interno, secundario); «NCF» vs «e-NCF» según la serie; incluir RNC/razón social de ambas partes y el tipo de comprobante.

#### A-18 · Barra de herramientas de documento con 15 iconos sin texto — Alta
- **Evidencia:** [`F-fac-9-totales.png`](evidence/F-fac-9-totales.png): dos juegos de flechas (|‹ ‹ › ›| y ← →), imprimir, correo, búsqueda, PDF, Excel, **Word**, «Parametrizaciones de formulario», ayuda; en una factura **sin guardar** también están activos. «Anular» (rojo) está pegado a «Nota de crédito» fuera de la tarjeta.
- **Por qué:** H6 (reconocimiento antes que recuerdo); las acciones principales (cobrar, enviar, imprimir) no se distinguen; riesgo de pulsar «Anular».
- **Qué hacer:** acciones primarias con texto («Registrar cobro», «Enviar», «Imprimir/PDF»); el resto en «Más»; deshabilitar lo que no aplica sin guardar; separar y confirmar las destructivas.

#### A-19 · Errores de búsqueda global: resultado de factura sin texto — Alta
- **Evidencia:** [`H-3-busqueda-ncf.png`](evidence/H-3-busqueda-ncf.png): buscar «B0200000001» devuelve «FACTURAS (1)» con **solo un icono, sin número ni cliente**. Productos sí funcionan ([`H-2-busqueda-martillo.png`](evidence/H-2-busqueda-martillo.png)).
- **Por qué:** buscar una factura por su NCF es la consulta más común en soporte y caja.
- **Qué hacer:** mostrar número, NCF, cliente, total y estado en el resultado.

#### A-20 · Menú «Crear nuevo»: textos solapados con los atajos — Alta (visual)
- **Evidencia:** [`H-6-notificaciones.png`](evidence/H-6-notificaciones.png): «Nueva cotización» se monta sobre «Alt Shift Q».
- **Por qué:** el menú de acción más usado se ve roto; en idiomas más largos (pt/en) empeora.
- **Qué hacer:** ancho mínimo y `gap`, truncado con `title`, o atajos en una segunda línea.

### 3.3 Medios

#### M-01 · Nombres distintos para lo mismo (menú ≠ título ≠ pestaña) — Media
| Menú | Título de la página | Pestaña / `<title>` |
|---|---|---|
| Todos los documentos | Repositorio de archivos | Repositorio de documentos |
| Formas de pago | Formas de pago | **Métodos** de pago |
| Condiciones de pago | Condiciones de pago | **Términos** de pago |
| Plan de cuentas | **Catálogo** de cuentas | Catálogo de cuentas |
| Multilibros | Libros contables | Libros contables |
| Impuestos | **Tasas** de impuesto | Impuestos |
| DataSheets | DataSheets | **Hojas de datos** |
| Periodos contables | **Períodos** contables | Periodos contables |
| Recibos | Recibos **de cliente** | Recibos de cliente |
| Libro: diario / Libro: mayor | Libro diario / Libro mayor | — |

En inglés: «Products & services» vs «Product inventory», «General journal» vs «Daily journal», «Ageing» vs «aging». En la factura, el filtro «Pendiente» corresponde a la etiqueta «Por cobrar». Fuente: `harness/survey-*.json`. **Por qué:** H4 y H6. **Qué hacer:** una sola clave i18n por entidad para menú, título, pestaña y migas; glosario de producto por idioma.

#### M-02 · Arquitectura de información: duplicados, menú sobrecargado y acciones como destinos — Media
- «**Facturas**» aparece en Ventas y en Compras, y «**Antigüedad de saldos**» también; en pestañas y búsqueda son indistinguibles. Usar «Facturas de venta» / «Facturas de proveedor», «Cartera por cobrar» / «Cuentas por pagar».
- **Contabilidad tiene 27 ítems** en una sola columna (incluye reportes, maestros y configuración); dividir en Contabilidad / Reportes / Configuración contable.
- Acciones como ítems de menú: «Ejecutar depreciación», «Cierre — anual»; «Mapa de relaciones» es una página que solo dice «ábrelo desde un documento» ([`es-light-70`](evidence/survey/es-light/es-light-70-reports_relationship-map.png)).
- Puntuación arbitraria en etiquetas: «Conciliación — manual», «Cierre — anual», «Libro: diario». «Flujos de trabajo» y «Ejecuciones» bajo «Configuración» dentro de «Mi trabajo».
- No hay migas de pan; el subtítulo «Facturas» bajo el título de un formulario parece una miga pero no es enlace.

#### M-03 · Estados vacíos en cuatro estilos distintos y sin acción — Media
- (a) icono de bandeja + «Todavía no hay nada aquí.» (Facturas, Productos, Órdenes, Asientos); (b) título + explicación sin icono (Cotizaciones, Tickets, Bancos); (c) título + explicación + botón (Facturas de proveedor); (d) texto plano arriba a la izquierda (Flujos de trabajo). Su posición vertical también cambia (centro vs pie de la pantalla: Activos fijos, Presupuestos).
- Evidencia: `es-light-07`, `-08`, `-15`, `-05`, `-38`, `-40` en [`survey/es-light/`](evidence/survey/es-light/).
- **Qué hacer:** un componente `EmptyState` (icono + título + explicación + acción primaria + enlace de ayuda), centrado en el área de contenido.

#### M-04 · Cabeceras de página y botones inconsistentes — Media
- Tres tamaños de título (26 px en listados, 20 px en Rentabilidad, 17 px con icono en Flujos de trabajo); acciones a la derecha (mayoría) o debajo del subtítulo (Presupuestos, Tipos de cambio); subtítulo presente o ausente.
- Botón «Nuevo»: icono `+` (Nómina, Nueva cuenta, Nuevo libro) vs `⊕` (resto). «Nuevo cliente» en un sitio, «Add customer» en otro (inglés).
- Filtros: buscador con icono a 100 % vs etiqueta «Buscar» en línea; *select* nativos sin estilo junto a componentes personalizados.

#### M-05 · Formatos de fecha mezclados y no localizados — Media
- En la misma pantalla: encabezado «1/1/2026 — 12/10/2026» (D/M) y campos «10/12/2026» o «mm/dd/yyyy» (M/D) — los `input type=date` nativos siguen el idioma del navegador, no el de la app ([`es-light-60`](evidence/survey/es-light/es-light-60-masters_currencies_exchange-rates.png), [`es-light-14`](evidence/survey/es-light/es-light-14-reports_aging_receivables.png)).
- «Enero **De** 2026» (Declaraciones) vs «enero de 2026» (Periodos); «Periodo 2026-10 abierto» (ISO) en la barra de estado vs «octubre de 2026»; en portugués «Fecho do período «**October** 2026»» (nombre guardado en el idioma del alta) ([`L-4-app-pt.png`](evidence/L-4-app-pt.png)).
- **Qué hacer:** selector de fecha propio que formatee con el *locale* de la app y del país (DD/MM en LatAm, MM/DD en EE. UU.); nombres de período generados al vuelo con `Intl.DateTimeFormat`, no almacenados.

#### M-06 · Formato monetario y numérico inconsistente — Media
- Total con símbolo «RD$6,491.18» pero listas, subtotales y precios sin símbolo («1,500.50»); «Retenciones −0.00» (cero negativo); en portugués «US$ 0,00» junto a «0.00%»; los campos numéricos aceptan y muestran «1500.5» sin formato.
- **Qué hacer:** un único *pipe* de moneda y de porcentaje por *locale*; normalizar −0 a 0; campos de importe con máscara y símbolo.

#### M-07 · Traducción incompleta y mezcla de variantes — Media
- Enumeraciones en inglés dentro de la UI en español: tipos de unidad «Units, Length, Weight» ([`es-light-30`](evidence/survey/es-light/es-light-30-masters_units-of-measure.png)); `aria-label` «Show password»; botón «SSO».
- Inglés mezcla EE. UU. y Reino Unido («Ageing», «Approvals centre», «Accounts receivable aging» vs «payables ageing»); portugués mezcla Brasil y Portugal («As minhas tarefas», «Fecho contabilístico», «Ligado» junto a «Estoque»).
- Datos semilla en el idioma del alta: plan de cuentas «Assets, Liabilities, Equity» con la UI en portugués ([`m-pt-light-44`](evidence/survey/m-pt-light/m-pt-light-44-accounting_chart-of-accounts.png)); cliente «Consumidor final» / POS «Cliente General» (dos nombres para lo mismo).
- **Qué hacer:** catálogos `en-US`, `pt-BR` explícitos (y `es-419`), revisión por hablante nativo, *lint* de cadenas sin traducir en CI, semillas por idioma/país.

#### M-08 · Texto truncado en controles — Media
- *Selects* de línea de factura «Gravadc», «18⁰/» ([`F-fac-4-lineas.png`](evidence/F-fac-4-lineas.png)); «República Dominic:» en el alta; placeholders «Crea una contraseña segu», «Sin producto del»; menú de Ajustes «Estructura empresa…», «Comprobantes fisca…», «Jurisdicciones fisca…» ([`F-ajustes-1-fiscal.png`](evidence/F-ajustes-1-fiscal.png)); nombre de empresa «QA Ñandú & S…» con «CURRENT COMPANY» en dos líneas; «FAC-00000001» partido en dos líneas en el listado; etiqueta del menú lateral «RH e folha de…».
- **Qué hacer:** anchos mínimos por contenido, `title`/tooltip al truncar, columnas con `white-space: nowrap` para identificadores.

#### M-09 · Accesibilidad (WCAG 2.2 AA) — Media
- **Contraste:** títulos de grupo del menú (#797f93 sobre #fdfdfe, 11 px) = **3.91:1** (< 4.5:1) en las 71 pantallas; 213 nodos con contraste insuficiente en tema claro frente a 61 en oscuro (`harness/36-contrast.cjs`).
- **Controles anidados:** cada pestaña (`role=tab`) contiene botones enfocables — 47 infracciones `nested-interactive` por página; `role=tablist` con hijos no permitidos (`aria-required-children`, crítico en axe).
- **Estructura:** 15 pantallas sin `h1` (reportes, POS, Tesorería); el contador va **dentro** del `h1` («Clientes 1» leído como título).
- **Tamaño:** etiquetas del carril de módulos a **10 px**; ~48 objetivos interactivos < 24×24 px por pantalla (WCAG 2.5.8).
- **Foco:** visible en casi todo (bien), pero un trazo del gráfico SVG y el divisor del menú reciben foco **sin indicador** (`harness/37-teclado.cjs`).
- **Errores solo por color:** ver A-03.
- **Qué hacer:** subir el gris de títulos a ≥ #5f6577; patrón de pestañas con botón de cierre fuera del `role=tab` (o `aria-hidden` + atajo); `h1` en todas las páginas; etiquetas ≥ 12 px; anillo de foco del sistema de diseño en todos los enfocables; axe en CI con umbral cero para *critical/serious*.

#### M-10 · Ajustes: 25 secciones dentro de un modal — Media
- [`F-ajustes-1-fiscal.png`](evidence/F-ajustes-1-fiscal.png): toda la configuración del ERP (usuarios, roles, impuestos, comprobantes, extensiones…) en un modal con scroll doble; títulos de tarjeta alineados a la derecha; título de 2FA partido en 4 líneas junto al botón; campos de contraseña con placeholder «••••••••» que parecen rellenos; «Sesiones activas» lista 23 sesiones sin agrupar ni «Cerrar las demás».
- El menú de usuario no ofrece idioma ni tema; «Comentarios» con chevron hacia la izquierda ([`F-menu-usuario.png`](evidence/F-menu-usuario.png)).
- **Qué hacer:** Ajustes como página completa con URL propia por sección; agrupar sesiones por dispositivo; idioma y tema en el menú de usuario.

#### M-11 · Formularios: valores por defecto y controles inadecuados — Media
- Campos numéricos prellenados con «0» (hay que borrarlo) en producto, factura, cotización ([`F-prod-1-form.png`](evidence/F-prod-1-form.png)); importes sin símbolo ni separadores.
- Cliente: «Términos de pago» es **texto libre** («Neto 30» como placeholder que parece valor) y convive con «Días de crédito» y con el catálogo «Condiciones de pago» ([`F-cliente-1-form.png`](evidence/F-cliente-1-form.png)). País del cliente: *select* nativo de 250 países sin búsqueda.
- Proveedor: dirección en un único campo (cliente: bloque estructurado), sin condiciones de pago ([`F-prov-1-form.png`](evidence/F-prov-1-form.png)).
- Zona de imagen de producto desalineada y sin formatos/tamaño admitidos.
- Sin atributos `autocomplete` en el alta (nombre, correo, `new-password`), lo que rompe el autollenado y los gestores de contraseñas.
- Se aceptan existencias fraccionarias (1.5) para unidad «UND» y costes de 99 billones sin advertencia.

#### M-12 · Cotización: botones ambiguos y mensajes confusos — Media
- «Cancelar» (salir) y «Cancelar cotización» (anular) visibles a la vez; tras aceptar, sigue disponible «Rechazada por el cliente» en rojo ([`F-cot-8-convertida.png`](evidence/F-cot-8-convertida.png)); el éxito de la conversión dice «La cotización COT-00000001 **ya tiene** su factura en borrador» (suena a error).
- **Qué hacer:** «Descartar cambios» vs «Anular cotización»; máquina de estados visible; «Factura FAC-… creada en borrador — Abrir».

#### M-13 · Periodos y parámetros: ruido visual y copy técnico — Media
- 12 botones idénticos «Cerrar período» (permite intentar cerrar diciembre antes que octubre) ([`es-light-57`](evidence/survey/es-light/es-light-57-accounting_periods.png)).
- Parámetros de ley: columna «Acciones» vacía, vigencias «01/01/2020 — …», y textos de ingeniería («Una tasa es un hecho de un momento: nada se edita en su sitio…») ([`es-light-67`](evidence/survey/es-light/es-light-67-payroll_parameters.png)).
- **Qué hacer:** solo el período cerrable siguiente con acción; «Vigente desde 01/01/2020»; copy orientado a la tarea.

#### M-14 · Login: señales visuales confusas — Media
- Placeholder «••••••••» en contraseña (parece rellena); botones sociales solo con icono (llave de acceso, Google, Microsoft, «edificio» = SSO) sin texto visible; en tema **claro** el fondo es casi negro y el pie (Términos, Privacidad…) queda gris sobre gris; «Sign In» / «Sign in» / «Sign up» con mayúsculas inconsistentes; el aviso de demasiados intentos no dice cuánto esperar; «olvidé mi contraseña» no tiene `<title>` propio («Virtex») ([`auth/A-es-light-1440-login.png`](evidence/auth/A-es-light-1440-login.png), [`auth/A-en-dark-1440-login.png`](evidence/auth/A-en-dark-1440-login.png)).

#### M-15 · Validación de cliente y producto permisiva — Media
- Nombre de cliente con solo espacios no se marca; el nombre con `<script>alert(1)</script>` se guarda y se muestra como texto (bien escapado), pero sería deseable avisar de caracteres no habituales en razones sociales.

#### M-16 · Toasts duplicados y mal ubicados — Media
- «Cliente creado exitosamente.» aparece **dos veces**; los toasts se superponen al buscador global y a la barra de pestañas ([`F-cliente-4-guardado.png`](evidence/F-cliente-4-guardado.png), [`F-prod-5-lista.png`](evidence/F-prod-5-lista.png)).
- **Qué hacer:** deduplicar por clave; ubicar abajo a la derecha (convención de apps de escritorio) o bajo la cabecera.

#### M-17 · POS: detalles de catálogo y layout — Media
- Un **servicio** aparece «Agotado»; la tarjeta de producto se estira a toda la altura; el buscador no tiene icono; «Cobrar» queda pegado al borde inferior a 1440×900 ([`F-pos-3-carrito.png`](evidence/F-pos-3-carrito.png), [`es-light-11`](evidence/survey/es-light/es-light-11-sales_pos.png)); iniciales «QM»/«QS» como imagen.

#### M-18 · Unidades de medida no se pueden crear y el orden no es evidente — Media
- No hay botón «Nueva unidad»; el listado está ordenado por símbolo sin indicarlo (Pie y Pie cuadrado antes que Gramo) ([`es-light-30`](evidence/survey/es-light/es-light-30-masters_units-of-measure.png)).

#### M-19 · Plan de cuentas: jerarquía visual invertida y borrado peligroso — Media
- El código va debajo del nombre en violeta (parece enlace); icono de papelera en cuentas raíz con hijas; «Balance» en vez de «Saldo» ([`es-light-44`](evidence/survey/es-light/es-light-44-accounting_chart-of-accounts.png)).

#### M-20 · Tema oscuro: badges y iconos inconsistentes — Media
- «Por cobrar» se pinta negro en el panel y ámbar en el listado; iconos de calendario apenas visibles; chips «Cierre contable» con otro estilo ([`es-dark-01`](evidence/survey/es-dark/es-dark-01-overview.png), [`es-dark-07`](evidence/survey/es-dark/es-dark-07-invoices.png)).

#### M-21 · Libro diario y otros reportes sin filtros — Media
- Libro diario sin rango de fechas ni filtros; «Exportar» deshabilitado sin explicación ([`es-light-45`](evidence/survey/es-light/es-light-45-accounting_daily-journal.png)).

#### M-22 · Paso de verificación con dos acciones primarias — Media
- En los pasos de correo y SMS conviven «Verify» y «Next»; si se pulsa «Next» sin verificar aparece «Verify your mobile number before continuing» ([`RF-en-us-3-phone.png`](evidence/auth/RF-en-us-3-phone.png)). El número se muestra sin formato («+12025550147»).
- **Qué hacer:** verificar automáticamente al completar los 6 dígitos y avanzar; un solo botón.

#### M-23 · Fondo de las pantallas de acceso con corte — Media
- En pantallas de más de 900 px de alto (alta con errores), el fondo de onda se corta y la tarjeta queda sobre una franja blanca con el pie ([`R-en-us-1-vacio.png`](evidence/auth/R-en-us-1-vacio.png)).

#### M-24 · Mayúsculas y estilos de títulos de sección — Media
- Grupos del menú en MAYÚSCULAS con *tracking* (BANDEJA, DOCUMENTOS…), columnas de compras en MAYÚSCULAS, el resto en tipo oración; «TOTAL:» con dos puntos en mayúsculas en la vista de factura.

### 3.4 Bajos

| ID | Hallazgo | Evidencia | Recomendación |
|---|---|---|---|
| B-01 | Icono de pestaña genérico (documento) para casi todo; solo algunas tienen el icono de su menú. | `es-light-35` | Reutilizar el icono del ítem de menú. |
| B-02 | «Create the sales invoice», «Choose your **P**lan», «Book: General ledger», «Closing — annual»: inglés poco natural. | `US-factura-form.png`, `RF-en-us-6-plan.png` | Revisión de copy nativa. |
| B-03 | «Revisa 1 punto(s)»: pluralización perezosa. | `F-prod-2-invalido.png` | ICU plural. |
| B-04 | Separador «O» en minúscula (es) / «OR» (en). | login | Unificar. |
| B-05 | Lista de sectores con solo 7 opciones. | `RF-en-us-5-empresa.png` | Catálogo NAICS/CIIU resumido + «Otro». |
| B-06 | Tooltip «Parametrizaciones de formulario» (jerga). | factura | «Personalizar formulario». |
| B-07 | Exportar factura a **Word**. | factura | Quitar; mantener PDF/XML. |
| B-08 | «Lo que la empresa posee, lo que costó…» y otros subtítulos largos; algunos listados sin subtítulo. | `es-light-38` | Guía de microcopy. |
| B-09 | Divisor de redimensionar el menú sin indicador al enfocar. | `K-foco-*` | Anillo de foco. |
| B-10 | Símbolos de moneda no estándar («CO$», «CL$»). | `es-light-59` | Usar `Intl.NumberFormat` (`currencyDisplay: 'narrowSymbol'`). |
| B-11 | Sesión «Ubicación desconocida» en todas las entradas. | Ajustes › Mi perfil | Ocultar si no hay dato. |
| B-12 | En listados, «1–1 de 1» y paginación visibles con un solo registro. | `F-fac-8-lista.png` | Ocultar paginación si cabe en una página. |

---

## 4. Lo que funciona bien (mantener)

- **Seguridad percibida:** el login no revela si el correo existe; «olvidé mi contraseña» tampoco; límite de intentos; la política de contraseña muestra una lista en vivo; el contenido del usuario se **escapa** correctamente (`<script>` y emoji se muestran como texto).
- **Estados del sistema:** indicador «Sin guardar / Sin cambios» en formularios, punto en la pestaña con cambios, aviso **sin conexión** claro con indicador en la barra de estado ([`H-8-offline.png`](evidence/H-8-offline.png)), banner que explica por qué no se puede emitir una factura y cómo resolverlo.
- **Contabilidad integrada:** factura, cobro e inventario inicial generan sus asientos y el feed de actividad los muestra con enlaces.
- **Adaptación parcial a EE. UU.:** EIN/SSN/ITIN, estados y ZIP en el alta y en clientes, moneda USD por defecto.
- **Teclado:** enlace «Saltar al contenido», foco visible en casi todos los controles, Ctrl+E abre la búsqueda, diálogos con `role="dialog"` y `aria-modal`.
- **Cambio de idioma** inmediato y persistente; tema oscuro con buen contraste general (61 nodos frente a 213 en claro).
- **Prevención en eliminación:** el servidor impide borrar clientes con documentos (regresión de la QA anterior corregida).

---

## 5. Plan de remediación priorizado

| Fase | Plazo orientativo | Incluye | Criterio de salida |
|---|---|---|---|
| **0 · Bloqueantes** | 1-2 semanas | C-01, C-02, C-03, C-04, C-05, C-07, C-08, C-09, C-10 | Prueba de carga sin transacciones abiertas; E2E «alta → factura → cobro → POS» verde; páginas legales publicadas; consentimiento persistido. |
| **1 · País y confianza** | 2-4 semanas | C-06, A-02, A-10, A-11, A-12, A-13, A-15, A-17, M-05, M-06, M-07 | Por cada país vendible: checklist de paquete fiscal, catálogos editables, semillas y textos localizados; formatos por `Intl`. |
| **2 · Flujos y consistencia** | 4-6 semanas | A-01, A-03…A-09, A-14, A-16, A-18…A-20, M-01…M-04, M-10…M-13 | Componente único de documento; `EmptyState`, `PageHeader`, `FormField` con errores accesibles; glosario único; límite de pestañas. |
| **3 · Accesibilidad y móvil** | en paralelo | M-09, A-09, M-08, M-14, M-20, M-23 | axe sin *critical/serious* en CI; Lighthouse a11y ≥ 95; capturas móviles 390 px sin cortes. |
| **4 · Pulido** | continuo | M-15…M-19, M-21, M-22, M-24, B-01…B-12 | Revisión de microcopy por nativos (es-419, en-US, pt-BR). |

**Recomendaciones transversales**
1. **Sistema de diseño documentado** (tokens ya existen; faltan patrones): cabecera de página, estado vacío, formulario con validación, tabla con acciones, documento comercial, toasts, confirmación destructiva. Prohibir *selects* nativos sin estilo.
2. **«Paquete de país» como contrato:** cada país declara impuestos, documentos fiscales, formas de pago, nómina, formatos e identificadores; la UI oculta lo que no aplica. Un país no soportado no se «convierte» en RD.
3. **Pruebas automatizadas de UX en CI:** el arnés de `harness/` ya recorre 71 pantallas × 4 variantes con axe; convertirlo en *smoke* nocturno con umbrales (sin `h1` = 0, contraste = 0, errores de API = 0, títulos coherentes con el menú).
4. **Métricas de producto** para validar mejoras (guía §3.4): tasa de finalización del alta por paso, tiempo hasta la primera factura emitida, % de cobros aplicados, errores de validación por campo.

---

## 6. Anexo A — Matriz de pantallas (captura por variante)

Cada fila enlaza la captura de la pantalla en español claro, español oscuro, empresa de EE. UU. en inglés y móvil en portugués. Métricas completas por pantalla (axe, `h1`, título, texto truncado, errores de API) en `harness/survey-*.json`.

| # | Módulo | Pantalla | ES claro | ES oscuro | EE. UU. (en) | Móvil (pt) |
|---|---|---|---|---|---|---|
| 1 | Mi trabajo | Inicio | [ver](evidence/survey/es-light/es-light-01-overview.png) | [ver](evidence/survey/es-dark/es-dark-01-overview.png) | [ver](evidence/survey/us-en-light/us-en-light-01-overview.png) | [ver](evidence/survey/m-pt-light/m-pt-light-01-overview.png) |
| 2 | Mi trabajo | Aprobaciones | [ver](evidence/survey/es-light/es-light-02-approvals.png) | [ver](evidence/survey/es-dark/es-dark-02-approvals.png) | [ver](evidence/survey/us-en-light/us-en-light-02-approvals.png) | [ver](evidence/survey/m-pt-light/m-pt-light-02-approvals.png) |
| 3 | Mi trabajo | Mis tareas | [ver](evidence/survey/es-light/es-light-03-workflow-tasks.png) | [ver](evidence/survey/es-dark/es-dark-03-workflow-tasks.png) | [ver](evidence/survey/us-en-light/us-en-light-03-workflow-tasks.png) | [ver](evidence/survey/m-pt-light/m-pt-light-03-workflow-tasks.png) |
| 4 | Mi trabajo | Todos los documentos | [ver](evidence/survey/es-light/es-light-04-documents_repository.png) | [ver](evidence/survey/es-dark/es-dark-04-documents_repository.png) | [ver](evidence/survey/us-en-light/us-en-light-04-documents_repository.png) | [ver](evidence/survey/m-pt-light/m-pt-light-04-documents_repository.png) |
| 5 | Mi trabajo | Flujos de trabajo | [ver](evidence/survey/es-light/es-light-05-workflows.png) | [ver](evidence/survey/es-dark/es-dark-05-workflows.png) | [ver](evidence/survey/us-en-light/us-en-light-05-workflows.png) | [ver](evidence/survey/m-pt-light/m-pt-light-05-workflows.png) |
| 6 | Mi trabajo | Ejecuciones | [ver](evidence/survey/es-light/es-light-06-workflow-instances.png) | [ver](evidence/survey/es-dark/es-dark-06-workflow-instances.png) | [ver](evidence/survey/us-en-light/us-en-light-06-workflow-instances.png) | [ver](evidence/survey/m-pt-light/m-pt-light-06-workflow-instances.png) |
| 7 | Ventas | Facturas | [ver](evidence/survey/es-light/es-light-07-invoices.png) | [ver](evidence/survey/es-dark/es-dark-07-invoices.png) | [ver](evidence/survey/us-en-light/us-en-light-07-invoices.png) | [ver](evidence/survey/m-pt-light/m-pt-light-07-invoices.png) |
| 8 | Ventas | Cotizaciones | [ver](evidence/survey/es-light/es-light-08-quotes.png) | [ver](evidence/survey/es-dark/es-dark-08-quotes.png) | [ver](evidence/survey/us-en-light/us-en-light-08-quotes.png) | [ver](evidence/survey/m-pt-light/m-pt-light-08-quotes.png) |
| 9 | Ventas | Recibos | [ver](evidence/survey/es-light/es-light-09-customer-receipts.png) | [ver](evidence/survey/es-dark/es-dark-09-customer-receipts.png) | [ver](evidence/survey/us-en-light/us-en-light-09-customer-receipts.png) | [ver](evidence/survey/m-pt-light/m-pt-light-09-customer-receipts.png) |
| 10 | Ventas | Tickets de punto de venta | [ver](evidence/survey/es-light/es-light-10-sales_history.png) | [ver](evidence/survey/es-dark/es-dark-10-sales_history.png) | [ver](evidence/survey/us-en-light/us-en-light-10-sales_history.png) | [ver](evidence/survey/m-pt-light/m-pt-light-10-sales_history.png) |
| 11 | Ventas | Punto de venta | [ver](evidence/survey/es-light/es-light-11-sales_pos.png) | [ver](evidence/survey/es-dark/es-dark-11-sales_pos.png) | [ver](evidence/survey/us-en-light/us-en-light-11-sales_pos.png) | [ver](evidence/survey/m-pt-light/m-pt-light-11-sales_pos.png) |
| 12 | Ventas | Clientes | [ver](evidence/survey/es-light/es-light-12-contacts_customers.png) | [ver](evidence/survey/es-dark/es-dark-12-contacts_customers.png) | [ver](evidence/survey/us-en-light/us-en-light-12-contacts_customers.png) | [ver](evidence/survey/m-pt-light/m-pt-light-12-contacts_customers.png) |
| 13 | Ventas | Listas de precios | [ver](evidence/survey/es-light/es-light-13-masters_price-lists.png) | [ver](evidence/survey/es-dark/es-dark-13-masters_price-lists.png) | [ver](evidence/survey/us-en-light/us-en-light-13-masters_price-lists.png) | [ver](evidence/survey/m-pt-light/m-pt-light-13-masters_price-lists.png) |
| 14 | Ventas | Antigüedad de saldos | [ver](evidence/survey/es-light/es-light-14-reports_aging_receivables.png) | [ver](evidence/survey/es-dark/es-dark-14-reports_aging_receivables.png) | [ver](evidence/survey/us-en-light/us-en-light-14-reports_aging_receivables.png) | [ver](evidence/survey/m-pt-light/m-pt-light-14-reports_aging_receivables.png) |
| 15 | Compras | Facturas | [ver](evidence/survey/es-light/es-light-15-accounts-payable.png) | [ver](evidence/survey/es-dark/es-dark-15-accounts-payable.png) | [ver](evidence/survey/us-en-light/us-en-light-15-accounts-payable.png) | [ver](evidence/survey/m-pt-light/m-pt-light-15-accounts-payable.png) |
| 16 | Compras | Pagos a proveedores | [ver](evidence/survey/es-light/es-light-16-accounts-payable_payments.png) | [ver](evidence/survey/es-dark/es-dark-16-accounts-payable_payments.png) | [ver](evidence/survey/us-en-light/us-en-light-16-accounts-payable_payments.png) | [ver](evidence/survey/m-pt-light/m-pt-light-16-accounts-payable_payments.png) |
| 17 | Compras | Notas de débito | [ver](evidence/survey/es-light/es-light-17-accounts-payable_debit-notes.png) | [ver](evidence/survey/es-dark/es-dark-17-accounts-payable_debit-notes.png) | [ver](evidence/survey/us-en-light/us-en-light-17-accounts-payable_debit-notes.png) | [ver](evidence/survey/m-pt-light/m-pt-light-17-accounts-payable_debit-notes.png) |
| 18 | Compras | Órdenes de compra | [ver](evidence/survey/es-light/es-light-18-purchasing_orders.png) | [ver](evidence/survey/es-dark/es-dark-18-purchasing_orders.png) | [ver](evidence/survey/us-en-light/us-en-light-18-purchasing_orders.png) | [ver](evidence/survey/m-pt-light/m-pt-light-18-purchasing_orders.png) |
| 19 | Compras | Recepciones | [ver](evidence/survey/es-light/es-light-19-purchasing_receipts.png) | [ver](evidence/survey/es-dark/es-dark-19-purchasing_receipts.png) | [ver](evidence/survey/us-en-light/us-en-light-19-purchasing_receipts.png) | [ver](evidence/survey/m-pt-light/m-pt-light-19-purchasing_receipts.png) |
| 20 | Compras | Requisiciones | [ver](evidence/survey/es-light/es-light-20-purchasing_requisitions.png) | [ver](evidence/survey/es-dark/es-dark-20-purchasing_requisitions.png) | [ver](evidence/survey/us-en-light/us-en-light-20-purchasing_requisitions.png) | [ver](evidence/survey/m-pt-light/m-pt-light-20-purchasing_requisitions.png) |
| 21 | Compras | Proveedores | [ver](evidence/survey/es-light/es-light-21-contacts_suppliers.png) | [ver](evidence/survey/es-dark/es-dark-21-contacts_suppliers.png) | [ver](evidence/survey/us-en-light/us-en-light-21-contacts_suppliers.png) | [ver](evidence/survey/m-pt-light/m-pt-light-21-contacts_suppliers.png) |
| 22 | Compras | Antigüedad de saldos | [ver](evidence/survey/es-light/es-light-22-reports_aging_payables.png) | [ver](evidence/survey/es-dark/es-dark-22-reports_aging_payables.png) | [ver](evidence/survey/us-en-light/us-en-light-22-reports_aging_payables.png) | [ver](evidence/survey/m-pt-light/m-pt-light-22-reports_aging_payables.png) |
| 23 | Inventario | Ajustes de inventario | [ver](evidence/survey/es-light/es-light-23-inventory_adjustments.png) | [ver](evidence/survey/es-dark/es-dark-23-inventory_adjustments.png) | [ver](evidence/survey/us-en-light/us-en-light-23-inventory_adjustments.png) | [ver](evidence/survey/m-pt-light/m-pt-light-23-inventory_adjustments.png) |
| 24 | Inventario | Transferencias | [ver](evidence/survey/es-light/es-light-24-inventory_transfers.png) | [ver](evidence/survey/es-dark/es-dark-24-inventory_transfers.png) | [ver](evidence/survey/us-en-light/us-en-light-24-inventory_transfers.png) | [ver](evidence/survey/m-pt-light/m-pt-light-24-inventory_transfers.png) |
| 25 | Inventario | Productos | [ver](evidence/survey/es-light/es-light-25-inventory_products.png) | [ver](evidence/survey/es-dark/es-dark-25-inventory_products.png) | [ver](evidence/survey/us-en-light/us-en-light-25-inventory_products.png) | [ver](evidence/survey/m-pt-light/m-pt-light-25-inventory_products.png) |
| 26 | Inventario | Existencias | [ver](evidence/survey/es-light/es-light-26-inventory_stock.png) | [ver](evidence/survey/es-dark/es-dark-26-inventory_stock.png) | [ver](evidence/survey/us-en-light/us-en-light-26-inventory_stock.png) | [ver](evidence/survey/m-pt-light/m-pt-light-26-inventory_stock.png) |
| 27 | Inventario | Kárdex | [ver](evidence/survey/es-light/es-light-27-inventory_movements.png) | [ver](evidence/survey/es-dark/es-dark-27-inventory_movements.png) | [ver](evidence/survey/us-en-light/us-en-light-27-inventory_movements.png) | [ver](evidence/survey/m-pt-light/m-pt-light-27-inventory_movements.png) |
| 28 | Inventario | Categorías | [ver](evidence/survey/es-light/es-light-28-inventory_categories.png) | [ver](evidence/survey/es-dark/es-dark-28-inventory_categories.png) | [ver](evidence/survey/us-en-light/us-en-light-28-inventory_categories.png) | [ver](evidence/survey/m-pt-light/m-pt-light-28-inventory_categories.png) |
| 29 | Inventario | Almacenes | [ver](evidence/survey/es-light/es-light-29-masters_warehouses.png) | [ver](evidence/survey/es-dark/es-dark-29-masters_warehouses.png) | [ver](evidence/survey/us-en-light/us-en-light-29-masters_warehouses.png) | [ver](evidence/survey/m-pt-light/m-pt-light-29-masters_warehouses.png) |
| 30 | Inventario | Unidades de medida | [ver](evidence/survey/es-light/es-light-30-masters_units-of-measure.png) | [ver](evidence/survey/es-dark/es-dark-30-masters_units-of-measure.png) | [ver](evidence/survey/us-en-light/us-en-light-30-masters_units-of-measure.png) | [ver](evidence/survey/m-pt-light/m-pt-light-30-masters_units-of-measure.png) |
| 31 | Tesorería | Tablero | [ver](evidence/survey/es-light/es-light-31-accounting_treasury.png) | [ver](evidence/survey/es-dark/es-dark-31-accounting_treasury.png) | [ver](evidence/survey/us-en-light/us-en-light-31-accounting_treasury.png) | [ver](evidence/survey/m-pt-light/m-pt-light-31-accounting_treasury.png) |
| 32 | Tesorería | Conciliación — manual | [ver](evidence/survey/es-light/es-light-32-accounting_reconciliation.png) | [ver](evidence/survey/es-dark/es-dark-32-accounting_reconciliation.png) | [ver](evidence/survey/us-en-light/us-en-light-32-accounting_reconciliation.png) | [ver](evidence/survey/m-pt-light/m-pt-light-32-accounting_reconciliation.png) |
| 33 | Tesorería | Bancos | [ver](evidence/survey/es-light/es-light-33-masters_banks.png) | [ver](evidence/survey/es-dark/es-dark-33-masters_banks.png) | [ver](evidence/survey/us-en-light/us-en-light-33-masters_banks.png) | [ver](evidence/survey/m-pt-light/m-pt-light-33-masters_banks.png) |
| 34 | Tesorería | Formas de pago | [ver](evidence/survey/es-light/es-light-34-masters_payment-methods.png) | [ver](evidence/survey/es-dark/es-dark-34-masters_payment-methods.png) | [ver](evidence/survey/us-en-light/us-en-light-34-masters_payment-methods.png) | [ver](evidence/survey/m-pt-light/m-pt-light-34-masters_payment-methods.png) |
| 35 | Contabilidad | Asientos | [ver](evidence/survey/es-light/es-light-35-accounting_journal-entries.png) | [ver](evidence/survey/es-dark/es-dark-35-accounting_journal-entries.png) | [ver](evidence/survey/us-en-light/us-en-light-35-accounting_journal-entries.png) | [ver](evidence/survey/m-pt-light/m-pt-light-35-accounting_journal-entries.png) |
| 36 | Contabilidad | Asientos recurrentes | [ver](evidence/survey/es-light/es-light-36-accounting_recurring-entries.png) | [ver](evidence/survey/es-dark/es-dark-36-accounting_recurring-entries.png) | [ver](evidence/survey/us-en-light/us-en-light-36-accounting_recurring-entries.png) | [ver](evidence/survey/m-pt-light/m-pt-light-36-accounting_recurring-entries.png) |
| 37 | Contabilidad | Plantillas de asiento | [ver](evidence/survey/es-light/es-light-37-accounting_entry-templates.png) | [ver](evidence/survey/es-dark/es-dark-37-accounting_entry-templates.png) | [ver](evidence/survey/us-en-light/us-en-light-37-accounting_entry-templates.png) | [ver](evidence/survey/m-pt-light/m-pt-light-37-accounting_entry-templates.png) |
| 38 | Contabilidad | Activos fijos | [ver](evidence/survey/es-light/es-light-38-accounting_fixed-assets.png) | [ver](evidence/survey/es-dark/es-dark-38-accounting_fixed-assets.png) | [ver](evidence/survey/us-en-light/us-en-light-38-accounting_fixed-assets.png) | [ver](evidence/survey/m-pt-light/m-pt-light-38-accounting_fixed-assets.png) |
| 39 | Contabilidad | Ejecutar depreciación | [ver](evidence/survey/es-light/es-light-39-accounting_fixed-assets_depreciation.png) | [ver](evidence/survey/es-dark/es-dark-39-accounting_fixed-assets_depreciation.png) | [ver](evidence/survey/us-en-light/us-en-light-39-accounting_fixed-assets_depreciation.png) | [ver](evidence/survey/m-pt-light/m-pt-light-39-accounting_fixed-assets_depreciation.png) |
| 40 | Contabilidad | Presupuestos | [ver](evidence/survey/es-light/es-light-40-accounting_budgets.png) | [ver](evidence/survey/es-dark/es-dark-40-accounting_budgets.png) | [ver](evidence/survey/us-en-light/us-en-light-40-accounting_budgets.png) | [ver](evidence/survey/m-pt-light/m-pt-light-40-accounting_budgets.png) |
| 41 | Contabilidad | Cierre — anual | [ver](evidence/survey/es-light/es-light-41-accounting_closing_annual-close.png) | [ver](evidence/survey/es-dark/es-dark-41-accounting_closing_annual-close.png) | [ver](evidence/survey/us-en-light/us-en-light-41-accounting_closing_annual-close.png) | [ver](evidence/survey/m-pt-light/m-pt-light-41-accounting_closing_annual-close.png) |
| 42 | Contabilidad | Ajustes de auditoría | [ver](evidence/survey/es-light/es-light-42-accounting_audit-adjustments.png) | [ver](evidence/survey/es-dark/es-dark-42-accounting_audit-adjustments.png) | [ver](evidence/survey/us-en-light/us-en-light-42-accounting_audit-adjustments.png) | [ver](evidence/survey/m-pt-light/m-pt-light-42-accounting_audit-adjustments.png) |
| 43 | Contabilidad | Cierre de período | [ver](evidence/survey/es-light/es-light-43-accounting_closing_checklist.png) | [ver](evidence/survey/es-dark/es-dark-43-accounting_closing_checklist.png) | [ver](evidence/survey/us-en-light/us-en-light-43-accounting_closing_checklist.png) | [ver](evidence/survey/m-pt-light/m-pt-light-43-accounting_closing_checklist.png) |
| 44 | Contabilidad | Plan de cuentas | [ver](evidence/survey/es-light/es-light-44-accounting_chart-of-accounts.png) | [ver](evidence/survey/es-dark/es-dark-44-accounting_chart-of-accounts.png) | [ver](evidence/survey/us-en-light/us-en-light-44-accounting_chart-of-accounts.png) | [ver](evidence/survey/m-pt-light/m-pt-light-44-accounting_chart-of-accounts.png) |
| 45 | Contabilidad | Libro: diario | [ver](evidence/survey/es-light/es-light-45-accounting_daily-journal.png) | [ver](evidence/survey/es-dark/es-dark-45-accounting_daily-journal.png) | [ver](evidence/survey/us-en-light/us-en-light-45-accounting_daily-journal.png) | [ver](evidence/survey/m-pt-light/m-pt-light-45-accounting_daily-journal.png) |
| 46 | Contabilidad | Libro: mayor | [ver](evidence/survey/es-light/es-light-46-accounting_general-ledger.png) | [ver](evidence/survey/es-dark/es-dark-46-accounting_general-ledger.png) | [ver](evidence/survey/us-en-light/us-en-light-46-accounting_general-ledger.png) | [ver](evidence/survey/m-pt-light/m-pt-light-46-accounting_general-ledger.png) |
| 47 | Contabilidad | Mayor de terceros | [ver](evidence/survey/es-light/es-light-47-accounting_partner-ledger.png) | [ver](evidence/survey/es-dark/es-dark-47-accounting_partner-ledger.png) | [ver](evidence/survey/us-en-light/us-en-light-47-accounting_partner-ledger.png) | [ver](evidence/survey/m-pt-light/m-pt-light-47-accounting_partner-ledger.png) |
| 48 | Contabilidad | Análisis de variaciones | [ver](evidence/survey/es-light/es-light-48-accounting_variance-analysis.png) | [ver](evidence/survey/es-dark/es-dark-48-accounting_variance-analysis.png) | [ver](evidence/survey/us-en-light/us-en-light-48-accounting_variance-analysis.png) | [ver](evidence/survey/m-pt-light/m-pt-light-48-accounting_variance-analysis.png) |
| 49 | Contabilidad | Balance general | [ver](evidence/survey/es-light/es-light-49-reports_financial-statements_balance-sheet.png) | [ver](evidence/survey/es-dark/es-dark-49-reports_financial-statements_balance-sheet.png) | [ver](evidence/survey/us-en-light/us-en-light-49-reports_financial-statements_balance-sheet.png) | [ver](evidence/survey/m-pt-light/m-pt-light-49-reports_financial-statements_balance-sheet.png) |
| 50 | Contabilidad | Estado de resultados | [ver](evidence/survey/es-light/es-light-50-reports_financial-statements_income-statement.png) | [ver](evidence/survey/es-dark/es-dark-50-reports_financial-statements_income-statement.png) | [ver](evidence/survey/us-en-light/us-en-light-50-reports_financial-statements_income-statement.png) | [ver](evidence/survey/m-pt-light/m-pt-light-50-reports_financial-statements_income-statement.png) |
| 51 | Contabilidad | Balanza de comprobación | [ver](evidence/survey/es-light/es-light-51-reports_financial-statements_trial-balance.png) | [ver](evidence/survey/es-dark/es-dark-51-reports_financial-statements_trial-balance.png) | [ver](evidence/survey/us-en-light/us-en-light-51-reports_financial-statements_trial-balance.png) | [ver](evidence/survey/m-pt-light/m-pt-light-51-reports_financial-statements_trial-balance.png) |
| 52 | Contabilidad | Flujo de efectivo | [ver](evidence/survey/es-light/es-light-52-reports_financial-statements_cash-flow.png) | [ver](evidence/survey/es-dark/es-dark-52-reports_financial-statements_cash-flow.png) | [ver](evidence/survey/us-en-light/us-en-light-52-reports_financial-statements_cash-flow.png) | [ver](evidence/survey/m-pt-light/m-pt-light-52-reports_financial-statements_cash-flow.png) |
| 53 | Contabilidad | Declaraciones fiscales | [ver](evidence/survey/es-light/es-light-53-reports_fiscal-returns.png) | [ver](evidence/survey/es-dark/es-dark-53-reports_fiscal-returns.png) | [ver](evidence/survey/us-en-light/us-en-light-53-reports_fiscal-returns.png) | [ver](evidence/survey/m-pt-light/m-pt-light-53-reports_fiscal-returns.png) |
| 54 | Contabilidad | Dimensiones analíticas | [ver](evidence/survey/es-light/es-light-54-accounting_dimensions.png) | [ver](evidence/survey/es-dark/es-dark-54-accounting_dimensions.png) | [ver](evidence/survey/us-en-light/us-en-light-54-accounting_dimensions.png) | [ver](evidence/survey/m-pt-light/m-pt-light-54-accounting_dimensions.png) |
| 55 | Contabilidad | Multilibros | [ver](evidence/survey/es-light/es-light-55-accounting_ledgers.png) | [ver](evidence/survey/es-dark/es-dark-55-accounting_ledgers.png) | [ver](evidence/survey/us-en-light/us-en-light-55-accounting_ledgers.png) | [ver](evidence/survey/m-pt-light/m-pt-light-55-accounting_ledgers.png) |
| 56 | Contabilidad | Diarios | [ver](evidence/survey/es-light/es-light-56-accounting_journals.png) | [ver](evidence/survey/es-dark/es-dark-56-accounting_journals.png) | [ver](evidence/survey/us-en-light/us-en-light-56-accounting_journals.png) | [ver](evidence/survey/m-pt-light/m-pt-light-56-accounting_journals.png) |
| 57 | Contabilidad | Periodos contables | [ver](evidence/survey/es-light/es-light-57-accounting_periods.png) | [ver](evidence/survey/es-dark/es-dark-57-accounting_periods.png) | [ver](evidence/survey/us-en-light/us-en-light-57-accounting_periods.png) | [ver](evidence/survey/m-pt-light/m-pt-light-57-accounting_periods.png) |
| 58 | Contabilidad | Impuestos | [ver](evidence/survey/es-light/es-light-58-masters_taxes.png) | [ver](evidence/survey/es-dark/es-dark-58-masters_taxes.png) | [ver](evidence/survey/us-en-light/us-en-light-58-masters_taxes.png) | [ver](evidence/survey/m-pt-light/m-pt-light-58-masters_taxes.png) |
| 59 | Contabilidad | Monedas | [ver](evidence/survey/es-light/es-light-59-masters_currencies.png) | [ver](evidence/survey/es-dark/es-dark-59-masters_currencies.png) | [ver](evidence/survey/us-en-light/us-en-light-59-masters_currencies.png) | [ver](evidence/survey/m-pt-light/m-pt-light-59-masters_currencies.png) |
| 60 | Contabilidad | Tipos de cambio | [ver](evidence/survey/es-light/es-light-60-masters_currencies_exchange-rates.png) | [ver](evidence/survey/es-dark/es-dark-60-masters_currencies_exchange-rates.png) | [ver](evidence/survey/us-en-light/us-en-light-60-masters_currencies_exchange-rates.png) | [ver](evidence/survey/m-pt-light/m-pt-light-60-masters_currencies_exchange-rates.png) |
| 61 | Contabilidad | Condiciones de pago | [ver](evidence/survey/es-light/es-light-61-masters_payment-terms.png) | [ver](evidence/survey/es-dark/es-dark-61-masters_payment-terms.png) | [ver](evidence/survey/us-en-light/us-en-light-61-masters_payment-terms.png) | [ver](evidence/survey/m-pt-light/m-pt-light-61-masters_payment-terms.png) |
| 62 | RR.HH. y nómina | Mis volantes | [ver](evidence/survey/es-light/es-light-62-payroll_my-payslips.png) | [ver](evidence/survey/es-dark/es-dark-62-payroll_my-payslips.png) | [ver](evidence/survey/us-en-light/us-en-light-62-payroll_my-payslips.png) | [ver](evidence/survey/m-pt-light/m-pt-light-62-payroll_my-payslips.png) |
| 63 | RR.HH. y nómina | Nóminas | [ver](evidence/survey/es-light/es-light-63-payroll_runs.png) | [ver](evidence/survey/es-dark/es-dark-63-payroll_runs.png) | [ver](evidence/survey/us-en-light/us-en-light-63-payroll_runs.png) | [ver](evidence/survey/m-pt-light/m-pt-light-63-payroll_runs.png) |
| 64 | RR.HH. y nómina | Empleados | [ver](evidence/survey/es-light/es-light-64-hcm_employees.png) | [ver](evidence/survey/es-dark/es-dark-64-hcm_employees.png) | [ver](evidence/survey/us-en-light/us-en-light-64-hcm_employees.png) | [ver](evidence/survey/m-pt-light/m-pt-light-64-hcm_employees.png) |
| 65 | RR.HH. y nómina | Departamentos | [ver](evidence/survey/es-light/es-light-65-hcm_departments.png) | [ver](evidence/survey/es-dark/es-dark-65-hcm_departments.png) | [ver](evidence/survey/us-en-light/us-en-light-65-hcm_departments.png) | [ver](evidence/survey/m-pt-light/m-pt-light-65-hcm_departments.png) |
| 66 | RR.HH. y nómina | Conceptos | [ver](evidence/survey/es-light/es-light-66-payroll_concepts.png) | [ver](evidence/survey/es-dark/es-dark-66-payroll_concepts.png) | [ver](evidence/survey/us-en-light/us-en-light-66-payroll_concepts.png) | [ver](evidence/survey/m-pt-light/m-pt-light-66-payroll_concepts.png) |
| 67 | RR.HH. y nómina | Parámetros de ley | [ver](evidence/survey/es-light/es-light-67-payroll_parameters.png) | [ver](evidence/survey/es-dark/es-dark-67-payroll_parameters.png) | [ver](evidence/survey/us-en-light/us-en-light-67-payroll_parameters.png) | [ver](evidence/survey/m-pt-light/m-pt-light-67-payroll_parameters.png) |
| 68 | Análisis | Rentabilidad por producto | [ver](evidence/survey/es-light/es-light-68-reports_profitability-by-product.png) | [ver](evidence/survey/es-dark/es-dark-68-reports_profitability-by-product.png) | [ver](evidence/survey/us-en-light/us-en-light-68-reports_profitability-by-product.png) | [ver](evidence/survey/m-pt-light/m-pt-light-68-reports_profitability-by-product.png) |
| 69 | Análisis | Rentabilidad por cliente | [ver](evidence/survey/es-light/es-light-69-reports_profitability-by-customer.png) | [ver](evidence/survey/es-dark/es-dark-69-reports_profitability-by-customer.png) | [ver](evidence/survey/us-en-light/us-en-light-69-reports_profitability-by-customer.png) | [ver](evidence/survey/m-pt-light/m-pt-light-69-reports_profitability-by-customer.png) |
| 70 | Análisis | Mapa de relaciones | [ver](evidence/survey/es-light/es-light-70-reports_relationship-map.png) | [ver](evidence/survey/es-dark/es-dark-70-reports_relationship-map.png) | [ver](evidence/survey/us-en-light/us-en-light-70-reports_relationship-map.png) | [ver](evidence/survey/m-pt-light/m-pt-light-70-reports_relationship-map.png) |
| 71 | Análisis | DataSheets | [ver](evidence/survey/es-light/es-light-71-datasheets.png) | [ver](evidence/survey/es-dark/es-dark-71-datasheets.png) | [ver](evidence/survey/us-en-light/us-en-light-71-datasheets.png) | [ver](evidence/survey/m-pt-light/m-pt-light-71-datasheets.png) |

## 7. Anexo B — Cómo reproducir

```bash
# Infraestructura y app (ver README del repo)
service postgresql start && service redis-server start
npm install && npm run migration:run
DEV_SEED=true DEV_SEED_PASSWORD='QA-Test-Pass-2026' npx nx serve api   # :3000
npx nx serve client-web                                                # :4200

# Requiere axe-core: npm i -D axe-core (o AXE_PATH=/ruta/axe.min.js)
# Recorrido de las 71 pantallas (tag, tema, ancho, filtro, idioma)
cd docs/qa/ux/harness
./run-survey.sh es-light light 1440 "" es
ORG=<slug> EMAIL=<correo> ./run-survey.sh us-en-light light 1440 "" en

# Flujos: 08/12 alta, 21 cliente, 23 producto, 27 NCF, 28 factura, 33 cobro,
# 40-41 cotización, 43 proveedor, 44 POS y borrado, 42 cabecera/offline, 37-39 teclado,
# 09-realistic-hang.cjs reproduce C-01 (3 recargas).
node 09-realistic-hang.cjs
```

`restart-api.sh` y `reset` de throttling solo deben usarse en el entorno local de QA.
