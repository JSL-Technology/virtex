import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuditAccess } from '../audit/audit-access.decorator';
import { AuditAccessInterceptor } from '../audit/audit-access.interceptor';
import { ActionType } from '../audit/entities/audit-log.entity';
import { PayrollRunService } from './services/payroll-run.service';
import { PayrollTssService } from './services/payroll-tss.service';
import { CreateRunDto } from './dto/create-run.dto';

/**
 * The payroll HTTP surface.
 *
 * Every route names a fine-grained permission (calculating, approving and paying are different
 * grants), and the routes that expose salaries or feed a fiscal filing are wrapped in the same
 * `@AuditAccess` trail the general ledger uses — so "who pulled the December payroll" and "who
 * exported the TSS file" have an answer.
 */
@Controller('payroll')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditAccessInterceptor)
export class PayrollController {
  constructor(
    private readonly runs: PayrollRunService,
    private readonly tss: PayrollTssService,
  ) {}

  // ── Runs ─────────────────────────────────────────────────────────────────────

  @Post('runs')
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  createRun(@Body() dto: CreateRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.createDraft(dto, user.organizationId);
  }

  @Get('runs')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW)
  listRuns(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.runs.list(user.organizationId, { page, pageSize });
  }

  @Get('runs/:id')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW)
  getRun(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.findRun(id, user.organizationId);
  }

  @Post('runs/:id/calculate')
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  calculate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.calculate(id, user.organizationId, user.id);
  }

  @Post('runs/:id/approve')
  @HasPermission(PERMISSIONS.PAYROLL_APPROVE)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.approve(id, user.organizationId, user.id);
  }

  @Post('runs/:id/pay')
  @HasPermission(PERMISSIONS.PAYROLL_PAY)
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { bankGlAccountId?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runs.markPaid(id, user.organizationId, user.id, body?.bankGlAccountId);
  }

  @Post('runs/:id/cancel')
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.cancel(id, user.organizationId);
  }

  // ── Payslips ─────────────────────────────────────────────────────────────────

  @Get('runs/:id/payslips')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW)
  @AuditAccess({ entity: 'payroll', action: ActionType.READ, identifiers: ['id'] })
  payslips(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.payslipsOf(id, user.organizationId);
  }

  /** The caller's own payslips. Scoped to the employee linked to the user account. */
  @Get('me/payslips')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW_OWN)
  myPayslips(@CurrentUser() user: AuthenticatedUser) {
    return this.runs.payslipsForUser(user.id, user.organizationId);
  }

  // ── TSS ──────────────────────────────────────────────────────────────────────

  @Get('tss/novedades')
  @HasPermission(PERMISSIONS.TSS_EXPORT)
  @AuditAccess({ entity: 'tss_novedades', action: ActionType.READ, identifiers: ['year', 'month'] })
  novedades(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year: number,
    @Query('month') month: number,
  ) {
    return this.tss.novedades(user.organizationId, Number(year), Number(month));
  }

  @Get('runs/:id/tss/autodeterminacion')
  @HasPermission(PERMISSIONS.TSS_EXPORT)
  @AuditAccess({ entity: 'tss_autodeterminacion', action: ActionType.READ, identifiers: ['id'] })
  autodeterminacion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tss.autodeterminacion(id, user.organizationId);
  }

  @Get('runs/:id/tss/suir')
  @HasPermission(PERMISSIONS.TSS_EXPORT)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @AuditAccess({ entity: 'tss_suir', action: ActionType.EXPORT, identifiers: ['id'] })
  suir(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tss.exportSuir(id, user.organizationId);
  }
}
