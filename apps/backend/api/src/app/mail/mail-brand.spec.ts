import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { MAIL_BRAND } from './mail-brand';

/**
 * The email palette is the design system's, read back from the design system.
 *
 * ## Why this cannot be left to a comment
 *
 * An email cannot use `var(--accent-solid)`: most clients do not support custom properties, so
 * every colour has to be inlined as a literal. That makes `mail-brand.ts` a SECOND copy of the
 * palette, and a second copy is a copy that drifts. It already had: two values in the first
 * version of that file — the sunken surface and the tertiary ink — were eyeballed rather than
 * looked up, and were wrong by one step of the ramp. Nothing rendered incorrectly, which is
 * exactly the problem: a wrong grey in an email is invisible until somebody compares it to the
 * product side by side.
 *
 * So the SCSS is parsed here and the two are compared. When a designer changes
 * `--surface-canvas`, this test fails and names the value to change — instead of the emails
 * quietly becoming a slightly different product.
 *
 * ## What it does not check
 *
 * Only the colours the email actually mirrors. The type stacks are deliberately different (an
 * email cannot load a webfont), and the dark palette differs in role, not in value.
 */

/** The workspace root, found rather than counted: a moved file must not silently skip this. */
function workspaceRoot(): string {
  let dir = __dirname;
  while (!existsSync(join(dir, 'nx.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate the workspace root.');
    dir = parent;
  }
  return dir;
}

const DESIGN_SYSTEM = join(
  workspaceRoot(),
  'apps/core/client-web/src/assets/styles/design-system',
);

const primitives = readFileSync(
  join(DESIGN_SYSTEM, '_primitives.scss'),
  'utf8',
);
const theme = readFileSync(join(DESIGN_SYSTEM, '_theme.scss'), 'utf8');

/** `$neutral: ( 50: #f4f6fa, … )` → `{ '50': '#f4f6fa', … }` */
function ramp(name: string): Record<string, string> {
  const start = primitives.indexOf(`$${name}: (`);
  if (start === -1) throw new Error(`No such palette: $${name}`);
  const body = primitives.slice(start, primitives.indexOf(');', start));
  return Object.fromEntries(
    [...body.matchAll(/^\s*'?([\w-]+)'?:\s*(#[0-9a-f]{3,8}),/gim)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

const RAMPS: Record<string, Record<string, string>> = {
  neutral: ramp('neutral'),
  graphite: ramp('graphite'),
  iris: ramp('iris'),
  brand: ramp('brand'),
};

/** The body of one theme mixin, so `--content-primary` resolves per theme. */
function mixin(name: 'light' | 'dark'): string {
  const start = theme.indexOf(`@mixin ${name} {`);
  if (start === -1) throw new Error(`No such mixin: ${name}`);
  return theme.slice(start, theme.indexOf('\n}', start));
}

/**
 * Resolve one semantic token to the hex an email would have to inline.
 *
 * Handles both forms the theme uses: a literal (`--content-primary: #11151d;`) and a palette
 * lookup (`--surface-canvas: #{p.neutral(50)};`).
 */
function token(scope: 'light' | 'dark', name: string): string {
  const body = mixin(scope);
  const match = body.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'));
  if (!match) throw new Error(`No such token in ${scope}: --${name}`);
  const value = match[1].trim();

  const literal = value.match(/^(#[0-9a-f]{3,8})$/i);
  if (literal) return literal[1].toLowerCase();

  const lookup = value.match(/^#\{p\.(\w+)\((\d+|'[\w-]+')\)\}$/);
  if (lookup) {
    const step = lookup[2].replace(/'/g, '');
    const hex = RAMPS[lookup[1]]?.[step];
    if (!hex) throw new Error(`Unresolvable: ${value}`);
    return hex.toLowerCase();
  }
  throw new Error(`Unhandled token form for --${name}: ${value}`);
}

/** Every colour in `MAIL_BRAND`, next to the token it claims to mirror. */
const MIRRORS: Array<[keyof typeof MAIL_BRAND, 'light' | 'dark', string]> = [
  ['ground', 'light', 'surface-canvas'],
  ['card', 'light', 'surface-raised'],
  ['sunken', 'light', 'surface-sunken'],
  ['ink', 'light', 'content-primary'],
  ['ink2', 'light', 'content-secondary'],
  ['ink3', 'light', 'content-tertiary'],
  ['accent', 'light', 'accent-solid'],
  ['accentText', 'light', 'accent-text'],
  ['onAccent', 'light', 'accent-on-solid'],
  ['darkGround', 'dark', 'surface-canvas'],
  ['darkCard', 'dark', 'surface-raised'],
  ['darkSunken', 'dark', 'surface-active'],
  ['darkInk', 'dark', 'content-primary'],
  ['darkInk2', 'dark', 'content-secondary'],
  ['darkInk3', 'dark', 'content-tertiary'],
  ['darkLink', 'dark', 'accent-text'],
  ['darkAccent', 'dark', 'accent-solid'],
];

describe('the email palette', () => {
  it.each(MIRRORS)('%s mirrors --%s (%s theme)', (key, scope, name) => {
    expect(MAIL_BRAND[key]).toBe(token(scope, name));
  });

  it('takes the logotype colour from the brand tokens, not the interface accent', () => {
    // `--brand-*` is what `BrandingService` cannot overwrite. An email header painted with the
    // accent would change colour for every customer who picks their own.
    expect(MAIL_BRAND.brand).toBe(RAMPS.brand['from']);
    expect(MAIL_BRAND.brand).not.toBe(MAIL_BRAND.accent);
  });

  it('covers every colour it defines', () => {
    const colours = Object.entries(MAIL_BRAND)
      .filter(([, value]) => /^#[0-9a-f]{3,8}$/i.test(value))
      .map(([key]) => key);
    const checked = [...MIRRORS.map(([key]) => key as string), 'brand'];
    expect(colours.sort()).toEqual(checked.sort());
  });
});
