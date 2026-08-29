/**
 * =============================================================================
 *  UTILIDADES DE COLOR
 * =============================================================================
 *  Matemática de color conforme a WCAG 2.1, para el único punto de la
 *  aplicación donde los colores se calculan en tiempo de ejecución: la
 *  personalización de marca por cliente.
 *
 *  Todo lo demás usa tokens estáticos ya verificados. Aquí no hay elección
 *  posible: el acento lo elige el cliente en un selector, así que la
 *  legibilidad del resultado hay que CALCULARLA, no confiarla a que el color
 *  elegido resulte razonable.
 * =============================================================================
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Analiza `#rgb`, `#rrggbb` o `rgb(r, g, b)`. Devuelve `null` si no es válido. */
export function parseColor(input: string): Rgb | null {
  const value = input.trim();

  const hex = value.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return { r: parts[0], g: parts[1], b: parts[2] };
    }
  }

  return null;
}

const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
}

export function toRgbTriplet({ r, g, b }: Rgb): string {
  return `${clamp(r)}, ${clamp(g)}, ${clamp(b)}`;
}

/**
 * Luminancia relativa según WCAG 2.1.
 *
 * Es lo que la implementación anterior no hacía. Su comprobación era:
 *
 *     parseInt(hex.replace('#',''), 16) > 0xffffff / 2 ? '#000' : '#fff'
 *
 * Eso interpreta el color como UN entero de 24 bits, con lo que el resultado
 * queda dominado por el canal rojo y los otros dos apenas cuentan. Para
 * `#00ff00` —verde puro, uno de los colores más luminosos que existen— da
 * 0x00ff00 = 65 280, por debajo del umbral, y devuelve texto BLANCO sobre
 * verde brillante: contraste 1.4:1, ilegible.
 *
 * El ojo humano no percibe los tres canales por igual: el verde aporta ~72 %
 * de la luminancia percibida y el azul apenas un 7 %. Esos son los
 * coeficientes de abajo.
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const s = clamp(value) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Razón de contraste WCAG entre dos colores. Rango 1:1 … 21:1. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * Elige entre texto blanco o negro sobre un fondo dado, el que más contraste
 * ofrezca. Siempre devuelve al menos 4.5:1 — para cualquier color, blanco o
 * negro alcanzan ese umbral, porque sus luminancias son los extremos.
 */
export function readableTextOn(background: Rgb): Rgb {
  return contrastRatio(WHITE, background) >= contrastRatio(BLACK, background)
    ? WHITE
    : BLACK;
}

/** Mezcla lineal entre dos colores. `weight` 0 devuelve `a`; 1 devuelve `b`. */
export function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  const w = Math.max(0, Math.min(1, weight));
  return {
    r: a.r + (b.r - a.r) * w,
    g: a.g + (b.g - a.g) * w,
    b: a.b + (b.b - a.b) * w,
  };
}

export const lighten = (color: Rgb, amount: number): Rgb => mix(color, WHITE, amount);
export const darken = (color: Rgb, amount: number): Rgb => mix(color, BLACK, amount);

/**
 * Ajusta `color` hacia blanco o hacia negro —lo que haga falta— hasta que
 * alcance `targetRatio` contra `background`.
 *
 * Es la pieza que hace segura la personalización de marca. Un cliente puede
 * elegir como acento un azul marino oscuro; sobre el tema oscuro ese azul es
 * prácticamente invisible. En lugar de mostrar texto ilegible o de rechazar la
 * elección, se conserva el matiz del cliente y se ajusta solo la luminosidad
 * hasta que sea legible.
 *
 * Búsqueda binaria sobre la cantidad de mezcla: 24 iteraciones bastan para
 * quedar por debajo del error de redondeo a 8 bits.
 */
export function ensureContrast(
  color: Rgb,
  background: Rgb,
  targetRatio = 4.5
): Rgb {
  if (contrastRatio(color, background) >= targetRatio) return color;

  //  Si el fondo es oscuro se aclara el color; si es claro, se oscurece.
  const towards = relativeLuminance(background) < 0.5 ? WHITE : BLACK;

  let low = 0;
  let high = 1;
  let best = mix(color, towards, 1);

  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    const candidate = mix(color, towards, middle);

    if (contrastRatio(candidate, background) >= targetRatio) {
      best = candidate;
      high = middle;   // Se busca el ajuste MÍNIMO que cumple
    } else {
      low = middle;
    }
  }

  return best;
}

/**
 * Genera una escala de 10 tramos a partir de un color base, que ocupa el 500.
 * Se usa para las variantes de hover/activo de un acento personalizado.
 */
export function generateScale(base: Rgb): Record<number, Rgb> {
  return {
    50: mix(WHITE, base, 0.08),
    100: mix(WHITE, base, 0.16),
    200: mix(WHITE, base, 0.32),
    300: mix(WHITE, base, 0.52),
    400: mix(WHITE, base, 0.76),
    500: base,
    600: darken(base, 0.14),
    700: darken(base, 0.28),
    800: darken(base, 0.42),
    900: darken(base, 0.56),
  };
}
