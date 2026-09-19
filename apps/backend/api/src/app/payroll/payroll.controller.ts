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
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuditAccess } from '../audit/audit-access.decorator';
import { AuditAccessInterceptor } from '../audit/audit-access.interceptor';
import { ActionType } from '../audit/entities/audit-log.entity';
import { PayrollRunService } from './services/payroll-run.service';
import { PayrollTssService } from './services/payroll-tss.service';
import { PayrollConceptService } from './services/payroll-concept.service';
import { PayrollInputService } from './services/payroll-input.service';
import { PayrollParametersService } from './services/payroll-parameters.service';
import { PayrollParametersAdminService } from './services/payroll-parameters-admin.service';
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
    private readonly concepts: PayrollConceptService,
    private readonly inputs: PayrollInputService,
    private readonly parameters: PayrollParametersService,
    private readonly parametersAdmin: PayrollParametersAdminService,
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

  @Post('runs/:id/approve')
  @HasPermission(PERMISSIONS.PAYROLL_APPROVE)
  approve(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.approve(id, user.organizationId, user.id);
  }

  @Post('runs/:id/pay')
  @HasPermission(PERMISSIONS.PAYROLL_PAY)
  pay(
    @Param('id', UuidParamPipe) id: string,
    @Body() body: { bankGlAccountId?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runs.markPaid(id, user.organizationId, user.id, body?.bankGlAccountId);
  }

  @Post('runs/:id/cancel')
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  cancel(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.cancel(id, user.organizationId);
  }

  // ── Variable inputs (novedades) ───────────────────────────────────────────────

  @Get('runs/:id/inputs')
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  listInputs(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inputs.list(id, user.organizationId);
  }

  @Put('runs/:id/inputs')
  @HasPermission(PERMISSIONS.PAYROLL_PROCESS)
  replaceInputs(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpsertInputsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inputs.replace(id, dto, user.organizationId);
  }

  // ── Payslips ─────────────────────────────────────────────────────────────────

  @Get('runs/:id/payslips')
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
  upsertContribution(@Body() dto: UpsertContributionDto) {
    return this.parametersAdmin.upsertContribution(dto);
  }

  @Put('parameters/references')
  @HasPermission(PERMISSIONS.PAYROLL_PARAMETERS_MANAGE)
  upsertReference(@Body() dto: UpsertReferenceDto) {
    return this.parametersAdmin.upsertReference(dto);
  }

  @Put('parameters/tax-brackets')
  @HasPermission(PERMISSIONS.PAYROLL_PARAMETERS_MANAGE)
  replaceTaxScale(@Body() dto: ReplaceTaxScaleDto) {
    return this.parametersAdmin.replaceTaxScale(dto);
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

  @Get('runs/:id/tss/suir')
  @HasPermission(PERMISSIONS.TSS_EXPORT)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @AuditAccess({ entity: 'tss_suir', action: ActionType.EXPORT, identifiers: ['id'] })
  suir(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tss.exportSuir(id, user.organizationId);
  }
}
