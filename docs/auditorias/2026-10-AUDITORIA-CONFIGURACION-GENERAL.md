# Auditoría de la Configuración general: arquitectura de la información, layout, UX y UI

**Fecha:** 2026-10-29 · **Amplía:** [§5.C de la auditoría de la ventana de ajuste](2026-10-AUDITORIA-VENTANA-DE-AJUSTE.md#5c-configuración-general). Los hallazgos `CFG-01…CFG-11` de ese informe siguen vigentes y aquí se citan por su ID; los nuevos llevan el prefijo **`CG-`**.
**Ventana:** modal «Configuración» (menú de usuario › Configuración, o `#settings/<sección>` sobre cualquier ruta del portal). 26 secciones visibles para el Administrador.
**Método:** aplicación local con datos reales («Virtex Dev», DO). Recorrido en Chromium con Playwright; estilos y posiciones medidos con JavaScript; red y base de datos inspeccionadas; código leído (`features/settings/**`, 31 hojas de estilo propias más `_settings-shared.scss`).

**Evidencia:**

| Qué | Dónde |
|---|---|
| Capturas pliegue a pliegue de cada sección | [`2026-10-ventana-de-ajuste/capturas/config/NN-<sección>-pN.png`](2026-10-ventana-de-ajuste/capturas/config/) |
| Mediciones de layout | [`config-layout.json`](2026-10-ventana-de-ajuste/config-layout.json) |
| Recorrido de secciones | [`config-secciones.json`](2026-10-ventana-de-ajuste/config-secciones.json) |
| Scripts que lo reproducen | `harness/17`, `18`, `19`, `21`–`26` |

> Diagnóstico, sin cambios en el código. No guardé ningún cambio de configuración en esta pasada. Toqué dos valores y los dejé como estaban: la densidad volvió a «Cómoda» y un interruptor de IA volvió a su estado original.

---

## Resumen ejecutivo

1. **La Configuración no tiene una arquitectura: es un contenedor.** 26 pantallas hechas por separado (31 hojas de estilo) comparten una barra lateral, pero no un patrón. Miden **8 anchos máximos**, **5 cabeceras**, **5 posiciones** para la acción principal, **4 modelos de guardado** y **4 tipos de estado vacío**.
2. **La configuración del producto está repartida en tres sitios** (este modal, los grupos «Configuración» de cada módulo y páginas sueltas del espacio de trabajo), con **conceptos duplicados**: impuestos, monedas, cierre, aprobaciones e integraciones. Cada sección compensa con un enlace al pie del tipo «se gestionan en Maestros…», y «Maestros» ya no existe en el menú.
3. **Mezcla de alcances sin señalizarlo**: la cuenta personal, la empresa, el sistema y la plataforma conviven sin distinguir a quién afecta cada ajuste. «Personalización» mezcla preferencias de la persona (tema, densidad, idioma) con la marca de la empresa (logo, color), y la mitad se aplica sin guardar.
4. **Las cuentas contables por defecto están troceadas en 6 secciones** de 1 a 14 campos (Contabilidad, Multimoneda, Impuestos, Cierre fiscal, Intercompañía, Inventario). En cambio, «Seguridad y auditoría» e «Inteligencia artificial» ocupan 3.6–3.8 pantallas de scroll dentro de un modal.
5. **Errores visibles que un cliente notaría la primera semana:**
   - la opción seleccionada de los controles segmentados es **invisible en tema claro** (texto del mismo color que el fondo);
   - un Administrador aparece como «ADMINISTRATOR»;
   - las líneas de la tabla de Roles se cortan;
   - «Secuencias **fiscales**» dice en su pie que la numeración fiscal **no** se configura ahí;
   - Extensiones pide registrar «a la derecha» un panel que está debajo, y que además dice que registrar no le corresponde a la empresa.
6. **Recomendación: reestructurarla, no retocarla.** Página completa de Ajustes con buscador, cuatro áreas por alcance (Mi cuenta, Empresa, Contabilidad y fiscal, Administración), una plantilla única de sección con barra de guardado fija, y la configuración de módulos enlazada desde un solo índice. El detalle está en §8. **Nota: 4/10**, sin cambios respecto al informe principal; la arquitectura de la información baja de 5 a 4.

---

## 1. Estándar de referencia

| Convención | Producto | Confianza |
|---|---|---|
| Ajustes como **página o área propia** (no modal), con categorías: perfil de la organización, usuarios y roles, preferencias generales y por módulo, monedas, impuestos | Zoho Books ([Settings](https://www.zoho.com/books/help/settings/), [Preferences](https://www.zoho.com/books/help/settings/preferences.html)) | Alta |
| **Pestañas por ámbito** (Company, Billing & subscription, Usage, Sales, Expenses, Payments, **Advanced**). Cada sección se edita con su lápiz y se confirma con **Save/Cancel en esa sección** | QuickBooks Online ([Edit company settings](https://quickbooks.intuit.com/learn-support/en-us/help-articles/how-to-configure-company-settings/00/261902)) | Alta |
| **Autoguardado por campo**, con un indicador visible «guardando / guardado / no guardado» | Dynamics 365 Business Central ([Auto-save as you work](https://learn.microsoft.com/dynamics365-release-plan/2022wave2/smb/dynamics365-business-central/auto-save-as-work)) | Alta |
| Páginas de preferencias completas por área (*Company Information*, *General / Accounting Preferences*, *Enable Features*) | Oracle NetSuite | Media (conocimiento previo, no verificado en esta sesión) |
| Buscador en la app de Ajustes y una barra «Guardar / Descartar» común | Odoo | **Media**. En el informe principal (§3.3) la marqué «alta», pero no la pude verificar en esta sesión; la rebajo. |
| Diálogo modal: el foco entra, se queda dentro y vuelve; Escape no descarta trabajo sin avisar | WAI-ARIA APG, patrón *Dialog (Modal)* | Alta |

**Vara de medir:**

- Un área de Ajustes **encontrable** (buscador y categorías claras) que **separa alcances** (yo, mi empresa, la administración).
- **Un solo modelo de guardado** por pantalla: o explícito por sección, como QuickBooks, o autoguardado con indicador, como BC. **Nunca mezclados sin señal.**
- Cada ajuste dice qué hace y a quién afecta; los sensibles piden confirmación y quedan auditados.

---

## 2. Arquitectura de la información

### 2.1 Mapa actual (26 secciones)

Clasifiqué el contenido real de cada sección. «Tipo» indica qué es de verdad: **F** formulario de ajustes · **L** lista o administración de registros · **E** estado o informe · **H** índice de enlaces · **X** herramienta. «Pant.» son las pantallas de scroll a 1440×900. «Guardado» es el modelo observado.

| # | Barra lateral | Título de la página | Tipo | Campos | Pant. | Guardado | Alcance real |
|---|---|---|---|---|---|---|---|
| 1 | Mi perfil | *Dev User* (sin título de sección) | F + L | 11 | 2.2 | 2 botones en tarjetas + acciones sueltas (2FA, llaves, sesiones) | Persona |
| 2 | Mis empresas | Mis empresas | L | 0 | 1 | — | Persona |
| 3 | Facturación y plan | Facturación y plan | E | 0 | 1.8 | — | Empresa (suscripción) |
| 4 | Perfil de la empresa | Perfil de la empresa | F | 10 | 1.3 | «Guardar cambios» arriba a la derecha | Empresa |
| 5 | Estructura empresa… | Estructura empresarial | L | 0 | 1 | — | Grupo |
| 6 | Sucursales | Sucursales | L | 0 | 1 | — | Empresa |
| 7 | Personalización | Personalización **avanzada** | F | 4 + segmentados | 1.7 | «Guardar cambios» arriba; densidad y tema **se aplican al instante sin guardar** | **Persona + Empresa** |
| 8 | Contabilidad | **Preferencias contables** | F | 14 | 1.9 | «Descartar / Guardar cambios» al final (y = 1343 px) | Empresa |
| 9 | Multimoneda | Multimoneda **y tasas de cambio** | F | 5 | 1.2 | al final | Empresa |
| 10 | Impuestos | **Reglas de** impuestos | F | 7 | 1.1 | al final | Empresa |
| 11 | Cierre fiscal | **Periodos y** cierre fiscal | F | 2 | 1 | al final | Empresa |
| 12 | Intercompañía | **Reglas** intercompañía | F | 2 | 1 | al final | Grupo |
| 13 | Comprobantes fisca… | Comprobantes fiscales (RD · DGII) | F + L + X | 9 | 1.9 | sin botón general; «Registrar rango» por formulario | Empresa (país) |
| 14 | Retenciones | **Regímenes de** retención | E + L | 0 | 1.1 | — | Empresa (país) |
| 15 | Jurisdicciones fisca… | Jurisdicciones fiscales | L | 0 | 1 | — | Empresa (país) |
| 16 | Secuencias | Secuencias **fiscales** | F (tabla) | 10 | 1 | «Guardar» **por fila** (5) | Empresa |
| 17 | Aprobaciones | **Flujos de** aprobación | L | 0 | 1 | — | Empresa |
| 18 | Inventario | **Políticas de** inventario | F | 4 | 1 | al final | Empresa |
| 19 | Usuarios | **Gestión de** usuarios (+ miga «Administración / Usuarios») | L | 2 (filtros) | 1 | — | Administración |
| 20 | Roles y permisos | Roles y permisos | L | 0 | 1 | — | Administración |
| 21 | Seguridad y auditoría | Seguridad y auditoría | F + **E (informe de auditoría)** | 5 | **3.8** | casilla suelta, sin botón | Administración |
| 22 | Integraciones | Integraciones | **H** (duplica 24, 26 y 13) | 0 | 1.5 | — | Administración |
| 23 | Correo saliente | Correo saliente | F | 3 | 1 | «Guardar» abajo a la derecha | Empresa |
| 24 | SSO | Inicio de sesión único (SSO) | L | 1 | 1 | — | Administración |
| 25 | Inteligencia artificial | Inteligencia artificial | E + F | 4 + 13 casillas | **3.6** | **autoguardado silencioso** (`PUT /ai/settings`) | Empresa |
| 26 | Extensiones | Extensiones | L + **X** («Ejecutar en el aislamiento») | 1 | 1 | — | Administración / plataforma |

Además existe una 27.ª sección, **`sessions`**, registrada en `SECTION_MAP` pero sin entrada en la barra lateral. Su contenido aparece al final de «Mi perfil» («Sesiones activas»).

### 2.2 Hallazgos de arquitectura de la información

**CG-01 · Arquitectura · Alta**
**La configuración vive en tres sitios y se duplica.**

- **Dónde está:**
  - en el modal (26 secciones);
  - en los grupos «Configuración» de los módulos, leídos de los manifiestos: Contabilidad tiene 8 entradas (Dimensiones, Libros, Diarios, Períodos, Impuestos, Monedas, Tipos de cambio, Términos de pago), Inventario 3, Tesorería 2 y Mi trabajo 2 (Flujos de trabajo, Ejecuciones);
  - en páginas del espacio de trabajo (`data-imports` y `data-exports`, con permiso `settings:edit_company`).
- **Conceptos partidos en dos:**

  | En el modal | En otro sitio |
  |---|---|
  | Impuestos (cuentas) | Contabilidad › Configuración › Impuestos (tasas) |
  | Multimoneda (cuenta de diferencial y políticas) | Contabilidad › Monedas / Tipos de cambio |
  | Cierre fiscal | Contabilidad › Períodos / Cierre anual |
  | Aprobaciones | Mi trabajo › Flujos de trabajo |
  | Integraciones | Duplica Extensiones, SSO y Facturación electrónica del propio modal |

- Cada sección lo parchea con un enlace al pie:
  - «Las tasas de cada impuesto se gestionan en **Maestros**: Tasas de impuesto» (`10-impuestos-p2.png`);
  - «…en Maestros: Monedas»;
  - «El cierre de cada período se hace desde Contabilidad…».
- «Maestros» ya no es un nombre de menú: hoy es Contabilidad › Configuración.
- **Esperado:** un único índice de Ajustes que contenga o enlace toda la configuración, agrupada por área (estándar §1, Zoho y QuickBooks).

**CG-02 · Arquitectura · Alta**
**Alcances mezclados sin señal.**

- «Mi cuenta» (persona) comparte modal con Empresa y Sistema, y nada indica a quién afecta cada ajuste.
- «Personalización» mezcla:
  - preferencias **personales** (idioma, tema, densidad, ancho, alto contraste), que además están duplicadas en el menú de usuario;
  - **marca de la empresa** (logo, color de acento, tipografía, radio de bordes).
- Al pulsar «Compacta», la densidad **se aplica al instante** (`data-density="compact"`) sin ninguna petición de red, y «Guardar cambios» sigue deshabilitado (`24-config-detalles.cjs`). No se sabe si ese cambio persiste ni para quién.
- **Esperado:** «Preferencias» (personales, inmediatas) separadas de «Marca de la empresa» (explícitas y auditadas).

**CG-03 · Arquitectura · Alta**
**Las cuentas por defecto están troceadas en 6 secciones.**

- Contabilidad (14 campos), Impuestos (7), Multimoneda (5), Inventario (4), Cierre fiscal (2) e Intercompañía (2) usan **el mismo componente** (`settings-section.component`) para el mismo tipo de dato.
- Para revisar el mapa contable completo hay que abrir 6 secciones y guardar 6 veces.
- Al revés, «Ajuste por inflación» y «Patrimonio de apertura» viven en Contabilidad, no en Cierre.
- **Esperado:** una pantalla «Cuentas predeterminadas» con grupos plegables (Ventas, Compras, Caja y bancos, Impuestos, Inventario, Moneda, Cierre, Intercompañía), un buscador por cuenta y un solo guardado.

**CG-04 · Arquitectura / contenido · Alta**
**Los nombres no coinciden con el contenido.**

- **11 de 26** rótulos de la barra lateral difieren del título de su página (CFG-08). Además:
  - «**Inventario**» se titula «**Políticas** de inventario» y no contiene ninguna política: solo 4 cuentas. La valoración es un texto fijo («se valora a costo promedio ponderado») y no hay política de stock negativo (`18-inventario-p1.png`).
  - «**Secuencias**» se titula «Secuencias **fiscales**» y su pie dice «La numeración fiscal (NCF, e-CF) **no se configura aquí**» (`16-secuencias-p1.png`). El título contradice el contenido.
  - «Comprobantes fiscales» remite a «(**Ajustes › Facturación electrónica**)», una ruta que no existe (CFG-09).
  - «Seguridad y **auditoría**»: la auditoría es un informe, no un ajuste (CG-05).

**CG-05 · Arquitectura · Media**
**Hay contenido que no es configuración dentro de Configuración.**

- La **pista de auditoría** (tabla con filtros y paginación) ocupa la mayor parte de las 3.8 pantallas de «Seguridad y auditoría» (`21-seguridad-y-auditoria-p2.png`).
- La matriz «**Qué cubre el producto en DO**» (estado de cobertura del producto) aparece **expandida** en Retenciones y **plegada** en Comprobantes fiscales (`14-retenciones-p1.png`, `Y-restringido-fiscal.png`).
- **IA:** «Ejecuciones del motor» con trabajos «En cola» y botones deshabilitados «En curso…», más los contadores «Pendiente de revisar» (`25-inteligencia-artificial-p1.png`). Es estado operativo.
- **Extensiones:** «Ejecutar en el aislamiento», una herramienta de desarrollador, sin explicar para qué sirve a un cliente.
- **Esperado:** la auditoría como informe propio (con un enlace desde Seguridad), y el estado de la IA o de los trabajos en su módulo.

**CG-06 · Arquitectura / multipaís · Media**
**Las secciones no se condicionan por país.**

- «Jurisdicciones fiscales» (concepto de **nexo** de *sales tax* de EE. UU.: «la venta no se gravó por falta de nexo») se muestra a una empresa de DO. El código solo condiciona «Facturación electrónica / Régimen» por país (`showDominicanFiscal` / `showRegimeSettings`).
- Lo positivo: «Comprobantes fiscales (RD · DGII)» se ofrece solo a DO.

**CG-07 · Arquitectura · Media**
**Orden y profundidad de la barra lateral.**

- 26 entradas en 5 grupos, con 220 px de ancho; a 1440×900 caben unas 17 sin scroll.
- Las tareas de administración más frecuentes (Usuarios, Roles) quedan al fondo, bajo Finanzas y Operaciones.
- Tres rótulos aparecen truncados (CFG-11). No hay buscador (CFG-08).

### 2.3 Lo que funciona en la arquitectura

- **Enlaces profundos:** `#settings/<sección>` y acciones (`#settings/branches/new`).
- **Historial:** «Atrás» recorre las secciones visitadas (Secuencias → Impuestos → Contabilidad) y una recarga conserva la sección abierta.
- **Ayudas en las cuentas:** cada cuenta por defecto explica su función y su tipo («Recibe faltantes, sobrantes y revaluaciones de costo. Cuenta de tipo Gasto.»).
- **Campos bloqueados con explicación ejemplar:** «Moneda de los libros — Ya hay asientos en esta moneda: cambiarla reescribiría toda la contabilidad, así que está bloqueada»; el país en el Perfil de la empresa.
- **Nota de convivencia** entre Aprobaciones y Flujos de trabajo, que explica que ambos se aplican.

---

## 3. Layout y distribución de componentes

### 3.1 Mediciones (1440×900; contenido útil del modal: **878 px**)

| Medida | Valores encontrados | Debería |
|---|---|---|
| `max-width` de la página de sección | **8 distintos**: 1100 (9 secciones), 960 (10), none (4), 1000, 1040, 900, 860, 760 | 1 |
| Margen interior | 32 px en la mayoría; 24 px en Extensiones; **0** en Estructura empresarial | 1 |
| Título h1 | 20/600, 20/700, 22/700, 24/600, 24/700 (5 estilos) | 1 |
| Cabecera de sección | 5 patrones (ver CG-09) | 1 |
| Posición de la acción principal | 5 (ver CG-10) | 1–2 según el tipo de pantalla |
| Columnas de campos | 1 (Correo, IA), 2 (Finanzas, Perfil de la empresa), hasta 5 posiciones distintas (Comprobantes, Seguridad) | Rejilla común de 12 columnas |
| Títulos de grupo dentro de la sección | 3 estilos: VERSALITAS 12px gris («PREFERENCIAS DE IDIOMA», «PLAN ACTUAL»), negrita 15px («Ventas y cobros»), h2 de tarjeta («Información general») | 1 |
| Contenedor de grupo | tarjeta con cabecera gris, tarjeta sin cabecera, sin tarjeta, borde izquierdo de color | 1–2 |
| Estados vacíos | 4 patrones (ver CG-13) | 1 |
| Altura del scroll | de 1 a **3.8** pantallas dentro del modal | Página completa para >1.5 |

### 3.2 Hallazgos de layout

**CG-08 · Layout · Alta**
**Un modal no da cabida a esta cantidad de contenido.**

- El panel mide `max-width: 1100px; height: min(88vh, 820px)`, con doble scroll (barra lateral + contenido), y deja 878 px útiles para formularios de 2 columnas, tablas de 6 columnas y un informe de auditoría.
- A 1366×768, «Guardar cambios» de Contabilidad está en **y = 1455 px** del contenido, fuera de vista y sin barra fija (`25-config-tema-rol.cjs`).
- En móvil el contenido queda en 105 px (CFG-01).
- **Esperado:** página completa, igual que Zoho, QuickBooks, NetSuite y BC (§1).

**CG-09 · Layout · Media**
**Cinco cabeceras distintas para el mismo tipo de pantalla:**

1. Título + subtítulo + regla. Es la mayoría (Contabilidad, Correo…).
2. **Tarjeta de perfil sin título de sección**. En Mi perfil, el h1 es el nombre de la persona, «Dev User» (`01-mi-perfil-p1.png`).
3. Título + **miga de pan** «Administración / Usuarios», solo en Usuarios, y con un grupo («Administración») que no existe (se llama «Sistema») (`19-usuarios-p1.png`).
4. Título **sin subtítulo** + botón: Roles, Personalización, Extensiones.
5. **Sin margen**: en Estructura empresarial el título va pegado al borde izquierdo del panel y «Nueva subsidiaria» toca el borde derecho (`05-estructura-empresarial-p1.png`).

**CG-10 · Layout / UX · Alta**
**La acción principal aparece en cinco lugares:**

- arriba a la derecha (Perfil de la empresa, Personalización, Usuarios, Roles, Mis empresas, Estructura);
- debajo del contenido, a la izquierda (Retenciones «Agregar régimen», Jurisdicciones, Aprobaciones «Nueva política»);
- al final, a la derecha, tras 1–2 pantallas de scroll (Contabilidad, Multimoneda, Impuestos, Cierre, Intercompañía, Inventario, Correo);
- por fila (Secuencias);
- dentro de tarjetas (Mi perfil: «Guardar cambios» en la tarjeta izquierda, «Actualizar contraseña» en la derecha, «Activar» y «Agregar llave de acceso» en otras dos).

Quien pasa de una sección a otra tiene que buscar el botón cada vez. Relacionado con CFG-05.

**CG-11 · Layout · Media**
**Mi perfil: columnas desequilibradas.**

- La columna derecha (unos 330 px) comprime tarjetas con icono, texto y botón:
  - «Autenticación de dos factores (2FA)» se parte en 4 líneas;
  - la descripción va una o dos palabras por línea;
  - «Agregar llave de acceso» ocupa 3 líneas (`01-mi-perfil-p2.png`).
- La tarjeta izquierda se estira hasta la altura de la derecha y deja un **hueco blanco** de unos 500 px.
- «Sesiones activas» queda al final de la columna derecha, en el tercer pliegue.

**CG-12 · Layout · Media**
**Integraciones: la rejilla se rompe.**

- Cuatro tarjetas en 2×2 con insignia de estado, seguidas de «Correo entrante» a ancho completo:
  - con otro estilo (sin insignia, subtítulos en negrita pequeña);
  - con botones grises de ancho completo «Crear dirección»;
  - **pegada** a la fila superior, sin separación (`22-integraciones-p1.png`).
- Después, «Agentes de IA conectados» muestra una URL técnica (`http://localhost:3000/api/v1/mcp`).

**CG-13 · Layout / UI · Media**
**Cuatro tipos de estado vacío:**

- ilustración centrada + botón dentro de una tarjeta (Estructura);
- ilustración centrada sin tarjeta (Sucursales, Extensiones);
- **frase suelta debajo del botón** («Agregar régimen» → «Todavía no hay regímenes configurados.», igual en Jurisdicciones y Aprobaciones);
- texto gris centrado dentro de una tarjeta (SSO).

**CG-14 · Layout · Baja**
**Tablas con anatomías distintas:**

| Tabla | Tarjeta | Filtros | Búsqueda | Paginación | Recargar |
|---|---|---|---|---|---|
| Usuarios | sí | pestañas | sí | sí | sí |
| Roles | sí | — | — | — | — |
| Auditoría | no | 5 filtros en dos filas, «Hasta» solo en la segunda | — | — | — |
| Secuencias | no | — | — | — | — |

Las secuencias llevan además campos editables por fila.

---

## 4. UX: flujo, guardado, errores y permisos

**CG-15 · UX · Alta**
**Cuatro modelos de guardado medidos, sin indicación de cuál rige.**

| Modelo | Dónde | Señal que recibe la persona |
|---|---|---|
| Explícito por sección | Contabilidad, Perfil de la empresa, Correo… | Botón «Guardar cambios» / «Guardar» y aviso «Cambios guardados.» |
| Explícito por fila | Secuencias | Cinco botones «Guardar» |
| **Autoguardado silencioso** | IA (`PUT /ai/settings 200` al marcar una casilla) | **Ninguna**: ni aviso ni indicador |
| **Aplicación inmediata sin persistir** | Personalización (densidad, tema) | El cambio se ve, pero «Guardar cambios» sigue deshabilitado |

BC autoguarda y siempre muestra «guardando / guardado» (§1). Aquí el autoguardado es mudo y convive con formularios que exigen guardar.

**CG-16 · UX · Alta**
**Pérdida de cambios.** Escape, clic en el fondo y cambiar de sección descartan sin aviso (CFG-02). Lo agrava CG-15: la persona no sabe qué secciones guardan solas.

**CG-17 · UX · Alta**
**Permisos: secciones visibles que fallan al abrirse.**

- El usuario «QA-7734 Consulta inventario» (solo `products:view` e `inventory:view_stock`) ve 17 secciones.
- **Contabilidad / Secuencias:** «No tienes permisos para realizar esta acción.» con un botón **«Reintentar»**, inútil ante un 403. El texto habla de «acción» cuando solo intentaba **ver** (`Y-restringido-accounting.png`, `Y-restringido-sequences.png`).
- **Comprobantes fiscales:** aviso rojo «No se pudieron cargar las secuencias NCF.», sin decir que es un problema de permisos, y el formulario de **Rangos editable con «Registrar rango» activo** (`Y-restringido-fiscal.png`).
- **Perfil de la empresa:** campos editables y botón gris sin explicación (CFG-06).
- **Esperado:** ocultar lo que no puede ver, mostrar en solo lectura lo que puede ver, y explicar los permisos con su nombre.

**CG-18 · UX · Media**
**Verificación de seguridad (*step-up*) para mirar, y mensajes contradictorios.**

- Abrir Integraciones o SSO pide la contraseña solo para ver (CFG-07).
- En SSO aparecen a la vez el diálogo y un **aviso rojo** «No se pudieron cargar los dominios.» detrás (`24-sso-stepup.png`).
- La tarjeta SSO de Integraciones le dice al **Administrador** «Sin acceso — No tienes permiso para ver el estado de esta integración.» (`22-integraciones-p1.png`).

**CG-19 · UX · Media**
**Ajustes sensibles sin confirmación ni marca de impacto.**

- Cuentas por defecto, prefijos de secuencia («Guardar» por fila), modo de emisión fiscal, presupuesto de IA y envío de datos a proveedores de IA se aplican sin ninguna confirmación.
- Ninguno indica «afecta a documentos nuevos desde hoy» ni enlaza a su historial (la auditoría existe; ver §6).
- **Bien resuelto:** Secuencias impide bajar el próximo número con un mensaje en línea claro («El próximo número no puede bajar de 1: los anteriores pueden estar ya en documentos emitidos.»), y la moneda de los libros y el país están bloqueados con explicación.

**CG-20 · UX · Media**
**Ni valores por defecto visibles ni opción de restablecer.**

- Solo dos campos explican qué ocurre si se dejan vacíos: «Vacío: el nombre comercial…» en Correo saliente y «vacío = el predeterminado» en el presupuesto de IA.
- Ninguna sección ofrece «Restablecer valores por defecto».

**CG-21 · UX · Media**
**Instrucciones imposibles o contradictorias.**

- **Extensiones:** «Todavía no hay extensiones registradas. Registra una **a la derecha**», pero el panel «Registrar extensión» está **debajo** (x = 436, y = 615; el mensaje está en x = 609, y = 396). Además, el panel dice: «Publicar extensiones en el catálogo compartido lo hace el equipo de la plataforma» (`26-extensiones-p1.png`).
- **Secuencias:** «Secuencias fiscales» frente a «la numeración fiscal no se configura aquí» (CG-04).

**CG-22 · UX · Media**
**Estados que no terminan.** En IA, «Ejecuciones del motor: Predicción — En cola · 28/10/2026» y «Anomalías — En cola», con botones deshabilitados «En curso…». No hay tiempo estimado ni explicación (el motor de IA no estaba en marcha), y no se ofrece reintentar ni cancelar (`25-inteligencia-artificial-p1.png`).

**CG-23 · UX · Baja**
**Campos de contraseña que parecen rellenados.** Los tres campos de Mi perfil usan `placeholder="••••••••"` con valor vacío (DOM). Se ven como contraseñas ya escritas (`01-mi-perfil-p1.png`).

**CG-24 · UX · Baja**
**El título de la pestaña del navegador no cambia** al abrir Configuración: sigue diciendo el de la página de fondo, por ejemplo «Ajustes de inventario | Virtex».

---

## 5. UI: calidad visual y contenido

**CG-25 · UI / accesibilidad · Alta**
**La opción seleccionada de los controles segmentados es invisible en tema claro.**

- «Español» seleccionado: `color: rgb(91,55,217)` sobre `background: rgb(91,55,217)`, contraste **1:1** (DOM, `24-config-detalles.cjs`).
- En la vista previa, el botón primario («Aceptar») tampoco muestra texto (`07-personalizacion-p1.png`).
- En **tema oscuro** sí se ve (`Y-1366-oscuro-branding.png`), así que el fallo es de los tokens del tema claro.
- Criterio: WCAG 1.4.3.

**CG-26 · UI · Media**
**Las líneas de la tabla de Roles se cortan.** La celda de acciones es `display:flex` (las demás son `table-cell`), y la línea inferior de cada fila se interrumpe y reaparece desplazada bajo la columna Acciones (`20-roles-y-permisos-p1.png`).

**CG-27 · UI / contenido · Media**
**Código crudo del rol.** Usuarios muestra el rol del administrador como «**ADMINISTRATOR**»; Roles lo llama «Administrador» (`19-usuarios-p1.png`, `20-roles-y-permisos-p1.png`).

**CG-28 · UI · Media**
**Color semántico incorrecto.**

- SSO muestra un requisito («Debes verificar al menos un dominio antes de poder activar un proveedor.») en una **caja verde de éxito**.
- Correo saliente muestra una consecuencia grave («Ni aquí ni en el perfil de la empresa hay un correo: las respuestas de tus clientes **no llegarán a nadie**.») como **texto negro normal**, sin estilo de aviso (`23-correo-saliente-p1.png`).

**CG-29 · UI · Media**
**Pista de auditoría poco legible.**

- La columna «Registro» muestra fragmentos de UUID (`8fcabd9c`, `52a9c279`) en vez del nombre o número del documento.
- La columna «Dirección IP» vale «—» en todas las filas.
- Las filas de «Sistema» (12 períodos creados) entierran las acciones humanas.
- Los filtros de fecha usan `mm/dd/yyyy` y los combobox recortan «Buscar o seleccio…» (`21-seguridad-y-auditoria-p1.png`, `21-seguridad-y-auditoria-p2.png`).

**CG-30 · UI · Baja**
**Detalles de contenido:**

- **Mayúsculas:** «Créditos **De** IA» y «Asientos **Contables**» en Facturación, frente a minúscula en el resto.
- **Sin traducir:** «SSO» en la barra lateral, sin traducción ni expansión.
- **Marca:** el remitente de los correos es «no-reply@**virteex**.local», mientras la marca es «virtex».
- **Recortes sin `title`:** cuentas largas en los combobox («4300 — Descuentos y Devoluciones sobre V…», «5760 — Resultado por Exposición a la Inflaci…»).
- **Fechas en formato EE. UU.:** «Vence el 12/31/2027» en una organización DO (control nativo).

**CG-31 · UI · Baja**
**Iconos de acción deshabilitados** (editar o eliminar roles de sistema): tienen `title` pero no `aria-label`, y no explican **por qué** están deshabilitados («Los roles de sistema no se editan; duplícalo»).

---

## 6. Fortalezas a preservar

- **Textos de ayuda de calidad** en las cuentas y políticas, que dicen qué hace cada una y su tipo de cuenta.
- **Campos bloqueados con su porqué** (moneda de los libros, país).
- **Vistas previas útiles:**
  - Secuencias: «El próximo saldrá como FAC-00000001»;
  - Correo saliente: «Así lo verá tu cliente»;
  - Personalización: vista previa en vivo.
- **Validación en línea en Secuencias**, con un mensaje que explica la regla.
- **Navegación con historial:** Atrás, recarga y enlaces profundos funcionan.
- **Auditoría real:** los cambios de configuración quedan registrados con valor anterior y nuevo (verificado en el informe principal).
- **Tema oscuro completo** y axe-core sin violaciones en el modal (informe principal).
- **Condicionado por país donde sí existe:** Comprobantes fiscales DGII solo para DO.
- **Estados vacíos con buen texto:** Sucursales («Mientras no haya ninguna, los documentos no piden sucursal…») y Estructura empresarial.

---

## 7. Scorecard de la Configuración general (1–10)

Sustituye al de §10.C del informe principal, con los ejes ampliados.

| Eje | Nota | Justificación | Para llegar a 10 |
|---|---|---|---|
| Arquitectura de la información | **4** | CG-01 (tres sitios y duplicados), CG-02 (alcances), CG-03 (cuentas troceadas), CG-04 (nombres), CG-05 (no configuración), CG-06, sin buscador | Estructura de §8.1 |
| Layout y distribución | **4** | 8 anchos, 5 cabeceras, 5 posiciones de acción, modal con 3.8 pantallas, Mi perfil desequilibrado (CG-08…CG-14) | Plantilla única de §8.2 |
| Completabilidad | 4 | CFG-03, CG-17, CG-18 | Solo lectura por permiso, *step-up* al guardar, explicar los bloqueos |
| Prevención y recuperación | 3 | CG-15, CG-16, CG-19, CG-20 | Un modelo de guardado, guardia de cambios, confirmación en lo sensible, restablecer |
| Consistencia | 3 | Mediciones de §3.1 | *Tokens* y componentes de sección comunes |
| Calidad visual | 5 | Cuidada sección a sección; CG-25, CG-26, CG-28 | Corregir tokens del tema claro, tablas y color semántico |
| Accesibilidad | 4 | CG-25 (1:1), CFG-04 (foco), CG-31 | Contraste, patrón de diálogo o página |
| Contenido e idioma | 5 | Textos excelentes en las ayudas; CG-04, CG-21, CG-27, CG-30, CFG-09 | Revisión editorial de rótulos y referencias |
| Responsive | 2 | CFG-01, CG-08 | Página completa con lista → detalle en móvil |
| Veracidad de datos | 8 | Datos reales y auditados; autoguardado sin señal (CG-15) | Indicador de guardado |
| Competitividad | 4 | Frente a QuickBooks, Zoho y BC (§1) | §8 |
| **Global** | **4** | Topada por completabilidad (4) | — |

---

## 8. La forma correcta

### 8.1 Arquitectura propuesta

Una página completa `/settings`. El modal se mantiene solo como atajo que lleva a ella. Arriba, un **buscador de ajustes** que indexa secciones, campos y sinónimos («NCF», «ITBIS», «tipo de cambio», «2FA»). Cuatro áreas por **alcance**, cada una con su insignia («Solo para ti», «Toda la empresa», «Administración»):

```
Ajustes                                      [🔍 Buscar un ajuste…            ]
├─ Mi cuenta (solo para ti)
│   Perfil · Seguridad de acceso (contraseña, 2FA, llaves, sesiones) · Preferencias (idioma, tema, densidad)
├─ Empresa (toda la empresa)
│   Perfil y datos fiscales · Marca (logo, color, tipografía) · Estructura (subsidiarias, sucursales)
│   Correo saliente · Suscripción y uso
├─ Contabilidad y fiscal
│   Cuentas predeterminadas (una pantalla, grupos plegables: Ventas · Compras · Caja · Impuestos ·
│     Inventario · Moneda · Cierre · Intercompañía)
│   Políticas (plazo de pago, tasa de cambio, conservación, contribuyente) · Numeración (secuencias
│     internas) · Comprobantes fiscales [según país] · Retenciones · Jurisdicciones [solo países con nexo]
│   → enlaces a: Impuestos y tasas · Monedas y tipos de cambio · Períodos · Diarios · Dimensiones
├─ Operaciones
│   Aprobaciones (políticas) → enlace a Flujos de trabajo · Inventario (valoración, stock negativo,
│     cuentas → atajo a «Cuentas predeterminadas › Inventario»)
└─ Administración
    Usuarios · Roles y permisos · Seguridad de la organización · Inicio de sesión único · Integraciones
    (una sola: extensiones, facturación electrónica, correo entrante, agentes de IA) · Inteligencia artificial
    → Pista de auditoría (informe propio)
```

### 8.2 Plantilla única de sección

```
┌─ Ajustes › Contabilidad y fiscal › Cuentas predeterminadas ───────── [Toda la empresa] ┐
│ Cuentas predeterminadas                                                              │
│ Las cuentas que el sistema usa cuando un documento no indica otra.  Historial ↗      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ▸ Ventas y cobros (5)   ▾ Inventario (4)   ▸ Moneda (1)  …                            │
│   Inventario*        [1140 — Inventarios          ▾]  Cuenta de activo. Por defecto: 1140 │
│   Ajustes de inv.*   [5150 — Ajustes de inventario▾]  Recibe faltantes… ⚠ Afecta a docs nuevos │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ● 2 cambios sin guardar                          [Restablecer] [Descartar] [Guardar] │ ← barra fija
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Reglas de la plantilla:**

- Un ancho de lectura (por ejemplo, 960 px), un margen y una cabecera (miga, título, subtítulo, insignia de alcance, enlace al historial).
- Grupos con el mismo componente.
- **Barra de guardado fija** que solo aparece con cambios. En las listas (usuarios, roles, rangos), la acción principal va en la cabecera y la edición se hace en un panel lateral.
- **Un solo modelo de guardado.** Si una sección autoguarda (preferencias personales), un indicador «Guardado ✓» bajo el título, como en BC.
- **Guardia de cambios** al salir por cualquier vía.
- **Permisos:** ocultar las secciones sin `view` y mostrar en solo lectura las que no tienen `edit`, con una nota («Necesitas el permiso Editar empresa»).
- *Step-up* solo al **guardar**.
- **Estados vacíos** con una única anatomía: icono, título, explicación y acción.
- **Tablas** con una única anatomía: tarjeta, búsqueda, filtros y paginación cuando hay más de 25 filas.
- **Móvil:** lista de áreas → secciones → detalle, con la barra de guardado fija abajo.

### 8.3 Orden de trabajo sugerido

1. **Arreglos de bajo coste y alto impacto:**
   - contraste del segmentado (CG-25);
   - guardia de cambios (CFG-02);
   - motivo del botón deshabilitado (CFG-03);
   - foco del diálogo (CFG-04);
   - «ADMINISTRATOR» (CG-27);
   - tabla de Roles (CG-26);
   - textos de CG-04, CG-21 y CG-30.
2. **Plantilla de sección y barra de guardado fija**, aplicadas a las 26 secciones (CG-09, CG-10, CG-13, CG-15).
3. **Permisos y *step-up*** (CG-17, CG-18).
4. **Reorganización** (CG-01, CG-02, CG-03, CG-05) y buscador.
5. **Página completa y responsive** (CG-08, CFG-01).

---

## 9. Cobertura de esta ampliación

| Verificación | Cubierto |
|---|---|
| 26 secciones: título, botones, campos, errores de red, mediciones de layout, capturas pliegue a pliegue | ✅ |
| Modelo de guardado: explícito (Perfil de la empresa, Políticas de inventario), por fila (Secuencias, validación), autoguardado (IA, verificado por red y revertido), inmediato (densidad, revertida) | ✅ |
| Permisos: Administrador y rol restringido (Contabilidad, Secuencias, Comprobantes, Perfil) | ✅ |
| Tema oscuro y 1366×768 (Contabilidad, Personalización, Seguridad, Roles) | ✅ |
| Móvil y tableta (Políticas de inventario) | ✅ (informe principal) |
| Atrás del navegador, recarga y enlaces profundos | ✅ |

**No cubierto:**

- Guardar en las 24 secciones restantes, para no alterar la configuración real: en Secuencias, Comprobantes y SSO un guardado tiene efectos fiscales o de acceso.
- El buscador global del portal como vía para encontrar ajustes.
- Otros países: el país no se puede cambiar.
- Lector de pantalla real.
- `prefers-reduced-motion`.
