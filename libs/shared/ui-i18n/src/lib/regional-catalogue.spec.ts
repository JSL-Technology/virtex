import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyRegionalCatalogue, type RegionalCatalogue } from './regional-catalogue';

/**
 * The per-country layer, checked against the real patches rather than a fixture.
 *
 * ## What this is defending
 *
 * The audit's finding was that the architecture could not express a per-country exception at all:
 * `es-DO` and `es-MX` shared one catalogue, so the year-end bonus was a *regalía pascual* to every
 * Spanish-speaking reader — a term that means nothing in Monterrey — and the tax identifier was an
 * RNC in Bogotá.
 *
 * A patch is easy to add and easy to have quietly stop working, in two ways that a unit test on a
 * fixture would not catch: the patch could name a key the catalogue no longer has, and switching
 * from one country to another could leave the previous country's words standing on the keys the new
 * one does not override. Both are checked here, against the files that actually ship.
 */
const ROOT = path.resolve(__dirname, '../../../../..');
const SOURCE = path.join(ROOT, 'libs', 'shared', 'locales', 'src');

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every key the base catalogue defines. */
const baseKeys = new Set(
  fs
    .readdirSync(path.join(SOURCE, 'base'))
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => Object.keys(readJson(path.join(SOURCE, 'base', f)))),
);

/** The patches, as the generator emits them. */
const regional: RegionalCatalogue = Object.fromEntries(
  fs
    .readdirSync(path.join(SOURCE, 'regional'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => [
      f.replace(/\.json$/, ''),
      Object.fromEntries(
        Object.entries(readJson(path.join(SOURCE, 'regional', f)))
          .filter(([key]) => !key.startsWith('$'))
          .map(([key, value]) => [key, String(value)]),
      ),
    ]),
);

describe('the regional layer', () => {
  it('covers the markets this product is sold in', () => {
    expect(Object.keys(regional).sort()).toEqual(
      ['en-US', 'es-AR', 'es-CL', 'es-CO', 'es-DO', 'es-MX', 'es-PE', 'pt-BR'].sort(),
    );
  });

  it('only overrides keys the base catalogue has', () => {
    const stale = Object.entries(regional).flatMap(([locale, patch]) =>
      Object.keys(patch)
        .filter((key) => !baseKeys.has(key))
        .map((key) => `${locale}: ${key}`),
    );
    expect(stale).toEqual([]);
  });

  it('stays small, because a patch is an exception and not a catalogue', () => {
    for (const [locale, patch] of Object.entries(regional)) {
      // A patch approaching the size of the catalogue means somebody has started translating a
      // country rather than correcting one, which is the maintenance cost this design avoids.
      expect(Object.keys(patch).length).toBeLessThan(baseKeys.size / 20);
      expect(Object.keys(patch).length).toBeGreaterThan(0);
      void locale;
    }
  });

  it('gives each market its own word for the year-end bonus', () => {
    const key = 'payroll.runs.type_label.christmas_bonus';
    const base = { [key]: 'Bonificación de fin de año' };

    expect(applyRegionalCatalogue(base, regional, 'es-DO')[key]).toBe('Regalía pascual');
    expect(applyRegionalCatalogue(base, regional, 'es-MX')[key]).toBe('Aguinaldo');
    expect(applyRegionalCatalogue(base, regional, 'es-CO')[key]).toBe('Prima de navidad');
    expect(applyRegionalCatalogue(base, regional, 'pt-BR')[key]).toBe('Décimo terceiro salário');
  });

  it('falls through to the neutral wording for a market with no patch', () => {
    const key = 'payroll.runs.type_label.christmas_bonus';
    const base = { [key]: 'Bonificación de fin de año' };

    // es-419 is the neutral locale and deliberately has no patch: it IS the base.
    expect(applyRegionalCatalogue(base, regional, 'es-419')[key]).toBe('Bonificación de fin de año');
    expect(applyRegionalCatalogue(base, regional, null)[key]).toBe('Bonificación de fin de año');
  });

  it('does not leave one country’s words behind when the locale changes', () => {
    const base = {
      'payroll.runs.type_label.christmas_bonus': 'Bonificación de fin de año',
      'hcm.employees.form.tss_nss': 'Número de seguridad social',
    };

    // Mexico overrides the bonus but not the social security label, so switching from the Dominican
    // Republic must restore the neutral one rather than keep "NSS (TSS)".
    const dominican = applyRegionalCatalogue(base, regional, 'es-DO');
    expect(dominican['hcm.employees.form.tss_nss']).toBe('NSS (TSS)');

    const mexican = applyRegionalCatalogue(base, regional, 'es-MX');
    expect(mexican['hcm.employees.form.tss_nss']).toBe('NSS (IMSS)');

    const neutral = applyRegionalCatalogue(base, regional, 'es-419');
    expect(neutral['hcm.employees.form.tss_nss']).toBe('Número de seguridad social');
  });

  it('ignores an override for a key the catalogue does not carry', () => {
    const merged = applyRegionalCatalogue({ 'a.b': 'kept' }, { 'es-DO': { 'x.y': 'ignored' } }, 'es-DO');
    expect(merged).toEqual({ 'a.b': 'kept' });
  });

  it('leaves the base object untouched', () => {
    const base = { 'payroll.runs.type_label.christmas_bonus': 'Bonificación de fin de año' };
    applyRegionalCatalogue(base, regional, 'es-DO');
    expect(base['payroll.runs.type_label.christmas_bonus']).toBe('Bonificación de fin de año');
  });
});
