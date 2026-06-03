import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from './guards/jwt/jwt.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { PermissionsGuard } from './guards/permissions/permissions.guard';
import { HasPermission } from './decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { SsoAdminService } from './services/sso-admin.service';
import {
  CreateIdentityProviderDto,
  UpdateIdentityProviderDto,
  AddDomainDto,
} from './dto/sso-admin.dto';

/**
 * Per-organization enterprise SSO administration. All endpoints are scoped to the caller's
 * organization and require the company-settings permission plus CSRF protection.
 */
@ApiTags('Auth/SSO Admin')
@Controller('auth/sso/admin')
@UseGuards(JwtAuthGuard, CsrfGuard, PermissionsGuard)
@HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
export class SsoAdminController {
  constructor(private readonly ssoAdminService: SsoAdminService) {}

  private orgId(user: User): string {
    if (!user.organizationId) {
      throw new BadRequestException('User is not associated with an organization.');
    }
    return user.organizationId;
  }

  // --- Identity providers ---

  @Get('providers')
  @ApiOperation({ summary: 'List the organization SSO identity providers' })
  listProviders(@CurrentUser() user: User) {
    return this.ssoAdminService.listProviders(this.orgId(user));
  }

  @Post('providers')
  @ApiOperation({ summary: 'Create an SSO identity provider (disabled until a domain is verified)' })
  createProvider(@CurrentUser() user: User, @Body() dto: CreateIdentityProviderDto) {
    return this.ssoAdminService.createProvider(this.orgId(user), dto);
  }

  @Patch('providers/:id')
  @ApiOperation({ summary: 'Update an SSO identity provider' })
  updateProvider(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateIdentityProviderDto,
  ) {
    return this.ssoAdminService.updateProvider(this.orgId(user), id, dto);
  }

  @Delete('providers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an SSO identity provider' })
  async deleteProvider(@CurrentUser() user: User, @Param('id') id: string) {
    await this.ssoAdminService.deleteProvider(this.orgId(user), id);
  }

  // --- Domains ---

  @Get('domains')
  @ApiOperation({ summary: 'List the organization email domains and verification status' })
  listDomains(@CurrentUser() user: User) {
    return this.ssoAdminService.listDomains(this.orgId(user));
  }

  @Post('domains')
  @ApiOperation({ summary: 'Register an email domain (returns the DNS TXT record to publish)' })
  addDomain(@CurrentUser() user: User, @Body() dto: AddDomainDto) {
    return this.ssoAdminService.addDomain(this.orgId(user), dto.domain);
  }

  @Post('domains/:id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify domain ownership via the DNS TXT record' })
  verifyDomain(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ssoAdminService.verifyDomain(this.orgId(user), id);
  }

  @Delete('domains/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an email domain' })
  async deleteDomain(@CurrentUser() user: User, @Param('id') id: string) {
    await this.ssoAdminService.deleteDomain(this.orgId(user), id);
  }
}
