import {
  COUNTRY_FISCAL_PROFILES,
  fiscalFieldsFor,
  normalizeFiscalFields,
  validateFiscalFields,
} from './country-profiles';
import { TAX_ID_RULES, taxpayerKindAffectsValidation } from './tax-id-validators';

/**
 * The fiscal data each country actually needs to issue a document.
 *
 * Signup collected name, tax id and a structured address, and stopped there — so a Mexican tenant
 * was onboarded and charged without a `RegimenFiscal`, which means no CFDI 4.0 can be stamped for
 * them; an Argentine one without a `Condición frente al IVA` or a `Punto de Venta`; a Brazilian one
 * without a `CRT` or an `Inscrição Estadual`. Collecting these afterwards means asking a paying
 * customer to redo onboarding before their first invoice.
 */
describe('country fiscal fields', () => {
  describe('the markets that need extra data declare it', () => {
    it.each([
      ['MX', 'regimenFiscal'],
      ['AR', 'condicionIva'],
      ['AR', 'puntoVenta'],
      ['CO', 'responsabilidadesFiscales'],
      ['BR', 'regimeTributario'],
      ['BR', 'inscricaoEstadual'],
      ['CL', 'giro'],
      ['CL', 'codigoActividadEconomica'],
      ['PE', 'ubigeo'],
      ['EC', 'obligadoContabilidad'],
      ['DO', 'tipoIngreso'],
    ])('%s asks for %s', (country, key) => {
      expect(fiscalFieldsFor(country).map((field) => field.key)).toContain(key);
    });
  });

  describe('required answers are actually required', () => {
    it('rejects a Mexican signup with no régimen fiscal', () => {
      const errors = validateFiscalFields('MX', 'company', {});
      expect(errors).toEqual([
        expect.objectContaining({ key: 'regimenFiscal', reason: 'required' }),
      ]);
    });

    it('accepts one that supplies it', () => {
      expect(validateFiscalFields('MX', 'company', { regimenFiscal: '601' })).toEqual([]);
    });

    it('rejects a régimen the SAT catalogue does not contain', () => {
      expect(validateFiscalFields('MX', 'company', { regimenFiscal: '999' })).toEqual([
        expect.objectContaining({ key: 'regimenFiscal', reason: 'unknown_option' }),
      ]);
    });
  });

  describe('the catalogue narrows by taxpayer kind', () => {
    it('offers a persona moral régimen only to a company', () => {
      // 601 "General de Ley Personas Morales" is not available to a natural person.
      expect(validateFiscalFields('MX', 'individual', { regimenFiscal: '601' })).toEqual([
        expect.objectContaining({ key: 'regimenFiscal', reason: 'unknown_option' }),
      ]);
      expect(validateFiscalFields('MX', 'company', { regimenFiscal: '601' })).toEqual([]);
    });

    it('offers a persona física régimen only to a natural person', () => {
      // 612 "Personas Físicas con Actividades Empresariales y Profesionales".
      expect(validateFiscalFields('MX', 'individual', { regimenFiscal: '612' })).toEqual([]);
      expect(validateFiscalFields('MX', 'company', { regimenFiscal: '612' })).toEqual([
        expect.objectContaining({ key: 'regimenFiscal', reason: 'unknown_option' }),
      ]);
    });

    it('offers RESICO to both, as the catalogue does', () => {
      expect(validateFiscalFields('MX', 'company', { regimenFiscal: '626' })).toEqual([]);
      expect(validateFiscalFields('MX', 'individual', { regimenFiscal: '626' })).toEqual([]);
    });
  });

  describe('text fields are checked against the authority’s shape', () => {
    it('accepts a well-formed Argentine punto de venta', () => {
      expect(
        validateFiscalFields('AR', 'company', { condicionIva: '1', puntoVenta: '0001' }),
      ).toEqual([]);
    });

    it('rejects one that is not numeric', () => {
      expect(
        validateFiscalFields('AR', 'company', { condicionIva: '1', puntoVenta: 'PDV-1' }),
      ).toEqual([expect.objectContaining({ key: 'puntoVenta', reason: 'bad_format' })]);
    });

    it('accepts ISENTO for a Brazilian inscrição estadual', () => {
      expect(
        validateFiscalFields('BR', 'company', {
          regimeTributario: '1',
          inscricaoEstadual: 'ISENTO',
        }),
      ).toEqual([]);
    });

    it('requires a six-digit Peruvian ubigeo', () => {
      expect(validateFiscalFields('PE', 'company', { ubigeo: '150101' })).toEqual([]);
      expect(validateFiscalFields('PE', 'company', { ubigeo: '15' })).toEqual([
        expect.objectContaining({ key: 'ubigeo', reason: 'bad_format' }),
      ]);
    });
  });

  describe('nothing the country did not ask for is accepted or stored', () => {
    it('rejects an unknown key rather than ignoring it', () => {
      expect(validateFiscalFields('MX', 'company', { regimenFiscal: '601', sneaky: 'x' })).toEqual([
        expect.objectContaining({ key: 'sneaky', reason: 'unexpected' }),
      ]);
    });

    it('drops unknown keys when normalising for storage', () => {
      expect(
        normalizeFiscalFields('MX', 'company', { regimenFiscal: '601', sneaky: 'x' }),
      ).toEqual({ regimenFiscal: '601' });
    });

    it('trims what it keeps', () => {
      expect(normalizeFiscalFields('MX', 'company', { regimenFiscal: '  601  ' })).toEqual({
        regimenFiscal: '601',
      });
    });

    it('stores nothing for a country that asks for nothing extra', () => {
      expect(normalizeFiscalFields('UY', 'company', { anything: 'x' })).toEqual({});
      expect(validateFiscalFields('UY', 'company', {})).toEqual([]);
    });
  });

  describe('profile completeness', () => {
    it('every profile declares whether the market can issue documents', () => {
      for (const profile of COUNTRY_FISCAL_PROFILES) {
        expect(['available', 'preview']).toContain(profile.marketStatus);
      }
    });

    it('every profile has tax-id rules, so no country is registrable without validation', () => {
      for (const profile of COUNTRY_FISCAL_PROFILES) {
        expect(TAX_ID_RULES[profile.countryCode]).toBeDefined();
      }
    });

    it('every select option carries a non-empty code and label', () => {
      for (const profile of COUNTRY_FISCAL_PROFILES) {
        for (const field of profile.fiscalFields ?? []) {
          if (field.type !== 'select') continue;
          expect(field.options?.length).toBeGreaterThan(0);
          for (const option of field.options ?? []) {
            expect(option.code.trim()).not.toEqual('');
            expect(option.label.trim()).not.toEqual('');
          }
        }
      }
    });

    it('every text field carries an anchored pattern', () => {
      for (const profile of COUNTRY_FISCAL_PROFILES) {
        for (const field of profile.fiscalFields ?? []) {
          if (field.type !== 'text') continue;
          expect(field.pattern).toBeDefined();
          expect(() => new RegExp(field.pattern as string)).not.toThrow();
        }
      }
    });

    it('the markets whose identifier differs by taxpayer kind are flagged for the form', () => {
      for (const country of ['US', 'BR', 'MX', 'AR', 'PE', 'EC', 'VE', 'DO', 'CR']) {
        expect(taxpayerKindAffectsValidation(country)).toBe(true);
      }
      for (const country of ['CO', 'CL', 'UY', 'PY', 'GT', 'PA', 'BO', 'SV', 'HN', 'NI']) {
        expect(taxpayerKindAffectsValidation(country)).toBe(false);
      }
    });
  });
});
