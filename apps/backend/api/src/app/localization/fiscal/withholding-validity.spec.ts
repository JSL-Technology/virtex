import { TaxpayerType, applicableRegimes, findWithholdingScheme } from './withholding-regimes';

/** Withholding regimes apply on the document's date only (audit 2026-11-07, CMP-05). */
describe('withholding regimes in force', () => {
  const scheme = findWithholdingScheme('DO');
  const context = { payer: TaxpayerType.GOVERNMENT, payee: TaxpayerType.COMPANY, scope: 'SERVICES' as const };

  it('gives every built-in Dominican regime a start date and its legal basis', () => {
    for (const regime of scheme!.regimes) {
      expect(regime.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(regime.legalBasis.length).toBeGreaterThan(5);
    }
  });

  it('applies the State regimes after Ley 253-12 and not before', () => {
    expect(applicableRegimes(scheme, { ...context, on: '2026-08-01' }).map((r) => r.code)).toEqual(['DO-ITBIS-30-ESTADO', 'DO-ISR-5-ESTADO']);
    expect(applicableRegimes(scheme, { ...context, on: '2012-12-31' })).toEqual([]);
  });

  it('ends a regime the day its period ends', () => {
    const ended = { ...scheme!, regimes: scheme!.regimes.map((r) => ({ ...r, effectiveTo: '2026-06-30' })) };
    expect(applicableRegimes(ended, { ...context, on: '2026-06-30' })).toHaveLength(2);
    expect(applicableRegimes(ended, { ...context, on: '2026-07-01' })).toEqual([]);
  });
});
