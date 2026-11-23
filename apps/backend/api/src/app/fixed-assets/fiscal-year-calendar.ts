import { EntityManager } from 'typeorm';
import { roundAmount } from '../common/money';
import { addMonthsIso, previousDay, type IsoDate } from '../common/dates';
import { BadRequestError } from '../i18n/localized.exception';
import { firstChargeableMonth } from './depreciation-schedule';

/**
 * The company's fiscal years, as a depreciation book reads them (audit 2026-11-07, FINB-16): a
 * yearly rate applies to the value at the start of the company's fiscal year, and a year's months
 * add up to the year's charge — the company's year, not the calendar's. Loaded once for a run.
 */
export class FiscalYearCalendar {
  private constructor(private readonly years: ReadonlyArray<{ start: IsoDate; end: IsoDate }>) {}

  static async load(manager: EntityManager, organizationId: string): Promise<FiscalYearCalendar> {
    const rows: Array<{ start: string; end: string }> = await manager.query(
      `SELECT "start_date"::text AS "start", "end_date"::text AS "end"
         FROM "fiscal_years" WHERE "organization_id" = $1 ORDER BY "start_date"`,
      [organizationId],
    );
    return new FiscalYearCalendar(rows.map((row) => ({ start: row.start as IsoDate, end: row.end as IsoDate })));
  }

  /**
   * The month (1–12) the fiscal year holding `date` starts in: the year recorded for it; for a date
   * no recorded year holds, the nearest recorded year's — a company's fiscal year repeats; January
   * for a company with none.
   */
  startMonthOf(date: IsoDate): number {
    if (this.years.length === 0) return 1;
    const nearest = this.holding(date) ?? (date < this.years[0].start ? this.years[0] : this.years[this.years.length - 1]);
    return Number(nearest.start.slice(5, 7));
  }

  /** The first day of the fiscal year holding `date`. */
  yearStartOf(date: IsoDate): IsoDate {
    const holding = this.holding(date);
    if (holding) return holding.start;
    const startMonth = this.startMonthOf(date);
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    return `${month >= startMonth ? year : year - 1}-${String(startMonth).padStart(2, '0')}-01`;
  }

  /** Whether `month` (any date in it) is the last month of a fiscal year. */
  closesYear(month: IsoDate): boolean {
    const next = addMonthsIso(`${month.slice(0, 7)}-01`, 1);
    return this.yearStartOf(next) === next;
  }

  private holding(date: IsoDate): { start: IsoDate; end: IsoDate } | undefined {
    return this.years.find((year) => year.start <= date && year.end >= date);
  }
}

/** A book as the year it stands in is worked out: what it has accumulated, and where it stands. */
export interface BookPosition {
  id: string;
  accumulatedDepreciation: number;
  inServiceDate: string;
  depreciatedThrough: string | null;
}

/**
 * What each book had accumulated at the start of the fiscal year its next uncharged month falls
 * in: what it has now, less what it charged since that year began. One query per year start the
 * books share — on a run, usually one — through `chargedSince`, which sums a book's months on or
 * after a date.
 */
export async function yearOpenings(
  calendar: FiscalYearCalendar,
  books: readonly BookPosition[],
  chargedSince: (yearStart: IsoDate, ids: string[]) => Promise<Map<string, number>>,
): Promise<Map<string, { opening: number; fiscalYearStartMonth: number }>> {
  const result = new Map<string, { opening: number; fiscalYearStartMonth: number }>();
  const byYearStart = new Map<IsoDate, BookPosition[]>();
  for (const book of books) {
    const next = firstChargeableMonth(book);
    const fiscalYearStartMonth = calendar.startMonthOf(next);
    const yearStart = calendar.yearStartOf(next);
    result.set(book.id, { opening: roundAmount(book.accumulatedDepreciation), fiscalYearStartMonth });
    // A book whose next month opens its year, or that has charged nothing, starts the year now.
    if (!book.depreciatedThrough || next.slice(0, 7) === yearStart.slice(0, 7)) continue;
    byYearStart.set(yearStart, [...(byYearStart.get(yearStart) ?? []), book]);
  }
  for (const [yearStart, group] of byYearStart) {
    const charged = await chargedSince(yearStart, group.map((book) => book.id));
    for (const book of group) {
      const entry = result.get(book.id);
      if (entry) entry.opening = roundAmount(book.accumulatedDepreciation - (charged.get(book.id) ?? 0));
    }
  }
  return result;
}

/**
 * A declining balance's opening is stated where its rate applies — at the close of a fiscal year,
 * as the returns that deducted it were filed, or the books that charged it closed. Mid-year, the
 * year's base is not known. `openingThrough` is `YYYY-MM`.
 */
export async function assertDecliningOpeningAtYearEnd(manager: EntityManager, organizationId: string, openingThrough: string): Promise<void> {
  const calendar = await FiscalYearCalendar.load(manager, organizationId);
  const month = `${openingThrough.slice(0, 7)}-01`;
  if (calendar.closesYear(month)) return;
  const yearStart = calendar.yearStartOf(month);
  throw new BadRequestError('fixed_assets.declining_opening_not_year_end', {
    month: openingThrough.slice(0, 7),
    yearEnd: previousDay(yearStart).slice(0, 7),
  });
}
