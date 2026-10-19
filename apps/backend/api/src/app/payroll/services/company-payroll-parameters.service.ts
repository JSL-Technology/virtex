import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { toIsoDate } from '../../common/dates';
import { BadRequestError, NotFoundError } from '../../i18n/localized.exception';
import { TenantCountryResolver } from '../../shared/tenancy/tenant-country.resolver';
import {
  CompanyPayrollParameter,
  WithholdingBracket,
} from '../entities/company-payroll-parameter.entity';
import { RecordCompanyParameterDto } from '../dto/company-parameter.dto';

/**
 * The payroll parameters a company keeps for itself (see {@link CompanyPayrollParameter}).
 *
 * The same rule as the platform's statutory tables, applied to the company's own: a figure is a fact
 * about a date. Recording a figure for a parameter from a new date closes the window of the one in
 * force before it, instead of overwriting it; recording one for a date that already has a figure
 * corrects that figure, which is what a typo needs. A parameter is retired, never deleted, so a
 * payroll already computed can always be explained from the figures it used.
 */
@Injectable()
export class CompanyPayrollParametersService {
  constructor(
    @InjectRepository(CompanyPayrollParameter)
    private readonly parameters: Repository<CompanyPayrollParameter>,
    private readonly tenantCountry: TenantCountryResolver,
  ) {}

  list(organizationId: string): Promise<CompanyPayrollParameter[]> {
    return this.parameters.find({
      where: { organizationId },
      order: { code: 'ASC', jurisdiction: 'ASC', effectiveFrom: 'DESC' },
    });
  }

  async record(dto: RecordCompanyParameterDto, organizationId: string): Promise<CompanyPayrollParameter> {
    const values = validatedValues(dto);
    const code = dto.code.trim().toUpperCase();
    const jurisdiction = dto.jurisdiction?.trim().toUpperCase() ?? '';
    const effectiveFrom = toIsoDate(dto.effectiveFrom);

    return this.parameters.manager.transaction(async (manager) => {
      const repo = manager.getRepository(CompanyPayrollParameter);
      const sameParameter = { organizationId, code, jurisdiction };

      // The same date: a correction of that figure, in place.
      let existing = await repo.findOne({ where: { ...sameParameter, effectiveFrom } });

      // A later date: the figure in force until now ends the day before.
      let previous = existing
        ? null
        : await repo.findOne({
            where: { ...sameParameter, effectiveFrom: LessThan(effectiveFrom), effectiveTo: IsNull() },
            order: { effectiveFrom: 'DESC' },
          });
      // Except a placeholder the market seeded without figures: there was no figure in force to
      // close, so entering one fills the placeholder rather than leaving an empty row in history.
      if (previous?.requiresInput) {
        existing = previous;
        previous = null;
      }
      if (previous) {
        previous.effectiveTo = dayBefore(effectiveFrom);
        await repo.save(previous);
      }

      const currency = existing?.currencyCode ?? previous?.currencyCode ?? (await this.currencyOf(organizationId));
      const row = repo.merge(existing ?? repo.create(), {
        organizationId,
        countryCode: existing?.countryCode ?? previous?.countryCode ?? (await this.countryOf(organizationId)),
        code,
        name: dto.name.trim(),
        kind: dto.kind,
        jurisdiction,
        ...values,
        currencyCode: currency,
        effectiveFrom,
        // A row recorded before a later one keeps the window the later one gave it.
        effectiveTo: existing?.effectiveTo ?? null,
        source: 'COMPANY',
        legalBasis: dto.legalBasis?.trim() || existing?.legalBasis || previous?.legalBasis || null,
        requiresInput: false,
        active: existing?.active ?? previous?.active ?? true,
      });
      return repo.save(row);
    });
  }

  /** Retire a parameter (every version of it) from the company's payroll, or reinstate it. */
  async setActive(id: string, active: boolean, organizationId: string): Promise<CompanyPayrollParameter[]> {
    const row = await this.parameters.findOne({ where: { id, organizationId } });
    if (!row) throw new NotFoundError('payroll.company_parameters.not_found');
    await this.parameters.update(
      { organizationId, code: row.code, jurisdiction: row.jurisdiction },
      { active },
    );
    return this.parameters.find({
      where: { organizationId, code: row.code, jurisdiction: row.jurisdiction },
      order: { effectiveFrom: 'DESC' },
    });
  }

  private async countryOf(organizationId: string): Promise<string> {
    return (await this.tenantCountry.resolveOrNull(organizationId)) ?? '';
  }

  private async currencyOf(organizationId: string): Promise<string> {
    const [row] = await this.parameters.query(
      `SELECT "base_currency" FROM "organization_settings" WHERE "organization_id" = $1`,
      [organizationId],
    );
    return (row?.base_currency as string | undefined) ?? 'USD';
  }
}

type ParameterValues = Pick<
  CompanyPayrollParameter,
  'employeeRate' | 'employerRate' | 'wageBase' | 'threshold' | 'creditRate' | 'amount' | 'brackets'
>;

/**
 * The figures a kind of parameter is made of, and only those.
 *
 * A contribution is a rate (at least one side of it); a table is a set of brackets that start at
 * zero and climb without gaps; an amount is an amount. Anything else on the request is dropped, so a
 * table cannot also carry a stray rate the screen would then have to explain.
 */
export function validatedValues(dto: RecordCompanyParameterDto): ParameterValues {
  const none: ParameterValues = {
    employeeRate: null,
    employerRate: null,
    wageBase: null,
    threshold: null,
    creditRate: null,
    amount: null,
    brackets: null,
  };
  switch (dto.kind) {
    case 'CONTRIBUTION':
      if (dto.employeeRate == null && dto.employerRate == null) {
        throw new BadRequestError('payroll.company_parameters.rate_required');
      }
      return {
        ...none,
        employeeRate: dto.employeeRate ?? 0,
        employerRate: dto.employerRate ?? 0,
        wageBase: dto.wageBase ?? null,
        threshold: dto.threshold ?? null,
        creditRate: dto.creditRate ?? null,
      };
    case 'AMOUNT':
      if (dto.amount == null) throw new BadRequestError('payroll.company_parameters.amount_required');
      return { ...none, amount: dto.amount };
    case 'TABLE':
      return { ...none, brackets: validatedBrackets(dto.brackets ?? []) };
  }
}

function validatedBrackets(brackets: ReadonlyArray<Omit<WithholdingBracket, 'upTo'> & { upTo?: number | null }>): WithholdingBracket[] {
  if (brackets.length === 0) throw new BadRequestError('payroll.company_parameters.brackets_required');
  const sorted = [...brackets]
    .map((bracket): WithholdingBracket => ({
      over: bracket.over,
      upTo: bracket.upTo ?? null,
      rate: bracket.rate,
      baseAmount: bracket.baseAmount,
    }))
    .sort((a, b) => a.over - b.over);
  if (sorted[0].over !== 0) throw new BadRequestError('payroll.company_parameters.brackets_start_at_zero');
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const last = i === sorted.length - 1;
    // Only the top bracket is open; every other ends exactly where the next one starts.
    if (!last && (current.upTo === null || current.upTo !== next.over)) {
      throw new BadRequestError('payroll.company_parameters.brackets_contiguous');
    }
    if (current.upTo !== null && current.upTo <= current.over) {
      throw new BadRequestError('payroll.company_parameters.brackets_contiguous');
    }
  }
  return sorted;
}

function dayBefore(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
