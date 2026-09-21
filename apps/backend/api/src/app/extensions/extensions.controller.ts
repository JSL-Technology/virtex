import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { RequiresPlatformPermission } from '../security/decorators/platform-permission.decorator';
import { PLATFORM_PERMISSIONS } from '../security/platform-permissions';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { StepUp } from '../auth/decorators/step-up.decorator';
import { StepUpScope } from '../auth/enums/step-up-scope.enum';
import { ExtensionsService } from './extensions.service';
import { RegisterPluginDto } from './dto/register-plugin.dto';
import { ExecutePluginDto } from './dto/execute-plugin.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';

/**
 * HTTP surface for the extensions marketplace and sandbox.
 *
 * ## Two different kinds of route live here, and they needed two different kinds of permission
 *
 * Most of this controller acts on ONE tenant's relationship with an extension — which ones it has
 * installed, what it granted them, what they cost. Those are tenant routes and a tenant permission
 * is the right guard.
 *
 * Three of them act on the CATALOGUE, which every tenant reads: publishing a version, revoking an
 * extension, and running arbitrary code in the sandbox. Those were guarded by `extensions:manage`
 * and `extensions:execute` — ordinary tenant permissions that the `'*'` of every tenant's
 * ADMINISTRATOR role satisfies — so any customer could publish a version of any extension in the
 * marketplace (and, because the newest version used to be the one that executed, run it in other
 * tenants' isolates and browsers), withdraw any extension from everyone, or execute code of their
 * choosing in the API process.
 *
 * They now require a PLATFORM permission, which `RolesService` refuses to put into any tenant role
 * and which `'*'` deliberately does not satisfy. Publishing and revoking additionally take a
 * single-use step-up token: they are irreversible in effect and platform-wide in reach.
 *
 * Each platform route still declares a tenant permission as well. That is not redundancy — the
 * globally registered `PermissionsGuard` denies any route that declares neither `@HasPermission`
 * nor `@AuthenticatedOnly`, so without it these would be unreachable rather than protected, and
 * `route-authorisation.spec.ts` would fail.
 */
@Controller('extensions')
export class ExtensionsController {
  constructor(private readonly extensions: ExtensionsService) {}

  @Get()
  @HasPermission(PERMISSIONS.EXTENSIONS_VIEW)
  list(@CurrentUser() user: AuthenticatedUser) {
    // The viewer's tenant is passed so the catalogue can say whether each extension is theirs,
    // the platform's or a third party's — without exposing the publisher's organization id,
    // which would enumerate tenants.
    return this.extensions.list(user.organizationId);
  }

  @Get('consents')
  @HasPermission(PERMISSIONS.EXTENSIONS_VIEW)
  listConsents(@CurrentUser() user: AuthenticatedUser) {
    return this.extensions.listConsents(user.organizationId);
  }

  @Get('runtime')
  @HasPermission(PERMISSIONS.EXTENSIONS_VIEW)
  runtime(@CurrentUser() user: AuthenticatedUser) {
    return this.extensions.runtime(user.organizationId);
  }

  @Get(':name')
  @HasPermission(PERMISSIONS.EXTENSIONS_VIEW)
  getByName(@Param('name') name: string, @CurrentUser() user: AuthenticatedUser) {
    return this.extensions.getByName(name, user.organizationId);
  }

  @Post()
  @HasPermission(PERMISSIONS.EXTENSIONS_MANAGE)
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH)
  @UseGuards(StepUpGuard)
  @StepUp(StepUpScope.PUBLISH_EXTENSION)
  register(@Body() dto: RegisterPluginDto, @CurrentUser() user: AuthenticatedUser) {
    // The publisher is taken from the authenticated principal, never from the body: a name is an
    // identity, and letting the caller assert whose it is would undo the ownership check inside.
    return this.extensions.register(dto, user.organizationId ?? null);
  }

  @Post(':name/revoke')
  @HasPermission(PERMISSIONS.EXTENSIONS_MANAGE)
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.EXTENSIONS_REVOKE)
  @UseGuards(StepUpGuard)
  @StepUp(StepUpScope.PUBLISH_EXTENSION)
  revoke(@Param('name') name: string) {
    return this.extensions.revoke(name);
  }

  @Put(':name/consent')
  @HasPermission(PERMISSIONS.EXTENSIONS_INSTALL)
  setConsent(
    @Param('name') name: string,
    @Body() dto: GrantConsentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.extensions.setConsent(user.organizationId, name, dto);
  }

  @Post('execute')
  @HasPermission(PERMISSIONS.EXTENSIONS_EXECUTE)
  execute(@Body() dto: ExecutePluginDto, @CurrentUser() user: AuthenticatedUser) {
    // Running an INSTALLED extension is a tenant action and stays on the tenant permission. The
    // service refuses inline `code` unless the caller also holds the platform right, which is
    // checked there rather than here because it depends on the body.
    return this.extensions.execute(user.organizationId, dto, user.permissions);
  }

  @Get('billing/reconciliation')
  @HasPermission(PERMISSIONS.EXTENSIONS_MANAGE)
  reconciliation(@CurrentUser() user: AuthenticatedUser) {
    return this.extensions.reconciliation(user.organizationId);
  }
}
