import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';
import { FiscalRegimeSettingsService } from './services/fiscal-regime-settings.service';
import {
  RegisterFiscalRangeDto,
  SetFiscalRangeActiveDto,
  UpsertFiscalRegimeSettingsDto,
  UpsertTransmissionSettingsDto,
} from './dto/fiscal-regime-settings.dto';
import { TransmissionConfigService } from './services/transmission-config.service';
import { FiscalSubmissionService, visibleSubmission } from './services/fiscal-submission.service';
import { RequireStepUp, StepUpScope } from '../auth/contracts/step-up.contract';

/**
 * The tenant's e-invoicing configuration and the number ranges their authority granted them — the
 * ranges of every market that numbers from one, the Dominican NCF included.
 *
 * ## Why this endpoint decides whether a market works at all
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
export class FiscalRegimeSettingsController {
  constructor(
    private readonly settings: FiscalRegimeSettingsService,
    private readonly transmission: TransmissionConfigService,
    private readonly submissions: FiscalSubmissionService,
  ) {}

  /** The tenant's transmission channel, without the credential (FAC-EINV-04). */
  @Get('transmission')
  @HasPermission(PERMISSIONS.TAXES_VIEW)
  @ApiOperation({ summary: 'El canal de transmisión del contribuyente, sin la credencial.' })
  async transmissionSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.transmission.view(user.organizationId, await this.settings.countryOf(user.organizationId));
  }

  /**
   * Save it. Re-authentication is required: whoever sets this credential files documents with
   * legal effect in the company's name. What waited for the configuration is retried at once.
   */
  @Put('transmission')
  @HasPermission(PERMISSIONS.TAXES_EDIT)
  @RequireStepUp(StepUpScope.MANAGE_FISCAL_CREDENTIALS)
  @ApiOperation({ summary: 'Guardar el canal de transmisión (la credencial se cifra y nunca se devuelve).' })
  async saveTransmission(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertTransmissionSettingsDto) {
    const country = await this.settings.countryOf(user.organizationId);
    const view = await this.transmission.save(user.organizationId, country, dto);
    if (view.configured) await this.submissions.requeueNotConfigured(user.organizationId, country);
    return view;
  }

  /** Where an invoice's electronic document stands with the authority. */
  @Get('submissions/invoice/:invoiceId')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'El estado del documento electrónico de una factura ante la autoridad.' })
  async submissionForInvoice(@CurrentUser() user: AuthenticatedUser, @Param('invoiceId', UuidParamPipe) invoiceId: string) {
    const submission = await this.submissions.findByInvoice(invoiceId, user.organizationId);
    // The sealed payload and the raw response stay on the server: large, and not for the screen.
    return submission ? visibleSubmission(submission) : null;
  }

  /** Try again now: transmit a pending or failed document, or ask again about one already sent. */
  @Post('submissions/:id/retry')
  @HasPermission(PERMISSIONS.INVOICES_EDIT)
  @ApiOperation({ summary: 'Reintentar ahora la transmisión o la consulta del veredicto.' })
  async retrySubmission(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return visibleSubmission(await this.submissions.retryNow(id, user.organizationId));
  }

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
   * Retire a range, or put a superseded one back in force (retiring the one in force for its type
   * and series). The one way a range's state changes: there is no `DELETE`, because the row is the
   * authorisation past documents were issued under, and destroying it destroys the only record of
   * which permission covered which document.
   */
  @Patch('ranges/:id')
  @HasPermission(PERMISSIONS.TAXES_EDIT)
  @ApiOperation({ summary: 'Retirar o reactivar un rango; la fila permanece para la trazabilidad.' })
  async setRangeActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: SetFiscalRangeActiveDto,
  ) {
    return this.settings.setRangeActive(user.organizationId, id, dto.isActive);
  }
}
