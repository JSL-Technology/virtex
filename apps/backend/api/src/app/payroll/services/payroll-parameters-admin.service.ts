import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { toIsoDate } from '../../common/dates';
import { StatutoryContribution } from '../entities/statutory-contribution.entity';
import { IncomeTaxBracket } from '../entities/income-tax-bracket.entity';
import { StatutoryReference } from '../entities/statutory-reference.entity';
import {
  ReplaceTaxScaleDto,
  UpsertContributionDto,
  UpsertReferenceDto,
} from '../dto/upsert-parameters.dto';

/**
 * The write side of the versioned statutory parameters.
 *
 * The audit's rule is that correcting a rate is inserting a row, never a code change or a migration.
 * This is the surface that makes that true at runtime: an operator with the parameters grant records
 * a new AFP split, a new minimum contributory wage, or a re-indexed ISR scale, each keyed by its
 * effective date, and a run for a later period picks it up automatically while every run already
 * calculated keeps its snapshot.
 *
 * These tables are **global reference data** — the DR's rates are the same for every tenant, so they
 * carry no `organization_id` and sit outside row-level security, exactly like exchange rates. Writing
 * them therefore affects every tenant and is gated behind its own dedicated permission for that reason.
 * A version is upserted by its natural key so re-recording the same effective date corrects it in place.
 */
@Injectable()
export class PayrollParametersAdminService {
  constructor(
    @InjectRepository(StatutoryContribution)
    private readonly contributions: Repository<StatutoryContribution>,
    @InjectRepository(StatutoryReference)
    private readonly references: Repository<StatutoryReference>,
    @InjectRepository(IncomeTaxBracket)
    private readonly brackets: Repository<IncomeTaxBracket>,
    private readonly dataSource: DataSource,
  ) {}

  listContributions(countryCode: string): Promise<StatutoryContribution[]> {
    return this.contributions.find({
      where: { countryCode: countryCode.toUpperCase() },
      order: { regime: 'ASC', effectiveFrom: 'DESC' },
    });
  }

  listReferences(countryCode: string): Promise<StatutoryReference[]> {
    return this.references.find({
      where: { countryCode: countryCode.toUpperCase() },
      order: { key: 'ASC', effectiveFrom: 'DESC' },
    });
  }

  listBrackets(countryCode: string): Promise<IncomeTaxBracket[]> {
    return this.brackets.find({
      where: { countryCode: countryCode.toUpperCase() },
      order: { effectiveFrom: 'DESC', lowerAnnual: 'ASC' },
    });
  }

  async upsertContribution(dto: UpsertContributionDto): Promise<StatutoryContribution> {
    const country = dto.countryCode.toUpperCase();
    const effectiveFrom = toIsoDate(dto.effectiveFrom);
    const existing = await this.contributions.findOne({
      where: { countryCode: country, regime: dto.regime, effectiveFrom },
    });
    const row = this.contributions.merge(existing ?? this.contributions.create(), {
      countryCode: country,
      regime: dto.regime,
      effectiveFrom,
      effectiveTo: dto.effectiveTo ? toIsoDate(dto.effectiveTo) : null,
      employeeRate: dto.employeeRate,
      employerRate: dto.employerRate,
      base: dto.base,
      capMinWageMultiplier: dto.capMinWageMultiplier ?? null,
      floorMinWageMultiplier: dto.floorMinWageMultiplier ?? null,
    });
    return this.contributions.save(row);
  }

  async upsertReference(dto: UpsertReferenceDto): Promise<StatutoryReference> {
    const country = dto.countryCode.toUpperCase();
    const effectiveFrom = toIsoDate(dto.effectiveFrom);
    const existing = await this.references.findOne({
      where: { countryCode: country, key: dto.key, effectiveFrom },
    });
    const row = this.references.merge(existing ?? this.references.create(), {
      countryCode: country,
      key: dto.key,
      effectiveFrom,
      effectiveTo: dto.effectiveTo ? toIsoDate(dto.effectiveTo) : null,
      value: dto.value,
      currencyCode: dto.currencyCode ?? 'DOP',
    });
    return this.references.save(row);
  }

  /** Replace the whole scale in force from a date: the brackets are one set, versioned together. */
  async replaceTaxScale(dto: ReplaceTaxScaleDto): Promise<IncomeTaxBracket[]> {
    const country = dto.countryCode.toUpperCase();
    const effectiveFrom = toIsoDate(dto.effectiveFrom);
    return this.dataSource.transaction(async (em) => {
      await em.delete(IncomeTaxBracket, { countryCode: country, effectiveFrom });
      const rows = dto.brackets.map((b) =>
        em.create(IncomeTaxBracket, {
          countryCode: country,
          effectiveFrom,
          effectiveTo: dto.effectiveTo ? toIsoDate(dto.effectiveTo) : null,
          lowerAnnual: b.lowerAnnual,
          upperAnnual: b.upperAnnual ?? null,
          rate: b.rate,
          accumulatedTax: b.accumulatedTax,
        }),
      );
      return em.save(rows);
    });
  }
}
