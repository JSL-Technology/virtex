import { coverageFor, payrollImplemented } from '../localization/contracts/country-profile.contract';
import { JurisdictionRegistry } from './jurisdiction-registry';

/**
 * The disclosure and the engine say the same thing about payroll (audit 2026-11-07, JUR-02).
 *
 * `fiscal-coverage.ts` did not declare payroll at all, so a Mexican company learnt there was no
 * payroll for Mexico from the error of its first run, after paying. Every market now states it, and
 * the statement is checked against the strategies that actually exist.
 */
describe('payroll coverage', () => {
  const registry = new JurisdictionRegistry();
  const markets = ['DO', 'US', 'MX', 'CO', 'CL', 'PE', 'AR', 'BR', 'EC', 'UY', 'PY', 'BO', 'VE', 'PA', 'CR', 'GT', 'SV', 'HN', 'NI'];

  it.each(markets)('%s states payroll, and the statement matches the registry', (country) => {
    expect(coverageFor(country).capabilities.filter((c) => c.capability === 'payroll')).toHaveLength(1);
    expect(payrollImplemented(country)).toBe(registry.supports(country));
  });
});
