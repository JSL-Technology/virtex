import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { toIsoDate } from '../../common/dates';
import { BadRequestError } from '../../i18n/localized.exception';
import {
  StatutoryContribution,
} from '../entities/statutory-contribution.entity';
import { IncomeTaxBracket } from '../entities/income-tax-bracket.entity';
import {
  StatutoryReference,
  StatutoryReferenceKey,
} from '../entities/statutory-reference.entity';
import { ResolvedParameters } from '../jurisdictions/jurisdiction-strategy.interface';

/**
 * Resolves the statutory parameters in force for a country on a date.
 *
 * The single reader of the versioned parameter tables. It answers "which rates, caps and scale
 * applied on this date" by taking, for each regime/key, the newest version whose `effectiveFrom` is
 * on or before the date and whose `effectiveTo` has not passed — the same "latest in force"
 * resolution the exchange-rate and tax engines use. The run calls this once at calculation and
 * snapshots the result, so a later change to a parameter row never alters a run already computed.
 */
@Injectable()
export class PayrollParametersService {
  constructor(
    @InjectRepository(StatutoryContribution)
    private readonly contributions: Repository<StatutoryContribution>,
    @InjectRepository(IncomeTaxBracket)
    private readonly brackets: Repository<IncomeTaxBracket>,
    @InjectRepository(StatutoryReference)
    private readonly references: Repository<StatutoryReference>,
  ) {}

  async resolve(countryCode: string, on: Date | string): Promise<ResolvedParameters> {
    const country = (countryCode ?? '').toUpperCase();
    const date = toIsoDate(on);

    const [contributionRows, bracketRows, referenceRows] = await Promise.all([
      this.contributions.find({
        where: { countryCode: country, effectiveFrom: LessThanOrEqual(date) },
        order: { effectiveFrom: 'DESC' },
      }),
      this.brackets.find({
        where: { countryCode: country, effectiveFrom: LessThanOrEqual(date) },
        order: { effectiveFrom: 'DESC', lowerAnnual: 'ASC' },
      }),
      this.references.find({
        where: { countryCode: country, effectiveFrom: LessThanOrEqual(date) },
        order: { effectiveFrom: 'DESC' },
      }),
    ]);

    // For each regime keep only the newest version still in force on the date.
    const contributions = this.latestPerKey(
      contributionRows.filter((row) => this.inForce(row.effectiveTo, date)),
      (row) => row.regime,
    ).map((row) => ({
      regime: row.regime,
      employeeRate: row.employeeRate,
      employerRate: row.employerRate,
      base: row.base,
      capMinWageMultiplier: row.capMinWageMultiplier,
    }));

    if (contributions.length === 0) {
      throw new BadRequestError('PAYROLL.SIN_PARAMETROS_CONTRIBUCION_PAIS_FECHA', {
        p1: country,
        p2: date,
      });
    }

    // The applicable ISR scale is the whole set sharing the newest effectiveFrom in force.
    const inForceBrackets = bracketRows.filter((row) => this.inForce(row.effectiveTo, date));
    const newestBracketDate = inForceBrackets[0]?.effectiveFrom ?? null;
    const taxBrackets = inForceBrackets
      .filter((row) => row.effectiveFrom === newestBracketDate)
      .map((row) => ({
        lowerAnnual: row.lowerAnnual,
        upperAnnual: row.upperAnnual,
        rate: row.rate,
        accumulatedTax: row.accumulatedTax,
      }));

    const minWageRef = this.latestPerKey(
      referenceRows.filter((row) => this.inForce(row.effectiveTo, date)),
      (row) => row.key,
    ).find((row) => row.key === StatutoryReferenceKey.MIN_WAGE_COTIZABLE);

    if (!minWageRef) {
      throw new BadRequestError('PAYROLL.SIN_SALARIO_MINIMO_COTIZABLE_PAIS_FECHA', {
        p1: country,
        p2: date,
      });
    }

    return {
      countryCode: country,
      effectiveDate: date,
      minWageCotizable: minWageRef.value,
      contributions,
      taxBrackets,
      currencyCode: minWageRef.currencyCode,
    };
  }

  /** Rows come newest-first; keep the first seen for each key. */
  private latestPerKey<T, K>(rows: T[], keyOf: (row: T) => K): T[] {
    const seen = new Set<K>();
    const out: T[] = [];
    for (const row of rows) {
      const key = keyOf(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  }

  private inForce(effectiveTo: string | null, date: string): boolean {
    return effectiveTo === null || effectiveTo >= date;
  }
}
