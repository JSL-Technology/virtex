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
   otro fabricante.
3. **«ERP» no es el nombre.** El producto se llama Virtex y es un ERP, igual que
   Figma se llama Figma y es un editor de diseño. Componer la categoría dentro
   del logotipo la convertía en apellido.

---

## El símbolo

Un bloque de esquinas blandas con **un solo vértice vivo**, cortado por dos
canales paralelos en tres planos que ascienden hacia esa esquina.

- El **vértice** —la única esquina sin redondear y la única pieza en color de
  marca— es el punto donde se encuentran los planos. Un ERP es exactamente eso
  para una empresa: el punto donde convergen finanzas, operaciones e inventario.
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

El acento de marca es **iris**, no un azul.

| Tramo      | Valor     | Uso                                           |
| ---------- | --------- | --------------------------------------------- |
| `iris-600` | `#5b37d9` | Acento en tema claro · vértice del símbolo    |
| `iris-550` | `#6a47e8` | Acento en tema oscuro                         |
| `iris-500` | `#7d5cf6` | Vértice sobre el azulejo casi negro del icono |
| `iris-400` | `#a58fff` | Texto de acento y enlaces en tema oscuro      |

El iris se eligió por descarte razonado, no por gusto: **no colisiona con ningún
color semántico del sistema**. El petróleo, la otra candidata seria, se
confundía con `--info-solid`; la esmeralda, con `--success-solid`. En una
rejilla llena de insignias de estado esa confusión se paga cara.

Los tramos y los tokens que los consumen están en `_primitives.scss` y
`_theme.scss`. `npm run lint:contrast` verifica las 150 parejas
texto/superficie: ningún color de esta tabla se cambia sin volver a ejecutarlo.

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
- No se recolorea el símbolo fuera de los tokens: sobre una superficie de acento
  se usa `monochrome`, que lo lleva todo a la tinta en curso.
- No se recompone el logotipo a mano con un `<img>` y un `<span>`. Para eso está
  el componente, que es lo que garantiza las proporciones.
- No se rehace el wordmark con `<text>`. Vuelve a introducir la dependencia de
  que Inter esté disponible.
- No se estira. El símbolo es cuadrado y el logotipo tiene una sola proporción.

---

## Inventario

| Archivo                                | Para qué                                        |
| -------------------------------------- | ----------------------------------------------- |
| `shared/components/brand-logo/`        | **La fuente.** Todo uso dentro de la aplicación |
| `assets/logos/virtex-mark.svg`         | Símbolo, fondo claro                            |
| `assets/logos/virtex-mark-inverse.svg` | Símbolo, fondo oscuro                           |
| `assets/logos/virtex-logo.svg`         | Logotipo completo, fondo claro                  |
| `assets/logos/virtex-logo-inverse.svg` | Logotipo completo, fondo oscuro                 |
| `assets/logos/virtex-icon.svg`         | Azulejo de aplicación                           |
| `public/favicon.svg` · `favicon.ico`   | Pestaña del navegador                           |
| `public/icons/icon-*.png`              | Manifiesto PWA (72 → 512)                       |

Dentro del navegador se usa **siempre el componente**: es el único que responde
al tema y al acento personalizado de la organización. Los `.svg` sueltos son
para lo que sale del navegador.
