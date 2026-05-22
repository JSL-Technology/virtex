
import { Injectable } from '@nestjs/common';
import { CountryRegistrationStrategy } from './country-registration.strategy';
import { RegisterUserDto } from '../../dto/register-user.dto';
import { Organization } from '../../../organizations/entities/organization.entity';
import { User } from '../../../users/entities/user.entity/user.entity';
import { EntityManager } from 'typeorm';
import { LocalizationService } from '../../../localization/services/localization.service';

@Injectable()
export class UsRegistrationStrategy implements CountryRegistrationStrategy {
  constructor(private readonly localizationService: LocalizationService) {}

  async validate(dto: RegisterUserDto): Promise<void> {
    // US might not require Tax ID for all registrations, or simple format check
    // Logic can be added here.
  }

  async provision(organization: Organization, user: User, manager: EntityManager): Promise<void> {
    await this.localizationService.applyFiscalPackage(organization, manager);
  }
}
