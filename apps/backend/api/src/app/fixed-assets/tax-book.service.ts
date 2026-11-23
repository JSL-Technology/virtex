import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import type { LocalizedName } from '@virtex/shared/types';
import { FixedAsset, DepreciationMethod } from './entities/fixed-asset.entity';
import { FixedAssetBook, FixedAssetBookKind } from './entities/fixed-asset-book.entity';
import { FixedAssetBookCharge } from './entities/fixed-asset-book-charge.entity';
import {
  chargesDue,
  disposalMonthCharge,
  remainingSchedule,
  type DepreciableAsset,
  type ScheduledCharge,
} from './depreciation-schedule';
import { changedFixedTerms, termsOf, type FIXED_TAX_TERMS, type TaxBookTerms } from './tax-book-terms';
import { I18nService } from '../i18n/i18n.service';
import { roundAmount, toCents } from '../common/money';
import { addMonthsIso, endOfMonthIso, previousDay, startOfMonthIso, toIsoDate, type IsoDate } from '../common/dates';
import { Page, Paging, toPage } from '../common/pagination';
import { BadRequestError, ConflictError } from '../i18n/localized.exception';

/** What one asset's tax book is due, before it is recorded. */
export interface PlannedBookCharges {
  book: FixedAssetBook;
  asset: Pick<FixedAsset, 'id' | 'number' | 'name'>;
  charges: ScheduledCharge[];
  amount: number;
}

/** An asset's tax book as the register shows it. */
export interface TaxBookSummary {
  id: string;
  taxCategoryCode: string | null;
  method: FixedAssetBook['depreciationMethod'];
  annualRate: number;
  convention: FixedAssetBook['depreciationConvention'];
  cost: number;
  openingAccumulated: number;
  openingThrough: string | null;
  accumulatedDepreciation: number;
  taxValue: number;
  depreciatedThrough: string | null;
  closedOn: string | null;
  /** Months charged in it: once there is one, its basis, opening and convention are fixed. */
  chargedMonths: number;
}

/** The book's months charged, and the rest of its schedule. */
export interface TaxBookSchedule {
  book: TaxBookSummary;
  posted: Array<{ periodEnd: string; amount: number; accumulatedAfter: number; bookValueAfter: number; runId: string | null }>;
  projected: ScheduledCharge[];
}

/** One asset in the tax depreciation of a period. */
export interface TaxDepreciationRow {
  assetId: string;
  number: string;
  name: string;
  categoryCode: string | null;
  categoryName: string | null;
  categoryNameTranslations: LocalizedName | null;
  taxCategoryCode: string | null;
  method: FixedAssetBook['depreciationMethod'];
  annualRate: number;
  inServiceDate: string;
  disposalDate: string | null;
  /** The basis the book depreciates. */
  basis: number;
  /** Deducted before the period, and in it. */
  openingAccumulated: number;
  deduction: number;
  closingAccumulated: number;
  /** What is left to deduct at the end of the period, or on the day the asset left. */
  taxValue: number;
  /** The accounting book over the same months, and its carrying amount at the end. */
  accountingDepreciation: number;
  accountingCarrying: number | null;
  /**
   * The carrying amount less the tax value: the temporary difference deferred tax is measured on
   * (IAS 12). Null for an asset that left before the end — it carries neither.
   */
  difference: number | null;
}

export interface TaxDepreciationTotals {
  basis: number;
  openingAccumulated: number;
  deduction: number;
  closingAccumulated: number;
  taxValue: number;
  accountingDepreciation: number;
  accountingCarrying: number;
  difference: number;
}

/** A period's tax depreciation: the assets, their totals, and the totals by tax category. */
export interface TaxDepreciationReport {
  period: { from: string; to: string };
  totals: TaxDepreciationTotals & { assets: number };
  byTaxCategory: Array<TaxDepreciationTotals & { taxCategoryCode: string | null; method: string; annualRate: number; assets: number }>;
  assets: Page<TaxDepreciationRow>;
}

/**
 * The horizon of a book stated as a rate: a straight line ends when the base is used up and a
 * declining balance runs on what is left for as long as the asset is held, so the book is given
 * the longest life the register allows — a bound, which a declining balance reaches a century on
 * and writes off what is left then.
 */
const RATE_HORIZON_MONTHS = 1200;

/** How the tax book's form names its fixed terms, for a message that lists them. */
const TAX_TERM_LABELS: Record<(typeof FIXED_TAX_TERMS)[number], string> = {
  cost: 'fixed_assets.tax_book.basis',
  openingAccumulated: 'fixed_assets.tax_book.opening_accumulated',
  openingThrough: 'fixed_assets.tax_book.opening_through',
  convention: 'fixed_assets.tax_book.convention',
};

/**
 * An asset's tax book (audit 2026-11-07, FINB-16): what the tax authority lets the company deduct,
 * by its own categories and rates, kept beside the accounting book and charged by the same runs and
 * the same calculation. A memorandum — it posts nothing.
 */
@Injectable()
export class TaxBookService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly i18n: I18nService,
  ) {}

  /** Open the asset's tax book on `terms`. */
  async open(manager: EntityManager, asset: FixedAsset, terms: TaxBookTerms): Promise<FixedAssetBook> {
    await this.assertOpeningAtYearEnd(manager, asset.organizationId, terms);
    const opening = roundAmount(terms.openingAccumulated);
    const openingThrough = opening > 0 && terms.openingThrough ? endOfMonthIso(`${terms.openingThrough}-01`) : null;
    return manager.save(
      manager.create(FixedAssetBook, {
        organizationId: asset.organizationId,
        fixedAssetId: asset.id,
        kind: FixedAssetBookKind.TAX,
        taxCategoryCode: terms.taxCategoryCode,
        depreciationMethod: terms.method,
        annualRate: terms.annualRate,
        depreciationConvention: terms.convention,
        cost: roundAmount(terms.cost),
        residualValue: 0,
        accumulatedDepreciation: opening,
        openingAccumulatedDepreciation: opening,
        openingThrough,
        depreciatedThrough: openingThrough,
        closedOn: null,
      }),
    );
  }

  /**
   * Apply `next` to a book. Before it charged a month, anything may change. After, its tax
   * category, method and rate change from the next month on — a new rate applies to what is left —
   * and its basis, opening and convention, which decided what it charged, are fixed.
   */
  async revise(manager: EntityManager, book: FixedAssetBook, next: TaxBookTerms, assetNumber: string): Promise<FixedAssetBook> {
    if (book.closedOn) throw new ConflictError('fixed_assets.tax_book_closed', { number: assetNumber, date: book.closedOn });
    const charged = await this.chargedMonths(manager, book.id);
    if (charged > 0) {
      const fixed = changedFixedTerms(termsOf(book), next);
      if (fixed.length > 0) {
        throw new ConflictError('fixed_assets.tax_book_terms_fixed', {
          number: assetNumber,
          fields: this.i18n.listOf(fixed.map((field) => TAX_TERM_LABELS[field])),
        });
      }
    } else {
      await this.assertOpeningAtYearEnd(manager, book.organizationId, next);
      const opening = roundAmount(next.openingAccumulated);
      const openingThrough = opening > 0 && next.openingThrough ? endOfMonthIso(`${next.openingThrough}-01`) : null;
      Object.assign(book, {
        depreciationConvention: next.convention,
        cost: roundAmount(next.cost),
        accumulatedDepreciation: opening,
        openingAccumulatedDepreciation: opening,
        openingThrough,
        depreciatedThrough: openingThrough,
      });
    }
    Object.assign(book, { taxCategoryCode: next.taxCategoryCode, depreciationMethod: next.method, annualRate: next.annualRate });
    return manager.save(book);
  }

  /** Remove a book that has charged nothing; one that has is the record of what was deducted. */
  async remove(manager: EntityManager, book: FixedAssetBook, assetNumber: string): Promise<void> {
    const charged = await this.chargedMonths(manager, book.id);
    if (charged > 0) throw new ConflictError('fixed_assets.tax_book_has_charges', { number: assetNumber, months: charged });
    await manager.delete(FixedAssetBook, { id: book.id });
  }

  /** The asset's tax book, or null when it keeps none. */
  bookOf(manager: EntityManager, assetId: string, lock = false): Promise<FixedAssetBook | null> {
    return manager.findOne(FixedAssetBook, {
      where: { fixedAssetId: assetId, kind: FixedAssetBookKind.TAX },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  /** How many months a book has charged. */
  chargedMonths(manager: EntityManager, bookId: string): Promise<number> {
    return manager.count(FixedAssetBookCharge, { where: { bookId } });
  }

  /** The tax books of `assetIds`, as the register shows them, by asset. */
  async summaries(manager: EntityManager, organizationId: string, assetIds: string[]): Promise<Map<string, TaxBookSummary>> {
    if (assetIds.length === 0) return new Map();
    const books = await manager.find(FixedAssetBook, {
      where: { organizationId, kind: FixedAssetBookKind.TAX, fixedAssetId: In(assetIds) },
    });
    if (books.length === 0) return new Map();
    const counts: Array<{ book_id: string; months: number }> = await manager.query(
      `SELECT "book_id", COUNT(*)::int AS months FROM "fixed_asset_book_charges" WHERE "book_id" = ANY($1::uuid[]) GROUP BY "book_id"`,
      [books.map((book) => book.id)],
    );
    const months = new Map(counts.map((row) => [row.book_id, Number(row.months)]));
    return new Map(books.map((book) => [book.fixedAssetId, summaryOf(book, months.get(book.id) ?? 0)]));
  }

  /** What the open tax books of `assets` are due through `periodEnd`. */
  async plan(manager: EntityManager, organizationId: string, assets: FixedAsset[], periodEnd: IsoDate): Promise<PlannedBookCharges[]> {
    if (assets.length === 0) return [];
    const books = await manager.find(FixedAssetBook, {
      where: { organizationId, kind: FixedAssetBookKind.TAX, closedOn: IsNull(), fixedAssetId: In(assets.map((asset) => asset.id)) },
    });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const planned: PlannedBookCharges[] = [];
    for (const book of books) {
      const asset = byId.get(book.fixedAssetId);
      if (!asset) continue;
      const charges = chargesDue(await this.depreciable(manager, book, asset), periodEnd);
      if (charges.length === 0) continue;
      planned.push({ book, asset, charges, amount: total(charges) });
    }
    return planned;
  }

  /** Record what `planned` charged, under `runId`, and move each book on. */
  async record(manager: EntityManager, runId: string | null, planned: PlannedBookCharges[]): Promise<void> {
    for (const { book, charges } of planned) {
      if (charges.length === 0) continue;
      await manager.insert(
        FixedAssetBookCharge,
        charges.map((charge) => ({
          organizationId: book.organizationId,
          bookId: book.id,
          periodEnd: charge.periodEnd,
          amount: charge.amount,
          accumulatedAfter: charge.accumulatedAfter,
          bookValueAfter: charge.bookValueAfter,
          runId,
        })),
      );
      const last = charges[charges.length - 1];
      book.accumulatedDepreciation = last.accumulatedAfter;
      book.depreciatedThrough = last.periodEnd;
      await manager.update(FixedAssetBook, { id: book.id }, { accumulatedDepreciation: last.accumulatedAfter, depreciatedThrough: last.periodEnd });
    }
  }

  /**
   * The tax book of an asset leaving on `disposalDate`: the months still due before the disposal
   * month, and that month's own charge by the book's convention — planned for the disposal's run
   * to record. Null when it keeps no open book.
   */
  async planClosing(manager: EntityManager, asset: FixedAsset, disposalDate: IsoDate): Promise<PlannedBookCharges | null> {
    const book = await manager.findOne(FixedAssetBook, {
      where: { fixedAssetId: asset.id, kind: FixedAssetBookKind.TAX, closedOn: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!book) return null;
    const lastMonthBefore = previousDay(startOfMonthIso(disposalDate));
    const depreciable = await this.depreciable(manager, book, asset);
    const catchUp = chargesDue(depreciable, lastMonthBefore);
    const caughtUp = catchUp.at(-1);
    // The disposal month resumes after the catch-up, on the base of the year it falls in.
    const resumed: DepreciableAsset = caughtUp
      ? {
          ...depreciable,
          accumulatedDepreciation: caughtUp.accumulatedAfter,
          depreciatedThrough: caughtUp.periodEnd,
          decliningYearBase: await this.yearBaseAfter(manager, book, depreciable, catchUp),
        }
      : depreciable;
    const stub = disposalMonthCharge(resumed, disposalDate);
    const charges = stub ? [...catchUp, stub] : catchUp;
    return { book, asset, charges, amount: total(charges) };
  }

  /** Close the book of an asset that left on `disposalDate`: it charges nothing after. */
  async close(manager: EntityManager, book: FixedAssetBook, disposalDate: IsoDate): Promise<void> {
    book.closedOn = disposalDate;
    await manager.update(FixedAssetBook, { id: book.id }, { closedOn: disposalDate });
  }

  /** The book's months charged, and the rest of its schedule; null when the asset keeps none. */
  async schedule(manager: EntityManager, asset: FixedAsset): Promise<TaxBookSchedule | null> {
    const book = await this.bookOf(manager, asset.id);
    if (!book) return null;
    const posted = await manager.find(FixedAssetBookCharge, { where: { bookId: book.id }, order: { periodEnd: 'ASC' } });
    const projected = book.closedOn ? [] : remainingSchedule(await this.depreciable(manager, book, asset));
    return {
      book: summaryOf(book, posted.length),
      posted: posted.map((row) => ({
        periodEnd: toIsoDate(row.periodEnd),
        amount: row.amount,
        accumulatedAfter: row.accumulatedAfter,
        bookValueAfter: row.bookValueAfter,
        runId: row.runId,
      })),
      projected,
    };
  }

  /**
   * The tax depreciation of the months `from` through `to` (`YYYY-MM`): each asset's basis, what
   * was deducted before and in the period, what is left, and — against the accounting book — the
   * temporary difference. What a tax return's depreciation schedule and the deferred tax read.
   */
  async report(
    organizationId: string,
    from: string,
    to: string,
    paging: Paging,
    taxCategoryCode?: string,
  ): Promise<TaxDepreciationReport> {
    if (to < from) throw new BadRequestError('fixed_assets.report_period_reversed', { from, to });
    const start = `${from}-01`;
    const end = endOfMonthIso(`${to}-01`);
    const category = taxCategoryCode?.trim() ? taxCategoryCode.trim().toUpperCase() : null;

    // Every book of an asset in service by the end that had not left before the start.
    const scope = `
      WITH book AS (
        SELECT b."id", b."fixed_asset_id", b."tax_category_code", b."depreciation_method", b."annual_rate",
               b."cost" AS basis, b."opening_accumulated_depreciation" AS opening
          FROM "fixed_asset_books" b
          JOIN "fixed_asset" a ON a."id" = b."fixed_asset_id"
         WHERE b."organization_id" = $1 AND b."kind" = 'TAX'
           AND a."in_service_date" <= $3::date
           AND (b."closed_on" IS NULL OR b."closed_on" >= $2::date)
           AND ($4::text IS NULL OR b."tax_category_code" = $4::text)
      ),
      tax AS (
        SELECT c."book_id",
               COALESCE(SUM(c."amount") FILTER (WHERE c."period_end" < $2::date), 0) AS before,
               COALESCE(SUM(c."amount") FILTER (WHERE c."period_end" >= $2::date), 0) AS during
          FROM "fixed_asset_book_charges" c
         WHERE c."organization_id" = $1 AND c."period_end" <= $3::date AND c."book_id" IN (SELECT "id" FROM book)
         GROUP BY c."book_id"
      ),
      accounting AS (
        SELECT d."fixed_asset_id",
               COALESCE(SUM(d."amount"), 0) AS through_end,
               COALESCE(SUM(d."amount") FILTER (WHERE d."period_end" >= $2::date), 0) AS during
          FROM "fixed_asset_depreciations" d
         WHERE d."organization_id" = $1 AND d."period_end" <= $3::date AND d."fixed_asset_id" IN (SELECT "fixed_asset_id" FROM book)
         GROUP BY d."fixed_asset_id"
      ),
      line AS (
        SELECT a."id" AS asset_id, a."number", a."name", a."in_service_date", a."disposal_date",
               cat."code" AS category_code, cat."name" AS category_name, cat."name_translations" AS category_name_translations,
               book."tax_category_code", book."depreciation_method", book."annual_rate", book.basis,
               book.opening + COALESCE(tax.before, 0) AS opening_accumulated,
               COALESCE(tax.during, 0) AS deduction,
               book.opening + COALESCE(tax.before, 0) + COALESCE(tax.during, 0) AS closing_accumulated,
               COALESCE(accounting.during, 0) AS accounting_depreciation,
               CASE WHEN a."disposal_date" IS NOT NULL AND a."disposal_date" <= $3::date THEN NULL
                    ELSE a."cost" - a."opening_accumulated_depreciation" - COALESCE(accounting.through_end, 0) END AS accounting_carrying
          FROM book
          JOIN "fixed_asset" a ON a."id" = book."fixed_asset_id"
          LEFT JOIN "fixed_asset_categories" cat ON cat."id" = a."category_id"
          LEFT JOIN tax ON tax."book_id" = book."id"
          LEFT JOIN accounting ON accounting."fixed_asset_id" = a."id"
      )`;
    const params = [organizationId, start, end, category];
    const manager = this.dataSource.manager;
    const sums = `
      COALESCE(SUM(basis), 0) AS basis, COALESCE(SUM(opening_accumulated), 0) AS opening_accumulated,
      COALESCE(SUM(deduction), 0) AS deduction, COALESCE(SUM(closing_accumulated), 0) AS closing_accumulated,
      COALESCE(SUM(basis - closing_accumulated), 0) AS tax_value,
      COALESCE(SUM(accounting_depreciation), 0) AS accounting_depreciation,
      COALESCE(SUM(accounting_carrying), 0) AS accounting_carrying,
      COALESCE(SUM(accounting_carrying - (basis - closing_accumulated)), 0) AS difference`;

    const rows: Array<Record<string, unknown>> = await manager.query(
      `${scope}
       SELECT line.*, line.basis - line.closing_accumulated AS tax_value,
              line.accounting_carrying - (line.basis - line.closing_accumulated) AS difference
         FROM line
        ORDER BY line."tax_category_code" NULLS LAST, line."number"
        LIMIT $5 OFFSET $6`,
      [...params, paging.take, paging.skip],
    );
    const [overall]: Array<Record<string, unknown>> = await manager.query(`${scope} SELECT COUNT(*)::int AS assets, ${sums} FROM line`, params);
    const grouped: Array<Record<string, unknown>> = await manager.query(
      `${scope}
       SELECT "tax_category_code", "depreciation_method", "annual_rate", COUNT(*)::int AS assets, ${sums}
         FROM line
        GROUP BY "tax_category_code", "depreciation_method", "annual_rate"
        ORDER BY "tax_category_code" NULLS LAST, "depreciation_method", "annual_rate"`,
      params,
    );

    const assets = Number(overall?.['assets'] ?? 0);
    return {
      period: { from, to },
      totals: { ...totalsOf(overall), assets },
      byTaxCategory: grouped.map((row) => ({
        taxCategoryCode: (row['tax_category_code'] as string | null) ?? null,
        method: String(row['depreciation_method']),
        annualRate: Number(row['annual_rate']),
        assets: Number(row['assets']),
        ...totalsOf(row),
      })),
      assets: toPage(rows.map(rowOf), assets, paging),
    };
  }

  /**
   * A declining balance's opening is stated where its rate applies — at the end of a fiscal year,
   * as the returns that deducted it were filed. Mid-year, the year's base is not known.
   */
  private async assertOpeningAtYearEnd(manager: EntityManager, organizationId: string, terms: TaxBookTerms): Promise<void> {
    if (terms.method !== DepreciationMethod.DECLINING_BALANCE || terms.openingAccumulated <= 0 || !terms.openingThrough) return;
    const next = endOfMonthIso(addMonthsIso(`${terms.openingThrough}-01`, 1));
    const startMonth = await fiscalYearStartMonthOf(manager, organizationId, next);
    if (Number(next.slice(5, 7)) === startMonth) return;
    throw new BadRequestError('fixed_assets.tax_opening_not_year_end', {
      month: terms.openingThrough,
      yearEnd: previousDay(startOfYearContaining(next, startMonth)).slice(0, 7),
    });
  }

  /**
   * The book as the calculation reads it: its basis, method, rate and state, on the asset's dates,
   * with the company's fiscal year — what a declining balance's yearly rate applies to — and, when
   * the book resumes in the middle of a year, the value it started that year at.
   */
  private async depreciable(manager: EntityManager, book: FixedAssetBook, asset: Pick<FixedAsset, 'inServiceDate'>): Promise<DepreciableAsset> {
    const declining = book.depreciationMethod === DepreciationMethod.DECLINING_BALANCE;
    const inServiceDate = toIsoDate(asset.inServiceDate);
    const depreciatedThrough = book.depreciatedThrough ? toIsoDate(book.depreciatedThrough) : null;
    const next = depreciatedThrough ? endOfMonthIso(addMonthsIso(`${depreciatedThrough.slice(0, 7)}-01`, 1)) : endOfMonthIso(inServiceDate);
    // The tax year: what a declining balance's rate applies to, and what each year's cents add up in.
    const fiscalYearStartMonth = await fiscalYearStartMonthOf(manager, book.organizationId, next);
    const base: DepreciableAsset = {
      cost: book.cost,
      residualValue: book.residualValue,
      usefulLifeMonths: RATE_HORIZON_MONTHS,
      depreciationMethod: book.depreciationMethod,
      decliningAnnualRate: declining ? book.annualRate : null,
      straightLineAnnualRate: declining ? null : book.annualRate,
      fiscalYearStartMonth,
      depreciationConvention: book.depreciationConvention,
      inServiceDate,
      accumulatedDepreciation: book.accumulatedDepreciation,
      depreciatedThrough,
    };
    if (!declining || !depreciatedThrough) return base;
    const yearStart = startOfYearContaining(next, fiscalYearStartMonth);
    // What this book charged in the year the next month falls in: the value at the year's start is
    // what is left now plus those months.
    const decliningYearBase = roundAmount(book.cost - book.accumulatedDepreciation + (await this.chargedSince(manager, book.id, yearStart)));
    return { ...base, decliningYearBase };
  }

  /** The year base after the catch-up months: the same year's, or a new year's when they crossed one. */
  private async yearBaseAfter(
    manager: EntityManager,
    book: FixedAssetBook,
    depreciable: DepreciableAsset,
    catchUp: ScheduledCharge[],
  ): Promise<number | null> {
    if (book.depreciationMethod !== DepreciationMethod.DECLINING_BALANCE || catchUp.length === 0) return null;
    const startMonth = depreciable.fiscalYearStartMonth ?? 1;
    const last = catchUp[catchUp.length - 1];
    const next = endOfMonthIso(addMonthsIso(`${last.periodEnd.slice(0, 7)}-01`, 1));
    const yearStart = startOfYearContaining(next, startMonth);
    // The catch-up months inside the year the disposal month falls in, and the months already
    // recorded in it before the catch-up.
    const inYear = catchUp.filter((charge) => charge.periodEnd >= yearStart);
    return roundAmount(book.cost - last.accumulatedAfter + total(inYear) + (await this.chargedSince(manager, book.id, yearStart)));
  }

  private async chargedSince(manager: EntityManager, bookId: string, since: IsoDate): Promise<number> {
    const [{ charged }] = await manager.query<{ charged: string }[]>(
      `SELECT COALESCE(SUM("amount"), 0)::text AS charged FROM "fixed_asset_book_charges" WHERE "book_id" = $1 AND "period_end" >= $2`,
      [bookId, since],
    );
    return Number(charged);
  }
}

/** The month (1–12) the company's fiscal year that holds `date` starts in; January when none does. */
export async function fiscalYearStartMonthOf(manager: EntityManager, organizationId: string, date: IsoDate): Promise<number> {
  const [row] = await manager.query<{ month: number }[]>(
    `SELECT extract(month FROM "start_date")::int AS month FROM "fiscal_years"
      WHERE "organization_id" = $1 AND "start_date" <= $2::date AND "end_date" >= $2::date
      ORDER BY "start_date" DESC LIMIT 1`,
    [organizationId, date],
  );
  return row?.month ?? 1;
}

function summaryOf(book: FixedAssetBook, chargedMonths: number): TaxBookSummary {
  return {
    id: book.id,
    taxCategoryCode: book.taxCategoryCode,
    method: book.depreciationMethod,
    annualRate: book.annualRate,
    convention: book.depreciationConvention,
    cost: book.cost,
    openingAccumulated: book.openingAccumulatedDepreciation,
    openingThrough: book.openingThrough ? toIsoDate(book.openingThrough).slice(0, 7) : null,
    accumulatedDepreciation: book.accumulatedDepreciation,
    taxValue: roundAmount(book.cost - book.accumulatedDepreciation),
    depreciatedThrough: book.depreciatedThrough ? toIsoDate(book.depreciatedThrough) : null,
    closedOn: book.closedOn ? toIsoDate(book.closedOn) : null,
    chargedMonths,
  };
}

function rowOf(row: Record<string, unknown>): TaxDepreciationRow {
  return {
    assetId: String(row['asset_id']),
    number: String(row['number']),
    name: String(row['name']),
    categoryCode: (row['category_code'] as string | null) ?? null,
    categoryName: (row['category_name'] as string | null) ?? null,
    categoryNameTranslations: (row['category_name_translations'] as LocalizedName | null) ?? null,
    taxCategoryCode: (row['tax_category_code'] as string | null) ?? null,
    method: row['depreciation_method'] as FixedAssetBook['depreciationMethod'],
    annualRate: Number(row['annual_rate']),
    inServiceDate: toIsoDate(row['in_service_date'] as Date | string),
    disposalDate: row['disposal_date'] ? toIsoDate(row['disposal_date'] as Date | string) : null,
    basis: amount(row['basis']),
    openingAccumulated: amount(row['opening_accumulated']),
    deduction: amount(row['deduction']),
    closingAccumulated: amount(row['closing_accumulated']),
    taxValue: amount(row['tax_value']),
    accountingDepreciation: amount(row['accounting_depreciation']),
    accountingCarrying: row['accounting_carrying'] === null ? null : amount(row['accounting_carrying']),
    difference: row['difference'] === null ? null : amount(row['difference']),
  };
}

/** The first day of the year starting in `startMonth` that holds `date`. */
function startOfYearContaining(date: IsoDate, startMonth: number): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
}

function totalsOf(row: Record<string, unknown> | undefined): TaxDepreciationTotals {
  return {
    basis: amount(row?.['basis']),
    openingAccumulated: amount(row?.['opening_accumulated']),
    deduction: amount(row?.['deduction']),
    closingAccumulated: amount(row?.['closing_accumulated']),
    taxValue: amount(row?.['tax_value']),
    accountingDepreciation: amount(row?.['accounting_depreciation']),
    accountingCarrying: amount(row?.['accounting_carrying']),
    difference: amount(row?.['difference']),
  };
}

function amount(value: unknown): number {
  return roundAmount(Number(value ?? 0));
}

function total(charges: ScheduledCharge[]): number {
  return roundAmount(charges.reduce((sum, charge) => sum + toCents(charge.amount), 0) / 100);
}
