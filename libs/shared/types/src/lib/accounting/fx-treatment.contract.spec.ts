import {
  FX_TREATMENTS,
  defaultFxTreatmentForType,
  isFxTreatmentAllowedForType,
  summaryAccountFxSettingsFit,
} from './fx-treatment.contract';

/**
 * One rule for the client's account form and the server's chart of accounts (FIN-AC-03): which
 * accounts may be revalued, what an account is when nothing more is said, and what a summary
 * account may hold.
 */
describe('the foreign-currency treatment of an account', () => {
  const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

  it('revalues only balance-sheet accounts (IAS 21.23)', () => {
    expect(TYPES.filter((type) => isFxTreatmentAllowedForType(type, 'REVALUED'))).toEqual(['ASSET', 'LIABILITY']);
    expect(TYPES.every((type) => isFxTreatmentAllowedForType(type, 'HISTORICAL'))).toBe(true);
  });

  it('a liability is money owed unless said otherwise; an asset is not money unless said so', () => {
    expect(TYPES.map((type) => defaultFxTreatmentForType(type))).toEqual(['HISTORICAL', 'REVALUED', 'HISTORICAL', 'HISTORICAL', 'HISTORICAL']);
    expect(defaultFxTreatmentForType(null)).toBe('HISTORICAL');
  });

  it('a summary account has no treatment and no currency of its own', () => {
    expect(defaultFxTreatmentForType('LIABILITY', false)).toBe('HISTORICAL');
    expect(summaryAccountFxSettingsFit(false, 'HISTORICAL', null)).toBe(true);
    expect(summaryAccountFxSettingsFit(false, 'REVALUED', null)).toBe(false);
    expect(summaryAccountFxSettingsFit(false, 'HISTORICAL', 'USD')).toBe(false);
    for (const treatment of FX_TREATMENTS) {
      expect(summaryAccountFxSettingsFit(true, treatment, 'USD')).toBe(true);
    }
  });
});
