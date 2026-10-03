import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationSettings } from './entities/organization-settings.entity';
import { OrgSettingsService } from './services/org-settings.service';
import { MfaPolicyPort } from '../auth/ports/mfa-policy.port';
import { TenantCurrencyPort } from '../i18n/ports/tenant-currency.port';
import { TenantCurrencyService } from './services/tenant-currency.service';

/**
 * `MfaPolicyPort` is bound here, to the service that owns the settings row.
 *
 * `auth` asks "does this tenant require a second factor?" through the port, so the dependency
 * points from `organizations` to `auth` (a port declaration) rather than the other way round —
 * which is the direction `verify:boundaries` enforces.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OrganizationSettings])],
  providers: [
    OrgSettingsService,
    { provide: MfaPolicyPort, useExisting: OrgSettingsService },
    // The session's locale context asks for the tenant's books currency through this (QA A-12).
    { provide: TenantCurrencyPort, useClass: TenantCurrencyService },
  ],
  exports: [OrgSettingsService, MfaPolicyPort, TenantCurrencyPort],
})
export class OrgSettingsModule {}
