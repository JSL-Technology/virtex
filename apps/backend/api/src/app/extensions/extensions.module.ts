import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plugin } from './entities/plugin.entity';
import { PluginVersion } from './entities/plugin-version.entity';
import { TenantConsent } from './entities/tenant-consent.entity';
import { MeteringRecord } from './entities/metering-record.entity';
import { ExtensionsController } from './extensions.controller';
import { ExtensionsService } from './extensions.service';
import { SandboxService } from './services/sandbox.service';
import { PluginAdmissionService } from './services/plugin-admission.service';
import { MeteringService } from './services/metering.service';
import { BillingService } from './services/billing.service';
import { SigningKeyProvider } from './services/signing-key.provider';

/**
 * The extensions ("virtual machine for extensions") capability, consolidated from the standalone
 * plugin-host microservice into the API. It gives tenants a marketplace of signed, admitted
 * extensions that run in an isolated-vm sandbox, gated by per-tenant consent and metered for
 * usage billing.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Plugin, PluginVersion, TenantConsent, MeteringRecord]),
  ],
  controllers: [ExtensionsController],
  providers: [
    ExtensionsService,
    SandboxService,
    PluginAdmissionService,
    MeteringService,
    BillingService,
    SigningKeyProvider,
  ],
  exports: [ExtensionsService, SandboxService],
})
export class ExtensionsModule {}
