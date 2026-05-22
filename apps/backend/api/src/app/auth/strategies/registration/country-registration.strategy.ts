
import { RegisterUserDto } from '../../dto/register-user.dto';
import { Organization } from '../../../organizations/entities/organization.entity';
import { User } from '../../../users/entities/user.entity/user.entity';
import { EntityManager } from 'typeorm';

export interface CountryRegistrationStrategy {
  validate(dto: RegisterUserDto): Promise<void>;
  provision(organization: Organization, user: User, manager: EntityManager): Promise<void>;
}
