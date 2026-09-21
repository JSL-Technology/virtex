import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { SsoAdminService } from './services/sso-admin.service';
import {
  CreateIdentityProviderDto,
  UpdateIdentityProviderDto,
  AddDomainDto,
} from './dto/sso-admin.dto';
import { AuthenticatedUser } from '../security/principal';
import { CheckFeature } from '../saas/guards/feature-flag.guard';
import { BadRequestError } from '../i18n/localized.exception';
import { StepUpGuard } from './guards/step-up.guard';
import { StepUp } from './decorators/step-up.decorator';
import { StepUpScope } from './enums/step-up-scope.enum';

/**
 * Per-organization enterprise SSO administration.
 *
 * Scoped to the caller's organization, behind the company-settings permission and CSRF — and, now,
 * behind step-up.
 *
 * An identity provider decides who may sign in to a tenant, and through `defaultRoleId` it decides
 * what rights they are created with. That is a change to the authorization graph in exactly the
 * sense `MANAGE_ROLES` is, and it was reachable with a live session and `settings:edit_company`
 * alone — a configuration permission that implies nothing about managing people. Pointing the IdP
 * at the ADMINISTRATOR role would have made every new account from a verified domain a super-admin;
 * `SsoAdminService.assertRoleIsDelegable` now refuses that outright, and the step-up here means
 * the rest of the IdP configuration also costs a fresh proof of identity.
 */
@ApiTags('Auth/SSO Admin')
@Controller('auth/sso/admin')
@HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
@UseGuards(StepUpGuard)
@StepUp(StepUpScope.MANAGE_SSO)
// Configuring a per-tenant identity provider is the capability the Enterprise tier is named for.
@CheckFeature('enterprise_sso')
export class SsoAdminController {
  constructor(private readonly ssoAdminService: SsoAdminService) {}

  private orgId(user: AuthenticatedUser): string {
    if (!user.organizationId) {
      throw new BadRequestError('auth.user_not_associated_with_organization');
    }
    return user.organizationId;
  }

  // --- Identity providers ---

  @Get('providers')
  @ApiOperation({ summary: 'List the organization SSO identity providers' })
  listProviders(@CurrentUser() user: AuthenticatedUser) {
    return this.ssoAdminService.listProviders(this.orgId(user));
  }

  @Post('providers')
  @ApiOperation({ summary: 'Create an SSO identity provider (disabled until a domain is verified)' })
  createProvider(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateIdentityProviderDto) {
    // The actor travels through: `defaultRoleId` is a role assignment and goes through the same
    // delegation check as an invitation.
    return this.ssoAdminService.createProvider(this.orgId(user), dto, user);
  }

  @Patch('providers/:id')
  @ApiOperation({ summary: 'Update an SSO identity provider' })
  updateProvider(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateIdentityProviderDto,
  ) {
    return this.ssoAdminService.updateProvider(this.orgId(user), id, dto, user);
  }

  @Delete('providers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an SSO identity provider' })
  async deleteProvider(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.ssoAdminService.deleteProvider(this.orgId(user), id);
  }

  // --- Domains ---

  @Get('domains')
  @ApiOperation({ summary: 'List the organization email domains and verification status' })
  listDomains(@CurrentUser() user: AuthenticatedUser) {
    return this.ssoAdminService.listDomains(this.orgId(user));
  }

  @Post('domains')
  @ApiOperation({ summary: 'Register an email domain (returns the DNS TXT record to publish)' })
  addDomain(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddDomainDto) {
    return this.ssoAdminService.addDomain(this.orgId(user), dto.domain);
  }

  @Post('domains/:id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify domain ownership via the DNS TXT record' })
  verifyDomain(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ssoAdminService.verifyDomain(this.orgId(user), id);
  }

  @Delete('domains/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an email domain' })
  async deleteDomain(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.ssoAdminService.deleteDomain(this.orgId(user), id);
  }
}
