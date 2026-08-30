import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterUserDto } from './register-user.dto';

/**
 * The HTTP boundary of registration.
 *
 * Before this, `taxId` and `fiscalRegionId` were both `@IsOptional()` and the tax-id constraint
 * returned `true` whenever either was missing — so a client could omit both, skip every fiscal
 * check, and create a tenant with no fiscal identity. The country was never collected at all.
 *
 * These tests state the contract as properties of the payload rather than as one happy path.
 */
describe('RegisterUserDto', () => {
  const base = {
    organizationName: 'Acme SRL',
    countryCode: 'DO',
    taxpayerKind: 'company',
    // The Dominican Republic asks for the DGII income type on top of the identifier.
    fiscalProfile: { tipoIngreso: '01' },
    taxId: '131-12345-7',
    firstName: 'Ana',
    lastName: 'Pérez',
    email: 'ana@acme.do',
    password: 'Str0ng!Passw0rd#2026',
    recaptchaToken: 'token',
    address: 'Av. Winston Churchill 1099',
    city: 'Santo Domingo',
    state: '01',
    emailVerificationCode: '123456',
  };

  /**
   * A valid fiscal profile for each country these tests exercise.
   *
   * Which extra fields a country requires is part of its profile, so a test that switches country
   * to check an address rule has to bring that country's fiscal answers with it — otherwise it
   * fails on `fiscalProfile` for a reason that has nothing to do with what it is testing.
   */
  const FISCAL_PROFILE_BY_COUNTRY: Record<string, Record<string, string>> = {
    DO: { tipoIngreso: '01' },
    MX: { regimenFiscal: '601' },
    AR: { condicionIva: '1', puntoVenta: '0001' },
    CO: { responsabilidadesFiscales: 'O-13' },
    BR: { regimeTributario: '1', inscricaoEstadual: 'ISENTO' },
    CL: { giro: 'Servicios de software', codigoActividadEconomica: '620100' },
    PE: { ubigeo: '150101' },
    EC: { obligadoContabilidad: 'SI' },
  };

  const errorsFor = async (over: Record<string, unknown> = {}) => {
    const country = (over.countryCode as string) ?? base.countryCode;
    const payload = {
      ...base,
      // Default the fiscal profile to the country under test unless the case sets one itself.
      fiscalProfile: FISCAL_PROFILE_BY_COUNTRY[country] ?? {},
      ...over,
    };
    const dto = plainToInstance(RegisterUserDto, payload);
    const errors = await validate(dto);
    return errors.map((e) => e.property);
  };

  it('accepts a complete, well-formed payload', async () => {
    expect(await errorsFor()).toEqual([]);
  });

  describe('country', () => {
    it('is required', async () => {
      expect(await errorsFor({ countryCode: undefined })).toContain('countryCode');
    });

    it('refuses a market the product does not sell to', async () => {
      expect(await errorsFor({ countryCode: 'FR' })).toContain('countryCode');
    });
  });

  describe('tax id', () => {
    it('is required — omitting it must not skip fiscal validation', async () => {
      expect(await errorsFor({ taxId: undefined })).toContain('taxId');
    });

    it('refuses a wrong check digit', async () => {
      expect(await errorsFor({ taxId: '131-12345-8' })).toContain('taxId');
    });

    it('refuses an identifier valid for a different country', async () => {
      expect(await errorsFor({ taxId: '76.086.428-5' })).toContain('taxId');
    });

    it('is validated against the country in the SAME payload', async () => {
      // The Chilean RUT above, declared as Chilean this time, is accepted. `RM` is the SII's
      // own code for the Metropolitan Region — Chile now publishes a coded catalogue, so the
      // region travels as a code rather than as whatever the user typed.
      expect(
        await errorsFor({ countryCode: 'CL', taxId: '76.086.428-5', state: 'RM' }),
      ).toEqual([]);
    });

    it('no longer depends on a client-supplied fiscalRegionId being present', async () => {
      expect(await errorsFor({ fiscalRegionId: undefined, taxId: '131-12345-8' })).toContain('taxId');
    });
  });

  describe('fiscal address', () => {
    it('requires a street address', async () => {
      expect(await errorsFor({ address: '' })).toContain('address');
    });

    it('requires a city', async () => {
      expect(await errorsFor({ city: '' })).toContain('city');
    });

    it('requires a first-level division', async () => {
      expect(await errorsFor({ state: '' })).toContain('state');
    });

    it('refuses a division code the country does not publish', async () => {
      // '99' is not a Dominican province.
      expect(await errorsFor({ state: '99' })).toContain('state');
    });

    /**
     * Every one of the nineteen markets now publishes a coded catalogue for its first-level
     * division. That matters beyond tidiness: DIAN, the SII, SUNAT and the SEFAZ all carry the
     * division as a CODE in the stamped document, so a tenant who typed "Bs. As." or "Buenos
     * Aires Provincia" had stored something no invoice could be built from — and the product
     * would have had to go back and ask every existing customer for it again.
     */
    it('accepts the code the authority publishes', async () => {
      expect(
        await errorsFor({ countryCode: 'AR', taxId: '30-71234567-1', state: '01', postalCode: 'C1425' }),
      ).toEqual([]);
    });

    it('refuses free text now that every market publishes a catalogue', async () => {
      expect(
        await errorsFor({ countryCode: 'AR', taxId: '30-71234567-1', state: 'Buenos Aires', postalCode: 'C1425' }),
      ).toContain('state');
    });

    describe('postal code', () => {
      it('is required where the country requires one', async () => {
        // United States sales tax is destination-based; a rate cannot be determined without it.
        expect(
          await errorsFor({ countryCode: 'US', taxId: '12-3456789', state: 'TX', postalCode: undefined }),
        ).toContain('postalCode');
      });

      it('is optional where the country does not require one', async () => {
        expect(await errorsFor({ postalCode: undefined })).toEqual([]);
      });

      it('is checked against the country shape when present', async () => {
        // A five-digit code is not a Brazilian CEP.
        expect(
          await errorsFor({
            countryCode: 'BR',
            taxId: '11.222.333/0001-81',
            state: 'SP',
            postalCode: '10101',
          }),
        ).toContain('postalCode');
      });

      it('accepts the country shape when present', async () => {
        expect(
          await errorsFor({
            countryCode: 'BR',
            taxId: '11.222.333/0001-81',
            state: 'SP',
            postalCode: '01310-100',
          }),
        ).toEqual([]);
      });
    });
  });

  describe('password policy', () => {
    it('refuses a password that does not meet the policy', async () => {
      expect(await errorsFor({ password: 'short' })).toContain('password');
    });
  });
});


/**
 * The fields the payload gained, and why each one is not optional.
 */
describe('RegisterUserDto — fiscal identity', () => {
  const base = {
    organizationName: 'Acme SRL',
    countryCode: 'DO',
    taxpayerKind: 'company',
    fiscalProfile: { tipoIngreso: '01' },
    taxId: '131-12345-7',
    firstName: 'Ana',
    lastName: 'Pérez',
    email: 'ana@acme.do',
    password: 'Str0ng!Passw0rd#2026',
    recaptchaToken: 'token',
    address: 'Av. Winston Churchill 1099',
    city: 'Santo Domingo',
    state: '01',
    emailVerificationCode: '123456',
  };

  const errorsFor = async (over: Record<string, unknown> = {}) => {
    const dto = plainToInstance(RegisterUserDto, { ...base, ...over });
    const errors = await validate(dto);
    return errors.map((e) => e.property);
  };

  describe('taxpayer kind', () => {
    it('is required', async () => {
      expect(await errorsFor({ taxpayerKind: undefined })).toContain('taxpayerKind');
    });

    it('refuses a value outside the enum', async () => {
      expect(await errorsFor({ taxpayerKind: 'trust' })).toContain('taxpayerKind');
    });

    it('narrows which identifier scheme the tax id is checked against', async () => {
      // A 9-digit RNC is a company identifier; declared as a natural person it must fail, because
      // a Dominican individual files under an 11-digit cédula.
      expect(await errorsFor({ taxpayerKind: 'individual' })).toContain('taxId');
    });
  });

  describe('fiscal profile', () => {
    it('is required where the country requires it — omitting the object does not skip the check', async () => {
      // The classic `@IsOptional()` trap: absent must be a failure, not an exemption.
      expect(await errorsFor({ fiscalProfile: undefined })).toContain('fiscalProfile');
      expect(await errorsFor({ fiscalProfile: {} })).toContain('fiscalProfile');
    });

    it('rejects a code the authority does not publish', async () => {
      expect(await errorsFor({ fiscalProfile: { tipoIngreso: '99' } })).toContain('fiscalProfile');
    });

    it('rejects a key the country never asked for', async () => {
      expect(
        await errorsFor({ fiscalProfile: { tipoIngreso: '01', regimenFiscal: '601' } }),
      ).toContain('fiscalProfile');
    });

    it('rejects a non-object', async () => {
      expect(await errorsFor({ fiscalProfile: 'nope' })).toContain('fiscalProfile');
    });

    it('accepts an empty object for a country that asks for nothing extra', async () => {
      expect(
        await errorsFor({
          countryCode: 'UY',
          taxId: '211003420017',
          state: 'MO',
          fiscalProfile: {},
        }),
      ).toEqual([]);
    });
  });

  describe('phone', () => {
    it('is optional — signup does not require an SMS', async () => {
      expect(await errorsFor({ phone: undefined })).toEqual([]);
    });

    it('must be E.164 when present, matching the profile DTO', async () => {
      expect(await errorsFor({ phone: '8095551234' })).toContain('phone');
      expect(await errorsFor({ phone: '+18095551234' })).toEqual([]);
    });
  });
});
