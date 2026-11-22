import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import {
  InflationAdjustmentOutlookQueryDto,
  InflationAdjustmentRunsQueryDto,
  ReverseInflationAdjustmentDto,
  RunInflationAdjustmentDto,
} from './dto/run-inflation-adjustment.dto';
import { InflationAdjustmentService } from './inflation-adjustment.service';

/**
 * Restatement of the books for inflation (IAS 29; audit 2026-11-07, FIN-AC-04).
 *
 * Reading what a month's restatement would book is an accounting right; posting or undoing one
 * is its own. The period close books it on its own when the company's policy calls for it there,
 * so these routes are for a month restated by hand, a replacement after a revised index, and the
 * record of what each run did.
 */
@ApiTags('Accounting — Inflation adjustment')
@ApiBearerAuth()
@Controller('accounting/inflation-adjustment')
export class InflationAdjustmentController {
  constructor(private readonly adjustments: InflationAdjustmentService) {}

  @Get('outlook')
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @ApiOperation({ summary: 'Qué reexpresaría el mes, con qué índices, y qué hay ya contabilizado.' })
  outlook(@Query() query: InflationAdjustmentOutlookQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.outlook(user.organizationId, query.period, { ledgerId: query.ledgerId });
  }

  @Get('runs')
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @ApiOperation({ summary: 'Las reexpresiones de un libro, del mes más reciente al más antiguo.' })
  list(@Query() query: InflationAdjustmentRunsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.listRuns(user.organizationId, { ledgerId: query.ledgerId, year: query.year });
  }

  @Get('runs/:id')
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @ApiOperation({ summary: 'Una reexpresión con la cifra de cada cuenta y los índices que usó.' })
  get(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.getRun(user.organizationId, id);
  }

  @Post('runs')
  @Idempotent()
  @HasPermission(PERMISSIONS.ACCOUNTING_RUN_INFLATION_ADJUSTMENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reexpresa el libro al cierre del mes; un mes ya reexpresado responde con su corrida.' })
  async run(@Body() dto: RunInflationAdjustmentDto, @CurrentUser() user: AuthenticatedUser) {
    const { run, created } = await this.adjustments.run(user.organizationId, dto.period, user.id, {
      ledgerId: dto.ledgerId,
      replace: dto.replace === true,
    });
    return { created, run: await this.adjustments.getRun(user.organizationId, run.id) };
  }

  @Post('runs/:id/reverse')
  @Idempotent()
  @HasPermission(PERMISSIONS.ACCOUNTING_RUN_INFLATION_ADJUSTMENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deshace una reexpresión (la del último mes reexpresado del libro).' })
  async reverse(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: ReverseInflationAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.adjustments.reverse(user.organizationId, id, user.id, dto.reason);
    return this.adjustments.getRun(user.organizationId, id);
  }
}
