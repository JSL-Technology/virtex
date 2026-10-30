# Antes y después: ventana de ajuste, Configuración general y POS

Correcciones de los hallazgos de [la auditoría de la ventana de ajuste](2026-10-AUDITORIA-VENTANA-DE-AJUSTE.md) (INV, AUD, CFG, POS) y de [la Configuración general](2026-10-AUDITORIA-CONFIGURACION-GENERAL.md) (CG), más el formato regional configurable pedido después. Cada par usa la misma pantalla, los mismos datos `QA-7734` y el mismo tamaño de ventana; los guiones están en `2026-10-ventana-de-ajuste/harness` y se repiten con `CAP_DIR=capturas-despues`.

## Qué cambió, por área

### Ajuste de inventario
- **Fechas y períodos (INV-02, INV-13):** sin fechas futuras; la fecha debe caer en un período abierto de contabilidad e inventario; ya no se crean ejercicios solos. El formulario lo dice al escribir la fecha.
- **Saldo cambiado entre el conteo y la contabilización (INV-01):** el servidor lo detecta y pide decidir: aplicar el conteo o mantener la diferencia.
- **Kárdex y asiento con la misma fecha (INV-03)**, movimiento de revaluación en el kárdex (INV-16) y valor guardado en cada movimiento (INV-15).
- **Reversa de un contabilizado (INV-04)** con su asiento, motivo y enlace entre documentos; la anulación registra quién y cuándo (INV-17).
- **Diferencia e impacto antes de contabilizar (INV-05, INV-09):** columnas de diferencia y valor, y faltantes, sobrantes y revaluación en líneas separadas del asiento.
- **Solo lectura real (INV-06, INV-07):** sin «Guardar» en contabilizados ni anulados, cifras como texto, aviso del permiso que falta.
- **Pérdida de trabajo (INV-08):** guardia al cancelar o cerrar la pestaña y recuperación del borrador tras recargar.
- **Errores en línea (INV-11, INV-12, INV-20)** con texto bajo cada campo, enlazados por `aria-describedby`; orden de líneas estable (INV-18); almacén precargado desde la ficha (INV-19); cifras con moneda (INV-21).

### Ajuste de auditoría
- **El 500 al proponer (AUD-01):** el cierre anual cerraba el estado del módulo GL y la contabilización lo exigía incluso con `allowClosedPeriod`. Corregido y probado.
- **Totales (AUD-02)** en céntimos con formato; línea con un solo lado (AUD-06); **ruta de aprobación** anunciada antes de proponer (AUD-03); página de detalle con asiento y evidencia (AUD-04); etiquetas accesibles (AUD-05); textos (AUD-08).

### Configuración general
- **Una sola fuente:** un registro declara cada sección (nombre, descripción, palabras clave, alcance, permisos, países); de él salen la barra lateral, el buscador, la cabecera y el título de la pestaña (CG-01, CG-04, CG-07, CFG-08).
- **Cabecera común** con ruta, título, descripción, alcance («Solo para ti», «Afecta a toda la empresa», «Administración») y acciones (CG-09, CG-10); **barra de guardado** fija que dice qué falta (CFG-03, CFG-05, CG-15).
- **Nada se pierde sin preguntar:** Escape, fondo, cierre y cambio de sección preguntan (CFG-02, CG-16); foco atrapado y devuelto (CFG-04); modo compacto bajo 900 px (CFG-01, CG-08).
- **Permisos:** solo se ofrece lo que se puede abrir y lo demás es de solo lectura con el nombre del permiso (CFG-06, CG-17); SSO pide verificación al cambiar, no al mirar (CFG-07, CG-18).
- **Cuentas predeterminadas y políticas contables:** seis secciones fusionadas en dos, con un guardado, confirmación y «Restablecer» (CG-03, CG-20, CFG-10); los enlaces antiguos siguen funcionando.
- **Preferencias y marca separadas**, la marca guardada en el servidor (CG-02); contraste del control segmentado (CG-25).
- **Secuencias** con un guardado y confirmación (CG-19); **pista de auditoría** propia, legible y en el formato del lector (CG-05, CG-29); **IA** con autoguardado visible, confirmación al enviar datos y trabajos que caducan con explicación (CG-15, CG-22); **extensiones**, **roles**, **usuarios**, **correo**, **retenciones**, **jurisdicciones** por país y estados vacíos comunes (CG-06, CG-12, CG-13, CG-21, CG-26, CG-27, CG-28, CG-30, CG-31).

### Formato regional (nuevo)
- La empresa fija un formato para todos y cada persona puede elegir el suyo por encima: orden y separador de fecha, miles y decimales, reloj de 12/24 h y primer día de la semana. Se aplica al mostrar y al escribir (campos de fecha y numéricos), a los mensajes del servidor y a las facturas (PDF y correo).

### POS
- Error en línea del identificador (POS-01), atajos en su propio diálogo con F1 (POS-02), «Caja principal» sin cambiar el identificador guardado (POS-03) y aviso de que los ajustes son de este equipo (POS-04).

## Verificación

- Cliente: 238 suites, 1.280 pruebas en verde; compilación de desarrollo sin errores; lint sin errores.
- Servidor: 265 suites, 3.406 pruebas en verde contra Postgres local (3 omitidas ya lo estaban en la rama base; tres pruebas desfasadas de la rama base se pusieron al día); `tsc` sin errores; migraciones aplicadas; `check:schema-drift` sin deriva nueva.
- POS: 37 pruebas en verde; compilación sin errores.
- i18n: `npm run i18n:verify` en verde (112 claves huérfanas podadas; prosa en TypeScript por debajo de la línea base).
- Accesibilidad: axe-core sin violaciones en la ventana de Configuración y en el formulario de ajuste de auditoría; foco atrapado (0 de 60 tabulaciones salen del diálogo).
- Datos de prueba solo locales y con prefijo `QA-7734`; el formato regional y las cuentas por defecto se restauraron tras las capturas.

## Comparaciones

### Ajuste de inventario

#### Formulario nuevo · INV-05 · INV-13 · INV-20

Secciones «Qué y cuándo» y «Líneas», período de la fecha comprobado al instante, columnas de existencia, diferencia, costos y valor estimado, y guardado o salida con guardia de cambios.

| Antes | Después |
|---|---|
| ![Formulario nuevo, antes](2026-10-ventana-de-ajuste/capturas/10-inv-nuevo-vacio.png) | ![Formulario nuevo, después](2026-10-ventana-de-ajuste/capturas-despues/10-inv-nuevo-vacio.png) |

#### Guardar vacío · INV-11 · INV-12 · INV-20

Cada problema con el nombre del campo y enlazado a él; el mensaje queda junto al campo con aria-describedby.

| Antes | Después |
|---|---|
| ![Guardar vacío, antes](2026-10-ventana-de-ajuste/capturas/11-inv-guardar-vacio.png) | ![Guardar vacío, después](2026-10-ventana-de-ajuste/capturas-despues/11-inv-guardar-vacio.png) |

#### Borrador con tres líneas · INV-05 · INV-10 · INV-18

La diferencia contada se calcula y se muestra con su signo; costo de entrada con el promedio como pista; valor estimado por línea y total.

| Antes | Después |
|---|---|
| ![Borrador con tres líneas, antes](2026-10-ventana-de-ajuste/capturas/12-inv-borrador-lleno.png) | ![Borrador con tres líneas, después](2026-10-ventana-de-ajuste/capturas-despues/12-inv-borrador-lleno.png) |

#### Confirmar contabilización · INV-05 · INV-09

El diálogo dice qué se moverá: faltantes, sobrantes, revaluación y efecto neto, y que el ajuste quedará cerrado.

| Antes | Después |
|---|---|
| ![Confirmar contabilización, antes](2026-10-ventana-de-ajuste/capturas/14-inv-confirmar-contabilizar.png) | ![Confirmar contabilización, después](2026-10-ventana-de-ajuste/capturas-despues/14-inv-confirmar-contabilizar.png) |

#### Ajuste contabilizado · INV-07 · INV-09 · INV-17 · INV-21

Solo lectura de verdad: las cifras se leen como texto, quién creó y contabilizó, impacto contabilizado por naturaleza y acción «Revertir».

| Antes | Después |
|---|---|
| ![Ajuste contabilizado, antes](2026-10-ventana-de-ajuste/capturas/15-inv-contabilizado.png) | ![Ajuste contabilizado, después](2026-10-ventana-de-ajuste/capturas-despues/15-inv-contabilizado.png) |

#### Guardar sobre un contabilizado · INV-07

No hay botón «Guardar» en un documento contabilizado ni campos que inviten a editarlo.

| Antes | Después |
|---|---|
| ![Guardar sobre un contabilizado, antes](2026-10-ventana-de-ajuste/capturas/16-inv-guardar-sobre-contabilizado.png) | ![Guardar sobre un contabilizado, después](2026-10-ventana-de-ajuste/capturas-despues/16-inv-guardar-sobre-contabilizado.png) |

#### Existencia cambiada por otra sesión · INV-01

El servidor detecta el saldo cambiado y pide decidir (aplicar el conteo o mantener la diferencia) en vez de contabilizar con una existencia vieja.

| Antes | Después |
|---|---|
| ![Existencia cambiada por otra sesión, antes](2026-10-ventana-de-ajuste/capturas/22-inv-obsoleto-despues.png) | ![Existencia cambiada por otra sesión, después](2026-10-ventana-de-ajuste/capturas-despues/22-inv-obsoleto-despues.png) |

#### Fecha en un ejercicio cerrado · INV-02 · INV-13

El formulario avisa al escribir la fecha: «El período Junio 2019 está cerrado». Antes se creaba el borrador y se abría un ejercicio solo.

| Antes | Después |
|---|---|
| ![Fecha en un ejercicio cerrado, antes](2026-10-ventana-de-ajuste/capturas/26-inv-fecha-2019-borrador.png) | ![Fecha en un ejercicio cerrado, después](2026-10-ventana-de-ajuste/capturas-despues/26-inv-fecha-2019-borrador.png) |

#### Fecha futura · INV-02

«La fecha 10/08/2031 es posterior a hoy (30/10/2026)», en el formato del lector; la API también la rechaza.

| Antes | Después |
|---|---|
| ![Fecha futura, antes](2026-10-ventana-de-ajuste/capturas/27-inv-periodo-cerrado.png) | ![Fecha futura, después](2026-10-ventana-de-ajuste/capturas-despues/27-inv-periodo-cerrado.png) |

#### Anular y revertir · INV-04 · INV-17

El anulado dice quién y cuándo. Un contabilizado ahora se revierte con su propio asiento, motivo y enlace entre ambos documentos.

| Antes | Después |
|---|---|
| ![Anular y revertir, antes](2026-10-ventana-de-ajuste/capturas/29-inv-anulado.png) | ![Anular y revertir, después](2026-10-ventana-de-ajuste/capturas-despues/29-inv-anulado.png) ![Anular y revertir, después](2026-10-ventana-de-ajuste/capturas-despues/34-inv-revertir-dialogo.png) ![Anular y revertir, después](2026-10-ventana-de-ajuste/capturas-despues/35-inv-revertido.png) |

#### Cancelar con cambios · INV-08

Cancelar pregunta: guardar, descartar o seguir. El borrador se recupera tras una recarga.

| Antes | Después |
|---|---|
| ![Cancelar con cambios, antes](2026-10-ventana-de-ajuste/capturas/59-inv-cancelar-sucio.png) | ![Cancelar con cambios, después](2026-10-ventana-de-ajuste/capturas-despues/59-inv-cancelar-sucio.png) |

#### Recarga con cambios sin guardar · INV-08

Antes la recarga perdía el borrador. Ahora ofrece recuperar los cambios guardados en el navegador, con su fecha, o descartarlos.

| Antes | Después |
|---|---|
| ![Recarga con cambios sin guardar, antes](2026-10-ventana-de-ajuste/capturas/58-inv-tras-recarga.png) | ![Recarga con cambios sin guardar, después](2026-10-ventana-de-ajuste/capturas-despues/58-inv-tras-recarga.png) |

#### Móvil · INV-20 · CFG-01

Los campos se apilan a una columna con su mensaje debajo; la tabla de líneas se desplaza dentro de su propio contenedor sin ensanchar la página.

| Antes | Después |
|---|---|
| ![Móvil, antes](2026-10-ventana-de-ajuste/capturas/50-inv-movil.png) | ![Móvil, después](2026-10-ventana-de-ajuste/capturas-despues/50-inv-movil.png) |

#### Tema oscuro · INV-23

Colores de signo, estados y cifras desde los tokens del tema, legibles en oscuro.

| Antes | Después |
|---|---|
| ![Tema oscuro, antes](2026-10-ventana-de-ajuste/capturas/55-inv-oscuro.png) | ![Tema oscuro, después](2026-10-ventana-de-ajuste/capturas-despues/55-inv-oscuro.png) |

#### Abrir desde la ficha del producto · INV-19

Llega con el producto y con el almacén donde está (no el predeterminado), y la línea muestra su existencia allí.

| Antes | Después |
|---|---|
| ![Abrir desde la ficha del producto, antes](2026-10-ventana-de-ajuste/capturas/33-inv-desde-producto.png) | ![Abrir desde la ficha del producto, después](2026-10-ventana-de-ajuste/capturas-despues/33-inv-desde-producto.png) |

#### Rol de solo consulta · INV-06

Quien solo puede ver existencias no recibe un formulario editable ni botones que fallarían.

| Antes | Después |
|---|---|
| ![Rol de solo consulta, antes](2026-10-ventana-de-ajuste/capturas/62-restringido-borrador.png) | ![Rol de solo consulta, después](2026-10-ventana-de-ajuste/capturas-despues/62-restringido-borrador.png) |

### Ajuste de auditoría

#### Formulario con ejercicio cerrado · AUD-04 · AUD-05 · AUD-06

Totales en céntimos, validación de línea con un solo lado y aviso cuando no hay ejercicios cerrados.

| Antes | Después |
|---|---|
| ![Formulario con ejercicio cerrado, antes](2026-10-ventana-de-ajuste/capturas/71-aud-form-cerrado.png) | ![Formulario con ejercicio cerrado, después](2026-10-ventana-de-ajuste/capturas-despues/71-aud-form-cerrado.png) |

#### Problemas antes de guardar · AUD-02 · AUD-06 · AUD-08

Cada problema nombra su línea («Cuenta es obligatorio (línea 2)») y el descuadre se dice con su importe.

| Antes | Después |
|---|---|
| ![Problemas antes de guardar, antes](2026-10-ventana-de-ajuste/capturas/73-aud-problemas-cerrado.png) | ![Problemas antes de guardar, después](2026-10-ventana-de-ajuste/capturas-despues/73-aud-problemas-cerrado.png) |

#### Proponer · AUD-01 · AUD-03 · AUD-04

Antes: error 500. Ahora dice la ruta de aprobación antes de enviar y abre el detalle del ajuste contabilizado en el ejercicio cerrado, con su asiento.

| Antes | Después |
|---|---|
| ![Proponer, antes](2026-10-ventana-de-ajuste/capturas/75-aud-tras-proponer.png) | ![Proponer, después](2026-10-ventana-de-ajuste/capturas-despues/74b-aud-ruta-aprobacion.png) ![Proponer, después](2026-10-ventana-de-ajuste/capturas-despues/75-aud-tras-proponer.png) |

### Configuración

#### Abrir la configuración · CFG-04 · CG-01 · CG-07 · CG-09

Buscador, grupos por quién afecta, cabecera común (ruta, título, descripción, alcance), foco en el título y título de pestaña.

| Antes | Después |
|---|---|
| ![Abrir la configuración, antes](2026-10-ventana-de-ajuste/capturas/81-config-abierta.png) | ![Abrir la configuración, después](2026-10-ventana-de-ajuste/capturas-despues/81-config-abierta.png) |

#### Cuentas predeterminadas · CG-03 · CFG-10

Seis secciones en una, con un solo guardado, confirmación del cambio de cuentas y «Restablecer» cuando difiere de la predeterminada. Los enlaces antiguos siguen llevando aquí.

| Antes | Después |
|---|---|
| ![Cuentas predeterminadas, antes](2026-10-ventana-de-ajuste/capturas/82-config-politicas-inventario.png) | ![Cuentas predeterminadas, después](2026-10-ventana-de-ajuste/capturas-despues/82-config-cuentas-predeterminadas.png) |

#### Escape con cambios sin guardar · CFG-02 · CG-16

Antes se cerraba y se perdía el cambio. Ahora pregunta: cancelar, descartar o guardar.

| Antes | Después |
|---|---|
| ![Escape con cambios sin guardar, antes](2026-10-ventana-de-ajuste/capturas/84-config-tras-escape.png) | ![Escape con cambios sin guardar, después](2026-10-ventana-de-ajuste/capturas-despues/84-config-tras-escape.png) |

#### Móvil · CFG-01 · CG-08

La lista y la sección se turnan; la sección usa todo el ancho en vez de 105 px.

| Antes | Después |
|---|---|
| ![Móvil, antes](2026-10-ventana-de-ajuste/capturas/86-config-movil.png) | ![Móvil, después](2026-10-ventana-de-ajuste/capturas-despues/C-cfg-movil.png) ![Móvil, después](2026-10-ventana-de-ajuste/capturas-despues/C-cfg-movil-lista.png) |

#### Usuario restringido · CFG-06 · CG-17

Solo ve lo que puede abrir (8 secciones en vez de 17) y una sección pedida por enlace dice que no está disponible para su rol.

| Antes | Después |
|---|---|
| ![Usuario restringido, antes](2026-10-ventana-de-ajuste/capturas/C-restringido.png) | ![Usuario restringido, después](2026-10-ventana-de-ajuste/capturas-despues/C-restringido.png) ![Usuario restringido, después](2026-10-ventana-de-ajuste/capturas-despues/Y-restringido-accounting.png) |

#### Perfil de la empresa · CFG-03

La barra de guardado dice qué falta para poder guardar en lugar de un botón gris sin explicación.

| Antes | Después |
|---|---|
| ![Perfil de la empresa, antes](2026-10-ventana-de-ajuste/capturas/C-perfil-guardar-deshabilitado.png) | ![Perfil de la empresa, después](2026-10-ventana-de-ajuste/capturas-despues/config/05-profile-pliegue.png) |

#### Preferencias y marca · CG-02 · CG-25

Preferencias personales (inmediatas) separadas de la marca de la empresa (guardada en el servidor para todos). La opción elegida se ve en tema claro.

| Antes | Después |
|---|---|
| ![Preferencias y marca, antes](2026-10-ventana-de-ajuste/capturas/config/07-personalizacion-p1.png) | ![Preferencias y marca, después](2026-10-ventana-de-ajuste/capturas-despues/config/03-preferences-pliegue.png) ![Preferencias y marca, después](2026-10-ventana-de-ajuste/capturas-despues/config/07-branding-pliegue.png) |

#### Numeración de documentos · CG-04 · CG-15 · CG-19

Un nombre que coincide con su contenido, un solo guardado en vez de cinco y confirmación con el antes y el después de cada serie.

| Antes | Después |
|---|---|
| ![Numeración de documentos, antes](2026-10-ventana-de-ajuste/capturas/config/16-secuencias-p1.png) | ![Numeración de documentos, después](2026-10-ventana-de-ajuste/capturas-despues/C-secuencias-cambio.png) ![Numeración de documentos, después](2026-10-ventana-de-ajuste/capturas-despues/C-secuencias-confirmar.png) |

#### Seguridad y pista de auditoría · CG-05 · CG-29

Política y pista como secciones distintas. La pista nombra el registro, oculta por defecto el trabajo del sistema, prescinde de la IP vacía y escribe las fechas en el formato del lector.

| Antes | Después |
|---|---|
| ![Seguridad y pista de auditoría, antes](2026-10-ventana-de-ajuste/capturas/config/21-seguridad-y-auditoria-p2.png) | ![Seguridad y pista de auditoría, después](2026-10-ventana-de-ajuste/capturas-despues/21-politica-seguridad.png) ![Seguridad y pista de auditoría, después](2026-10-ventana-de-ajuste/capturas-despues/21-pista-auditoria.png) |

#### SSO sin pedir contraseña para mirar · CFG-07 · CG-18

La verificación de seguridad se pide al cambiar, no al abrir. El requisito de dominio se muestra como aviso informativo, no en verde de éxito.

| Antes | Después |
|---|---|
| ![SSO sin pedir contraseña para mirar, antes](2026-10-ventana-de-ajuste/capturas/config/24-sso-stepup.png) | ![SSO sin pedir contraseña para mirar, después](2026-10-ventana-de-ajuste/capturas-despues/config/16-sso-pliegue.png) |

#### Integraciones · CG-12 · CG-18

La tarjeta SSO ya no dice «Sin acceso» al administrador y los bloques tienen separación.

| Antes | Después |
|---|---|
| ![Integraciones, antes](2026-10-ventana-de-ajuste/capturas/config/22-integraciones-p1.png) | ![Integraciones, después](2026-10-ventana-de-ajuste/capturas-despues/config/17-integrations-pliegue.png) |

#### Inteligencia artificial · CG-15 · CG-22

Lo que la empresa permite va primero y dice que se guarda solo. Activar el envío de datos pide confirmación. Los trabajos que el motor no toma caducan y se explican.

| Antes | Después |
|---|---|
| ![Inteligencia artificial, antes](2026-10-ventana-de-ajuste/capturas/config/25-inteligencia-artificial-p1.png) | ![Inteligencia artificial, después](2026-10-ventana-de-ajuste/capturas-despues/config/18-ai-pliegue.png) |

#### Extensiones · CG-21

Sin título duplicado, el estado vacío dice dónde registrar («debajo de esta lista») y el aislamiento explica para qué sirve.

| Antes | Después |
|---|---|
| ![Extensiones, antes](2026-10-ventana-de-ajuste/capturas/config/26-extensiones-p1.png) | ![Extensiones, después](2026-10-ventana-de-ajuste/capturas-despues/config/19-extensions-pliegue.png) |

#### Roles y permisos · CG-26 · CG-31

Las líneas de la tabla son continuas y los botones bloqueados dicen por qué («los roles del sistema no se editan: duplícalo»).

| Antes | Después |
|---|---|
| ![Roles y permisos, antes](2026-10-ventana-de-ajuste/capturas/config/20-roles-y-permisos-p1.png) | ![Roles y permisos, después](2026-10-ventana-de-ajuste/capturas-despues/config/13-roles-pliegue.png) |

#### Usuarios · CG-27

El rol se lee «Administrador», no «ADMINISTRATOR».

| Antes | Después |
|---|---|
| ![Usuarios, antes](2026-10-ventana-de-ajuste/capturas/config/19-usuarios-p1.png) | ![Usuarios, después](2026-10-ventana-de-ajuste/capturas-despues/config/12-users-pliegue.png) |

#### Correo saliente · CG-28

«Las respuestas no llegarán a nadie» aparece como advertencia, no como texto normal.

| Antes | Después |
|---|---|
| ![Correo saliente, antes](2026-10-ventana-de-ajuste/capturas/config/23-correo-saliente-p1.png) | ![Correo saliente, después](2026-10-ventana-de-ajuste/capturas-despues/config/10-smtp-pliegue.png) |

#### Retenciones · CG-05 · CG-13

La matriz de cobertura del producto va plegada al pie, como en Comprobantes fiscales, y el estado vacío es el común.

| Antes | Después |
|---|---|
| ![Retenciones, antes](2026-10-ventana-de-ajuste/capturas/config/14-retenciones-p1.png) | ![Retenciones, después](2026-10-ventana-de-ajuste/capturas-despues/config/23-withholding-regimes-pliegue.png) |

### Formato regional (nuevo)

#### Fechas, separadores decimales y hora · Pedido

No existía. Ahora la empresa fija un formato para todos y cada persona puede elegir el suyo: orden y separador de fecha, miles y decimales, reloj y primer día de la semana, con vista previa. Se aplica al mostrar y al escribir en toda la aplicación y en las facturas.

| Antes | Después |
|---|---|
| ![Fechas, separadores decimales y hora, antes](2026-10-ventana-de-ajuste/capturas/config/07-personalizacion-p1.png) | ![Fechas, separadores decimales y hora, después](2026-10-ventana-de-ajuste/capturas-despues/R-formato-empresa.png) ![Fechas, separadores decimales y hora, después](2026-10-ventana-de-ajuste/capturas-despues/R-preferencias-formato-elegido.png) ![Fechas, separadores decimales y hora, después](2026-10-ventana-de-ajuste/capturas-despues/R-existencias-con-formato.png) |

### POS

#### Ajustes de la caja · POS-01 · POS-02 · POS-04

El identificador inválido dice por qué bajo el campo, los atajos están en su propio diálogo (F1) y se aclara que los ajustes son de este equipo.

| Antes | Después |
|---|---|
| ![Ajustes de la caja, antes](2026-10-ventana-de-ajuste/capturas/92-pos-ajustes-invalido.png) | ![Ajustes de la caja, después](2026-10-ventana-de-ajuste/capturas-despues/92-pos-ajustes-invalido.png) |

#### Caja predeterminada · POS-03

«Caja principal» en lugar de «Caja main»; el identificador guardado no cambia y los turnos existentes siguen asociados.

| Antes | Después |
|---|---|
| ![Caja predeterminada, antes](2026-10-ventana-de-ajuste/capturas/90-pos-terminal.png) | ![Caja predeterminada, después](2026-10-ventana-de-ajuste/capturas-despues/90-pos-terminal.png) |
