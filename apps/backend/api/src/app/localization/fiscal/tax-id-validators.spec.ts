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
