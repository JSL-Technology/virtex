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
      // The Chilean RUT above, declared as Chilean this time, is accepted.
      expect(
        await errorsFor({ countryCode: 'CL', taxId: '76.086.428-5', state: 'Metropolitana' }),
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

    it('accepts free text where the country publishes no coded catalogue', async () => {
      expect(
        await errorsFor({ countryCode: 'AR', taxId: '30-71234567-1', state: 'Buenos Aires', postalCode: 'C1425' }),
      ).toEqual([]);
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
