
import { Injectable, BadRequestException } from '@nestjs/common';
import { CountryRegistrationStrategy } from './country-registration.strategy';
import { RegisterUserDto } from '../../dto/register-user.dto';
import { Organization } from '../../../organizations/entities/organization.entity';
import { User } from '../../../users/entities/user.entity/user.entity';
import { EntityManager } from 'typeorm';
import { LocalizationService } from '../../../localization/services/localization.service';

@Injectable()
export class DoRegistrationStrategy implements CountryRegistrationStrategy {
  constructor(private readonly localizationService: LocalizationService) {}

  async validate(dto: RegisterUserDto): Promise<void> {
    if (!dto.taxId) {
        throw new BadRequestException('El RNC es obligatorio para República Dominicana.');
    }
    const strategy = this.localizationService.getStrategy('DO');
    const isValid = await strategy.validateTaxId(dto.taxId);
    if (!isValid) {
        throw new BadRequestException('El RNC proporcionado no es válido.');
    }
  }

  async provision(organization: Organization, user: User, manager: EntityManager): Promise<void> {
    // Specific provisioning for DO (e.g. assign default local taxes, chart of accounts)
    // This is currently handled by UserRegisteredEvent -> LocalizationService.applyFiscalPackage
    // We can delegate to that or do extra steps here.
    // For now, we just ensure the fiscal package is applied.
    await this.localizationService.applyFiscalPackage(organization, manager);
  }
}
