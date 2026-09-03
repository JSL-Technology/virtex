import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Handlebars from 'handlebars';

/**
 * The brand, as an email can render it.
 *
 * ## Why this file exists
 *
 * The interface takes its colour from `_theme.scss`, where every value is a custom property and
 * the browser resolves the theme. An email has neither: `var()` is unsupported in most clients,
 * `<style>` is stripped by some, and the recipient's dark mode is a media query the sender has
 * to anticipate. So the palette has to be written out again, in literal hexadecimal, inlined on
 * the elements themselves.
 *
 * Written out again is not the same as invented again. Every value below names the design-system
 * token it mirrors, so the two can be compared by reading rather than by rendering — and
 * `mail-brand.spec.ts` fails if one drifts from the other.
 *
 * The alternative — ten templates each with its own idea of the brand — is what this replaces.
 * Before this file, `password-reset` used `#0A66FF`, `billing-notice` used `#3498db`,
 * `verification-code` used Arial on `#f4f4f4`, and `user-invitation` had no styling at all: four
 * different products, as far as the recipient could tell.
 */
export const MAIL_BRAND = {
  // ── Superficies ────────────────────────────────────────────────────────────
  /** `--surface-canvas` · el lienzo detrás de la tarjeta */
  ground: '#f4f6fa',
  /** `--surface-raised` · la tarjeta */
  card: '#ffffff',
  /** `--surface-sunken` · cajas hundidas: código, URL de reserva */
  sunken: '#eff2f7',
  // ── Contenido ──────────────────────────────────────────────────────────────
  /** `--content-primary` */
  ink: '#11151d',
  /** `--content-secondary` · el cuerpo del mensaje */
  ink2: '#4a5266',
  /** `--content-tertiary` · pie y notas legales */
  ink3: '#626980',

  // ── Acento ─────────────────────────────────────────────────────────────────
  /** `--accent-solid` · relleno del botón */
  accent: '#5b37d9',
  /** `--accent-text` · enlaces sobre superficie clara */
  accentText: '#4a2ab5',
  /** `--accent-on-solid` */
  onAccent: '#ffffff',

  // ── Marca ──────────────────────────────────────────────────────────────────
  /** `--brand-from` · el violeta del símbolo */
  brand: '#6a47e8',

  // ── Tema oscuro ────────────────────────────────────────────────────────────
  //  Los mismos neutros de Teams que usa la aplicación, para que un correo
  //  abierto en modo oscuro sea reconociblemente el mismo producto.
  /** `$graphite-950` */
  darkGround: '#141414',
  /** `$graphite-900` */
  darkCard: '#242424',
  /** `$graphite-800` */
  darkSunken: '#333333',
  /** `--content-primary`, oscuro */
  darkInk: '#ffffff',
  /** `--content-secondary`, oscuro */
  darkInk2: '#d6d6d6',
  /** `--content-tertiary`, oscuro */
  darkInk3: '#adadad',
  /** `--accent-text`, oscuro · enlaces sobre superficie oscura */
  darkLink: '#a58fff',
  /** `--accent-solid`, oscuro */
  darkAccent: '#6a47e8',

  /**
   * La pila tipográfica.
   *
   * Inter primero, por si el cliente la tiene instalada; el resto son las caras
   * de sistema que más se le parecen. Una webfont NO se descarga: Gmail elimina
   * `@import` y `<link>`, así que anunciarla solo añade peso al mensaje.
   */
  font: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  /** Para el código de verificación, donde las cifras deben alinearse. */
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
} as const;

export type MailBrandKey = keyof typeof MAIL_BRAND;

/**
 * Registers the shared pieces of the email layout as Handlebars partials.
 *
 * Partials rather than a template per email: the shell —document, styles, dark-mode block,
 * header with the logo, footer— is written once and every message opts into it with
 * `{{#> shell}}`. A change to the button style is one edit, not ten.
 *
 * They are registered on the global Handlebars instance because that is the one
 * `@nestjs-modules/mailer`'s adapter compiles with; the adapter itself offers no hook for them.
 */
export function registerMailPartials(templatesDir: string): void {
  const dir = join(templatesDir, 'partials');
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.hbs')) continue;
    Handlebars.registerPartial(
      file.replace(/\.hbs$/, ''),
      readFileSync(join(dir, file), 'utf8'),
    );
  }
}
