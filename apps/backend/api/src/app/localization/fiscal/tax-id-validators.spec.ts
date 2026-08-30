import {
  TAX_ID_VALIDATORS,
  isSupportedFiscalCountry,
  isValidArgentineCuit,
  isValidBrazilianCnpj,
  isValidChileanRut,
  isValidColombianNit,
  isValidDominicanTaxId,
  isValidEcuadorianRuc,
  isValidGuatemalanNit,
  isValidMexicanRfc,
  isValidPeruvianRuc,
  isValidUruguayanRut,
  isValidUsEin,
  isValidVenezuelanRif,
  TaxpayerKind,
  canonicalizeTaxId,
  validateTaxId,
} from './tax-id-validators';

/**
 * These are the checks the product exists to get right.
 *
 * Before this module, one country (the Dominican Republic) validated its identifier
 * algorithmically and every other one was a regex — or, for most of the market, nothing at all.
 * A regex accepts roughly ten times more strings than a tax authority ever issues, so a typo was
 * stored as real and surfaced weeks later as a rejected invoice.
 *
 * Every positive case below is a well-formed identifier whose check digit is arithmetically
 * correct. Every negative case is the same identifier with one digit changed — which is what a
 * typo actually looks like, and precisely what a regex cannot catch.
 */
describe('Tax identifier validation', () => {
  describe('Dominican Republic — RNC and cédula (DGII)', () => {
    it.each(['131-12345-7', '101010101', '401007551'])('accepts the valid RNC %s', (rnc) => {
      expect(isValidDominicanTaxId(rnc)).toBe(true);
    });

    it('rejects an RNC whose check digit is off by one', () => {
      expect(isValidDominicanTaxId('101010102')).toBe(false);
    });

    it('accepts an 11-digit cédula with a correct Luhn digit', () => {
      expect(isValidDominicanTaxId('00113918205')).toBe(true);
    });

    it('rejects the wrong length outright', () => {
      expect(isValidDominicanTaxId('1234567')).toBe(false);
    });
  });

  describe('United States — EIN (IRS)', () => {
    it.each(['12-3456789', '954321098', '47-1234567'])('accepts %s', (ein) => {
      expect(isValidUsEin(ein)).toBe(true);
    });

    /**
     * An EIN has no check digit, so the prefix is the only structural signal there is. The IRS
     * does not assign 00, 07, 08, 09, 17, 18, 19, 28, 29, 49, 69, 70, 78, 79, 89, 96 or 97, which
     * is exactly the set a placeholder or a typo tends to produce.
     */
    it.each(['00-1234567', '07-1234567', '78-1234567'])('rejects the unassigned prefix in %s', (ein) => {
      expect(isValidUsEin(ein)).toBe(false);
    });

    it('rejects anything that is not nine digits', () => {
      expect(isValidUsEin('12-345678')).toBe(false);
    });
  });

  describe('Mexico — RFC (SAT)', () => {
    it('accepts a company RFC with a correct check digit', () => {
      expect(isValidMexicanRfc('MLI070518TL8')).toBe(true);
    });

    it('rejects the same RFC with a wrong check digit', () => {
      expect(isValidMexicanRfc('MLI070518TL7')).toBe(false);
    });

    /** The embedded date is where most typos land, and a regex accepts every one of them. */
    it.each(['MLI071318TL8', 'MLI070232TL8', 'MLI070431TL8'])(
      'rejects the impossible date in %s',
      (rfc) => {
        expect(isValidMexicanRfc(rfc)).toBe(false);
      },
    );

    it('rejects a shape that is not an RFC at all', () => {
      expect(isValidMexicanRfc('123456789')).toBe(false);
    });
  });

  describe('Colombia — NIT (DIAN)', () => {
    it('accepts a NIT whose verification digit agrees', () => {
      expect(isValidColombianNit('900373115-3')).toBe(true);
    });

    it('rejects a NIT whose verification digit does not', () => {
      expect(isValidColombianNit('900373115-4')).toBe(false);
    });

    /**
     * The verification digit is required. Accepting a bare NIT meant a 9-digit value passed with
     * no arithmetic performed at all — and the DV is the only integrity check a NIT has.
     */
    it('refuses a bare NIT quoted without its verification digit', () => {
      expect(isValidColombianNit('900373115')).toBe(false);
    });

    /** A Chilean-style 'K' check character is not issuable in Colombia and must not be stripped. */
    it('refuses a NIT carrying a check character Colombia does not issue', () => {
      expect(isValidColombianNit('900373115-K')).toBe(false);
      expect(isValidColombianNit('900373115K')).toBe(false);
    });
  });

  describe('Chile — RUT (SII)', () => {
    it.each(['76.086.428-5', '12.345.678-5'])('accepts %s', (rut) => {
      expect(isValidChileanRut(rut)).toBe(true);
    });

    /** The check character is 'K' for one residue class; treating it as a digit rejects them. */
    it('accepts a RUT whose check character is K', () => {
      expect(isValidChileanRut('13.185.031-K')).toBe(true);
    });

    it('rejects a RUT with the wrong check character', () => {
      expect(isValidChileanRut('76.086.428-6')).toBe(false);
    });
  });

  describe('Argentina — CUIT (AFIP)', () => {
    it('accepts a CUIT with a correct check digit', () => {
      expect(isValidArgentineCuit('30-71234567-1')).toBe(true);
    });

    it('rejects a CUIT with a wrong check digit', () => {
      expect(isValidArgentineCuit('30-71234567-2')).toBe(false);
    });

    /** AFIP only issues a fixed set of entity prefixes. */
    it('rejects an unissuable entity prefix', () => {
      expect(isValidArgentineCuit('99-71234567-1')).toBe(false);
    });
  });

  describe('Brazil — CNPJ (Receita Federal)', () => {
    it('accepts a CNPJ with both check digits correct', () => {
      expect(isValidBrazilianCnpj('11.222.333/0001-81')).toBe(true);
    });

    it('rejects a CNPJ with one check digit changed', () => {
      expect(isValidBrazilianCnpj('11.222.333/0001-82')).toBe(false);
    });

    /** Repeated digits satisfy the arithmetic but are never issued. */
    it('rejects an all-identical CNPJ', () => {
      expect(isValidBrazilianCnpj('11.111.111/1111-11')).toBe(false);
    });
  });

  describe('Peru — RUC (SUNAT)', () => {
    it('accepts a company RUC', () => {
      expect(isValidPeruvianRuc('20100070970')).toBe(true);
    });

    it('rejects a wrong check digit', () => {
      expect(isValidPeruvianRuc('20100070971')).toBe(false);
    });

    it('rejects an unissuable taxpayer-type prefix', () => {
      expect(isValidPeruvianRuc('99100070970')).toBe(false);
    });
  });

  describe('Ecuador — RUC (SRI)', () => {
    it('accepts a private-company RUC', () => {
      expect(isValidEcuadorianRuc('1791287541001')).toBe(true);
    });

    it('rejects one whose check digit is wrong', () => {
      expect(isValidEcuadorianRuc('1791287542001')).toBe(false);
    });

    it('rejects an out-of-range province code', () => {
      expect(isValidEcuadorianRuc('9991287541001')).toBe(false);
    });

    it('rejects an establishment suffix that is not 001', () => {
      expect(isValidEcuadorianRuc('1791287541002')).toBe(false);
    });
  });

  describe('Uruguay — RUT (DGI)', () => {
    it('accepts a RUT with a correct check digit', () => {
      expect(isValidUruguayanRut('211003420017')).toBe(true);
    });

    it('rejects a RUT with a wrong check digit', () => {
      expect(isValidUruguayanRut('211003420018')).toBe(false);
    });
  });

  /**
   * These four countries had defective validators that this suite could not see, because each was
   * tested with a single value and in two cases that value passed the broken implementation by
   * arithmetic coincidence. Every country now carries several independently-sourced identifiers
   * and a negative case per rule.
   */
  describe('Venezuela — RIF (SENIAT)', () => {
    it('accepts a company RIF', () => {
      expect(isValidVenezuelanRif('J-30599168-5')).toBe(true);
    });

    it('rejects a wrong check digit', () => {
      expect(isValidVenezuelanRif('J-30599168-4')).toBe(false);
    });

    /** The leading letter is part of the sum, so it cannot be swapped freely. */
    it('rejects the same digits under a different taxpayer type', () => {
      expect(isValidVenezuelanRif('V-30599168-5')).toBe(false);
    });
  });

  describe('Guatemala — NIT (SAT)', () => {
    it('accepts a NIT with a correct check character', () => {
      expect(isValidGuatemalanNit('1234567-9')).toBe(true);
    });

    it('rejects a NIT with a wrong check character', () => {
      expect(isValidGuatemalanNit('1234567-8')).toBe(false);
    });
  });

  /**
   * The property that matters most: a country with no validator is not "probably fine". Signup
   * used to fall back to a strategy whose validate() was empty, so an unsupported country was
   * accepted with no checking at all and the tenant was provisioned with no fiscal package.
   */
  describe('unsupported countries', () => {
    it.each(['ZZ', 'FR', 'DE', 'JP', ''])('reports %p as unsupported', (code) => {
      expect(isSupportedFiscalCountry(code)).toBe(false);
    });

    it('refuses to validate a tax id for a country it does not support', () => {
      expect(validateTaxId('FR', '12345678901234')).toBe(false);
    });

    it('refuses an empty tax id even for a supported country', () => {
      expect(validateTaxId('DO', '   ')).toBe(false);
    });
  });

  /** Every validator must be total: nonsense in, boolean out, never an exception. */
  describe('robustness', () => {
    const hostile = ['', '   ', 'null', '../../etc/passwd', '<script>', '👍', 'x'.repeat(500)];

    it.each(Object.keys(TAX_ID_VALIDATORS))('%s survives hostile input', (country) => {
      for (const input of hostile) {
        expect(() => validateTaxId(country, input)).not.toThrow();
        expect(typeof validateTaxId(country, input)).toBe('boolean');
      }
    });
  });
});


// -------------------------------------------------------------------------------------------
// Regression suite for the defects the single-value tests above could not detect.
// -------------------------------------------------------------------------------------------

describe('tax-id validators — defects the previous suite could not see', () => {
  describe('Venezuela: the weight series was shifted one position onto the digits', () => {
    /**
     * The old implementation applied 4,3,2,7,6,5,4,3 to the eight body digits instead of
     * 3,2,7,6,5,4,3,2. It accepted `J-30599168-5` — the value in the country profile and in the
     * only unit test — because for those particular digits the two sums differ by exactly 11 and
     * therefore land on the same residue. Every other real RIF was rejected.
     */
    it.each([
      ['J-00123072-6', 'PDVSA'],
      ['J-00002950-4', 'a published corporate RIF'],
      ['G-20000110-0', 'a public-entity RIF'],
      ['J-30599168-5', 'the value the old code accepted by coincidence'],
    ])('accepts %s (%s)', (rif) => {
      expect(validateTaxId('VE', rif)).toBe(true);
    });

    it('still rejects an altered check digit', () => {
      expect(validateTaxId('VE', 'J-00123072-7')).toBe(false);
    });

    it('rejects a type letter it does not issue', () => {
      expect(validateTaxId('VE', 'X-00123072-6')).toBe(false);
    });
  });

  describe('Ecuador: the natural-person branch was off by one', () => {
    /**
     * The cédula's check digit is its TENTH digit, computed over the first nine. The old code ran
     * eight coefficients over the first eight and compared against the ninth, so it rejected every
     * natural-person RUC in the country.
     */
    it('accepts a natural-person RUC', () => {
      expect(validateTaxId('EC', '1710034065001')).toBe(true);
    });

    it('accepts a company RUC', () => {
      expect(validateTaxId('EC', '1791287541001')).toBe(true);
    });

    it('keeps requiring the 001 establishment suffix SRI publishes for the RUC itself', () => {
      expect(validateTaxId('EC', '1791287541002')).toBe(false);
    });

    it('rejects an altered natural-person check digit', () => {
      expect(validateTaxId('EC', '1710034064001')).toBe(false);
    });
  });

  describe('Colombia: ten-digit NITs were unreachable', () => {
    /** The weight table stopped at nine entries, so a ten-digit body was refused before any
     *  arithmetic ran — excluding every cédula-derived NIT. */
    const dv = (body: string): string => {
      const official = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3];
      const weights = official.slice(official.length - body.length);
      const sum = [...body].reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
      const remainder = sum % 11;
      return String(remainder > 1 ? 11 - remainder : remainder);
    };

    it.each(['1020304050', '1098765432', '0800123456'])(
      'accepts the ten-digit NIT %s with its DIAN check digit',
      (body) => {
        expect(validateTaxId('CO', body + dv(body))).toBe(true);
      },
    );

    it('still accepts the nine-digit form', () => {
      expect(validateTaxId('CO', '900373115-3')).toBe(true);
    });

    it('still requires the verification digit', () => {
      expect(validateTaxId('CO', '900373115')).toBe(false);
    });
  });

  describe('United States: sole proprietors were locked out', () => {
    /**
     * The profile advertises `individualDocument: { code: 'SSN', label: 'SSN / ITIN' }` and the
     * comment beside it says rejecting that shape "would lock out a whole class of customer" —
     * and then only the EIN validator ran, so any SSN whose first two digits fell outside the IRS
     * prefix list was refused.
     */
    it('accepts an SSN whose leading pair is not an EIN prefix', () => {
      expect(validateTaxId('US', '078-05-1120', TaxpayerKind.INDIVIDUAL)).toBe(true);
    });

    it('accepts an EIN for a company', () => {
      expect(validateTaxId('US', '12-3456789', TaxpayerKind.COMPANY)).toBe(true);
    });

    it.each([
      ['000-12-3456', 'area 000 is never issued'],
      ['666-12-3456', 'area 666 is never issued'],
      ['123-00-4567', 'group 00 is never issued'],
      ['123-45-0000', 'serial 0000 is never issued'],
    ])('rejects %s as an individual identifier (%s)', (ssn) => {
      expect(validateTaxId('US', ssn, TaxpayerKind.INDIVIDUAL)).toBe(false);
    });

    it('accepts an ITIN in an IRS-assigned group range', () => {
      expect(validateTaxId('US', '912-70-1234', TaxpayerKind.INDIVIDUAL)).toBe(true);
    });

    it('rejects an ITIN whose group the IRS does not assign', () => {
      expect(validateTaxId('US', '912-10-1234', TaxpayerKind.INDIVIDUAL)).toBe(false);
    });
  });

  describe('taxpayer kind narrows the accepted scheme', () => {
    it.each([
      ['BR', '11.222.333/0001-81', TaxpayerKind.COMPANY, true, 'CNPJ as a company'],
      ['BR', '11.222.333/0001-81', TaxpayerKind.INDIVIDUAL, false, 'CNPJ declared a person'],
      ['BR', '529.982.247-25', TaxpayerKind.INDIVIDUAL, true, 'CPF as a person'],
      ['BR', '111.111.111-11', TaxpayerKind.INDIVIDUAL, false, 'a repeated-digit CPF'],
      ['MX', 'DEM010203AB5', TaxpayerKind.COMPANY, true, 'a 12-character RFC as a company'],
      ['MX', 'DEM010203AB5', TaxpayerKind.INDIVIDUAL, false, 'that RFC declared a person'],
      ['AR', '30-71234567-1', TaxpayerKind.COMPANY, true, 'a 30- CUIT as a company'],
      ['AR', '30-71234567-1', TaxpayerKind.INDIVIDUAL, false, 'that CUIT declared a person'],
      ['PE', '20123456786', TaxpayerKind.COMPANY, true, 'a 20- RUC as a company'],
      ['PE', '20123456786', TaxpayerKind.INDIVIDUAL, false, 'that RUC declared a person'],
      ['DO', '131-12345-7', TaxpayerKind.COMPANY, true, 'a 9-digit RNC as a company'],
      ['DO', '131-12345-7', TaxpayerKind.INDIVIDUAL, false, 'that RNC declared a cédula'],
      ['VE', 'J-00123072-6', TaxpayerKind.COMPANY, true, 'a J- RIF as a company'],
      ['VE', 'J-00123072-6', TaxpayerKind.INDIVIDUAL, false, 'that RIF declared a person'],
      ['EC', '1710034065001', TaxpayerKind.INDIVIDUAL, true, 'a natural-person RUC'],
      ['EC', '1710034065001', TaxpayerKind.COMPANY, false, 'that RUC declared a company'],
    ])('%s %s as %s → %s (%s)', (country, value, kind, expected) => {
      expect(validateTaxId(country as string, value as string, kind as TaxpayerKind)).toBe(expected);
    });

    it('accepts either scheme when the kind is unknown', () => {
      expect(validateTaxId('BR', '529.982.247-25')).toBe(true);
      expect(validateTaxId('BR', '11.222.333/0001-81')).toBe(true);
    });
  });

  describe('canonical storage form preserves what the identifier encodes', () => {
    /**
     * Registration used to persist `taxId.replace(/[^\d]/g, '')`. These are the six countries
     * where that deleted information the identifier carries, and the reason a second Mexican
     * company incorporated on the same date could not sign up: the stored values collided on
     * the unique index over (tax_id, fiscal_region_id).
     */
    it('keeps the RFC intact, so two different Mexican companies do not collide', () => {
      expect(canonicalizeTaxId('MX', 'DEM010203AB5')).toBe('DEM010203AB5');
      expect(canonicalizeTaxId('MX', 'XYZ010203AB5')).toBe('XYZ010203AB5');
      expect(canonicalizeTaxId('MX', 'DEM010203AB5')).not.toBe(canonicalizeTaxId('MX', 'XYZ010203AB5'));
    });

    it('keeps the Chilean and Guatemalan K check character', () => {
      expect(canonicalizeTaxId('CL', '76.086.428-K')).toBe('76086428K');
      expect(canonicalizeTaxId('GT', '1234567-K')).toBe('1234567K');
    });

    it('keeps the RIF type letter, so a company and a person stay distinct', () => {
      expect(canonicalizeTaxId('VE', 'J-30599168-5')).toBe('J305991685');
      expect(canonicalizeTaxId('VE', 'V-30599168-5')).toBe('V305991685');
      expect(canonicalizeTaxId('VE', 'J-30599168-5')).not.toBe(canonicalizeTaxId('VE', 'V-30599168-5'));
    });

    it('keeps the Nicaraguan RUC prefix and the Panamanian segment structure', () => {
      expect(canonicalizeTaxId('NI', 'J0310000012345')).toBe('J0310000012345');
      expect(canonicalizeTaxId('PA', '15512345-2-2018')).toBe('15512345-2-2018');
    });

    it('strips only formatting for the numeric countries', () => {
      expect(canonicalizeTaxId('DO', '131-12345-7')).toBe('131123457');
      expect(canonicalizeTaxId('US', '12-3456789')).toBe('123456789');
      expect(canonicalizeTaxId('BR', '11.222.333/0001-81')).toBe('11222333000181');
    });

    it('is idempotent — canonicalising a canonical value changes nothing', () => {
      for (const [country, value] of [
        ['MX', 'DEM010203AB5'], ['CL', '76.086.428-K'], ['VE', 'J-30599168-5'],
        ['PA', '15512345-2-2018'], ['DO', '131-12345-7'],
      ] as const) {
        const once = canonicalizeTaxId(country, value);
        expect(canonicalizeTaxId(country, once)).toBe(once);
      }
    });

    it('refuses to invent a canonical form for a country it does not know', () => {
      expect(() => canonicalizeTaxId('ZZ', '123')).toThrow();
    });
  });
});
