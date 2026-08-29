import type * as Highcharts from 'highcharts';

/**
 * =============================================================================
 *  TEMA DE GRÁFICOS
 * =============================================================================
 *  Traduce los tokens del sistema de diseño a opciones de Highcharts.
 *
 *  ── El problema que resuelve ────────────────────────────────────────────────
 *  Cada widget del panel llevaba su propia paleta escrita a mano:
 *
 *      cashflow-chart     → upColor '#4ade80', color '#f87171'
 *      ar-aging-chart     → ['#4ade80', '#fbbf24', '#fb923c', '#f87171', '#ef4444']
 *      top-products-chart → ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa']
 *      invoice-status     → pagadas '#4ade80', …
 *
 *  Cuatro verdes distintos para el mismo concepto —«positivo»— en cuatro
 *  gráficos de la MISMA pantalla. Ninguna de esas paletas reaccionaba al tema,
 *  así que en modo oscuro los tonos claros vibraban sobre el fondo y en modo
 *  claro los saturados quemaban.
 *
 *  ── Cómo se resuelve ────────────────────────────────────────────────────────
 *  Los colores se LEEN del DOM en el momento de construir el gráfico, de forma
 *  que provienen del mismo `:root` que el resto de la interfaz. Un cambio de
 *  tema o de marca se refleja sin tocar ningún widget.
 *
 *  Se lee de `documentElement` y no de `body` porque es ahí donde viven los
 *  tokens y donde se conmuta `data-theme`; leer de `body` funcionaba por
 *  herencia, pero fallaba con cualquier token que un componente intermedio
 *  hubiera redefinido.
 * =============================================================================
 */

/** Lee un token y devuelve su valor calculado, o `fallback` si no existe. */
export function token(name: string, fallback = ''): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/** Compone `rgba()` a partir de una terna `--*-rgb` del sistema. */
export function tokenAlpha(rgbToken: string, alpha: number, fallback = ''): string {
  const triplet = token(rgbToken);
  return triplet ? `rgba(${triplet}, ${alpha})` : fallback;
}

/**
 * Paleta categórica: ocho series ordenadas por separación de matiz, de modo
 * que sigan siendo distinguibles en deuteranopía.
 */
export function categoricalPalette(): string[] {
  return Array.from({ length: 8 }, (_, i) => token(`--viz-${i + 1}`)).filter(Boolean);
}

/** Colores con carga semántica. Un único verde «positivo» para toda la app. */
export function semanticColors() {
  return {
    positive: token('--success-solid'),
    negative: token('--error-solid'),
    warning: token('--warning-solid'),
    info: token('--info-solid'),
    accent: token('--accent-solid'),
    neutral: token('--content-tertiary'),
  };
}

/**
 * Escala secuencial para métricas ordenadas (antigüedad de deuda, intensidad
 * de riesgo). Va de «sano» a «crítico» pasando por advertencia, así que el
 * ORDEN es informativo: no lo reordenes.
 */
export function severityScale(): string[] {
  return [
    token('--success-solid'),
    token('--viz-4'),
    token('--warning-solid'),
    token('--viz-8'),
    token('--error-solid'),
  ].filter(Boolean);
}

/**
 * Opciones base comunes a todos los gráficos: tipografía, rejilla, ejes,
 * leyenda y tooltip, todo tomado de los tokens.
 *
 * Se fusiona con las opciones propias del widget; lo que el widget defina
 * gana, de modo que esto es un punto de partida coherente y no una jaula.
 */
export function baseChartOptions(): Highcharts.Options {
  const content = token('--content-primary');
  const secondary = token('--content-secondary');
  const tertiary = token('--content-tertiary');
  const grid = token('--viz-grid');
  const axis = token('--viz-axis');
  const surface = token('--surface-overlay');
  const border = token('--border-default');
  const font = token('--font-sans');
  const radius = parseFloat(token('--radius-md', '6')) || 6;

  return {
    colors: categoricalPalette(),

    chart: {
      //  Transparente para que el gráfico adopte la superficie de su tarjeta,
      //  sea cual sea. Antes cada widget fijaba su propio fondo y quedaba un
      //  rectángulo de otro color dentro de la tarjeta al cambiar de tema.
      backgroundColor: 'transparent',
      style: { fontFamily: font },
      spacing: [8, 8, 8, 8],
    },

    title: { text: undefined },

    credits: { enabled: false },

    xAxis: {
      lineColor: border,
      tickColor: border,
      gridLineColor: grid,
      labels: { style: { color: axis, fontSize: '11px' } },
      title: { style: { color: secondary } },
    },

    yAxis: {
      gridLineColor: grid,
      lineColor: border,
      tickColor: border,
      labels: { style: { color: axis, fontSize: '11px' } },
      title: { style: { color: secondary } },
    },

    legend: {
      itemStyle: { color: secondary, fontWeight: '500', fontSize: '12px' },
      itemHoverStyle: { color: content },
      itemHiddenStyle: { color: tertiary },
    },

    tooltip: {
      backgroundColor: surface,
      borderColor: border,
      borderRadius: radius,
      style: { color: content, fontSize: '12px' },
      shadow: false,   // La sombra nativa de Highcharts ignora el tema
    },

    plotOptions: {
      series: {
        animation: prefersReducedMotion() ? false : { duration: 320 },
        states: {
          hover: { brightness: 0.08 },
          inactive: { opacity: 0.35 },
        },
      },
    },

    //  Highcharts necesita saber describir el gráfico a un lector de pantalla;
    //  sin esto, un panel financiero entero es invisible para quien no ve.
    accessibility: {
      enabled: true,
      keyboardNavigation: { enabled: true },
    },
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
