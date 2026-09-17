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
import { LocalizationProvisioningModule } from '../localization/localization-provisioning.module';
// SaasModule removed: it is @Global() so SaasService is available everywhere without an explicit import.
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { UserCacheModule } from '../auth/modules/user-cache.module';
import { OrgSettingsModule } from './org-settings.module';
import { OrgSettingsService } from './services/org-settings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      OrganizationSettings,
      OrganizationSubsidiary,
      UserOrganization,
    ]),
    OrgSettingsModule,
    ChartOfAccountsModule,
    // LocalizationProvisioningModule (leaf) provides the two methods needed by
    // OrganizationsService: findRegionByCountryCode() and applyFiscalPackage().
    // No forwardRef needed — the leaf has no dependency back on OrganizationsModule.
    LocalizationProvisioningModule,
    // SaasModule is @Global(); SaasService resolves without an explicit import.
    // Revoking a membership has to invalidate the cached principal, or the removal only takes
    // effect when the entry expires fifteen minutes later.
    UserCacheModule,
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, MembershipService],
  exports: [OrganizationsService, MembershipService, OrgSettingsModule]
})
export class OrganizationsModule {}
