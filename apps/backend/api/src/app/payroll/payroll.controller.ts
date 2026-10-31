import { PayPayrollRunDto } from './dto/pay-run.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  ParseIntPipe,
  Query,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { HttpResponse as Response } from '../common/http/http.types';
import { BadRequestError } from '../i18n/localized.exception';
import { PayrollDeclarationsService } from './services/payroll-declarations.service';
import { LeaveService } from './services/leave.service';
import { DecideLeaveDto, RequestLeaveDto } from './dto/leave.dto';
import { LeaveStatus } from './entities/employee-leave.entity';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { RequireStepUp, StepUpScope } from '../auth/contracts/step-up.contract';
import { RequiresPlatformPermission } from '../security/decorators/platform-permission.decorator';
import { PLATFORM_PERMISSIONS } from '../security/platform-permissions';
import { AuditAccess } from '../audit/audit-access.decorator';
import { AuditAccessInterceptor } from '../audit/audit-access.interceptor';
import { ActionType } from '../audit/entities/audit-log.entity';
import { PayrollRunService } from './services/payroll-run.service';
import { PayrollTssService } from './services/payroll-tss.service';
import { PayrollConceptService } from './services/payroll-concept.service';
import { PayrollInputService } from './services/payroll-input.service';
import { PayrollParametersService } from './services/payroll-parameters.service';
import { PayrollParametersAdminService } from './services/payroll-parameters-admin.service';
import { CompanyPayrollParametersService } from './services/company-payroll-parameters.service';
import { RecordCompanyParameterDto, SetCompanyParameterActiveDto } from './dto/company-parameter.dto';
import { TenantCountryResolver } from '../shared/tenancy/tenant-country.resolver';
import { CreateRunDto } from './dto/create-run.dto';
import { CreateConceptDto } from './dto/create-concept.dto';
import { UpdateConceptDto } from './dto/update-concept.dto';
import { UpsertInputsDto } from './dto/upsert-inputs.dto';
import { PreviewSeveranceDto } from './dto/preview-severance.dto';
import {
  ReplaceTaxScaleDto,
  UpsertContributionDto,
  UpsertReferenceDto,
} from './dto/upsert-parameters.dto';

/**
 * The payroll HTTP surface.
 *
 * Every route names a fine-grained permission (calculating, approving, paying, configuring concepts
 * and editing statutory parameters are all different grants). The routes that move money or feed a
 * fiscal filing — calculate, approve, pay, cancel, the TSS exports, the payslip reads — are wrapped
 * in the same `@AuditAccess` trail the general ledger uses, so "who ran, approved or paid the
 * December payroll" and "who exported the TSS file" always have an answer.
 */
@Controller('payroll')
@UseInterceptors(AuditAccessInterceptor)
export class PayrollController {
  constructor(
    private readonly runs: PayrollRunService,
    private readonly tss: PayrollTssService,
    private readonly declarations: PayrollDeclarationsService,
    private readonly leave: LeaveService,
    private readonly concepts: PayrollConceptService,
    private readonly inputs: PayrollInputService,
    private readonly parameters: PayrollParametersService,
    private readonly parametersAdmin: PayrollParametersAdminService,
    private readonly companyParameters: CompanyPayrollParametersService,
    private readonly tenantCountry: TenantCountryResolver,
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
  getRun(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.findRun(id, user.organizationId);
  }

  // The state transitions below each UPDATE the run row, so they are recorded automatically by the
  // FinancialAuditSubscriber (payroll_runs is an audited table) — actor, before and after included —
  // rather than by a hand-applied access decorator, which is only for reads/exports.

  @Post('runs/:id/calculate')
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  calculate(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.calculate(id, user.organizationId, user.id);
  }

  /**
   * Approving a run settles every employee's pay for the period. Irreversible in effect and the
   * last gate before money moves, so it costs a fresh proof of identity and the token burns —
   * one re-authentication authorises one approval, not an afternoon of them.
   */
  @Post('runs/:id/approve')
  @RequireStepUp(StepUpScope.APPROVE_PAYROLL)
  @HasPermission(PERMISSIONS.PAYROLL_APPROVE)
  approve(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.approve(id, user.organizationId, user.id);
  }

  /** Paying is where the money actually leaves. Same treatment as approving. */
  @Post('runs/:id/pay')
  @RequireStepUp(StepUpScope.APPROVE_PAYROLL)
  @HasPermission(PERMISSIONS.PAYROLL_PAY)
  pay(
    @Param('id', UuidParamPipe) id: string,
    @Body() body: PayPayrollRunDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runs.markPaid(id, user.organizationId, user.id, body ?? {});
  }

  @Post('runs/:id/cancel')
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  cancel(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.cancel(id, user.organizationId);
  }

  // ── Variable inputs (novedades) ───────────────────────────────────────────────

  @Get('runs/:id/inputs')
  @RequireStepUp(StepUpScope.VIEW_PAYROLL_DATA)
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  listInputs(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inputs.list(id, user.organizationId);
  }

  @Put('runs/:id/inputs')
  @RequireStepUp(StepUpScope.MANAGE_COMPENSATION)
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  replaceInputs(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpsertInputsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inputs.replace(id, dto, user.organizationId);
  }

  // ── Payslips ─────────────────────────────────────────────────────────────────

  /**
   * Individual salaries, for every employee in the run.
   *
   * The canonical sensitive read in this product, and it sat behind a permission and a live
   * session alone. Re-authentication here is reusable within the token's ten minutes
   * (VIEW_PAYROLL_DATA is not in SINGLE_USE_SCOPES) because payroll is a job people do for an
   * hour at a time, and a prompt per row is a prompt people learn to click through.
   */
  @Get('runs/:id/payslips')
  @RequireStepUp(StepUpScope.VIEW_PAYROLL_DATA)
  @HasPermission(PERMISSIONS.PAYROLL_VIEW)
  @AuditAccess({ entity: 'payroll', action: ActionType.READ, identifiers: ['id'] })
  payslips(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.payslipsOf(id, user.organizationId);
  }

  /** The caller's own payslips. Scoped to the employee linked to the user account. */
  @Get('me/payslips')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW_OWN)
  myPayslips(@CurrentUser() user: AuthenticatedUser) {
    return this.runs.payslipsForUser(user.id, user.organizationId);
  }

  // ── Concepts (tenant catalogue) ───────────────────────────────────────────────

  @Get('concepts')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW)
  listConcepts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.concepts.list(user.organizationId, includeInactive === 'true');
  }

  @Post('concepts')
  @HasPermission(PERMISSIONS.PAYROLL_MANAGE)
  createConcept(@Body() dto: CreateConceptDto, @CurrentUser() user: AuthenticatedUser) {
    return this.concepts.create(dto, user.organizationId);
  }

  @Patch('concepts/:id')
  @HasPermission(PERMISSIONS.PAYROLL_MANAGE)
  updateConcept(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateConceptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.concepts.update(id, dto, user.organizationId);
  }

  @Delete('concepts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.PAYROLL_MANAGE)
  removeConcept(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.concepts.remove(id, user.organizationId);
  }

  // ── Severance / prestaciones ──────────────────────────────────────────────────

  @Post('employees/:employeeId/severance/preview')
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  @AuditAccess({ entity: 'payroll_severance', action: ActionType.READ, identifiers: ['employeeId'] })
  previewSeverance(
    @Param('employeeId', UuidParamPipe) employeeId: string,
    @Body() dto: PreviewSeveranceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runs.previewSeverance(employeeId, user.organizationId, dto.endDate, {
      monthlySalary: dto.monthlySalary,
      ordinarySalaryEarnedThisYear: dto.ordinarySalaryEarnedThisYear,
    });
  }

  // ── Statutory parameters (shared reference data) ──────────────────────────────
  //
  // `@Query('country') country = 'DO'` used to stand on these four. A Costa Rican or Mexican tenant
  // that opened the payroll settings without naming a country was then shown Dominican AFP/SFS/ISR
  // parameters as if they were its own — a wrong answer that looks like a right one (A-08). The
  // country now comes from the tenant when it is not stated explicitly, and the resolver throws
  // rather than defaulting when the tenant has none, so a missing country surfaces instead of
  // silently becoming Dominican.

  @Get('parameters')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW)
  async resolvedParameters(
    @CurrentUser() user: AuthenticatedUser,
    @Query('country') country?: string,
    @Query('on') on?: string,
  ) {
    const resolved = country ?? (await this.tenantCountry.resolve(user.organizationId));
    return this.parameters.resolve(resolved, on ?? new Date().toISOString().slice(0, 10));
  }

  @Get('parameters/contributions')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW)
  async listContributions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('country') country?: string,
  ) {
    return this.parametersAdmin.listContributions(
      country ?? (await this.tenantCountry.resolve(user.organizationId)),
    );
  }

  @Get('parameters/references')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW)
  async listReferences(
    @CurrentUser() user: AuthenticatedUser,
    @Query('country') country?: string,
  ) {
    return this.parametersAdmin.listReferences(
      country ?? (await this.tenantCountry.resolve(user.organizationId)),
    );
  }

  @Get('parameters/tax-brackets')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW)
  async listBrackets(
    @CurrentUser() user: AuthenticatedUser,
    @Query('country') country?: string,
  ) {
    return this.parametersAdmin.listBrackets(
      country ?? (await this.tenantCountry.resolve(user.organizationId)),
    );
  }

  // The parameter writes below are recorded by the FinancialAuditSubscriber (the statutory tables are
  // audited), so a rate change always leaves an actor and a before/after.

  @Put('parameters/contributions')
  @HasPermission(PERMISSIONS.PAYROLL_PARAMETERS_MANAGE)
  // Statutory tables every tenant's payroll is computed with: platform-only.
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.PAYROLL_STATUTORY_MANAGE)
  @RequireStepUp(StepUpScope.MANAGE_COMPENSATION)
  upsertContribution(@Body() dto: UpsertContributionDto) {
    return this.parametersAdmin.upsertContribution(dto);
  }

  @Put('parameters/references')
  @HasPermission(PERMISSIONS.PAYROLL_PARAMETERS_MANAGE)
  // Statutory tables every tenant's payroll is computed with: platform-only.
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.PAYROLL_STATUTORY_MANAGE)
  @RequireStepUp(StepUpScope.MANAGE_COMPENSATION)
  upsertReference(@Body() dto: UpsertReferenceDto) {
    return this.parametersAdmin.upsertReference(dto);
  }

  @Put('parameters/tax-brackets')
  @HasPermission(PERMISSIONS.PAYROLL_PARAMETERS_MANAGE)
  // Statutory tables every tenant's payroll is computed with: platform-only.
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.PAYROLL_STATUTORY_MANAGE)
  @RequireStepUp(StepUpScope.MANAGE_COMPENSATION)
  replaceTaxScale(@Body() dto: ReplaceTaxScaleDto) {
    return this.parametersAdmin.replaceTaxScale(dto);
  }

  // ── Company parameters (the tenant's own, effective-dated) ─────────────────────
  //
  // The statutory tables above are the platform's, for the markets the payroll engine computes. A
  // company in any other market keeps its rates here — seeded from its country pack as editable
  // statutory defaults (FICA, Medicare, FUTA for the United States) plus the ones only it can know
  // (its state's withholding table and unemployment rate). Writing them changes how the company's
  // payroll is withheld, so it is the parameters grant and a fresh re-authentication, as above.

  @Get('company-parameters')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW)
  listCompanyParameters(@CurrentUser() user: AuthenticatedUser) {
    return this.companyParameters.list(user.organizationId);
  }

  @Post('company-parameters')
  @HasPermission(PERMISSIONS.PAYROLL_PARAMETERS_MANAGE)
  @RequireStepUp(StepUpScope.MANAGE_COMPENSATION)
  recordCompanyParameter(@Body() dto: RecordCompanyParameterDto, @CurrentUser() user: AuthenticatedUser) {
    return this.companyParameters.record(dto, user.organizationId);
  }

  @Patch('company-parameters/:id')
  @HasPermission(PERMISSIONS.PAYROLL_PARAMETERS_MANAGE)
  @RequireStepUp(StepUpScope.MANAGE_COMPENSATION)
  setCompanyParameterActive(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: SetCompanyParameterActiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companyParameters.setActive(id, dto.active, user.organizationId);
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
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tss.autodeterminacion(id, user.organizationId);
  }

  // ── Vacations and leave ──────────────────────────────────────────────────────

  /** The vacation the law grants the employee for the current service year, and what is left. */
  @Get('employees/:employeeId/vacation-balance')
  @HasPermission(PERMISSIONS.HCM_VIEW)
  vacationBalance(
    @Param('employeeId', UuidParamPipe) employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('asOf') asOf?: string,
  ) {
    return this.leave.balance(user.organizationId, employeeId, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined);
  }

  @Get('leaves')
  @HasPermission(PERMISSIONS.HCM_VIEW)
  listLeaves(
    @CurrentUser() user: AuthenticatedUser,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    if (status && !(Object.values(LeaveStatus) as string[]).includes(status)) {
      throw new BadRequestError('payroll.leave.status_unknown', { status });
    }
    return this.leave.list(user.organizationId, {
      employeeId: employeeId && /^[0-9a-f-]{36}$/i.test(employeeId) ? employeeId : undefined,
      status: status as LeaveStatus | undefined,
    });
  }

  @Post('employees/:employeeId/leaves')
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  requestLeave(
    @Param('employeeId', UuidParamPipe) employeeId: string,
    @Body() dto: RequestLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.request(user.organizationId, employeeId, dto, user.id);
  }

  @Post('leaves/:id/approve')
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  approveLeave(@Param('id', UuidParamPipe) id: string, @Body() dto: DecideLeaveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leave.decide(user.organizationId, id, 'approve', user.id, dto.note);
  }

  @Post('leaves/:id/reject')
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  rejectLeave(@Param('id', UuidParamPipe) id: string, @Body() dto: DecideLeaveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leave.decide(user.organizationId, id, 'reject', user.id, dto.note);
  }

  @Post('leaves/:id/cancel')
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  cancelLeave(@Param('id', UuidParamPipe) id: string, @Body() dto: DecideLeaveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leave.decide(user.organizationId, id, 'cancel', user.id, dto.note);
  }

  // ── DGII and the bank ────────────────────────────────────────────────────────

  /** The IR-3: ISR withheld on the salaries paid in the month, employee by employee. */
  @Get('declarations/ir3')
  @HasPermission(PERMISSIONS.TSS_EXPORT)
  @AuditAccess({ entity: 'dgii_ir3', action: ActionType.EXPORT, identifiers: ['year', 'month'] })
  async ir3(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @Res() res: Response,
    @Query('format') format?: string,
  ) {
    if (month < 1 || month > 12 || year < 2000 || year > 2100) throw new BadRequestError('compliance.month_must_between_12');
    const ir3 = await this.declarations.ir3(user.organizationId, year, month);
    if (format !== 'csv') return res.header('Content-Type', 'application/json; charset=utf-8').send(ir3);
    const quote = (v: string | number | null) => {
      const t = typeof v === 'number' ? v.toFixed(2) : (v ?? '');
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = [
      'cedula,nombre,ingresos,seguridad_social,base_imponible,isr_retenido',
      ...ir3.rows.map((r) =>
        [r.identityDocument, r.employeeName, r.grossEarnings, r.socialSecurity, r.taxableBase, r.incomeTax].map(quote).join(','),
      ),
    ];
    return res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="DGII_IR3_${ir3.period}.csv"`)
      .send(lines.join('\n'));
  }

  /** The file the bank pays an approved run's net wages from, in the bank's layout. */
  @Get('runs/:id/bank-file')
  @HasPermission(PERMISSIONS.PAYROLL_PAY)
  @AuditAccess({ entity: 'payroll_bank_file', action: ActionType.EXPORT, identifiers: ['id'] })
  async bankFile(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Query('layout') layout?: string,
  ) {
    const file = await this.declarations.bankFile(user.organizationId, id, layout || 'GENERIC');
    return res
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .header('X-Payroll-Transfers', String(file.transfers))
      .header('X-Payroll-Total', file.total.toFixed(2))
      .header('X-Payroll-Without-Account', String(file.withoutAccount.length))
      .send(file.body);
  }

  @Get('runs/:id/tss/suir')
  @HasPermission(PERMISSIONS.TSS_EXPORT)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @AuditAccess({ entity: 'tss_suir', action: ActionType.EXPORT, identifiers: ['id'] })
  suir(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tss.exportSuir(id, user.organizationId);
  }
}
