# `vx-table`: la tabla del producto

Toda tabla del cliente web es un `<vx-table>` alrededor de una `<table>` nativa y semántica.
`npm run verify:tables` lo comprueba en cada plantilla y en la CI.

```html
<vx-table labelKey="invoices.list.title">
  <table [appSort]="table.sort" [appTableMenu]="menu">
    <thead>
      <tr>
        <th appSortHeader="number">{{ 'invoices.number' | translate }}</th>
        <th appSortHeader="customer">{{ 'invoices.customer' | translate }}</th>
        <th appSortHeader="total" class="numeric">{{ 'invoices.total' | translate }}</th>
        <th class="actions-column"><span class="sr-only">{{ 'common.actions' | translate }}</span></th>
      </tr>
    </thead>
    <tbody>
      @for (invoice of table.rows(); track invoice.id) {
        <tr appRowLink [appRowMenu]="invoice" #row="appRowMenu">
          <td><a class="table-link" [routerLink]="[invoice.id]">{{ invoice.number }}</a></td>
          <td>{{ invoice.customerName }}</td>
          <td class="numeric"><vx-amount [value]="invoice.total" /></td>
          <td class="actions-column">…</td>
        </tr>
      }
    </tbody>
  </table>
</vx-table>
```

En el componente: `imports: [...VX_TABLE]` (o `...VX_UI`, que la incluye).

## Por qué un envoltorio y no una tabla construida con definiciones de columna

Las filas se quedan donde la página las escribe —su `@for`, sus celdas, sus enlaces, `appRowMenu`,
`appSort`, `appRowLink`—, así que la tabla conserva su semántica para el lector de pantalla y todas
las directivas que el producto ya da a las tablas, y una página pasa a `vx-table` sin reescribirse.

Lo que el componente se queda es lo que antes cambiaba de una página a otra sin que nadie lo
hubiera decidido. Había cinco maneras de pintar una tabla —`ds.data-table` dentro de una tarjeta con
sombra en las listas, `ui.table` sin caja en Configuración, `views.table-wrapper` en las vistas,
`.card` + `.data-table` en las páginas clásicas y `.lines-table` en los documentos— y en sus
diferencias no había ninguna decisión: el enlace de la primera columna era morado en unas listas y
negro en otras, la columna de acciones iba centrada en unas y a la derecha en otras, y un importe
solo se alineaba si su celda llevaba una de cuatro clases sinónimas. Ahora hay una hoja de estilos.

## Entradas

| Entrada | Valores | Para qué |
|---|---|---|
| `labelKey` | clave i18n | Nombra la tabla para el lector de pantalla (salvo que tenga `<caption>`, `aria-label` o `aria-labelledby` propios) y la región desplazable. |
| `label` | texto ya traducido | Lo mismo, para un nombre que se construye en ejecución (un estado, el título de un gráfico). |
| `layout` | `list` (por defecto) · `grid` | `list`: un registro por fila; en un contenedor estrecho, si no cabe como tabla, cada fila se apila como ficha «etiqueta: valor». `grid`: un informe, una matriz o las líneas de un documento; nunca se apila, se desplaza de lado. |
| `frame` | `box` (por defecto) · `none` | `box`: una región con borde sobre el lienzo de la página. `none`: dentro de algo que ya la delimita (un grupo de Configuración, un diálogo, la sección de un formulario). Nunca sombra. |
| `stickyColumn` | booleano | En un `grid`, la primera columna queda a la vista al desplazar de lado. |
| `maxHeight` | longitud CSS | Las filas se desplazan por dentro a partir de esa altura, bajo una cabecera fija. |
| `density` | `auto` (por defecto) · `compact` · `comfortable` | `auto` sigue la preferencia de densidad de la persona. |
| `busy` | booleano | Se están refrescando las filas que se ven: siguen, atenuadas, con `aria-busy`. |
| `empty` | booleano | No hay filas: la cabecera se queda y debajo se dice (`[vxTableEmpty]` o `emptyKey`). |

En una lista dentro de `vx-list-shell`, la tabla ocupa el alto que queda y desplaza sus filas por
dentro, con la cabecera y la barra de herramientas a la vista. En cualquier otro sitio mide lo que
sus filas, salvo que se le dé `maxHeight`.

## El vocabulario de las columnas

Una celda dice qué contiene con una clase, en la cabecera **y** en las celdas:

| Clase | Qué es | Cómo se ve |
|---|---|---|
| `numeric` | Importes, cantidades, recuentos | A la derecha, cifras tabulares, sin partir. La flecha de orden va delante. |
| `actions-column` | Lo que se hace con la fila | Estrecha, sin partir, al final. Sin etiqueta al apilar. |
| `select-column` | La casilla de selección | La escriben `vxSelectAll` y `vxSelect`. |
| `text-center` | Una marca corta (un icono de estado) | Centrada. |
| `nowrap` | Un código o una fecha que no debe partirse | En una línea. |
| `title-column` | Lo que identifica la fila, cuando no es la primera columna (el número de un asiento) | Al apilarse, titula la ficha y va primero. Sin ella titula la primera columna. |

Y en el contenido: `.table-link` para el enlace que abre el registro (del color del texto, con peso;
la fila entera responde con `appRowLink`).

No hay alias: `text-right`, `num`, `amount` o `row-actions` en una celda los rechaza el verificador.

## Lo que hace con la tabla (`table-dom.ts`)

- **`data-label` en cada celda**, desde la cabecera de su columna: es la etiqueta de la ficha cuando
  la fila se apila. Una etiqueta que la página escribió se respeta; una celda que abarca varias
  columnas (un subtotal, un mensaje, una fila de detalle) no lleva.
- **Roles ARIA explícitos** en una `list`: una fila apilada es `display: block`, y el navegador deja
  de tratar como tabla lo que ya no se pinta como tabla. Los roles conservan las relaciones.
- **Una región con nombre y enfocable** cuando la tabla se desplaza (WCAG 2.1.1): con el teclado se
  puede desplazar aunque no tenga nada enfocable dentro.
- **Cabecera de varias filas**: cada fila se fija debajo de la anterior.

## Selección y acciones en lote

La página provee `ListSelectionService` (el mismo que usa el menú de fila para actuar sobre varias):

```html
<vx-table labelKey="inventory.products.title">
  <vx-bulk-bar>
    <button type="button" class="secondary-button" *appHasPermission="'products:edit'" (click)="archive()">…</button>
  </vx-bulk-bar>
  <table>
    <thead><tr><th vxSelectAll></th>…</tr></thead>
    <tbody>
      @for (row of rows(); track row.id) {
        <tr appRowLink [appRowMenu]="row"><td [vxSelect]="row.id" [vxSelectLabel]="row.name"></td>…</tr>
      }
    </tbody>
  </table>
</vx-table>
```

- La casilla de la cabecera dice «algunas» (mixta) cuando no están todas.
- Mayús+clic selecciona un rango; la casilla no abre la fila que hay detrás.
- `vx-bulk-bar` solo aparece con algo seleccionado, dice cuántos (anunciado con cortesía) y quita
  la selección. Sus acciones son las de la página, con los mismos permisos que las de la fila.

## Estados

La carga, el error y la lista vacía de una pantalla de lista los lleva `vx-list-shell`. Una tabla
fuera de una lista (las líneas de un documento, un informe) usa `empty` para decir que no hay filas
sin perder la cabecera, y `busy` para refrescar sin saltar.

## Fuera del alcance, a propósito

- **El punto de venta** (`apps/pos`) es otra aplicación, con su propio sistema de diseño: oscuro, de
  uso táctil y tokens `--pos-*` (ver `docs/pos.md`).
- **Una hoja impresa** (el ticket, la factura en papel) no es interfaz: no tiene tema, ni teléfono,
  ni nadie que la recorra con el teclado. Se maqueta una vez para el papel.
