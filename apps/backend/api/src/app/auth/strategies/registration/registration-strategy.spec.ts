import { BadRequestException } from '@nestjs/common';
import { RegistrationStrategyFactory } from './registration-strategy.factory';
import { ProfileRegistrationStrategy } from './profile-registration.strategy';
import { RegisterUserDto } from '../../dto/register-user.dto';
import { LocalizationService } from '../../../localization/services/localization.service';
import { supportedCountryCodes, findCountryProfile } from '../../../localization/fiscal/country-profiles';

/**
 * The country a tenant registers under decides everything downstream: which check digit is
 * verified, which chart of accounts is created, which taxes are seeded, which invoicing regime
 * applies. Getting it wrong is not a cosmetic error, and the previous implementation could not
 * get it right — its factory ended in `default: return this.usStrategy`, and that strategy's
 * `validate()` was an empty method body.
 */
describe('Registration strategy', () => {
  const localization = { applyFiscalPackage: jest.fn() } as unknown as LocalizationService;
  const strategy = new ProfileRegistrationStrategy(localization);
  const factory = new RegistrationStrategyFactory(strategy);

  const dto = (over: Partial<RegisterUserDto>): RegisterUserDto =>
    ({
      organizationName: 'Acme',
      countryCode: 'DO',
      taxId: '131-12345-7',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.com',
      password: 'x',
      recaptchaToken: 't',
      address: 'Calle 1',
      city: 'Santo Domingo',
      state: '01',
      ...over,
    }) as RegisterUserDto;

  describe('factory', () => {
    it.each(supportedCountryCodes())('resolves a strategy for %s', (code) => {
      expect(factory.getStrategy(code)).toBe(strategy);
    });

    it('is case-insensitive about the country code', () => {
      expect(factory.getStrategy('do')).toBe(strategy);
    });

    it.each(['FR', 'DE', 'JP', 'ZZ', '', undefined as unknown as string])(
      'refuses %p rather than falling back to a strategy that validates nothing',
      (code) => {
        expect(() => factory.getStrategy(code)).toThrow(BadRequestException);
      },
    );
  });

  describe('validate', () => {
    it('accepts a well-formed payload for a supported country', async () => {
      await expect(strategy.validate(dto({}))).resolves.toBeUndefined();
    });

    it('refuses an unsupported country even when the factory is bypassed', async () => {
      await expect(strategy.validate(dto({ countryCode: 'FR' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a missing tax id', async () => {
      await expect(strategy.validate(dto({ taxId: '   ' }))).rejects.toThrow(BadRequestException);
    });

    it('refuses a tax id whose check digit is wrong', async () => {
      // One digit changed from the valid RNC above. A regex cannot tell these apart; that is the
      // entire reason the check digit exists.
      await expect(strategy.validate(dto({ taxId: '131-12345-8' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a tax id that is valid for a DIFFERENT country', async () => {
      // A Chilean RUT submitted under a Dominican registration. Both are "a tax id"; only one is
      // a Dominican one.
      await expect(
        strategy.validate(dto({ countryCode: 'DO', taxId: '76.086.428-5' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires a postal code where the country requires one', async () => {
      // United States sales tax is destination-based: no ZIP, no rate.
      expect(findCountryProfile('US')!.address.postalCodeRequired).toBe(true);
      await expect(
        strategy.validate(dto({ countryCode: 'US', taxId: '12-3456789', state: 'TX', postalCode: '' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not require a postal code where the country does not', async () => {
      expect(findCountryProfile('DO')!.address.postalCodeRequired).toBe(false);
      await expect(strategy.validate(dto({ postalCode: undefined }))).resolves.toBeUndefined();
    });

    it('re-validates rather than trusting a payload that was checked earlier', async () => {
      // The payment-first flow stores a validated payload and replays it hours later. A stored
      // payload is still untrusted input; this is the second gate that makes that safe.
      await expect(strategy.validate(dto({ taxId: '000000000' }))).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('provision', () => {
    it('applies the fiscal package for the organization', async () => {
      const org = { id: 'org-1' } as never;
      const manager = {} as never;
      await strategy.provision(org, {} as never, manager);
      expect(localization.applyFiscalPackage).toHaveBeenCalledWith(org, manager);
    });
  });
});
