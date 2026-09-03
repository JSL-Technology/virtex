# Marca Virtex

Especificación de la identidad: qué es cada pieza, cómo se construye y qué no
se puede hacer con ella. El logotipo vive en el código —no en un archivo suelto
que alguien exporta a mano—, así que este documento describe lo que ya está
implementado, no una intención.

---

## Por qué se rehízo

La marca anterior era una «V» azul junto a la palabra «virtex», con «ERP»
debajo. Tres problemas, ninguno de gusto:

1. **Decía dos veces lo mismo.** Un símbolo con forma de V seguido de la palabra
   que empieza por V es una redundancia: el símbolo no aporta información que la
   palabra no diera ya, y encima la daba peor.
2. **El azul no identificaba nada.** `#2563eb` es el azul por defecto de medio
   ecosistema de producto. Cualquier captura de la aplicación podía ser la de
   otro fabricante. Una primera versión resolvió el matiz pero dejó el símbolo
   casi todo en tinta: cambiaba de negro a blanco con el tema y, siendo
   correcto, seguía sin aportar reconocimiento por color.
3. **«ERP» no es el nombre.** El producto se llama Virtex y es un ERP, igual que
   Figma se llama Figma y es un editor de diseño. Componer la categoría dentro
   del logotipo la convertía en apellido.

---

## El símbolo

Un bloque de esquinas blandas con **un solo vértice vivo**, cortado por dos
canales paralelos en tres planos que ascienden hacia esa esquina.

- El **vértice** —la única esquina sin redondear, y la que recibe el extremo
  claro del degradado— es el punto donde se encuentran los planos. Un ERP es
  exactamente eso para una empresa: el punto donde convergen finanzas,
  operaciones e inventario.
- El **cuerpo** es el sistema.
- La **contrapartida**, el plano pequeño de la esquina opuesta, es el otro lado
  del asiento. La partida doble, dibujada.

No representa ninguna letra. Es deliberado: el símbolo nombra el concepto, la
palabra nombra el producto, y ninguno de los dos repite al otro.

### Construcción

Todo se deriva de una caja de 100 × 100:

| Medida       | Valor                       | Por qué                                                     |
| ------------ | --------------------------- | ----------------------------------------------------------- |
| Bloque       | 90 × 90, centrado           | El 5 % de margen es área de respeto incorporada             |
| Radio blando | 22                          | Tres esquinas; da el aire de bloque, no de icono de sistema |
| Vértice      | radio 0                     | La cuarta esquina. Si se redondea, la marca pierde su tema  |
| Canales      | ancho 5.6, a ±26 del centro | Sobreviven a 16 px; más finos desaparecen                   |
| Eje de corte | 45°, hacia el vértice       | Los planos ascienden, no caen                               |

Los cortes están **alejados a propósito** de las esquinas redondeadas. Cuando
pasan cerca, el redondeo se recorta y aparecen colas puntiagudas que parecen un
error de trazado.

---

## El wordmark

«virtex» en minúsculas, Inter 600, interletrado −0.022 em, **en curvas**.

Va en curvas y no en texto porque los `.svg` sueltos se usan donde no hay hoja
de estilos: favicon, plantillas de correo, PDF. El logotipo anterior declaraba
`font-family="Inter"` y en un cliente de correo se dibujaba en Arial — es decir,
no era el logotipo. Con las curvas ya trazadas la marca es la misma en todas
partes.

El interletrado abierto del logotipo anterior (+3.2 sobre 48 px) es un recurso
de otra época; cerrado, la palabra se lee como una unidad.

### Centrado óptico

La masa de «virtex» está en la altura de x, pero el ojo también cuenta el asta
de la «t» y el punto de la «i». La palabra se centra ponderando **62 / 38** entre
el centro de la altura de x y el centro de la caja de tinta. Centrar solo por
caja la deja visiblemente baja.

En el componente esa corrección va **dentro del `viewBox`** del wordmark, que es
más alto que la tinta por abajo: así el centrado vertical normal del contenedor
la coloca en su sitio y ningún consumidor tiene que corregirla a mano.

---

## Composición

| Medida                              | Valor                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Separación símbolo ↔ palabra        | 0.25 × lado del símbolo                                                  |
| Alto de la caja del wordmark        | 0.7205 × lado del símbolo                                                |
| Área de respeto                     | El 5 % que el símbolo ya lleva dentro; en piezas impresas, medio símbolo |
| Tamaño mínimo del símbolo           | 16 px                                                                    |
| Tamaño mínimo del logotipo completo | 18 px de símbolo                                                         |

Estas proporciones están en `brand-logo.scss` **y** en los `.svg` sueltos. Si
divergen, el logotipo de la aplicación deja de ser el del correo.

---

## Color

La marca es de **un solo color**: un violeta con un degradado corto.

| Token          | Valor     | Papel                                       |
| -------------- | --------- | ------------------------------------------- |
| `--brand-from` | `#6a47e8` | Extremo hundido, esquina inferior izquierda |
| `--brand-to`   | `#8f77ff` | Extremo claro, el vértice                   |

### Por qué un degradado y no un plano

El degradado recorre **toda la figura** en la diagonal ascendente, en espacio de
usuario y no relativo a cada trazado. Eso hace que los tres planos compartan una
sola rampa y que el vértice —que está al final del eje— reciba el extremo claro.

Es la razón de que la marca no necesite un segundo color para destacar su
vértice. Una versión intermedia lo llevaba en arcilla y se veía cargada: dos
familias de color y cuatro valores para una figura de tres planos.

### Por qué NO cambia con el tema

`--brand-from` y `--brand-to` se publican **fuera** de los mixins de tema. El
logotipo es el mismo color sobre lienzo claro y sobre lienzo oscuro, y ese es
justamente el punto: una marca que cambia de color con el tema no se recuerda
por su color.

Que eso sea posible no es casualidad. Las dos paradas se eligieron dentro de la
franja de luminancia que alcanza **≥3:1 contra los dos lienzos** a la vez:

| Parada    | Sobre `#f4f6fa` | Sobre `#141414` |
| --------- | --------------- | --------------- |
| `#6a47e8` | 5.28:1          | 3.23:1          |
| `#8f77ff` | 3.11:1          | 5.48:1          |

Un violeta más profundo (`#5b37d9`, el acento de la interfaz) se queda en 2.63:1
sobre el lienzo oscuro y obligaría a mantener dos logotipos. Por eso el
degradado es corto: no es un efecto, es el recorrido más largo que admite esa
restricción.

### Por qué el branding del cliente no lo toca

`BrandingService` solo escribe `--accent-*`, `--content-link` y
`--border-focus`. El logotipo consume `--brand-*`, que ese servicio no conoce.
Una organización personaliza **su** interfaz; la marca de Virtex mantiene su
presencia dentro de ella.

Durante una versión el símbolo se pintó con `--content-primary` y
`--accent-solid`. Se veía correcto y era un error de marca por partida doble: el
símbolo era casi todo tinta —negro sobre claro, blanco sobre oscuro—, así que no
aportaba ningún reconocimiento por color; y al personalizar su acento, el
cliente teñía el logotipo de Virtex.

---

## Versiones

Cada una existe para un soporte concreto. No son gustos intercambiables.

| Versión       | `tone`     | Cuándo                                                                                  |
| ------------- | ---------- | --------------------------------------------------------------------------------------- |
| **Principal** | `brand`    | Siempre que el soporte admita color, sobre fondo claro u oscuro indistintamente         |
| **Un tono**   | `mono`     | Reproducción a una tinta que sí admite color: bordado, serigrafía, sello                |
| **Negativo**  | `negative` | Fotografías, superficies de acento y cualquier fondo con el que el violeta no contraste |
| **Positivo**  | `positive` | Impresión a una tinta negra, fax, documento oficial, grabado                            |

En la aplicación se conmutan con la entrada `tone` del componente, sin cambiar
de archivo. Fuera del navegador, cada una tiene su `.svg` en el inventario.

---

## Tema oscuro

Los neutros del tema oscuro son los de **Microsoft Teams**. Los valores no están
transcritos de memoria: se extrajeron del paquete `@fluentui/tokens`
(`teamsDarkTheme`), de modo que cada tramo de `$graphite` corresponde a un token
real de Fluent y no a una aproximación.

Es una rampa de gris **puro**, sin el tinte frío de `$neutral`. Ese es el motivo
de traerla: un fondo sin croma no compite en matiz con el violeta, así que la
marca se percibe más saturada sobre ella. El tema claro conserva `$neutral`,
que sí lleva tinte — sobre blanco el problema es el contrario.

El color primario NO viene de Teams: sigue siendo el iris de Virtex.

---

## La bajada «ERP»

Es una **bajada de categoría**, no parte del logotipo. Va apagada por defecto
(`showDescriptor`), en tinta terciaria y con interletrado abierto —compuesta
como lo que es— y solo se enciende donde la marca aún no se conoce: una portada
comercial, una firma de correo. En la barra de la aplicación no aporta nada y
suma ruido en cada pantalla.

---

## Qué no se hace

- No se redondea el vértice. Es el tema de la marca.
- No se recolorea el símbolo fuera de los tokens. Sobre una superficie de acento
  o una fotografía se usa `tone="negative"`; nunca un violeta a ojo.
- No se le añade un segundo color. La marca es de un solo tono, y el vértice se
  destaca por el degradado.
- No se recompone el logotipo a mano con un `<img>` y un `<span>`. Para eso está
  el componente, que es lo que garantiza las proporciones.
- No se rehace el wordmark con `<text>`. Vuelve a introducir la dependencia de
  que Inter esté disponible.
- No se estira. El símbolo es cuadrado y el logotipo tiene una sola proporción.

---

## Inventario

| Archivo                                 | Para qué                                        |
| --------------------------------------- | ----------------------------------------------- |
| `shared/components/brand-logo/`         | **La fuente.** Todo uso dentro de la aplicación |
| `assets/logos/virtex-mark.svg`          | Símbolo, color                                  |
| `assets/logos/virtex-mark-mono.svg`     | Símbolo, un tono                                |
| `assets/logos/virtex-mark-negative.svg` | Símbolo, blanco                                 |
| `assets/logos/virtex-mark-positive.svg` | Símbolo, una tinta                              |
| `assets/logos/virtex-logo.svg`          | Logotipo, color · palabra en tinta              |
| `assets/logos/virtex-logo-inverse.svg`  | Logotipo, color · palabra en blanco             |
| `assets/logos/virtex-logo-negative.svg` | Logotipo, todo blanco                           |
| `assets/logos/virtex-logo-positive.svg` | Logotipo, todo a una tinta                      |
| `assets/logos/virtex-icon.svg`          | Azulejo de aplicación                           |
| `public/favicon.svg` · `favicon.ico`    | Pestaña del navegador                           |
| `public/icons/icon-*.png`               | Manifiesto PWA (72 → 512)                       |

El azulejo es **violeta**, no casi negro: en una rejilla de iconos lo que
identifica a una marca a 24 px es su color, no su silueta. Dentro, el símbolo va
en blanco, porque sobre violeta profundo el violeta no contrastaría.

Dentro del navegador se usa **siempre el componente**: es el único que conmuta
las cuatro versiones sin cambiar de archivo. Los `.svg` sueltos son para lo que
sale del navegador.
