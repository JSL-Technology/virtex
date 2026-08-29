# Sistema de diseño de Virtex

Guía de referencia para construir interfaz en Virtex. Si vas a escribir CSS en
este repositorio, esto es lo que necesitas saber.

---

## La regla

**Nunca escribas un color literal.** Ni `#4ade80`, ni `rgba(74, 222, 128, .15)`,
ni `green`. Usa un token semántico.

```scss
// no
.saldo-vencido { color: #ef4444; background: rgba(239, 68, 68, 0.1); }

// sí
.saldo-vencido { color: var(--error-text); background: var(--error-surface); }
```

No es una cuestión de estilo. Un literal solo conoce un tema, así que en cuanto
el usuario cambia a oscuro deja de funcionar. El token sabe en qué tema está.

`npm run lint:design-system` rechaza los literales, de modo que la regla se
comprueba sola.

---

## Arquitectura

Tres capas, cada una con un único cometido.

```
assets/styles/
├── design-system/
│   ├── _primitives.scss   Escalas cromáticas crudas (SCSS, privadas)
│   ├── _theme.scss        Tokens semánticos, claro + oscuro   ← el contrato
│   ├── _scales.scss       Tipografía, espaciado, radios, movimiento, z-index
│   ├── _breakpoints.scss  Mixins responsivos
│   ├── _mixins.scss       Patrones de interfaz reutilizables
│   ├── _compat.scss       Alias heredados (en retirada)
│   └── _index.scss        API pública para componentes
├── base/
│   ├── _reset.scss        Reinicio
│   ├── _elements.scss     Estilos por defecto de elementos nativos
│   └── _a11y.scss         Foco, movimiento reducido, contraste forzado
├── vendor/
│   └── _dockview.scss     Adaptación de Dockview a nuestros tokens
└── _utilities.scss        Clases globales mínimas
```

Las **primitivas** son variables SCSS, no custom properties. Eso no es un
detalle: al vivir solo en tiempo de compilación, una plantilla no puede
alcanzarlas. La barrera es física, no una convención que se acabe olvidando.

---

## Uso desde un componente

```scss
@use 'assets/styles/design-system' as ds;

.panel-de-asientos {
  background-color: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-4);

  @include ds.focus-ring;
  @include ds.bp-up('md') { padding: var(--space-6); }
}
```

Los tokens **no se importan**: son globales desde que `styles.scss` los emite.
Solo se importan mixins y funciones.

---

## Tokens

### Superficies — de más profunda a más elevada

| Token | Uso |
|---|---|
| `--surface-canvas` | Fondo de la aplicación |
| `--surface-base` | Superficie de contenido por defecto |
| `--surface-raised` | Tarjetas, paneles |
| `--surface-overlay` | Modales, popovers, menús |
| `--surface-sunken` | Campos, pozos, cabeceras de tabla |
| `--surface-hover` / `--surface-active` | Estados de interacción |
| `--surface-selected` | Fila o elemento seleccionado |
| `--surface-inverse` | Tooltips y avisos de alto contraste |

La elevación se comunica al revés en cada tema y es deliberado: en **oscuro**
cada nivel *aclara* la superficie (más cerca de la luz); en **claro** todas son
blancas y las separa la *sombra*. Así funciona la luz de verdad.

### Contenido

`--content-primary` (AAA) · `--content-secondary` · `--content-tertiary` ·
`--content-disabled` · `--content-inverse` · `--content-link`

### Bordes

| Token | Cuándo |
|---|---|
| `--border-subtle` | Separadores decorativos |
| `--border-default` | Contorno estándar de componente |
| `--border-strong` | Cuando el borde es el **único** indicador del límite de un control. Cumple 3:1 |
| `--border-focus` | Anillo de foco |

Un campo de formulario usa `--border-strong`. Un separador entre filas usa
`--border-subtle`.

### Acento y estados

Cada familia (`accent`, `success`, `warning`, `error`, `info`) publica el mismo
juego de roles:

| Sufijo | Qué es |
|---|---|
| `-solid` | **Relleno.** Lleva texto encima |
| `-on-solid` | El texto que va sobre ese relleno |
| `-text` | **Texto** de ese color sobre una superficie normal |
| `-surface` | Fondo tenue para bandas y etiquetas |
| `-border` | Borde a juego con `-surface` |
| `-rgb` | Terna para componer opacidades |

**`-solid` y `-text` no son intercambiables.** Resuelven restricciones
opuestas: `-solid` debe contrastar con el texto que lleva encima, `-text` debe
contrastar con la superficie sobre la que se apoya. Usar uno por otro es el
error que dejaba el texto de todos los botones primarios en 3.22:1.

```scss
.btn-guardar   { background: var(--accent-solid); color: var(--accent-on-solid); }
.enlace-factura{ color: var(--accent-text); }
.banda-error   { background: var(--error-surface); border-color: var(--error-border);
                 color: var(--error-text); }
```

### Opacidad

Con la terna `-rgb`, nunca con un literal:

```scss
box-shadow: 0 0 0 3px rgba(var(--accent-solid-rgb), 0.22);
```

### Visualización de datos

`--viz-1` … `--viz-8` (categórica, separada por matiz para deuteranopía), sus
`--viz-N-rgb`, más `--viz-grid` y `--viz-axis`.

En TypeScript hay que leerlos del DOM, no repetirlos:

```ts
import { categoricalPalette, semanticColors, baseChartOptions }
  from 'app/core/utils/chart-theme';
```

Un concepto, un color: «positivo» es `semanticColors().positive` en todos los
gráficos, no un verde distinto en cada widget.

---

## Escalas

**Tipografía** — `--text-2xs` (11px) · `xs` 12 · `sm` 13 · `md` **14, base de
la interfaz** · `base` 15 · `lg` 17 · `xl` 20 · `2xl` 24 · `3xl` 30 · `4xl` 36.

Pesos: `--font-regular|medium|semibold|bold`.

**Espaciado** — rejilla de 4px: `--space-1` (4px) … `--space-24` (96px).

**Radios** — `--radius-xs|sm|md|lg|xl|2xl|full`. `--radius-md` es el radio de
marca y el resto se deriva de él.

**Movimiento** — `--duration-instant|fast|normal|slow|deliberate` y
`--ease-standard|decelerate|accelerate|spring`.

Las duraciones se anulan solas bajo `prefers-reduced-motion`, así que un
componente que use los tokens ya respeta la preferencia sin comprobarla.

**Apilamiento** — `--z-base` … `--z-tooltip`. Escala con nombre; nunca `9999`.

**Puntos de ruptura** — `xs` 480 · `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 ·
`2xl` 1536, y solo por mixin:

```scss
@include ds.bp-up('md')   { }   // preferido: mobile-first
@include ds.bp-down('md') { }   // solo para adaptar código heredado
@include ds.bp-touch      { }   // hay dedo, no ratón
```

---

## Mixins

Botones `ds.button-primary|secondary|ghost|danger|icon|link`, formularios
`ds.input-base`, `ds.field-label|hint|error`, superficies `ds.surface-card|
overlay`, datos `ds.data-table`, `ds.badge($variante)`, `ds.numeric`, diálogos
`ds.modal-scrim`, `ds.modal-panel`, y utilidades `ds.focus-ring`,
`ds.transition`, `ds.truncate`, `ds.skeleton`, `ds.empty-state`, `ds.scrollbar`.

`ds.transition()` exige propiedades explícitas a propósito. `transition: all`
obliga al motor a vigilarlas todas y hace que los colores «repten» al cambiar
de tema en lugar de conmutar en seco.

---

## Temas

El tema se resuelve por atributo en `<html>`:

| Estado | Resultado |
|---|---|
| `data-theme="light"` | Claro, aunque el sistema esté en oscuro |
| `data-theme="dark"` | Oscuro, aunque el sistema esté en claro |
| Sin atributo | Lo que diga `prefers-color-scheme` |

Que el tercer caso sea CSS puro es lo que permite pintar el tema correcto en el
primer fotograma. Un script embebido en `index.html` aplica el atributo antes
de que se resuelva la hoja de estilos, de modo que no hay destello.

Ortogonales: `data-contrast="high"` refuerza bordes y texto tenue sobre
*cualquiera* de los dos temas; `data-density="compact"` ciñe las alturas de
control.

Para tematizar un subárbol —una previsualización que muestre claro y oscuro a
la vez— existe `data-theme-scope="light|dark"`.

Todo esto lo gobierna **`ThemeService`, y solo él**. `BrandingService` delega.

---

## Personalización de marca

Una organización puede fijar acento, tipografía, radio, densidad, ancho y
logotipo. `BrandingService` sobrescribe tokens concretos en `:root`; el resto
sigue viniendo del sistema.

Los **neutros no son personalizables**. Son los que sostienen el contraste
verificado de toda la interfaz, y dejarlos abiertos permitía volver ilegible la
aplicación entera desde un selector de color.

El acento sí, porque su legibilidad se **calcula**: `ensureContrast()` conserva
el matiz elegido y ajusta solo la luminosidad hasta alcanzar 4.5:1 contra la
superficie del tema activo. Un azul marino corporativo sirve como relleno y
aparece aclarado cuando actúa como texto sobre fondo oscuro.

---

## Accesibilidad

El contrato está verificado, no prometido: `npm run lint:contrast` comprueba
las **150** parejas texto/superficie de ambos temas contra WCAG 2.1 leyendo el
CSS **compilado**.

| Elemento | Mínimo |
|---|---|
| Texto principal | 7:1 (AAA) |
| Texto secundario y terciario | 4.5:1 (AA) |
| Texto sobre relleno | 4.5:1 (AA) |
| Bordes que delimitan un control | 3:1 |

Si cambias un color en `_theme.scss`, vuelve a ejecutarlo. Los valores no son
estéticos por casualidad: son la solución de una restricción.

Además, de forma global: anillo de foco en todo elemento enfocable,
`prefers-reduced-motion` respetado en el origen, modo de contraste forzado de
Windows contemplado, objetivos táctiles de 44px y enlace de «saltar al
contenido».

---

## Comprobaciones

```bash
npm run lint:design-system   # ambas
npm run lint:tokens          # literales, tokens fantasma, secuestro de tokens
npm run lint:contrast        # WCAG sobre el CSS compilado
```

`lint:tokens` comprueba tres cosas:

1. **Colores literales** fuera de las capas que tienen derecho a definirlos.
2. **Tokens usados pero nunca definidos.** Una `var()` sin definir no hereda:
   descarta la declaración entera. Así llevaban tiempo 41 archivos pintando
   bordes invisibles, y nada lo señalaba.
3. **Componentes que redefinen un token global.** Redeclarar `--text-primary`
   en un `:host` lo secuestra para todo el subárbol; es lo que hacía que las
   pantallas de acceso ignorasen el tema.

---

## Añadir un componente

1. `@use 'assets/styles/design-system' as ds;`
2. Solo tokens; ningún literal.
3. Mixins antes que reimplementar un botón o una tabla.
4. Míralo en claro **y** en oscuro.
5. Recórrelo con el tabulador: todo lo interactivo debe mostrar foco.
6. `npm run lint:design-system`.

Si te falta un token, **añádelo a `_theme.scss` en los dos temas** — no lo
resuelvas con un literal en el componente. Un token que falta es una señal de
que el sistema tiene un hueco, y el hueco se tapa en el sistema.

---

## Capa de compatibilidad

`_compat.scss` mantiene vivos los nombres heredados (`--bg-primary`,
`--text-primary`, `--card-bg-color`…) apuntándolos a tokens reales, para que la
migración fuera incremental y verificable en lugar de un cambio irrepetible de
174 archivos.

Es un andamio, no arquitectura. **No añadas alias nuevos.** Cada uno desaparece
cuando migra su último consumidor.
