import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { FiscalRegimeSettingsService } from './services/fiscal-regime-settings.service';
import {
  RegisterFiscalRangeDto,
  UpsertFiscalRegimeSettingsDto,
} from './dto/fiscal-regime-settings.dto';

/**
 * The tenant's e-invoicing configuration and the number ranges their authority granted them.
 *
 * ## Why this endpoint decides whether six markets work at all
 *
 * The regimes are implemented, but a Chilean tenant cannot issue without a CAF, an Ecuadorean one
 * without an emission point, a Brazilian one without their IBGE codes. Until now the only way to
 * supply any of it was an `INSERT`. The product refused to issue — correctly — with no way out.
 *
 * ## What never comes back
 *
 * A range's secret. The CAF contains the RSA key that seals the taxpayer's folios and Colombia's
 * ClaveTécnica is what makes a CUFE theirs; either one, read back through an API, lets whoever
 * reads it issue fiscal documents in the taxpayer's name. So it goes in and is never returned —
 * `hasSecret` says whether one is on file, and replacing it means uploading a new one.
 */
@ApiTags('Facturación electrónica — Configuración')
@ApiBearerAuth()
@Controller('einvoicing/regime')
@UseGuards(JwtAuthGuard)
export class FiscalRegimeSettingsController {
  constructor(private readonly settings: FiscalRegimeSettingsService) {}

  @Get('settings')
  @HasPermission(PERMISSIONS.TAXES_VIEW)
  @ApiOperation({ summary: 'La configuración del régimen del contribuyente.' })
  async find(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.find(user.organizationId);
  }

  @Put('settings')
  @HasPermission(PERMISSIONS.TAXES_EDIT)
  @ApiOperation({ summary: 'Guardar la configuración del régimen.' })
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertFiscalRegimeSettingsDto,
  ) {
    return this.settings.upsert(user.organizationId, dto);
  }

  @Get('ranges')
  @HasPermission(PERMISSIONS.TAXES_VIEW)
  @ApiOperation({
    summary: 'Los rangos autorizados del contribuyente, sin el material secreto.',
  })
  async listRanges(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.listRanges(user.organizationId);
  }

  @Post('ranges')
  @HasPermission(PERMISSIONS.TAXES_CREATE)
  @ApiOperation({ summary: 'Registrar un rango que autorizó la autoridad.' })
  async registerRange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterFiscalRangeDto,
  ) {
    return this.settings.registerRange(user.organizationId, dto);
  }

  /**
   * Retire a range. It stays on file, deactivated.
   *
   * `DELETE` is the verb the client uses and deactivation is what happens, because the row is the
   * authorisation past documents were issued under. Destroying it destroys the only record of
   * which permission covered which document.
   */
  @Delete('ranges/:id')
  @HasPermission(PERMISSIONS.TAXES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirar un rango; la fila permanece para la trazabilidad.' })
  async deactivateRange(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.settings.deactivateRange(user.organizationId, id);
  }
}
