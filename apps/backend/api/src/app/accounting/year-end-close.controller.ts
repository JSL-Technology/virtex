import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { YearEndCloseService } from './year-end-close.service';
import { ReopenFiscalYearDto, YearEndCloseDto } from './dto/year-end-close.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { toIsoDate } from '../common/dates';

@ApiTags('Accounting — Year end')
@ApiBearerAuth()
@Controller('accounting/year-end-close')
@UseGuards(JwtAuthGuard)
export class YearEndCloseController {
  constructor(private readonly yearEndCloseService: YearEndCloseService) {}

  @HasPermission(PERMISSIONS.ACCOUNTING_CLOSE_YEAR)
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cierra el año fiscal: traspasa el resultado a resultados acumulados y abre el siguiente.',
  })
  async closeFiscalYear(
    @Body() closeDto: YearEndCloseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const closedYear = await this.yearEndCloseService.closeFiscalYear(
      closeDto,
      user.organizationId,
      user.id,
    );
    // A message key, not a Spanish sentence composed here. The response used to carry a literal,
    // which is untranslatable and bypasses the catalogue every other endpoint answers through.
    return {
      messageKey: 'ACCOUNTING.ANO_FISCAL_CERRADO_EXITOSAMENTE',
      messageParams: { to: toIsoDate(closedYear.endDate) },
      fiscalYear: closedYear,
    };
  }

  /**
   * Reopen a settled year.
   *
   * There was no route and no service method: a closed year was permanent, and an audit adjustment
   * arriving after the close had nowhere to go.
   */
  @HasPermission(PERMISSIONS.ACCOUNTING_REOPEN_YEAR)
  @Post('reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reabre un año fiscal cerrado y revierte el asiento de traspaso de resultados.',
  })
  async reopenFiscalYear(
    @Body() dto: ReopenFiscalYearDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const reopened = await this.yearEndCloseService.reopenFiscalYear(
      dto,
      user.organizationId,
      user.id,
    );
    return {
      messageKey: 'ACCOUNTING.ANO_FISCAL_REABIERTO_EXITOSAMENTE',
      messageParams: { to: toIsoDate(reopened.endDate) },
      fiscalYear: reopened,
    };
  }
}
