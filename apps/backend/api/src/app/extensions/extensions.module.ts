import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
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
    // `ExtensionsController` guards two routes with `StepUpGuard`, which needs `JwtService` —
    // nothing here provided it, so the application could not boot: "make sure that the argument
    // JwtService ... is available in the ExtensionsModule module." `forwardRef` defensively,
    // matching how every other module reaches into `AuthModule`, even though nothing here forms
    // a cycle with it today.
    forwardRef(() => AuthModule),
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
