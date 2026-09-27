import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationDomain } from '../organizations/entities/organization-domain.entity';
import { RolesModule } from '../roles/roles.module';
import { AuthModule } from './auth.module';
import { IdentityProvider } from './entities/identity-provider.entity';
import { SsoAdminService } from './services/sso-admin.service';
import { SsoAdminController } from './sso-admin.controller';

/**
 * Administration of a tenant's enterprise identity providers.
 *
 * Its own module because it is the one piece of authentication that needs Roles:
 * `SsoAdminService` checks, through `RoleDelegationPort`, that the default role an IdP will grant
 * is one the administrator configuring it may assign. Living inside `AuthModule` made that module
 * import `RolesModule` while `RolesModule` imports `AuthModule` — a cycle held together with
 * `forwardRef` on both sides. From here both edges point one way.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IdentityProvider, OrganizationDomain]), AuthModule, RolesModule],
  controllers: [SsoAdminController],
  providers: [SsoAdminService],
})
export class SsoAdminModule {}
