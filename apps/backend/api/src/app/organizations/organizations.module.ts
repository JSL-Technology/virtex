import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationSettings } from './entities/organization-settings.entity';
import { OrganizationSubsidiary } from './entities/organization-subsidiary.entity';
import { UserOrganization } from './entities/user-organization.entity';
import { MembershipService } from './services/membership.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      OrganizationSettings,
      OrganizationSubsidiary,
      UserOrganization,
    ]),
    ChartOfAccountsModule,
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, MembershipService],
  exports: [OrganizationsService, MembershipService]
})
export class OrganizationsModule {}
