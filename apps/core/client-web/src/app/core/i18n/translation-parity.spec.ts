import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';

/**
 * The two catalogues must describe the same product.
 *
 * `en.json` had drifted to 376 keys behind `es.json`, and because the app is configured with
 * `fallbackLang: 'es'` that did not surface as a missing string — it surfaced as Spanish text on
 * an English screen. Eighty-eight of those keys were the security and profile settings: the 2FA
 * setup, the recovery codes, the active-session list, the password change. For a product being
 * sold in the United States, the account-security screens rendering in Spanish is not a polish
 * issue.
 *
 * A silent fallback cannot be caught by looking at the app, so it is caught here instead.
 */
type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      Object.assign(out, flatten(value as Tree, path));
    } else {
      out[path] = value as string;
    }
  }
  return out;
}

const EN = flatten(en as unknown as Tree);
const ES = flatten(es as unknown as Tree);

describe('translation catalogues', () => {
  it('English defines every key Spanish defines', () => {
    expect(Object.keys(ES).filter((key) => !(key in EN))).toEqual([]);
  });

  it('Spanish defines every key English defines', () => {
    expect(Object.keys(EN).filter((key) => !(key in ES))).toEqual([]);
  });

  it('has no empty strings in either catalogue', () => {
    expect(Object.entries(EN).filter(([, v]) => !String(v).trim()).map(([k]) => k)).toEqual([]);
    expect(Object.entries(ES).filter(([, v]) => !String(v).trim()).map(([k]) => k)).toEqual([]);
  });

  /**
   * An interpolation that exists in one language and not the other renders a literal
   * `{{email}}` to whichever half of the customer base reads that language.
   */
  it('uses the same interpolation placeholders in both languages', () => {
    const placeholders = (value: string) =>
      [...String(value).matchAll(/{{\s*([\w.]+)\s*}}/g)].map((m) => m[1]).sort();

    const mismatched = Object.keys(EN)
      .filter((key) => key in ES)
      .filter((key) => placeholders(EN[key]).join(',') !== placeholders(ES[key]).join(','));

    expect(mismatched).toEqual([]);
  });

  /**
   * The account-security and profile screens are the ones that were rendering in Spanish for
   * English users, so they get an explicit floor rather than relying on the parity check alone.
   */
  it.each(['SETTINGS.SECURITY', 'SETTINGS.PROFILE', 'AUTH.STEP_UP', 'REGISTER', 'LOGIN'])(
    '%s is fully translated in English',
    (namespace) => {
      const keys = Object.keys(ES).filter((key) => key.startsWith(`${namespace}.`));
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.filter((key) => !(key in EN))).toEqual([]);
    },
  );
});
