# Los cinco gestos

Toda interacción del ERP es una de cinco, y cada una tiene **un** tratamiento
canónico aquí:

| Gesto | Componente | Qué hace el usuario |
|---|---|---|
| `LIST` | `vx-list-shell` | Encontrar un conjunto de registros |
| `DOCUMENT` | `vx-document-shell` | Leer uno, con su estado y su historia |
| `DRAFT` | `vx-draft-shell` | Cambiar un borrador y confirmarlo |
| `INBOX` | `vx-inbox-shell` | Ver qué le toca, ordenado por lo que bloquea |
| `OVERVIEW` | — | Agregado; su forma la define el propio informe |
| `CANVAS` | — | Una superficie sobre la que compone: hoja de cálculo, terminal, asistente |

## Por qué esto es un componente y no una guía de estilo

Una guía de estilo es una regla que alguien tiene que recordar. Antes de esto,
treinta y cinco listas del producto habían inventado treinta y cinco maneras de
decir «cargando»: algunas un `<p>` con texto, otras nada; unas mostraban el
error dentro de la tabla, otras lo tragaban; el estado vacío existía en poco más
de la mitad. Ninguna de esas diferencias fue una decisión: son el residuo de
haber escrito la misma pantalla muchas veces.

El armazón se queda con los cuatro estados —cargando, error, vacío, con datos—
porque son exactamente los que se olvidan. La página proyecta su tabla y no
puede olvidarse de nada, porque no es suya la responsabilidad.

## Por qué la bandeja tiene el suyo y no una variante de lista

Se pensó como `vx-list-shell` con una variante, y no lo es. Una lista responde
«¿dónde está esto?»; una bandeja responde «¿he terminado?». Sus elementos no son
filas de una tabla —son cosas que esperan, con un porqué, un desde cuándo y la
acción que las resuelve— y esa acción viaja en una plantilla que la página
aporta, porque aprobar no es navegar.

## Por qué `OVERVIEW` y `CANVAS` no tienen armazón

Un informe financiero no comparte anatomía con otro: un balance es una jerarquía
de cuentas, un flujo de caja es una serie temporal. Forzarlos a un molde común
produciría un molde vacío. Lo mismo vale para una hoja de cálculo, un terminal de
punto de venta o un asistente de importación: son superficies sobre las que el
usuario compone, y una cabecera fija estorbaría. El gesto sigue declarado en el
manifiesto —sirve para el título de la ventana y para su identidad— pero no
impone una forma.

`CANVAS` es deliberadamente estrecho. No es la salida para una pantalla que no se
ha pensado: una lista que «se siente distinta» sigue siendo una lista.
