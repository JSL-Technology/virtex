import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS } from '../shared/permissions';
import { ExtensionsService } from './extensions.service';
import { RegisterPluginDto } from './dto/register-plugin.dto';
import { ExecutePluginDto } from './dto/execute-plugin.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';

/**
 * HTTP surface for the extensions marketplace and sandbox.
 *
 * Every route sits behind the platform's auth guard and permission model — the standalone
 * plugin-host authenticated with a shared static token and a signed context header; here the same
 * operations are gated by real per-user permissions, and the tenant is taken from the authenticated
 * principal (`organizationId`) rather than a header, so a client cannot assert another tenant.
 */
@Controller('extensions')
@UseGuards(JwtAuthGuard)
export class ExtensionsController {
  constructor(private readonly extensions: ExtensionsService) {}

  @Get()
  @HasPermission(PERMISSIONS.EXTENSIONS_VIEW)
  list() {
    return this.extensions.list();
  }

  @Get('consents')
  @HasPermission(PERMISSIONS.EXTENSIONS_VIEW)
  listConsents(@CurrentUser() user: AuthenticatedUser) {
    return this.extensions.listConsents(user.organizationId);
  }

  @Get(':name')
  @HasPermission(PERMISSIONS.EXTENSIONS_VIEW)
  getByName(@Param('name') name: string) {
    return this.extensions.getByName(name);
  }

  @Post()
  @HasPermission(PERMISSIONS.EXTENSIONS_MANAGE)
  register(@Body() dto: RegisterPluginDto) {
    return this.extensions.register(dto);
  }

  @Post(':name/revoke')
  @HasPermission(PERMISSIONS.EXTENSIONS_MANAGE)
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
    return this.extensions.execute(user.organizationId, dto);
  }

  @Get('billing/reconciliation')
  @HasPermission(PERMISSIONS.EXTENSIONS_MANAGE)
  reconciliation(@CurrentUser() user: AuthenticatedUser) {
    return this.extensions.reconciliation(user.organizationId);
  }
}
