# Progreso — QA E2E exploratorio (Virtex)

Archivo de avance vivo. Si la sesión se corta, continuar desde aquí.

## Entorno (confirmado con el usuario: levantar local)
- Rama: `claude/e2e-qa-all-modules-lo7usn` (base `4d26bfce`).
- Postgres 16 nativo (`/tmp/pgdata`, BD `erp`), Redis 7, `npm run migration:run`.
- API `nx serve api` en :3000 con `DEV_SEED=true DEV_SEED_PASSWORD=QA-Test-Pass-2026`.
- Web `nx serve client-web` en :4200. Chromium headless (Playwright 1.56) desde `docs/qa/harness/`.
- Usuario admin sembrado: `dev@virtex.local` (empresa "Virtex Dev", DO, slug `virtex-dev`).
- Fuentes de Google y reCAPTCHA no son alcanzables desde el contenedor (limitación del entorno, no de la app).

## Condición de prueba importante
- Con `dockview-angular@8.3.1` (lo que hay en la rama) **ninguna página monta su contenido** (QA-001).
  Para poder probar el resto, se instaló localmente `dockview-angular@6.6.1` con `--no-save`
  (no se modificó package.json ni el lockfile). Todo lo probado después de ese punto lleva esa condición.
- Recargar/abrir URL con sesión activa congela la pestaña (QA-002). Las pruebas navegan dentro del SPA.

## Estado por fase
- [x] Levantar entorno
- [x] Inventario de rutas desde manifiestos (`harness/routes.txt`, 107 rutas; 9 módulos)
- [x] Bloqueantes detectados y aislados: QA-001, QA-002, QA-003, QA-004
- [x] Inventario de elementos por página (crawler SPA)
- [x] Clic en todos los elementos por página (pasada 1 vacía + pasada 2 con datos + verificación manual)
- [x] Formularios principales (válido / vacío / inválido / límite / largo / especiales)
- [x] Flujos principales por módulo
- [x] Flujos cruzados
- [x] Roles (SELLER, ACCOUNTANT, MEMBER, 2º ADMIN)
- [x] Informe final (INFORME.md) + scorecard + matriz (MATRIZ_COBERTURA.md)

Evidencia: en el repo solo las 29 capturas citadas en el informe; el set completo (≈550 capturas) quedó fuera del repo por tamaño.

## Notas de hallazgos (borrador, se consolidan en INFORME.md)
- QA-001 CRÍTICA dockview-angular 8.3.1: ninguna pestaña monta su página (TabWrapper sin tab al montar). Con 6.6.1 funciona.
- QA-002 CRÍTICA recargar/abrir URL autenticada congela la pestaña: /auth/session devuelve organizations:[] y organizationRouteGuard redirige a sí mismo en bucle.
- QA-003 ALTA WorkspaceSyncService y jobs usan URL relativa /api/v1/me/* → 4200 (GET devuelve index.html, PUT 404): el espacio de trabajo nunca se guarda.
- QA-004 ALTA GET /localization/identity-document-types → 403 incluso para admin (*): "Tipo de documento" vacío en Cliente/Proveedor/búsqueda.
- QA-005 CRÍTICA Crear cliente imposible: el form envía "" en email/identityDocumentTypeCode y la API los rechaza (400). Toast genérico "Error al crear el cliente."
- QA-006 README: dice que el usuario dev se siembra solo; en realidad requiere DEV_SEED=true y DEV_SEED_PASSWORD>=12.
- Producto: nombre >255 pasa el cliente, 400 del backend con toast genérico; SKU duplicado 409 con toast genérico. Doble clic protegido OK. Asiento de inventario inicial OK.
- Cliente: "País" obligatorio sin asterisco y sin default al país de la empresa.
- Ajustes: 11/20 secciones "EN DESARROLLO". Fiscal: título sin padding; input file en inglés.
- NCF: validaciones OK con mensajes claros; 409 por solape con mensaje genérico "No se pudo registrar el rango."
- Factura: input de búsqueda de Artículo con ancho 0 (solo teclado); Desc.% acepta 0–0.99 pero la columna dice % → "10" invalida en silencio y el resumen queda 0.00; banner "Revisa 1 punto(s)" persiste tras corregir; combobox con id="null".
- Factura FAC-00000001 E32 emitida: asientos CxC/Ingresos/ITBIS y Costo/Inventario correctos; stock 50→48; balanza, ER, BG, antigüedad, rentabilidad y actividad reflejan. 
- Dashboard en USD (EBITDA "USD 800.00") con empresa en DOP; textos del gráfico en inglés; títulos en "Title Case".
- Rentabilidad por cliente duplica el nombre ("X — X").
- Tesorería: "Cuenta de contrapartida" SIEMPRE vacía (filtra EQUITY dentro de cuentas de banco) → imposible crear cuenta con saldo inicial. Validadores condicionales quedan pegados al volver saldo a 0. "Cuenta contable" ofrece 1160/1210/1230 (no son cuentas de dinero). Moneda sin default DOP. IBAN "###" aceptado.
- Step-up: diálogo sin estilos; 1 contraseña errónea → 401 → interceptor refresca y REENVÍA el intento fallido, usuario expulsado al login y 429 "cuenta bloqueada" (5/15 min, cada error cuenta doble).
- Recibo: al añadir factura aplica el saldo completo, no el monto recibido (No aplicado negativo) — error claro al guardar. Recibos parcial+total OK: factura Paid, banco 2,360, CxC 0, asientos 1120/1130 OK.
- Listas abiertas no se refrescan tras crear en otra pestaña (facturas "parcial" y recibos "1" hasta reabrir).
- Mail: cola BullMQ a 127.0.0.1:587 (ECONNREFUSED) → sin efectos externos; job "welcome" fallido 5 veces.
- Proveedor: mismo defecto de "" que clientes (400) → imposible crear desde la UI. Teléfono "abc" aceptado.
- OC: en "Nueva" totaliza en USD (tras guardar DOP). ITBIS espera fracción (0.18); "18" → impuestos 99,000 y error «[[taxRate]]» (clave cruda). GET localhost:4200/api/v1/lifecycles (URL relativa rota).
- Factura proveedor: tabla de líneas sin estilos (inputs apilados). Errores «[[product]]», «[[expenseAccountId]]». Diálogo de confirmación sin estilos (mismo componente que step-up). Enviar a aprobación → ABIERTA (sin política), asiento 2110 OK.
- Pago proveedor: chip "· · DOP 5,000.00" sin número/proveedor. Step-up move_funds. Pago OK (2110/1120) pero banco queda -2,640 sin aviso de sobregiro.
- OC: creador aprueba su propia OC (sin SoD). "Registrar recepción" recibe todo sin diálogo (sin parcial).
- CRÍTICO flujo cruzado: OC Recibida 10 uds → stock sigue 48, 0 stock_movements, 0 asientos.
- Aprobaciones/Mi trabajo vacíos aunque la OC estuvo "Por aprobar" (pendiente verificar en ese estado).
- CRÍTICO Asiento manual imposible: POST /journal-entries 400 (ledgerId no permitido por whitelist). Toast genérico. Línea con débito y crédito a la vez pasa el cliente. Fecha 2031 → 403 con toast genérico.
- Asientos de cobros/pagos con currency_code NULL → la lista los muestra en USD.
- Libro Mayor sin selector de cuenta (callejón sin salida). Editar diario → GET /journals/:id 404. Editar libro: subtítulo "Define un nuevo libro".
- Cuenta contable: tipos/categorías como enums en inglés; categoría no filtrada por tipo → EXPENSE+CURRENT_ASSET guardado (201).
- CRÍTICO Cierre de período: enero → 500 (falta diario DEPREC para depreciación); sin mensaje en UI; sin confirmación antes de una acción irreversible. Cierre anual: placeholder. Libros: columna "Por defecto" muestra "Aceptar".
- RR.HH.: departamento vacío sin mensaje; «[[identityDocument]]» crudo; la cédula del placeholder (001-1234567-8) es rechazada 422; documento se muestra en claro pese a "Cifrado". Alta de empleado sin salario (se registra luego en Historial salarial con step-up manage_compensation; la tabla no se refresca tras guardar).
- Concepto de nómina: Tasa 5000 → 500 (numeric overflow) en vez de 400; cálculo "Monto fijo" sin campo de monto.
- ALTA Step-up: el presupuesto (5/5min por usuario + throttler 5/15min por endpoint) cuenta intentos CORRECTOS → bloqueo "cuenta bloqueada temporalmente" en uso normal. Peticiones paralelas abren 2 diálogos apilados (hay que confirmar 2 veces).
- ALTA Detalle de nómina queda en "Cargando" para siempre tras el step-up (todas las llamadas 200); solo reabriendo la pestaña se ve.
- Cálculo de nómina 09/2026 correcto (AFP 2.87%, SFS 3.04%, ISR escala anual verificada; neto 56,730.95).
- SoD nómina: aprobar por quien calculó → 403 correcto, pero SIN mensaje en UI. (OC no aplica SoD.)
- Usuarios: desplegable de rol queda DETRÁS del modal (no se puede elegir con ratón). "Rol" obligatorio sin asterisco. Botones ×/Cancelar son type=submit (Cancelar no envió: OK). Invitación duplicada → 201. Roles con nombres en inglés.
- Activación (set-password): contraseña débil → botón deshabilitado SIN explicar requisitos; espera 8 s (timeout reCAPTCHA) sin feedback; tras activar aterriza en "Acceso Denegado" (/unauthorized).
- Roles: backend aplica permisos (403) OK en SELLER/ACCOUNTANT/MEMBER; rutas prohibidas → "Acceso Denegado" OK. PERO el riel muestra TODOS los módulos a todos los roles; MEMBER ve botón "Nueva factura de venta"; SELLER recibe 403 en /currencies (selector de moneda vacío) aunque puede emitir (FAC-2 OK, stock 46).
- Nómina: aprobada por 2º admin (SoD OK) → asiento NOMINA-2026-000001 cuadrado y correcto. UI no se refresca tras aprobar. "Marcar como pagada": 400 requiere cuenta bancaria pero la UI no tiene selector → nómina impagable; sin mensaje.
- Maestros: categoría vacía sin mensaje; duplicado 400; almacén: form sin estilos; "Nuevo banco" abre "Nueva cuenta bancaria"; "Nueva sucursal" no hace nada; U. de medida sin botón de alta; impuesto 150% aceptado; borrar impuesto pide confirmación OK. Lista de precios: Draft/Active en inglés, USD por defecto, vigencia 1 día por defecto. Requisición en USD; lifecycles URL rota.
- Workspace: búsqueda OK (grupos "Invoices/Products/Customers" en inglés; caracteres especiales seguros). "Nueva cotización" y "Reportes" (Inicio) → páginas "en construcción" (títulos "New", "Reports").
- MOCK: Exportaciones (historial 2025 ficticio, "Generar archivo" sin red), Importaciones (historial ficticio, "Importar datos" sin red), DataSheets (libros demo "Juan Pérez"/"Laptops", no abren; "Nuevo libro" llama a localhost:4200/api/datasheets/... sin /v1).
- Plantillas: subir archivo con nombre ya usado en Repositorio → 400 (comparten carpeta). Nueva carpeta: sin diálogo.
- POS: UI calcula ITBIS 18% (1,180) y servidor 0% → 409 pos.totals_changed; sin mensaje; imagen de producto rota. Venta POS imposible.
- Conciliación: claves crudas «[[startDate]]», «[[dateColumn]]»...
- Aprobaciones/Mi trabajo vacíos con REQ "Por aprobar" → bandeja no conectada a compras.
- Dashboard: EBITDA USD 1,600 / margen 40% ignora nómina aprobada (75,313.50) → verificar vs ER.
- (Retirado) ER sin nómina: el asiento de nómina está fechado 30/09 y el reporte va "hasta hoy"; con rango correcto aparece. Asiento de nómina con currency_code NULL.
- ALTA Detalle de factura: 14/16 botones de la barra muertos (Primero/Anterior/Siguiente/Último, Avanzar, Imprimir, Correo, Búsqueda, PDF, Excel, Word, Parametrizaciones, Ayuda; ni window.print ni window.open). "Copiar de" muerto; "Copiar a" OK. No existe Anular ni Nota de crédito en la factura.
- Ajustes/Mi perfil: Guardar deshabilitado sin explicación (Teléfono obligatorio sin * ni mensaje); con teléfono → PATCH /users/profile 400 (email no admitido por whitelist) → perfil no editable. Cambio de contraseña sin pedir la actual; débil/no coincide sin mensaje. "Activar 2FA" muerto. "Cambiar correo" no respondió. Cargos en inglés (CEO, MANAGER…). Sesiones: dispositivo "on", ubicación inferida "Santo Domingo" para localhost.
- Estructura Empresarial: "Cargando subsidiarias…" permanente sin petición de red.
- Facturación y Plan: uso 0/∞ en todo pese a datos reales; "Plan actual Enterprise — Sin suscripción activa"; límites en inglés ("invoices/mes").
- SSO: requiere 2 step-ups solo para ver.
- Sesión/seguridad: XSS escapado OK; 5 logins fallidos → 429 con mensaje claro OK; aviso de cambios sin guardar OK; sesión expirada → login?reason=expired OK; logout revoca y API 401 OK. Credenciales incorrectas muestran "Tu sesión no es válida o expiró" (engañoso).
- Verificación manual: Exportar de estados financieros/rentabilidad/facturas SÍ descargan CSV (falsos negativos de la pasada 1). Muertos: Exportar de Libro Diario, Plan de cuentas, Libro Mayor, Historial de ventas; clic en asiento y "Más acciones"; "Solicitar Permiso". Filas de producto/cliente abren edición OK.
- Edición: cliente PATCH 200 OK; producto PATCH 200 OK; cambiar stock 46→999 genera asiento de ajuste correcto (571,800) sin pedir motivo ni confirmación.
- Plan de cuentas: Editar → 400 reasonForChange sin campo en el formulario (ninguna cuenta editable). Filtros OK; encabezados no ordenan; clic en cuenta abre su mayor. Balanza: rango invertido con mensaje claro.
- Extensiones: admin del inquilino → step-up y luego 403 (requiere rol de plataforma).
- CRÍTICO Eliminaciones (datos QA): cliente con 2 facturas → DELETE 200 y BORRA EN CASCADA facturas (e-NCF emitidos) y recibos; los 12 asientos quedan; antigüedad CxC descuadra −2,360 con el mayor. Producto con facturas/OC → DELETE 200. Departamento con empleado → 204 sin confirmación (empleado queda con depto inexistente). Concepto de nómina sin confirmación. Cuenta 5910 → 404 "No se pudo eliminar", confirmación muestra JSON crudo.
- Inicio: "Vence la factura…" y "Cierre del período…" navegan OK; filas de actividad no navegan.
