# Reevaluación de la modal de Configuración: UX y UI

**Fecha:** 2026-11-07 · **Rama:** `ccr-dfd589ce-gjq30q` · **Estándar:** v0.1, el mismo de la evaluación · **Evaluación anterior:** [6,8 / 10](2026-11-EVALUACION-MODAL-CONFIGURACION.md)

**Objeto.** El mismo que en la evaluación: la modal que se abre con `#settings/<página>`, con su armazón y las **25 páginas** que ve una empresa de República Dominicana.

**Método.** El mismo arnés y la misma fórmula de la evaluación ([`harness/`](2026-11-modal-configuracion/harness/)), con cuatro añadidos:
- **EST-02**, que antes no se pudo verificar. En cada página, las peticiones de datos de la página fallan como si no hubiera red; la sesión, las traducciones y los recursos estáticos siguen pasando. Se comprueba que aparece el error con «Reintentar» y que, al reintentar con la red sana, la página se recupera.
- **PERM-01**, que tampoco se pudo verificar. La sesión se sustituye por una con todos los permisos de lectura y ninguno de gestión. Se recorren las 20 páginas de Empresa y Administración.
- **GUA-01 ampliada.** 16 casos en lugar de 10, uno por formulario o editor, cada uno con las cuatro salidas: Escape, la X, el fondo y otra página.
- **Revisión visual de todas las capturas de teléfono, de los diálogos y de los estados de error.** Encontró ocho defectos que la evaluación no había visto (R01–R08). También se corrigieron.

**Condiciones.** Las mismas de la evaluación:
- tema claro y oscuro;
- densidad cómoda y compacta;
- 1440 × 900, 1366 × 768 y 390 × 844 (táctil);
- recorrido completo con el tabulador en cada página;
- 13 búsquedas.

**Qué no se hizo.**
- No se guardaron cambios de configuración ni se crearon registros: las pruebas descartan lo que escriben.
- La empresa sigue siendo nueva, así que listas como Sucursales o Retenciones se ven vacías.

**Evidencia.**
- **Antes:** las capturas de la evaluación, en [`capturas/`](2026-11-modal-configuracion/capturas/), señaladas en rojo.
- **Después:** [`despues/`](2026-11-modal-configuracion/despues/), con lo corregido señalado en verde, a doble densidad.
- **Defectos nuevos (antes):** [`reevaluacion-antes/`](2026-11-modal-configuracion/reevaluacion-antes/).
- **EST-02, PERM-01 y GUA-01:** una captura por página en [`est02/`](2026-11-modal-configuracion/est02/), [`perm01/`](2026-11-modal-configuracion/perm01/) y [`gua01/`](2026-11-modal-configuracion/gua01/).
- **Mediciones:** [`resultados-reevaluacion/`](2026-11-modal-configuracion/resultados-reevaluacion/).

---

## Resumen

### Nota: **10 / 10** (definitiva)

| | Evaluación | Reevaluación |
|---|---|---|
| Cumplimiento ponderado | 68,1 % (72,9 de 107 puntos) | **100 % (113 de 113 puntos)** |
| Cobertura | 41 de 43 reglas (95 %) | **43 de 43 reglas (100 %)** |
| Tope por severidad | 7 (había hallazgos altos) | **Ninguno** (no queda ningún hallazgo abierto) |
| Hallazgos abiertos | 4 altos · 12 medios · 10 bajos | **0** (26 de la evaluación y 8 nuevos, todos corregidos) |

**Qué cambió.** El interior de las páginas ya sigue un solo patrón por función, construido sobre piezas comunes:
- **Grupo** (`vx-settings-group`): título y espacio, dos niveles de título y sin tarjetas.
- **Guardado:** una barra común que pregunta al salir con cambios. Lo personal se guarda solo y lo dice. Los editores de un registro llevan su propio botón y también preguntan al salir.
- **Estados:** vacío (`vx-empty-state`), error con reintento (`vx-error-state`) y carga (`vx-spinner`).
- **Avisos** (`vx-notice`) y etiquetas de estado (`vx-badge`), con el color según el significado.
- **Acciones de fila:** «Editar» a la vista y el resto en el menú compartido.
- **Controles:** subida de archivos (`vx-file-button`), desplegable (`vx-settings-disclosure`), paginación (`vx-pager`) y diálogo (`vx-dialog`).

Sobre esas piezas desaparecieron los dos caminos por los que se perdían cambios sin aviso, los cuatro fallos de accesibilidad y las ocho inconsistencias globales.

**Lo que se comprobó.** Todo lo que sigue está medido en la pasada final, sobre el código que se publica:
- **Accesibilidad:** 0 violaciones de axe (WCAG 2.2 AA) en las 25 páginas, en las cinco condiciones, y 0 en los diálogos abiertos.
- **Foco:** 0 fugas en las 25 páginas y en los diálogos.
- **Cambios sin guardar (GUA-01):** 16 de 16 casos, con las cuatro salidas.
- **Carga y error (EST-02):** 23 de 23 páginas aplicables.
- **Solo lectura (PERM-01):** 12 de 12 páginas aplicables.
- **Red:** 0 errores HTTP.

---

## Antes y después, hallazgo por hallazgo

Cada hallazgo de la evaluación con lo que se cambió, cómo se comprobó y su evidencia. A la izquierda, la captura de la evaluación (en rojo); a la derecha, la misma vista ahora (en verde).

### Altos

#### H01 · Correo saliente descartaba los cambios sin avisar → corregido
**Regla:** GUA-01

- **Qué se hizo.** La página registra sus cambios en el armazón y usa la barra de guardado común. Escape, la X, el fondo y el cambio de página preguntan antes de cerrar.
- **Comprobación.** Caso `smtp` de la prueba de cambios: aparece la barra, Escape pregunta, «Seguir editando» conserva el valor escrito y cerrar también pregunta.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H01-a-correo-con-cambios.png) | ![](2026-11-modal-configuracion/despues/A-H01-a-correo-con-cambios-barra.png) |
| ![](2026-11-modal-configuracion/capturas/H01-b-correo-tras-escape.png) | ![](2026-11-modal-configuracion/despues/A-H01-b-correo-escape-pregunta.png) |
| ![](2026-11-modal-configuracion/capturas/H01-c-correo-reabierta-vacia.png) | ![](2026-11-modal-configuracion/despues/A-H01-c-correo-valor-conservado.png) |

#### H02 · Texto de acento ilegible en tema oscuro → corregido
**Regla:** A11Y-01

- **Qué se hizo.** La insignia de rol, los botones secundarios y la vista previa de Marca usan el token de texto de acento, que se ajusta al tema, y no el de relleno.
- **Comprobación.** axe sin ningún fallo de `color-contrast` en tema oscuro en las 25 páginas.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H02-a-contraste-oscuro-mi-perfil.png) | ![](2026-11-modal-configuracion/despues/A-H02-a-oscuro-mi-perfil.png) |
| ![](2026-11-modal-configuracion/capturas/H02-b-contraste-oscuro-marca.png) | ![](2026-11-modal-configuracion/despues/A-H02-b-oscuro-vista-previa.png) |

#### H03 · Usuarios: controles sin nombre accesible → corregido
**Reglas:** A11Y-02, ACC-02

- **Qué se hizo.**
  - El botón de actualizar se anuncia como «Actualizar» y el «…» de cada fila como «Más acciones para Dev User».
  - Las dos casillas de selección no hacían nada: no existe ninguna acción en lote. Por eso se quitaron en vez de etiquetarlas (ACC-02: ningún control visible sin acción real).
- **Comprobación.** axe sin `button-name` ni `label` en Usuarios en las cinco condiciones. Ningún botón de la página queda sin nombre accesible.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H03-usuarios-sin-nombre-accesible.png) | ![](2026-11-modal-configuracion/despues/A-H03-usuarios-nombres-accesibles.png) |

#### H04 · El foco caía donde no se ve → corregido
**Reglas:** A11Y-03, A11Y-02

- **Qué se hizo.**
  - **Seguridad de la cuenta.** El campo oculto para los gestores de contraseñas ya no recibe el foco (`tabindex="-1"` y `aria-hidden`). La primera parada del tabulador es «Contraseña actual» (a).
  - **Subida de archivos.** Foto, logo y certificado usan el mismo componente (`vx-file-button`). Pinta el anillo de foco en el botón visible mientras el campo de archivo, oculto, tiene el foco (b, c, d).
- **Comprobación.** Recorrido con el tabulador en las 25 páginas: 0 fugas y 0 paradas tapadas. La detección automática marca dos casos que no son fallos, porque el anillo lo pinta otro elemento; se confirmaron en captura:
  - los selectores de cuenta (e), donde el anillo lo pinta su contenedor;
  - las tarjetas de plan (f), donde lo pinta la tarjeta del radio.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H04-a-foco-en-campo-oculto.png) | ![](2026-11-modal-configuracion/despues/A-H04-a-primer-foco-contrasena-actual.png) |
| ![](2026-11-modal-configuracion/capturas/H04-b-foco-invisible-subir-foto.png) | ![](2026-11-modal-configuracion/despues/A-H04-b-foco-visible-subir-foto.png) |
| ![](2026-11-modal-configuracion/capturas/H04-c-foco-invisible-subir-logo.png) | ![](2026-11-modal-configuracion/despues/A-H04-c-foco-visible-subir-logo.png) |
| ![](2026-11-modal-configuracion/capturas/H04-d-asi-si-foco-visible-certificado.png) | ![](2026-11-modal-configuracion/despues/A-H04-d-foco-visible-certificado.png) |

| Selector de cuenta (e) | Tarjeta de plan (f) |
|---|---|
| ![](2026-11-modal-configuracion/despues/A-H04-e-foco-visible-selector-de-cuenta.png) | ![](2026-11-modal-configuracion/despues/A-H04-f-foco-visible-plan.png) |

### Medios

#### H05 · Inteligencia artificial: el autoguardado no guardaba al cerrar con Escape → corregido
**Regla:** GUA-01

- **Qué se hizo.** La política de IA es configuración de la empresa, no una preferencia personal. Por eso pasa al modelo común: la barra de guardado aparece con el primer cambio y Escape pregunta. Activar el envío de datos o mostrar los identificadores pide confirmación antes de guardar.
- **Comprobación.** Casos `ai` y `ai-agents` de la prueba de cambios: los dos cumplen.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H05-a-ia-valor-escrito.png) | ![](2026-11-modal-configuracion/despues/A-H05-a-ia-barra-de-guardado.png) |
| ![](2026-11-modal-configuracion/capturas/H05-b-ia-reabierta-valor-anterior.png) | ![](2026-11-modal-configuracion/despues/A-H05-b-ia-escape-pregunta.png) |

#### H06 · Más de una acción primaria a la vez → corregido
**Regla:** ACC-01

- **Qué se hizo.**
  - **Seguridad de la cuenta.** «Actualizar contraseña», el envío del formulario principal, es la única primaria. «Activar», «Agregar llave de acceso» y «Cerrar las demás sesiones» son secundarias.
  - **Comprobantes fiscales.** «Registrar rango» y «Subir certificado» son secundarias. Las dos son botones de editores de registro dentro de la página.
  - **Acción duplicada.** Mientras la lista está vacía, la llamada a crear vive solo en el estado vacío y la cabecera no la repite. Así ocurre en Estructura empresarial, Sucursales, Retenciones y Aprobaciones.
- **Comprobación.** Ninguna página tiene más de una primaria habilitada, ni a 1440 px ni en el teléfono.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H06-a-dos-primarias-seguridad.png) | ![](2026-11-modal-configuracion/despues/A-H06-a-seguridad-sin-primarias-duplicadas.png) |
| ![](2026-11-modal-configuracion/capturas/H06-b-primaria-duplicada-estructura.png) | ![](2026-11-modal-configuracion/despues/A-H06-b-estructura-una-primaria.png) |

#### H07 · Títulos de grupo: seis estilos y jerarquía invertida → corregido
**Reglas:** TIP-01, JER-02

- **Qué se hizo.** El título de grupo sale de un solo componente, con dos estilos: grupo (h2, 17 px / 600) y subgrupo (h3, 14 px / 600). El nombre de la persona en Mi perfil deja de ser un segundo h1.
- **Comprobación.**
  - En las 25 páginas solo hay esos dos estilos de título, y ningún subnivel es mayor que su nivel.
  - Cada vista tiene un único h1, el título de la página (24 px / 700).

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H07-a-h3-mayor-que-h2.png) | ![](2026-11-modal-configuracion/despues/A-H07-a-titulos-de-grupo-iguales.png) |
| ![](2026-11-modal-configuracion/capturas/H07-b-h2-de-dos-tamanos.png) | ![](2026-11-modal-configuracion/despues/A-H07-b-grupo-h2-subgrupo-h3.png) |
| ![](2026-11-modal-configuracion/capturas/H07-c-dos-h1.png) | ![](2026-11-modal-configuracion/despues/A-H07-c-un-solo-h1.png) |

#### H08 · Cuatro tipos de tarjeta, con sombras y radios distintos → corregido
**Reglas:** CON-02, SOM-01, RAD-01, CON-01

- **Qué se hizo.** Los grupos son título y espacio (`vx-settings-group`), sin tarjeta ni sombra. Solo quedan contenedores con borde para tres usos permitidos:
  - los avisos (`vx-notice`);
  - las vistas previas;
  - las opciones que se eligen como tarjeta, que son los planes.
- **Comprobación.** En las 25 páginas, y también en el teléfono, ningún contenedor de contenido tiene sombra.
  - Avisos y vistas previas comparten un radio de 6 px.
  - El único otro radio, 9,6 px, es la tarjeta de muestra de Marca: reproduce el radio que elige la empresa, y cambia al mover el control «Radio de bordes».

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H08-a-tarjeta-banda-gris-icono.png) | ![](2026-11-modal-configuracion/despues/A-H08-a-mi-perfil-sin-tarjetas.png) |
| ![](2026-11-modal-configuracion/capturas/H08-b-tarjeta-banda-gris-subtitulo.png) | ![](2026-11-modal-configuracion/despues/A-H08-b-perfil-empresa-sin-tarjetas.png) |
| ![](2026-11-modal-configuracion/capturas/H08-c-tarjeta-icono-circular.png) | ![](2026-11-modal-configuracion/despues/A-H08-c-seguridad-sin-tarjetas.png) |
| ![](2026-11-modal-configuracion/capturas/H08-d-tarjeta-cabecera-mayusculas.png) | ![](2026-11-modal-configuracion/despues/A-H08-d-facturacion-sin-tarjetas.png) |

#### H09 · Cuatro modelos de guardado → corregido
**Regla:** GUA-02

- **Qué se hizo.** Un modelo por tipo de cambio, decidido una vez y aplicado en todas las páginas:

  | Tipo de cambio | Modelo | Páginas |
  |---|---|---|
  | Configuración de la empresa o de la cuenta | Barra de guardado común: aparece con cambios, dice por qué no se puede guardar y pregunta al salir | Mi perfil, Perfil de la empresa, Formato regional, Marca, Correo saliente, Política de seguridad, IA, Integraciones, Cuentas predeterminadas, Políticas contables, Comprobantes fiscales, Numeración, Aprobaciones |
  | Preferencia personal | Se guarda sola y lo dice («Los cambios se guardan solos») | Preferencias |
  | Alta o edición de un registro | Botón propio del editor, que también pregunta al salir con cambios | Dominio y proveedor de SSO, rango y certificado fiscales, régimen de retención, cambio de contraseña, roles, usuarios |
  | Acción inmediata | Botón con confirmación proporcional | Sesiones, llaves de acceso, extensiones |

- **Justificación.** GUA-02 es DEBERÍA. Las dos excepciones a la barra son deliberadas:
  - una preferencia personal no necesita confirmarse;
  - un registro se crea o se edita como una unidad: no tiene sentido una barra que guarde a medias un rango fiscal.
- **Comprobación.** Los 16 casos de la prueba de cambios preguntan al salir, en los tres modelos con formulario.

| Política de seguridad | Comprobantes fiscales |
|---|---|
| ![](2026-11-modal-configuracion/despues/A-H09-politica-barra-de-guardado.png) | ![](2026-11-modal-configuracion/despues/A-H09-fiscal-barra-de-guardado.png) |

#### H10 · Cuatro patrones de estado vacío → corregido
**Regla:** EST-01

- **Qué se hizo.** Todos los vacíos usan el componente común, con icono, título, explicación y acción cuando la hay, y ninguno va dentro de una tarjeta. En la Pista de auditoría, el vacío que provoca el filtro por defecto lo dice y ofrece «Mostrar también las del sistema».
- **Comprobación.** Hay 11 estados vacíos en las 25 páginas, todos `vx-empty-state`.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H10-a-dos-vacios-en-sso.png) | ![](2026-11-modal-configuracion/despues/A-H10-a-sso-un-solo-vacio.png) |
| ![](2026-11-modal-configuracion/capturas/H10-b-vacio-texto-plano.png) | ![](2026-11-modal-configuracion/despues/A-H10-b-pista-de-auditoria.png) |
| ![](2026-11-modal-configuracion/capturas/H10-c-vacio-sin-titulo.png) | ![](2026-11-modal-configuracion/despues/A-H10-c-extensiones-vacio-comun.png) |

#### H11 · El mismo estado, distinto color → corregido
**Regla:** COL-01

- **Qué se hizo.**
  - Los estados salen de `vx-badge`, con el tono según el significado: «Activo», «Activa» y «Activada» son verdes en Usuarios, Plan y facturación e Integraciones.
  - Los avisos salen de `vx-notice`, con el mismo amarillo para lo que bloquea en Comprobantes fiscales y en Correo saliente.
- **Comprobación.** Revisión de las 25 páginas en los dos temas.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H11-a-activa-neutro.png) | ![](2026-11-modal-configuracion/despues/A-H11-a-activo-ok-usuarios.png) |
| ![](2026-11-modal-configuracion/capturas/H11-b-activo-verde.png) | ![](2026-11-modal-configuracion/despues/A-H11-b-activa-ok-facturacion.png) |
| ![](2026-11-modal-configuracion/capturas/H11-c-aviso-gris.png) | ![](2026-11-modal-configuracion/despues/A-H11-c-aviso-comun-fiscal.png) |
| ![](2026-11-modal-configuracion/capturas/H11-d-aviso-amarillo.png) | ![](2026-11-modal-configuracion/despues/A-H11-d-aviso-comun-correo.png) |

#### H12 · Clave de traducción a la vista → corregido
**Regla:** CONT-01

- **Qué se hizo.** La clave `ai.admin.state.engine_offline` existe en es, en y pt, y se declaró en las familias de claves compuestas para que el verificador del catálogo la vigile.
- **Comprobación.**
  - No queda ninguna clave cruda en las 25 páginas, en ninguna condición.
  - La consola no registra ninguna traducción que falte.
  - `npm run i18n:verify` pasa.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H12-clave-cruda-ia.png) | ![](2026-11-modal-configuracion/despues/A-H12-ia-sin-clave-cruda.png) |

#### H13 · Textos que se contradecían o se repetían → corregido
**Regla:** CONT-02

- **Qué se hizo.**
  - **Preferencias.** Dice una sola vez dónde se guarda cada grupo: el idioma y los formatos, en la cuenta; la apariencia, en este equipo (a, b). Bajo Idioma queda una sola ayuda (c).
  - **Repeticiones.** Política de seguridad (d), Aprobaciones (e), Numeración y SSO dejan de repetir lo que ya dice otro texto de la página.
- **Comprobación.** Lectura de las 25 páginas.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H13-a-preferencias-en-este-equipo.png) | ![](2026-11-modal-configuracion/despues/A-H13-ab-preferencias-dice-donde-se-guarda.png) |
| ![](2026-11-modal-configuracion/capturas/H13-c-ayuda-duplicada.png) | ![](2026-11-modal-configuracion/despues/A-H13-c-una-sola-ayuda-idioma.png) |
| ![](2026-11-modal-configuracion/capturas/H13-d-explicacion-repetida.png) | ![](2026-11-modal-configuracion/despues/A-H13-d-politica-sin-repeticion.png) |
| ![](2026-11-modal-configuracion/capturas/H13-e-titulo-y-cuerpo-repetidos.png) | ![](2026-11-modal-configuracion/despues/A-H13-e-aprobaciones-titulo-y-cuerpo-distintos.png) |

#### H14 · «Ajustes» en una modal que se llama «Configuración» → corregido
**Regla:** CONT-03

- **Qué se hizo.** El aviso de Comprobantes fiscales usa el nombre del país, que conoce, y lista lo que falta con enlaces directos: «Registrar un rango» lleva al formulario de la propia página y «Perfil de la empresa» abre esa página.
- **Comprobación.** Ningún texto de la modal dice «Ajustes». Los enlaces llevan a donde dicen.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H14-ajustes-en-vez-de-configuracion.png) | ![](2026-11-modal-configuracion/despues/A-H14-nombres-reales-y-enlaces.png) |

#### H15 · Patrones distintos para la misma función → corregido
**Regla:** COMP-01

- **Qué se hizo.** Un componente por función:

  | Función | Ahora |
  |---|---|
  | Acciones de fila | «Editar» (o «Ver») a la vista y el resto en el menú «…» compartido, en Usuarios, Roles, Sucursales, SSO y Aprobaciones |
  | Subir archivo | `vx-file-button` en Mi perfil, Marca y Comprobantes fiscales |
  | Control segmentado | Un solo mixin, a la medida de sus opciones, en Preferencias, Marca y Usuarios |
  | Desplegable | `vx-settings-disclosure` en Seguridad de la cuenta, Retenciones y Comprobantes fiscales |
  | Paginación y diálogo | `vx-pager` y `vx-dialog` (ver R05 y R07) |

- **Comprobación.** Revisión de las 25 páginas y de sus diálogos.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H15-a-roles-iconos-en-fila.png) | ![](2026-11-modal-configuracion/despues/A-H15-a-roles-acciones-de-fila.png) |
| ![](2026-11-modal-configuracion/capturas/H15-b-usuarios-menu-de-fila.png) | ![](2026-11-modal-configuracion/despues/A-H15-b-usuarios-acciones-de-fila.png) |

| Menú de fila compartido | Segmentados iguales |
|---|---|
| ![](2026-11-modal-configuracion/despues/A-H15-c-menu-de-fila-compartido.png) | ![](2026-11-modal-configuracion/despues/A-H15-d-segmentados-iguales.png) |

#### H16 · En móvil, Usuarios y Roles perdían columnas → corregido
**Regla:** RESP-01

- **Qué se hizo.**
  - Por debajo de 640 px, las tablas de la modal se leen como una lista: cada fila muestra cada dato con su nombre, y debajo sus acciones.
  - Los filtros de estado de Usuarios se ven todos (ver también R02).
- **Comprobación.** A 390 px, ninguna página desborda en horizontal ni corta un texto visible.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H16-a-movil-usuarios.png) | ![](2026-11-modal-configuracion/despues/A-H16-a-movil-usuarios.png) |
| ![](2026-11-modal-configuracion/capturas/H16-b-movil-roles.png) | ![](2026-11-modal-configuracion/despues/A-H16-b-movil-roles.png) |

### Bajos

#### H17 · Tarjetas pegadas → corregido
**Regla:** ESP-01

Un solo escalón entre grupos: 32 px entre grupos y 24 px entre subgrupos, que pone el componente de grupo. También se aplica cuando un grupo es el último de un panel incrustado (IA, Integraciones, Comprobantes fiscales).

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H17-tarjetas-pegadas.png) | ![](2026-11-modal-configuracion/despues/A-H17-separacion-uniforme.png) |

#### H18 · Alineación y agrupación → corregido
**Regla:** ALI-01

- **Seguridad de la cuenta.** El desplegable de sesiones arranca en el margen del contenido (a).
- **Pista de auditoría.** «Desde» y «Hasta» forman un grupo, el periodo (b).
- **IA.** Las ayudas quedan alineadas con su campo (c).

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H18-a-enlace-desalineado.png) | ![](2026-11-modal-configuracion/despues/A-H18-a-desplegable-alineado.png) |
| ![](2026-11-modal-configuracion/capturas/H18-b-desde-hasta-separados.png) | ![](2026-11-modal-configuracion/despues/A-H18-b-desde-y-hasta-juntos.png) |

![Ayudas alineadas en IA](2026-11-modal-configuracion/despues/A-H18-c-ayudas-alineadas-ia.png)

#### H19 · Controles de muestra que parecían reales → corregido
**Regla:** ACC-02

La vista previa de Marca es inerte (`inert`, `aria-hidden`): sus botones y su campo ya no reciben el foco ni el puntero.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H19-controles-de-muestra.png) | ![](2026-11-modal-configuracion/despues/A-H19-vista-previa-inerte.png) |

#### H20 · Acciones fuera de la cabecera → corregido
**Regla:** ACC-03

Extensiones pone «Abrir el gestor» y «Actualizar» en la cabecera, como las demás páginas.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H20-acciones-fuera-de-cabecera.png) | ![](2026-11-modal-configuracion/despues/A-H20-acciones-en-la-cabecera.png) |

#### H21 · Moneda en tres formatos → corregido
**Regla:** FMT-01

Un único formateador, el de la empresa: símbolo pegado y dos decimales. Ejemplos: «US$0.00 de US$200.00» en IA, «US$199.00 al mes» en Plan y «RD$1,234,567.89» en la vista previa.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H21-a-moneda-con-espacio.png) | ![](2026-11-modal-configuracion/despues/A-H21-a-moneda-ia.png) |
| ![](2026-11-modal-configuracion/capturas/H21-b-moneda-sin-decimales.png) | ![](2026-11-modal-configuracion/despues/A-H21-b-moneda-facturacion.png) |

#### H22 · Mayúsculas, minúsculas y cifras → corregido
**Reglas:** TIP-02, CONT-04, TIP-03

- **Mayúsculas.** Ninguna mayúscula sostenida en el contenido: «Plan actual», «Método de pago», «Administrador».
- **Minúsculas.** La lista de consumo va en estilo oración: «Facturas en el período», «Créditos de IA en el período».
- **Cifras.** Las cifras alineadas usan numerales tabulares (`font-variant-numeric: tabular-nums`).

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H22-a-mayusculas.png) | ![](2026-11-modal-configuracion/despues/A-H22-a-sin-mayusculas.png) |
| ![](2026-11-modal-configuracion/capturas/H22-b-minusculas-y-cifras.png) | ![](2026-11-modal-configuracion/despues/A-H22-b-consumo-estilo-oracion-y-cifras.png) |

#### H23 · Formularios: asterisco, etiquetas y anchos → corregido
**Reglas:** FORM-01, FORM-02

- **Asterisco.** El marcador de obligatorio tiene un solo estilo, el color de error, en toda la modal.
- **Etiquetas.** SSO («Dominio») y Extensiones tienen etiqueta visible. El texto de ejemplo queda como ejemplo.
- **Anchos.** Teléfono, Cargo, Nombre del remitente y los demás datos cortos miden lo que su dato. En una sola columna (teléfono) todos ocupan el ancho; ver R03.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H23-a-obligatorio-rojo.png) | ![](2026-11-modal-configuracion/despues/A-H23-a-obligatorio-uniforme.png) |
| ![](2026-11-modal-configuracion/capturas/H23-b-obligatorio-gris.png) | ![](2026-11-modal-configuracion/despues/A-H23-b-etiqueta-visible-sso.png) |
| ![](2026-11-modal-configuracion/capturas/H23-c-campos-ancho-completo.png) | ![](2026-11-modal-configuracion/despues/A-H23-c-anchos-por-dato.png) |

#### H24 · «Agregar dominio» deshabilitado sin motivo → corregido
**Regla:** COMP-02

El botón ya no está deshabilitado: al pulsarlo con el campo vacío o mal escrito, el campo dice qué falta. Lo mismo hacen ahora «Guardar» en el diálogo de roles (R06) y «Enviar invitación» en Usuarios (R07).

![«Agregar dominio» dice qué falta](2026-11-modal-configuracion/despues/A-H24-dominio-dice-que-falta.png)

#### H25 · Buscador: términos habituales con resultado incompleto → corregido
**Regla:** NAV-01

«firma» encuentra Comprobantes fiscales (el certificado de firma) y Extensiones. «impuestos» e «ITBIS» encuentran Cuentas predeterminadas, Comprobantes fiscales y Retenciones. Las 13 búsquedas dan el resultado esperado; «zona horaria» y «xyz123» siguen sin resultados porque esa configuración no existe.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H25-buscador-firma.png) | ![](2026-11-modal-configuracion/despues/A-H25-buscador-firma.png) |

#### H26 · Rejilla 3 + 1, accesos duplicados y operación dentro de Configuración → corregido
**Reglas:** ANT-01, ARQ-01

- **Integraciones.** Contiene solo lo que se configura ahí: el correo entrante y los agentes de IA conectados. Para la importación de datos queda un enlace. Desaparecen la rejilla y los accesos que repetían la barra lateral (a).
- **IA.** Se queda con la política, la disponibilidad y el consumo, y enlaza a la actividad (b). Las ejecuciones, las bitácoras de agentes y las propuestas del asistente son operación: viven en Análisis › Actividad de la IA (c), con su propio permiso (`ai_usage:view`).

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/capturas/H26-integraciones-3-mas-1.png) | ![](2026-11-modal-configuracion/despues/A-H26-a-integraciones-sin-duplicados.png) |

| IA enlaza la actividad | Actividad de la IA, en Análisis |
|---|---|
| ![](2026-11-modal-configuracion/despues/A-H26-b-ia-enlaza-la-actividad.png) | ![](2026-11-modal-configuracion/despues/A-H26-c-actividad-de-la-ia-en-analisis.png) |

---

## Defectos nuevos encontrados en la reevaluación

La revisión visual de todas las capturas de teléfono, de los diálogos y de los estados de error encontró ocho defectos que la evaluación no había visto. Ninguno estaba entre los 26 hallazgos, pero todos incumplían una regla del estándar. Se corrigieron antes de calcular la nota.

#### R01 · Casillas y radios de 44 px en pantallas táctiles
**Reglas:** COMP-01, RESP-01 · **Páginas:** Preferencias, Política de seguridad, Pista de auditoría, IA, Comprobantes fiscales

- **Qué pasaba.** Una regla global estiraba a 44 × 44 px todas las casillas y radios en dispositivos táctiles. El navegador dibuja el control del tamaño de su caja, así que en el teléfono salía un cuadro vacío enorme junto a su texto (1).
- **Corrección.** Los botones y enlaces conservan los 44 px. Las casillas y los radios crecen a 24 px, el mínimo de WCAG 2.5.8, y la etiqueta que los nombra amplía la zona táctil (`assets/styles/base/_a11y.scss`).
- **Comprobación.** En el teléfono, la casilla de «Alto contraste» y las de IA miden 24 × 24 px. axe 2.5.8 sigue sin fallos.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/reevaluacion-antes/R01-a-casilla-44px-preferencias.png) | ![](2026-11-modal-configuracion/despues/A-R01-a-casilla-24px-preferencias.png) |
| ![](2026-11-modal-configuracion/reevaluacion-antes/R01-b-casillas-44px-ia.png) | ![](2026-11-modal-configuracion/despues/A-R01-b-casillas-24px-ia.png) |

#### R02 · El control segmentado se partía en dos líneas con un hueco
**Reglas:** COMP-01, ALI-01 · **Página:** Usuarios (teléfono)

- **Qué pasaba.** A 390 px, «Bloqueado» bajaba a una segunda línea y dejaba un hueco a su derecha dentro del borde (1).
- **Corrección.** Las divisiones del segmentado son el fondo que asoma por un hueco de 1 px. Si las opciones no caben, cada línea se estira a todo el ancho y el bloque sigue siendo un rectángulo dividido. Es el mismo mixin para todos los segmentados.
- **Comprobación.** En el teléfono, la primera línea reparte sus cuatro opciones a todo el ancho y «Bloqueado» ocupa la segunda.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/reevaluacion-antes/R02-segmentado-partido-usuarios.png) | ![](2026-11-modal-configuracion/despues/A-R02-segmentado-ordenado-usuarios.png) |

#### R03 · Mi perfil en una columna: campos pegados y uno más estrecho
**Reglas:** ESP-01, FORM-02 · **Página:** Mi perfil (teléfono)

- **Qué pasaba.** En el teléfono, el último campo de cada pareja perdía su margen, así que «Correo electrónico» quedaba a 4 px de «Apellidos» e «Idioma preferido» pegado a «Cargo» (1, 2). Además, el campo corto de idioma medía 288 px junto a otros de 358 px (3).
- **Corrección.** La separación la pone la rejilla, con una columna y con dos. Los anchos por dato se aplican desde 640 px; en una columna, todos ocupan el ancho.
- **Comprobación.** En el teléfono, las separaciones entre campos miden 16 px y todos los campos miden 358 px.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/reevaluacion-antes/R03-espaciado-mi-perfil.png) | ![](2026-11-modal-configuracion/despues/A-R03-espaciado-uniforme-mi-perfil.png) |

#### R04 · Roles del sistema: un «Editar» gris en cada fila que no hacía nada
**Reglas:** COMP-02, ACC-02 · **Página:** Roles y permisos

- **Qué pasaba.** Los cuatro roles del sistema mostraban «Editar» deshabilitado (1, 2, 3). El motivo estaba en el nombre accesible y en un título emergente, que en un teléfono no existe: al tocarlo no pasaba nada. Además, quien no puede editar roles no tenía forma de ver qué permite cada uno.
- **Corrección.** Un rol del sistema, o cualquier rol para quien no tiene permiso de edición, ofrece «Ver». Abre el rol en solo lectura: el aviso de por qué no se edita, la descripción y la lista de lo que concede, que respeta los comodines (`*`, `ventas:*`). Desde ahí se puede «Duplicar rol».
- **Comprobación.**
  - Las cuatro filas dicen «Ver los permisos del rol · …», sin `aria-disabled`.
  - El diálogo pasa axe y atrapa el foco.
  - Hay seis pruebas unitarias nuevas (`roles.page.spec.ts`).

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/reevaluacion-antes/R04-roles-editar-muerto.png) | ![](2026-11-modal-configuracion/despues/A-R04-c-movil-roles-ver.png) |
| ![](2026-11-modal-configuracion/reevaluacion-antes/B-R04-roles-editar-deshabilitado.png) | ![](2026-11-modal-configuracion/despues/A-R04-a-roles-ver-en-lugar-de-editar.png) |

![Rol del sistema en solo lectura](2026-11-modal-configuracion/despues/A-R04-b-rol-del-sistema-en-solo-lectura.png)

#### R05 · Pista de auditoría: una paginación propia y la celda «Registro» partida
**Reglas:** COMP-01, ALI-01 · **Página:** Pista de auditoría

- **Qué pasaba.**
  - La pista tenía su propia paginación, «Página 1 · 2 registros» con dos botones de texto, distinta de la de Usuarios y del resto del producto. En el teléfono, sus botones bajaban a otra línea (3).
  - En la vista de lista, el tipo de registro flotaba en medio de la fila, separado del registro (2).
- **Corrección.**
  - La pista usa `vx-pager`: rango, páginas y filas por página. La API ya devuelve el total y acepta hasta 200 filas.
  - Tipo y registro van juntos en una celda.
- **Comprobación.** La paginación dice «1–21 de 21» con el selector de filas por página. Una prueba unitaria nueva cubre el cambio de página y de tamaño.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/reevaluacion-antes/R05-paginador-y-registro-auditoria.png) | ![](2026-11-modal-configuracion/despues/A-R05-b-movil-registro-y-paginacion.png) |

![Paginación común en la pista](2026-11-modal-configuracion/despues/A-R05-a-pista-paginacion-comun.png)

#### R06 · Diálogo de rol: «Guardar» gris sin motivo, grupos en mayúsculas y tokens heredados
**Reglas:** COMP-02, TIP-02, CON-02 · **Página:** Roles y permisos (crear o editar)

- **Qué pasaba.**
  - «Guardar» se quedaba deshabilitado sin decir qué faltaba.
  - Cada grupo de permisos era una tarjeta con banda gris y título en mayúsculas sostenidas (1).
  - El diálogo usaba colores heredados en lugar de los del sistema.
  - Cada casilla mostraba en su título emergente el identificador técnico del permiso (`journal_entries:view`).
- **Corrección.**
  - «Guardar» siempre se puede pulsar: si falta algo, el campo lo dice («“Nombre del rol” es obligatorio», «Marca al menos un permiso») y el foco va al primero.
  - Los grupos son título y espacio, en estilo oración, con las casillas en rejilla.
  - El diálogo usa los tokens, las etiquetas y los campos de la modal.
- **Comprobación.** Pasa axe, atrapa el foco y Escape lo cierra sin cerrar la modal.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/reevaluacion-antes/B-R06-crear-rol-antes.png) | ![](2026-11-modal-configuracion/despues/A-R06-crear-rol-dice-que-falta.png) |

#### R07 · Usuarios: dos diálogos propios, distintos del resto
**Reglas:** COMP-01, CONT-02, A11Y-04 · **Página:** Usuarios (invitar, editar, eliminar)

- **Qué pasaba.** Invitar o editar a una persona, y confirmar su borrado, abrían diálogos hechos a mano:
  - otros botones, que se elevaban al pasar el ratón;
  - otra altura de campo y etiquetas en negrita;
  - un «×» de texto por cierre (1, 2, 3).
  - La confirmación de borrado hablaba en otro registro: «¿Está seguro que desea…?».
  - Sobre todo, el diálogo de invitar no atrapaba el foco. En la prueba, las 25 pulsaciones de Tab llevaron el foco a la página de detrás (el botón de cerrar Configuración, el buscador, la barra lateral), y Escape ya no cerraba solo el diálogo.
- **Corrección.**
  - Invitar y editar usan `vx-dialog`, con los campos y mensajes de error comunes. El foco empieza en el primer campo.
  - El borrado usa la confirmación compartida, la misma que piden Roles, SSO o las llaves de agentes, en la voz de la modal.
- **Comprobación.**
  - En el diálogo de invitar, el foco empieza en «Nombre» y ninguna de las 25 tabulaciones sale del diálogo.
  - Escape lo cierra sin cerrar la modal, y axe no encuentra fallos ni al invitar ni al editar.
  - Al enviarlo vacío, cada campo dice qué le falta: «“Nombre” es obligatorio», «“Correo electrónico” es obligatorio»…
  - Una prueba unitaria nueva cubre la confirmación compartida.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/reevaluacion-antes/B-R07-a-invitar-usuario-antes.png) | ![](2026-11-modal-configuracion/despues/A-R07-a-invitar-usuario-dialogo-comun.png) |
| ![](2026-11-modal-configuracion/reevaluacion-antes/B-R07-b-invitar-errores-antes.png) | ![](2026-11-modal-configuracion/despues/A-R07-b-invitar-dice-que-falta.png) |

![Editar usuario, con el diálogo común](2026-11-modal-configuracion/despues/A-R07-c-editar-usuario.png)

#### R08 · Sin conexión, tres páginas repetían el error
**Reglas:** CONT-02, EST-02 · **Páginas:** Plan y facturación, Integraciones, Roles y permisos

- **Qué pasaba.** La prueba de EST-02 pasaba, porque cada página mostraba su error con «Reintentar». Pero tres páginas lo decían dos veces:
  - **Plan y facturación:** un bloque de error para la suscripción y otro igual para los planes.
  - **Integraciones:** uno para el correo entrante y otro para los agentes.
  - **Roles:** el error de la página y, encima, una notificación emergente («No pudimos cargar los permisos»).

  Cuentas predeterminadas y Políticas contables, que también reúnen varias lecturas, ya mostraban un solo error.
- **Corrección.** El mismo patrón en todas las páginas que reúnen varias lecturas:
  - si fallan todas, un solo error con un reintento que las repite todas;
  - si falla una, el error va en su grupo;
  - mientras cargan todas, una sola espera.

  Roles carga los roles y el catálogo de permisos como una sola lectura. Los paneles de Integraciones siguen montados y conservan su estado.
- **Comprobación.**
  - En la nueva pasada de EST-02, las tres páginas muestran un solo error y se recuperan al reintentar.
  - Siete pruebas unitarias nuevas: la carga conjunta de Roles, sin notificación emergente; cuatro para los estados de Plan y facturación; dos para los de Integraciones.

| Antes | Después |
|---|---|
| ![](2026-11-modal-configuracion/reevaluacion-antes/R08-a-facturacion-dos-errores.png) | ![](2026-11-modal-configuracion/est02/11-billing-sin-red.png) |
| ![](2026-11-modal-configuracion/reevaluacion-antes/R08-b-integraciones-dos-errores.png) | ![](2026-11-modal-configuracion/est02/17-integrations-sin-red.png) |
| ![](2026-11-modal-configuracion/reevaluacion-antes/R08-c-roles-error-y-aviso.png) | ![](2026-11-modal-configuracion/est02/13-roles-sin-red.png) |

---

## Las reglas que la evaluación no pudo verificar

### EST-02 · Carga y error con reintento

En cada página, el arnés deja pasar la sesión, las traducciones y los recursos estáticos, y hace fallar como sin red todas las demás peticiones. Luego:
1. busca el error y su «Reintentar»;
2. restablece la red y pulsa «Reintentar»;
3. comprueba que la página se recupera sin errores.

| Página | Peticiones cortadas | Error con «Reintentar» | Se recupera al reintentar | Resultado |
|---|---|---|---|---|
| Mi perfil | 1 | sí | sí | Cumple |
| Seguridad de la cuenta | 1 | sí | sí | Cumple |
| Preferencias | 0 | — | — | No aplica: no pide datos al cargar |
| Mis empresas | 0 | — | — | No aplica: no pide datos al cargar |
| Perfil de la empresa | 1 | sí | sí | Cumple |
| Formato regional | 1 | sí | sí | Cumple |
| Marca de la empresa | 1 | sí | sí | Cumple |
| Estructura empresarial | 2 | sí | sí | Cumple |
| Sucursales | 2 | sí | sí | Cumple |
| Correo saliente | 1 | sí | sí | Cumple |
| Plan y facturación | 4 | sí | sí | Cumple |
| Usuarios | 3 | sí | sí | Cumple |
| Roles y permisos | 2 | sí | sí | Cumple |
| Política de seguridad | 1 | sí | sí | Cumple |
| Pista de auditoría | 3 | sí | sí | Cumple |
| Inicio de sesión único (SSO) | 3 | sí | sí | Cumple |
| Integraciones | 2 | sí | sí | Cumple |
| Inteligencia artificial | 1 | sí | sí | Cumple |
| Extensiones | 2 | sí | sí | Cumple |
| Cuentas predeterminadas | 6 | sí | sí | Cumple |
| Políticas contables | 4 | sí | sí | Cumple |
| Comprobantes fiscales | 4 | sí | sí | Cumple |
| Retenciones | 2 | sí | sí | Cumple |
| Numeración de documentos | 1 | sí | sí | Cumple |
| Aprobaciones | 2 | sí | sí | Cumple |

Preferencias y Mis empresas no piden datos al servidor al abrirse: leen la sesión, que ya está cargada. Las capturas de cada página, sin red y tras reintentar, están en [`est02/`](2026-11-modal-configuracion/est02/).

| Sin red (Cuentas predeterminadas) | Tras reintentar |
|---|---|
| ![](2026-11-modal-configuracion/est02/20-default-accounts-sin-red.png) | ![](2026-11-modal-configuracion/est02/20-default-accounts-reintento.png) |

### PERM-01 · Solo lectura, y el permiso que falta

La sesión del cliente se sustituye por una con todos los permisos de lectura y ninguno de gestión (`perm01.js`, `view-permissions.json`). En cada página de Empresa y Administración se cuentan los controles que cambian algo: campos y botones habilitados, sin contar filtros, búsqueda, paginación ni «Ver». Las páginas de Tu cuenta son de la propia persona y siempre se pueden editar.

| Página | Aviso de solo lectura | Barra de guardado | Controles que cambian algo | Resultado |
|---|---|---|---|---|
| Perfil de la empresa | sí | no | 0 | Cumple |
| Formato regional | sí | no | 0 | Cumple |
| Marca de la empresa | sí | no | 0 | Cumple |
| Estructura empresarial | — | — | — | No aplica: leerla exige un permiso de gestión, y la modal lo nombra |
| Sucursales | sí | no | 0 | Cumple |
| Plan y facturación | sí | no | 0 | Cumple |
| Usuarios | sí | no | 0 | Cumple |
| Roles y permisos | sí | no | 0 | Cumple |
| Política de seguridad | sí | no | 0 | Cumple |
| Inteligencia artificial | sí | no | 0 | Cumple |
| Extensiones | sí | no | 0 | Cumple |
| Cuentas predeterminadas | — | — | — | No aplica: leerla exige un permiso de gestión, y la modal lo nombra |
| Políticas contables | — | — | — | No aplica: leerla exige un permiso de gestión, y la modal lo nombra |
| Comprobantes fiscales | sí | no | 0 | Cumple |
| Retenciones | sí | no | 0 | Cumple |
| Numeración de documentos | — | — | — | No aplica: leerla exige un permiso de gestión, y la modal lo nombra |
| Aprobaciones | — | — | — | No aplica: leerla exige un permiso de gestión, y la modal lo nombra |
| Correo saliente | — | — | — | No aplica: leerla exige un permiso de gestión, y la modal lo nombra |
| Inicio de sesión único (SSO) | — | — | — | No aplica: leerla exige un permiso de gestión, y la modal lo nombra |
| Integraciones | — | — | — | No aplica: leerla exige un permiso de gestión, y la modal lo nombra |

- **Lo que cumple.** En las 12 páginas que se pueden leer:
  - un aviso dice qué permiso falta para cambiarlas («Solo lectura: cambiar esta sección requiere el permiso “Editar usuarios”»);
  - no aparece la barra de guardado;
  - no queda ningún control que cambie algo.
- **Las 8 que no aplican.** Estructura empresarial, Correo saliente, SSO, Integraciones, Cuentas predeterminadas, Políticas contables y Numeración exigen `settings:edit_company` solo para verse; Aprobaciones exige `workflows:manage`. La API exige lo mismo para leerlas (`GET /organizations/settings/:section`), así que no existe un modo de solo lectura que mostrar. La modal dice qué permiso falta: «Para abrir esta sección hace falta el permiso “Editar la configuración de la empresa”». Crear un permiso de lectura para esa configuración es una decisión de producto, no de interfaz (D6, abajo).

| Solo lectura (Usuarios) | Sin permiso para verla (Correo saliente) |
|---|---|
| ![](2026-11-modal-configuracion/perm01/07-users-solo-lectura.png) | ![](2026-11-modal-configuracion/perm01/18-smtp-solo-lectura.png) |

### GUA-01 · Ningún cambio se pierde sin aviso (16 casos)

En cada caso, el arnés escribe un cambio, comprueba que aparece la barra de guardado si la página la usa, y prueba las cuatro salidas que nombra la regla:
- Escape;
- la X;
- un clic en el fondo, fuera del panel;
- otra página de la barra lateral.

Cada salida debe preguntar, y «Seguir editando» debe dejar lo escrito donde estaba (`dirty3.js` prueba Escape y la X; `exits.js`, el fondo y el cambio de página). Al final descarta el cambio: no guarda nada.

| Caso | Barra de guardado | Escape | La X | El fondo | Otra página | Lo escrito se conserva | Resultado |
|---|---|---|---|---|---|---|---|
| Mi perfil · nombre | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Seguridad de la cuenta · contraseña | no (editor con botón propio) | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Perfil de la empresa · sitio web | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Formato regional · hora | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Marca · color de acento | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Correo saliente · remitente | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Política de seguridad · segundo factor | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| SSO · dominio | no (editor con botón propio) | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| IA · presupuesto mensual | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| IA · límite del agente | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Políticas contables · plazo de pago | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Comprobantes fiscales · modalidad | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Comprobantes fiscales · rango sin registrar | no (editor con botón propio) | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Retenciones · régimen nuevo | no (editor con botón propio) | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Numeración · prefijo | sí | pregunta | pregunta | pregunta | pregunta | sí | Cumple |
| Aprobaciones · política nueva | no (editor con botón propio) | pregunta | pregunta | pregunta | pregunta | sí | Cumple |

| Con un cambio (Numeración) | Escape pregunta |
|---|---|
| ![](2026-11-modal-configuracion/gua01/sequences-1-con-cambios.png) | ![](2026-11-modal-configuracion/gua01/sequences-2-escape-pregunta.png) |

### Diálogos

Ni la evaluación ni las fases por página abren los diálogos, así que `dialogs.js` los comprueba aparte: axe sobre el diálogo abierto, 25 tabulaciones, Escape y el foco inicial.

| Diálogo | axe | Tabulaciones fuera del diálogo | Escape cierra solo el diálogo | Foco inicial |
|---|---|---|---|---|
| Crear rol | 0 | 0 de 25 | sí | «Nombre del rol» |
| Ver un rol del sistema | 0 | 0 de 25 | sí | el diálogo |
| Invitar usuario | 0 | 0 de 25 | sí | «Nombre» |
| Editar usuario | 0 | — | — | «Nombre» |
| Invitar usuario, **antes** | 0 | **25 de 25** | **no** | el contenedor |

---

## Veredicto por regla

Mismo ámbito que en la evaluación: una regla **global** vale 1 o 0 para toda la modal, y una regla **local** puntúa la proporción de páginas, o de casos, aplicables que cumplen.

| ID | Fuerza | Ámbito | Puntuación | Resultado | Evidencia |
|---|---|---|---|---|---|
| JER-01 | DEBE | global | 1,00 | Cumple | Miga, título, descripción y alcance en las 25 páginas |
| JER-02 | DEBE | local | 1,00 | Cumple en 25 de 25 | Un h1 por vista (24/700); ningún h3 mayor que su h2 |
| TIP-01 | DEBE | global | 1,00 | Cumple | Dos estilos de título en toda la modal: h2 17/600 y h3 14/600 |
| TIP-02 | DEBERÍA | local | 1,00 | Cumple en 25 de 25 | Ninguna mayúscula sostenida en el contenido (H22, R06) |
| TIP-03 | DEBE | local | 1,00 | Cumple en 2 de 2 | tabular-nums en las cifras en columna (Plan y facturación, Numeración) |
| ACC-01 | DEBE | local | 1,00 | Cumple en 25 de 25 | Como máximo una primaria habilitada por página, a 1440 px y en teléfono |
| ACC-02 | DEBE | local | 1,00 | Cumple en 25 de 25 | Vista previa inerte; sin casillas sin acción; «Ver» en lugar de un «Editar» muerto |
| ACC-03 | DEBERÍA | local | 1,00 | Cumple en 25 de 25 | Acciones de página en la cabecera (Extensiones incluida) |
| ACC-04 | DEBE | global | 1,00 | Cumple | Confirmación proporcional en restablecer, cerrar sesiones, 2FA, revocar, eliminar |
| GUA-01 | DEBE | local | 1,00 | Cumple en 16 de 16 | 16 casos: Escape, la X, el fondo y otra página preguntan; lo escrito se conserva |
| GUA-02 | DEBERÍA | global | 1,00 | Cumple | Un modelo por tipo de cambio, con las excepciones justificadas por escrito |
| GUA-03 | DEBE | global | 1,00 | Cumple | La barra dice por qué no se puede guardar; los editores dicen qué falta |
| CON-01 | DEBERÍA | local | 1,00 | Cumple en 25 de 25 | Contenedor solo en avisos, vistas previas y opciones elegibles |
| CON-02 | DEBE | global | 1,00 | Cumple | Una anatomía de grupo: vx-settings-group (título y espacio) |
| SOM-01 | DEBE | local | 1,00 | Cumple en 25 de 25 | Ningún contenedor de contenido con sombra (1440 px y teléfono) |
| RAD-01 | DEBE | global | 1,00 | Cumple | 6 px en avisos y vistas previas; la muestra de Marca refleja el radio elegido |
| ESP-01 | DEBE | local | 1,00 | Cumple en 25 de 25 | 32 px entre grupos, 24 px entre subgrupos; 16 px entre campos (R03) |
| ALI-01 | DEBE | local | 1,00 | Cumple en 25 de 25 | Desplegable, periodo y ayudas alineados; segmentado y celda de registro (R02, R05) |
| COL-01 | DEBE | global | 1,00 | Cumple | vx-badge con tono por significado; vx-notice para avisos |
| COL-02 | DEBE | global | 1,00 | Cumple | Todo estado lleva texto |
| EST-01 | DEBE | global | 1,00 | Cumple | 11 estados vacíos, todos vx-empty-state |
| EST-02 | DEBE | global | 1,00 | Cumple | 23 de 23 páginas aplicables: error con reintento y recuperación; uno solo si fallan varias lecturas (R08) |
| CONT-01 | DEBE | local | 1,00 | Cumple en 25 de 25 | Ninguna clave cruda ni traducción que falte, en las cinco condiciones |
| CONT-02 | DEBE | local | 1,00 | Cumple en 25 de 25 | Sin contradicciones ni repeticiones, tampoco en los errores; una sola voz (R07, R08) |
| CONT-03 | DEBE | local | 1,00 | Cumple en 25 de 25 | Lugares con su nombre y enlazados |
| CONT-04 | DEBERÍA | local | 1,00 | Cumple en 25 de 25 | Estilo oración |
| FMT-01 | DEBE | global | 1,00 | Cumple | Un formateador de moneda y uno de fecha (corto en datos, largo en frases) |
| FORM-01 | DEBE | local | 1,00 | Cumple en 15 de 15 | Etiqueta visible en todo campo; un estilo de obligatorio |
| FORM-02 | DEBERÍA | local | 1,00 | Cumple en 12 de 12 | Ancho por dato desde 640 px; ancho completo en una columna |
| COMP-01 | DEBE | global | 1,00 | Cumple | Un patrón por función: filas, subida, segmentado, desplegable, paginación, diálogo, casilla |
| COMP-02 | DEBE | local | 1,00 | Cumple en 6 de 6 | Deshabilitado con motivo o botón que dice qué falta |
| A11Y-01 | DEBE | local | 1,00 | Cumple en 25 de 25 | axe sin fallos de contraste en claro y oscuro |
| A11Y-02 | DEBE | local | 1,00 | Cumple en 25 de 25 | axe sin fallos de nombre ni etiqueta |
| A11Y-03 | DEBE | local | 1,00 | Cumple en 25 de 25 | Foco visible siempre; nunca en un elemento invisible (casos de contenedor, en captura) |
| A11Y-04 | DEBE | global | 1,00 | Cumple | 0 fugas de foco en 25 páginas y en los diálogos |
| A11Y-05 | DEBE | global | 1,00 | Cumple | axe 2.5.8 sin fallos en ambas densidades y en táctil |
| A11Y-06 | DEBE | global | 1,00 | Cumple | Escape cierra solo la capa superior (diálogos incluidos) |
| NAV-01 | DEBERÍA | global | 1,00 | Cumple | 13 búsquedas con el resultado esperado |
| NAV-02 | DEBE | global | 1,00 | Cumple | Página activa marcada y miga |
| ARQ-01 | DEBERÍA | global | 1,00 | Cumple | Integraciones sin duplicados; la actividad de la IA, en Análisis |
| RESP-01 | DEBE | local | 1,00 | Cumple en 25 de 25 | A 390 px: sin desbordes ni textos cortados; tablas como lista |
| ANT-01 | DEBE | local | 1,00 | Cumple en 25 de 25 | Sin rejillas repetitivas ni otros antipatrones de la §10 |
| PERM-01 | DEBE | global | 1,00 | Cumple | 12 de 12 páginas aplicables en solo lectura; las demás nombran el permiso |

## Cálculo de la nota

Con la misma fórmula del protocolo (código: [`harness/nota-reevaluacion.py`](2026-11-modal-configuracion/harness/nota-reevaluacion.py)):

1. **Pesos.** DEBE vale 3 y DEBERÍA vale 1.
2. **Puntos.** Se suma peso × puntuación: 113 de 113 → **100 %**.
3. **Nota base.** 10 × 100 % = **10,0**.
4. **Topes.** No queda ningún hallazgo abierto, así que no hay tope.
5. **Cobertura.** 43 de 43 reglas evaluadas (100 %): la nota es definitiva.

**Nota final: 10 / 10.**

- **Agregación por página.** La agregación estricta, en la que basta una página que falle para dar la regla por incumplida, también da **10,0**, porque ninguna regla falla en ninguna página. En la evaluación esa cifra era 2,2.
- **Qué cambiaría la nota.** Que el producto decida otra cosa en D1 (sombras) o en D6 (permiso de lectura) cambiaría el estándar, no esta medición. Con el estándar v0.1 vigente, no queda nada que corregir.

## Comprobaciones técnicas

| Comprobación | Resultado |
|---|---|
| Compilación de Angular (`ngc -p apps/core/client-web/tsconfig.app.json`) | Sin errores |
| Pruebas del cliente (Jest, suite completa) | 242 suites y 1323 pruebas, todas pasan |
| ESLint sobre lo tocado (configuración del cliente) | 0 errores |
| `npm run i18n:verify` (catálogo, huérfanas, registro formal, textos sin traducir, prosa) | Pasa |
| `npm run lint:design-system` (tokens y contraste, tema claro y oscuro) | 150 de 150 comprobaciones |
| Compilación de la API (`tsc -p apps/backend/api/tsconfig.app.json`) | Sin errores |
| Pasos de la CI tras el lint, reproducidos en local con el entorno de la CI | Todos pasan (ver abajo) |

**La CI del PR.** El paso de lint fallaba en main desde hace semanas y este PR lo arregló. Eso dejó a la vista pasos que llevaban tiempo sin ejecutarse, y tres fallaban por motivos anteriores a este PR. Se corrigieron aquí y se comprobó en local, con las mismas variables y una base de datos nueva, que todos los pasos siguientes pasan:
- **`check:schema-drift`.** La migración `PosSaleAccounting` crea el índice único `UQ_pos_sales_org_fiscal_number`, pero la entidad `PosSale` no lo declaraba. Ahora lo declara. Sin el cambio, el fallo se reproduce idéntico en local; con él, pasa.
- **`verify:rls-runtime`.** El interceptor de inquilino recibe ahora un `Reflector`, y el verificador lo construía sin él. Pasa con las 18 comprobaciones.
- **`verify:auth-contract`.** El registro exige la aceptación de los documentos legales, y el verificador llamaba al servicio con la firma anterior. Pasa con las 40 comprobaciones.
- **El resto:** `verify:tenant-scope`, `verify:security`, `verify:rls`, `verify:upgrade-path`, `verify:boundaries`, `verify:fiscal-identity`, `verify:tenancy`, `verify:boot`, `verify:markets`, `verify:provisioning`, `verify:ecf`, `verify:invoicing` y las pruebas del motor de IA en Python. Pasan sin cambios.

**La API.** Las lecturas de la configuración (`GET /organizations/settings/:section`) admiten 120 peticiones por minuto. El límite general de 20 por endpoint cortaba con 429 la propia navegación entre páginas de la modal, que lee una sección por página.

**Lo que no es de esta modal.** Dos verificadores que no corren en la CI siguen marcando lo mismo que en el commit de partida, fuera de la modal:
- `verify:form-a11y`: 25 avisos en formularios de otros módulos;
- `verify:required-markers`: dos fechas de la importación de extractos bancarios.

## Lo que la detección automática marca y no es un fallo

| Señal del arnés | Qué es | Comprobación |
|---|---|---|
| «Primarias» de más en Preferencias, Marca y Usuarios | El segmento activo, el color de marca elegido y el botón de muestra de la vista previa inerte tienen el relleno de acento, pero no son botones primarios | Ninguna página tiene más de un `primary-button` habilitado |
| «Tarjetas» en 11 páginas | Avisos (`vx-notice`), vistas previas y, en el teléfono, el segmentado de Usuarios | Usos permitidos por CON-01; ninguno con sombra |
| Foco «sin anillo» en Pista de auditoría (3) y Cuentas predeterminadas (27) | Los campos de los selectores: el anillo lo pinta su contenedor | Captura A-H04-e |
| Foco en «caja invisible» en Mi perfil, Marca, Plan y Comprobantes fiscales | Campos de archivo y radios ocultos a la vista: el anillo lo pinta su botón o su tarjeta | Capturas A-H04-b, c, d y f |
| «Texto cortado» en Usuarios, Roles y Pista (teléfono) | Los encabezados de columna solo para lectores de pantalla («Acciones», «Detalle») | Son `sr-only` a propósito |
| Fechas en varios formatos | Las muestras del selector de formato (14/09/2026, 09/14/2026…) y la fecha larga en frases («6 de noviembre de 2027») | Un solo formateador: corto en datos y largo en frases |
| Radio de 9,6 px | La tarjeta de muestra de Marca reproduce el radio que elige la empresa | Cambia con el control «Radio de bordes» |

## Decisiones pendientes que afectan a esta evaluación

- **D1, sombras.** Se mantiene lo decidido en la evaluación: se aplicó la constitución, sin sombra en el contenido. Hoy ningún contenedor de la modal la lleva.
- **D5, mayúsculas.** Solo la etiqueta de grupo de la barra lateral va en mayúsculas.
- **D6, permiso de lectura de la configuración de empresa (nueva).** Siete páginas exigen `settings:edit_company` para verse, igual que la API. Si el producto quiere que alguien pueda consultar esa configuración sin cambiarla, hace falta un permiso de lectura en el catálogo, en los roles y en la API. Con él, esas páginas se verían en solo lectura como las otras doce.

## Propuestas al estándar surgidas de la reevaluación

1. **EST-02 con varias lecturas.** Añadir a la regla el patrón de R08: si fallan todas las lecturas, un solo error; si falla una, en su grupo.
2. **Revisar el teléfono, los diálogos y los estados de error.** Los ocho defectos nuevos estaban en vistas que las fases automáticas no abren o no miran. El protocolo debería exigir una revisión visual de las capturas de teléfono y de EST-02, y una pasada de `dialogs.js`.
3. **COMP-02 en táctil.** Un motivo solo en el título emergente no existe en un teléfono. La regla debería pedir que el motivo se vea, o que el control haga algo útil, como «Ver» en lugar de un «Editar» deshabilitado.

## Reproducibilidad

[`harness/README.md`](2026-11-modal-configuracion/harness/README.md) explica cómo repetir cada paso. Las mediciones de la pasada final están en [`resultados-reevaluacion/`](2026-11-modal-configuracion/resultados-reevaluacion/):

| Archivo | Contenido |
|---|---|
| `base.json`, `dark.json`, `laptop.json`, `phone.json`, `density.json` | Mediciones y axe por condición |
| `focus.json` | Recorrido de teclado |
| `search.json` | Buscador |
| `dirty3.json`, `exits.json` | GUA-01, 16 casos: Escape y la X; el fondo y otra página |
| `est02.json` | EST-02 |
| `perm01.json` | PERM-01 |
| `dialogs.json`, `dialogs-before.json` | Diálogos, después y antes |
| `after-log.json` | Comprobaciones hechas al capturar el «después» |
| `analisis.txt` | Resumen regla por regla (`analyze.js`) |
