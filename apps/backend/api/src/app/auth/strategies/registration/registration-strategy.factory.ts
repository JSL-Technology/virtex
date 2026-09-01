import { Injectable } from '@nestjs/common';
import { CountryRegistrationStrategy } from './country-registration.strategy';
import { ProfileRegistrationStrategy } from './profile-registration.strategy';
import { findCountryProfile } from '../../../localization/fiscal/country-profiles';
import { BadRequestError } from '../../../i18n/localized.exception';

/**
 * Resolve the registration rules for a country, or refuse the country.
 *
 * The previous implementation ended in `default: return this.usStrategy` — a strategy whose
 * `validate()` body was a comment. Every market outside the Dominican Republic and the United
 * States, including the six the signup form offered, was therefore registered with no fiscal
 * validation and provisioned with the United States chart of accounts.
 *
 * Refusing is the correct behaviour, not a degradation: a tenant that cannot be validated cannot
 * be invoiced for, and discovering that at signup costs a support conversation while discovering
 * it at the first invoice costs the customer a filing deadline.
 */
@Injectable()
export class RegistrationStrategyFactory {
  constructor(private readonly profileStrategy: ProfileRegistrationStrategy) {}

  getStrategy(countryCode: string): CountryRegistrationStrategy {
    if (!findCountryProfile(countryCode)) {
      throw new BadRequestError('AUTH.PAIS_TODAVIA_NO_ESTA_DISPONIBLE_REGISTRO', { countryCode });
    }
    return this.profileStrategy;
  }
}
