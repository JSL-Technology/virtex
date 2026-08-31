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
import { LocalizationModule } from '../localization/localization.module';
import { SaasModule } from '../saas/saas.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { UserCacheModule } from '../auth/modules/user-cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      OrganizationSettings,
      OrganizationSubsidiary,
      UserOrganization,
    ]),
    ChartOfAccountsModule,
    // A subsidiary is provisioned with its country's chart of accounts and taxes in the same
    // transaction that creates it, exactly like a signup.
    forwardRef(() => LocalizationModule),
    forwardRef(() => SaasModule),
    // Revoking a membership has to invalidate the cached principal, or the removal only takes
    // effect when the entry expires fifteen minutes later.
    UserCacheModule,
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, MembershipService],
  exports: [OrganizationsService, MembershipService]
})
export class OrganizationsModule {}
