import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CountryRegistrationStrategy } from './country-registration.strategy';
import { RegisterUserDto } from '../../dto/register-user.dto';
import { Organization } from '../../../organizations/entities/organization.entity';
import { User } from '../../../users/entities/user.entity/user.entity';
import { LocalizationService } from '../../../localization/services/localization.service';
import { findCountryProfile } from '../../../localization/fiscal/country-profiles';
import { validateTaxId } from '../../../localization/fiscal/tax-id-validators';
import { BadRequestError } from '../../../i18n/localized.exception';

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
      throw new BadRequestError('AUTH.PAIS_TODAVIA_NO_ESTA_DISPONIBLE_REGISTRO', { countryCode: dto.countryCode });
    }

    if (!dto.taxId?.trim()) {
      throw new BadRequestError('AUTH.ES_OBLIGATORIO', { label: profile.taxId.label, name: profile.name });
    }

    // Re-checked here even though the DTO already validated it. The DTO constraint protects the
    // HTTP boundary; this protects every other caller — the payment-first flow replays a stored
    // payload that was validated hours earlier, and a stored payload is still untrusted input.
    //
    // The taxpayer kind is passed. Without it `validateTaxId` accepts the UNION of both schemes,
    // which made this "defence in depth" strictly weaker than the check it was backing up: a
    // United States nine-digit value passes as an EIN under one prefix rule and as an SSN under
    // another, and only the kind decides which applies.
    if (!validateTaxId(profile.countryCode, dto.taxId, dto.taxpayerKind)) {
      throw new BadRequestError('AUTH.NO_ES_VALIDO', { label: profile.taxId.label, name: profile.name });
    }

    if (profile.address.postalCodeRequired && !dto.postalCode?.trim()) {
      throw new BadRequestError('AUTH.ES_OBLIGATORIO_2', { postalCodeLabel: profile.address.postalCodeLabel, name: profile.name });
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
