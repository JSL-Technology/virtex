import { isValidBic } from '../../common/validators/bank-identifiers.validator';
import { isValidDominicanTaxId } from '../../markets/do/identity';
import { BANK_KINDS } from '../entities/bank.entity';
import { DOMINICAN_BANKS } from './do-banks';
import { REFERENCE_BANKS, RETIRED_BICS, referenceBanksFor, retiredBic } from './index';

/**
 * The Dominican list is data a payment is routed by. These are the rules it was built under,
 * checked on every entry, so an edit that breaks one fails here rather than at a bank.
 */
describe('Dominican reference banks', () => {
  it('holds the 43 intermediaries the SB lists as operating, by kind', () => {
    const byKind = (kind: string) => DOMINICAN_BANKS.filter((bank) => bank.kind === kind).length;
    expect(DOMINICAN_BANKS).toHaveLength(43);
    expect(byKind('multiple_bank')).toBe(16);
    expect(byKind('savings_credit_bank')).toBe(14);
    expect(byKind('savings_loan_association')).toBe(10);
    expect(byKind('credit_corporation')).toBe(3);
    expect(DOMINICAN_BANKS.every((bank) => (BANK_KINDS as readonly string[]).includes(bank.kind))).toBe(true);
  });

  it('has one entry per institution, under any of its names', () => {
    const key = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const names = DOMINICAN_BANKS.flatMap((bank) => [key(bank.name), key(bank.legalName)]);
    expect(new Set(DOMINICAN_BANKS.map((bank) => key(bank.name))).size).toBe(43);
    expect(new Set(DOMINICAN_BANKS.map((bank) => key(bank.legalName))).size).toBe(43);
    // A short name never equals another institution's legal name.
    for (const bank of DOMINICAN_BANKS) {
      expect(names.filter((name) => name === key(bank.name)).length).toBeLessThanOrEqual(2);
    }
    expect(DOMINICAN_BANKS.every((bank) => bank.name.length <= 120 && bank.legalName.length <= 200)).toBe(true);
  });

  it('carries only connected BICs: well formed, not passive, not retired, and unique', () => {
    const bics = DOMINICAN_BANKS.map((bank) => bank.swiftBic).filter((bic): bic is string => !!bic);
    expect(bics).toHaveLength(25);
    expect(new Set(bics).size).toBe(bics.length);
    for (const bic of bics) {
      expect(isValidBic(bic)).toBe(true);
      expect(bic).toHaveLength(8);
      // ISO 9362: a `1` in the 8th position marks an institution not connected to SWIFT.
      expect(bic[7]).not.toBe('1');
      expect(retiredBic(bic)).toBeNull();
    }
  });

  it('gives as local code the BCRD participant code, which is the 11-character BIC', () => {
    for (const bank of DOMINICAN_BANKS) {
      if (!bank.localCode) continue;
      expect(bank.localCode).toMatch(/^[A-Z]{4}DO[A-Z0-9]{2}[A-Z0-9]{3}$/);
      if (bank.swiftBic) expect(bank.localCode.startsWith(bank.swiftBic)).toBe(true);
      else expect(bank.localCode[7]).toBe('1'); // passive: participant code without a SWIFT BIC
    }
    expect(DOMINICAN_BANKS.filter((bank) => bank.localCode && !bank.swiftBic).map((bank) => bank.name)).toEqual([
      'Asociación Duarte',
      'Asociación Peravia',
    ]);
  });

  it('leaves the BIC empty where sources conflict and nothing official settles it', () => {
    for (const name of ['Banco Adopem', 'Banco Confisa', 'Banco Fihogar']) {
      const bank = DOMINICAN_BANKS.find((entry) => entry.name === name);
      expect(bank).toMatchObject({ swiftBic: null, localCode: null });
    }
  });

  it('stores every RNC as 9 digits that pass the DGII check digit', () => {
    const withRnc = DOMINICAN_BANKS.filter((bank) => bank.taxId);
    expect(withRnc).toHaveLength(37);
    for (const bank of withRnc) {
      expect(bank.taxId).toMatch(/^\d{9}$/);
      expect(isValidDominicanTaxId(bank.taxId as string)).toBe(true);
    }
    expect(new Set(withRnc.map((bank) => bank.taxId)).size).toBe(withRnc.length);
  });

  it('cites the regulator first for every entry', () => {
    for (const bank of DOMINICAN_BANKS) {
      expect(bank.sources[0]).toMatch(/^https:\/\/sb\.gob\.do\/supervisados\/entidades-de-intermediacion-financiera\//);
    }
  });

  it('is offered by country, case aside, and not where no list is shipped', () => {
    expect(referenceBanksFor('do')).toBe(DOMINICAN_BANKS);
    expect(referenceBanksFor('MX')).toEqual([]);
    expect(referenceBanksFor(null)).toEqual([]);
    expect(Object.keys(REFERENCE_BANKS)).toEqual(['DO']);
  });

  it('recognises a retired BIC with or without a branch code', () => {
    expect(retiredBic('belndosdxxx')).toMatchObject({ bic: 'BELNDOSD', successor: 'AHRIDOS2' });
    expect(retiredBic('AHCSDOSD')).toMatchObject({ successor: null });
    expect(retiredBic('BCBHDOSD')).toBeNull();
    expect(retiredBic(null)).toBeNull();
    for (const retired of RETIRED_BICS) {
      if (retired.successor) expect(DOMINICAN_BANKS.some((bank) => bank.swiftBic === retired.successor)).toBe(true);
    }
  });
});
