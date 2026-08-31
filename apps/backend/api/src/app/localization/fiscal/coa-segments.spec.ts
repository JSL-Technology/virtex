import { AccountTemplateDto } from '../entities/coa-template.entity';
import {
  buildCountryCoaTemplate,
  coaCodeLength,
  coaSegmentsFor,
  splitCoaCode,
} from './coa-builder';
import { supportedCountryCodes } from './country-profiles';

/**
 * The account CODE and the account-code STRUCTURE must describe the same thing.
 *
 * They did not. `coa-builder` emitted one segment per account while
 * `AccountSegmentsService.initializeDefault` wrote a fixed four-level structure into every
 * organization, and `ChartOfAccountsService.create` refuses any account whose segment count
 * differs from the organization's definition. The result was that provisioning threw on the very
 * first account of every tenant, in every market — invisible to the whole test suite, because the
 * one script that claimed to prove provisioning replaced the real service with a stub that does
 * not validate segments.
 *
 * These tests are the invariant that makes the pair inseparable. They run over every supported
 * country, so opening a market or adding a statutory plan cannot reintroduce the mismatch.
 */

function flatten(template: AccountTemplateDto[]): AccountTemplateDto[] {
  return template.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

describe('chart-of-accounts segment structure', () => {
  const countries = supportedCountryCodes();

  it('covers every supported market (guards against a silently empty sweep)', () => {
    expect(countries.length).toBeGreaterThanOrEqual(19);
  });

  describe.each(countries)('%s', (country) => {
    const accounts = flatten(buildCountryCoaTemplate(country));
    const specs = coaSegmentsFor(country);

    it('produces a non-empty chart', () => {
      expect(accounts.length).toBeGreaterThan(20);
    });

    it('declares at least one segment', () => {
      expect(specs.length).toBeGreaterThan(0);
      expect(specs.every((spec) => spec.length > 0)).toBe(true);
    });

    it('emits exactly as many segments per account as the country declares', () => {
      for (const account of accounts) {
        expect(account.segments).toHaveLength(specs.length);
      }
    });

    it('emits segments whose lengths match the declared structure', () => {
      for (const account of accounts) {
        account.segments.forEach((value, index) => {
          expect(value).toHaveLength(specs[index].length);
        });
      }
    });

    it('produces unique account codes', () => {
      const codes = accounts.map((account) => account.segments.join('-'));
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('round-trips a code through splitCoaCode', () => {
      const sample = '1'.padEnd(coaCodeLength(country), '0');
      expect(splitCoaCode(country, sample).join('')).toBe(sample);
    });

    it('rejects a code that does not fit the structure rather than truncating it', () => {
      expect(() => splitCoaCode(country, '1')).toThrow(/no encaja en la estructura/);
    });
  });
});
