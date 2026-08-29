import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CountryRegistrationStrategy } from './country-registration.strategy';
import { RegisterUserDto } from '../../dto/register-user.dto';
import { Organization } from '../../../organizations/entities/organization.entity';
import { User } from '../../../users/entities/user.entity/user.entity';
import { LocalizationService } from '../../../localization/services/localization.service';
import { findCountryProfile } from '../../../localization/fiscal/country-profiles';
import { validateTaxId } from '../../../localization/fiscal/tax-id-validators';

/**
 * The registration rules for every supported market, driven by the country profile.
 *
 * There used to be two hand-written strategies — one for the Dominican Republic and one for the
 * United States whose `validate()` had an empty body — and a factory whose `default:` branch
 * returned the empty one. Every market that was not the Dominican Republic therefore registered
 * with no fiscal validation of any kind.
 *
 * One strategy driven by data replaces both. Adding a country is adding a profile and a validator,
 * and it is impossible to add a country that then silently validates nothing: `validateTaxId`
 * returns false for a country it has no algorithm for, and the factory refuses a country with no
 * profile before this is ever reached.
 */
@Injectable()
export class ProfileRegistrationStrategy implements CountryRegistrationStrategy {
  constructor(private readonly localizationService: LocalizationService) {}

  async validate(dto: RegisterUserDto): Promise<void> {
    const profile = findCountryProfile(dto.countryCode);
    if (!profile) {
      throw new BadRequestException(
        `El país "${dto.countryCode}" todavía no está disponible para registro.`,
      );
    }

    if (!dto.taxId?.trim()) {
      throw new BadRequestException(
        `El ${profile.taxId.label} es obligatorio para ${profile.name}.`,
      );
    }

    // Re-checked here even though the DTO already validated it. The DTO constraint protects the
    // HTTP boundary; this protects every other caller — the payment-first flow replays a stored
    // payload that was validated hours earlier, and a stored payload is still untrusted input.
    if (!validateTaxId(profile.countryCode, dto.taxId)) {
      throw new BadRequestException(
        `El ${profile.taxId.label} no es válido para ${profile.name}.`,
      );
    }

    if (profile.address.postalCodeRequired && !dto.postalCode?.trim()) {
      throw new BadRequestException(
        `El ${profile.address.postalCodeLabel} es obligatorio para ${profile.name}.`,
      );
    }
  }

  async provision(
    organization: Organization,
    _user: User,
    manager: EntityManager,
  ): Promise<void> {
    await this.localizationService.applyFiscalPackage(organization, manager);
  }
}
