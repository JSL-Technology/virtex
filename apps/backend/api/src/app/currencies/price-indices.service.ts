import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ISO_MONTH_PATTERN } from '@virtex/shared/types';
import { PRICE_INDEX_SERIES, priceIndexSeries, type PriceIndexSeriesDefinition } from '../markets';
import { UnprocessableEntityError } from '../i18n/localized.exception';
import { toIsoMonth, todayIso, type IsoMonth } from '../common/dates';

/**
 * General price indices: the series each market prescribes for restating its statements (IAS 29),
 * and their monthly values.
 *
 * Reference data, like the exchange rates beside it: the platform loads the published figures
 * (`price_index_values`) and every company reads them; a company may record a month the platform
 * has not loaded yet (`tenant_price_index_values`), and that value is used only while the published
 * one is missing. Both are versioned: a correction is the next revision, never an edit.
 */

/** Where the value of a month came from. */
export type PriceIndexSource = 'PLATFORM' | 'COMPANY';

/** The value of one month of a series, as a company restates with it. */
export interface ResolvedPriceIndexValue {
  /** `2026-03`. */
  period: IsoMonth;
  /** Exact decimal text: never converted to a JavaScript number on the way to a coefficient. */
  value: string;
  revision: number;
  source: PriceIndexSource;
  /** The row the value is, for the record each restatement keeps of what it used. */
  valueId: string;
  publishedOn: string | null;
  reference: string | null;
  /**
   * The company's own value for the same month when the published one is used instead of it:
   * shown, so a figure the company typed and the platform's are never silently different.
   */
  companyValue: { value: string; revision: number } | null;
}

/** One revision of one month, from either table: the month's history. */
export interface PriceIndexRevision {
  period: IsoMonth;
  value: string;
  revision: number;
  source: PriceIndexSource;
  publishedOn: string | null;
  reference: string | null;
  recordedAt: string;
  recordedByUserId: string | null;
}

export interface PriceIndexEntry {
  period: IsoMonth;
  /** Decimal text: up to twenty digits before the point and ten after it. */
  value: string;
  publishedOn?: string | null;
  reference?: string | null;
}

/** A level the column holds: positive, at most 20 integer and 10 decimal digits. */
const LEVEL = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,10})?$/;

/** `2026-03` → `2026-03-01`, the date a month is stored under. */
export function monthStart(period: IsoMonth): string {
  return `${period}-01`;
}

/** `7694.0072000000` → `7694.0072`: the level as it was published. */
export function trimLevel(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

@Injectable()
export class PriceIndicesService {
  constructor(private readonly dataSource: DataSource) {}

  /** Every series a market prescribes, in code order. */
  catalogue(): PriceIndexSeriesDefinition[] {
    return [...PRICE_INDEX_SERIES.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  /** The series, or a refusal naming the codes that exist. */
  requireSeries(code: string): PriceIndexSeriesDefinition {
    const series = priceIndexSeries(code);
    if (!series) {
      throw new UnprocessableEntityError('price_indices.series_unknown', {
        code,
        known: this.catalogue().map((entry) => entry.code).join(', '),
      });
    }
    return series;
  }

  /**
   * The value of each month from `from` to `to` (both `YYYY-MM`, inclusive) that has one, for the
   * company: the published figure's latest revision, else the company's own latest revision.
   * Months with neither are absent from the map.
   */
  async resolve(
    organizationId: string,
    seriesCode: string,
    from: IsoMonth,
    to: IsoMonth,
    manager?: EntityManager,
  ): Promise<Map<IsoMonth, ResolvedPriceIndexValue>> {
    this.requireSeries(seriesCode);
    const em = manager ?? this.dataSource.manager;
    const rows: Array<{
      period: string;
      p_id: string | null;
      p_value: string | null;
      p_revision: number | null;
      p_published_on: string | null;
      p_reference: string | null;
      c_id: string | null;
      c_value: string | null;
      c_revision: number | null;
      c_published_on: string | null;
      c_reference: string | null;
    }> = await em.query(
      `
      WITH platform AS (
        SELECT DISTINCT ON ("period") "period", "id", "value", "revision", "published_on", "reference"
          FROM "price_index_values"
         WHERE "series_code" = $1 AND "period" BETWEEN $2::date AND $3::date
         ORDER BY "period", "revision" DESC
      ), company AS (
        SELECT DISTINCT ON ("period") "period", "id", "value", "revision", "published_on", "reference"
          FROM "tenant_price_index_values"
         WHERE "organization_id" = $4 AND "series_code" = $1 AND "period" BETWEEN $2::date AND $3::date
         ORDER BY "period", "revision" DESC
      )
      SELECT to_char(COALESCE(p."period", c."period"), 'YYYY-MM') AS "period",
             p."id" AS p_id, p."value"::text AS p_value, p."revision" AS p_revision,
             to_char(p."published_on", 'YYYY-MM-DD') AS p_published_on, p."reference" AS p_reference,
             c."id" AS c_id, c."value"::text AS c_value, c."revision" AS c_revision,
             to_char(c."published_on", 'YYYY-MM-DD') AS c_published_on, c."reference" AS c_reference
        FROM platform p
        FULL JOIN company c ON c."period" = p."period"
       ORDER BY 1
      `,
      [seriesCode, monthStart(from), monthStart(to), organizationId],
    );

    const resolved = new Map<IsoMonth, ResolvedPriceIndexValue>();
    for (const row of rows) {
      const published = row.p_id !== null;
      resolved.set(row.period, {
        period: row.period,
        value: trimLevel((published ? row.p_value : row.c_value) as string),
        revision: Number(published ? row.p_revision : row.c_revision),
        source: published ? 'PLATFORM' : 'COMPANY',
        valueId: (published ? row.p_id : row.c_id) as string,
        publishedOn: published ? row.p_published_on : row.c_published_on,
        reference: published ? row.p_reference : row.c_reference,
        companyValue:
          published && row.c_id !== null
            ? { value: trimLevel(row.c_value as string), revision: Number(row.c_revision) }
            : null,
      });
    }
    return resolved;
  }

  /** Every revision of one month, from the platform and from the company, newest first. */
  async history(organizationId: string, seriesCode: string, period: IsoMonth): Promise<PriceIndexRevision[]> {
    this.requireSeries(seriesCode);
    assertMonth(period);
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `
      SELECT 'PLATFORM' AS "source", "value"::text AS "value", "revision",
             to_char("published_on", 'YYYY-MM-DD') AS "publishedOn", "reference", "recorded_at" AS "recordedAt",
             "recorded_by_user_id" AS "recordedByUserId"
        FROM "price_index_values" WHERE "series_code" = $1 AND "period" = $2::date
      UNION ALL
      SELECT 'COMPANY', "value"::text, "revision",
             to_char("published_on", 'YYYY-MM-DD'), "reference", "recorded_at", "recorded_by_user_id"
        FROM "tenant_price_index_values" WHERE "organization_id" = $3 AND "series_code" = $1 AND "period" = $2::date
       ORDER BY "recordedAt" DESC, "revision" DESC
      `,
      [seriesCode, monthStart(period), organizationId],
    );
    return rows.map((row) => ({
      period,
      value: trimLevel(String(row['value'])),
      revision: Number(row['revision']),
      source: row['source'] as PriceIndexSource,
      publishedOn: (row['publishedOn'] as string | null) ?? null,
      reference: (row['reference'] as string | null) ?? null,
      recordedAt: new Date(row['recordedAt'] as string).toISOString(),
      recordedByUserId: (row['recordedByUserId'] as string | null) ?? null,
    }));
  }

  /**
   * Record months of a series for the company — a new revision of each month whose value or
   * reference differs from the company's latest one; recording the same figure again records
   * nothing, so a retried request or a re-imported file changes nothing.
   */
  async recordForCompany(
    organizationId: string,
    seriesCode: string,
    entries: readonly PriceIndexEntry[],
    userId: string | null,
    manager?: EntityManager,
  ): Promise<{ recorded: number; unchanged: number }> {
    return this.record({ table: 'tenant_price_index_values', organizationId }, seriesCode, entries, userId, manager);
  }

  /** Record published months of a series for every company: the platform's load. */
  async recordPublished(
    seriesCode: string,
    entries: readonly PriceIndexEntry[],
    userId: string | null,
    manager?: EntityManager,
  ): Promise<{ recorded: number; unchanged: number }> {
    return this.record({ table: 'price_index_values', organizationId: null }, seriesCode, entries, userId, manager);
  }

  /** The rules every recorded month obeys, whoever records it. Throws the first refusal. */
  validateEntries(seriesCode: string, entries: readonly PriceIndexEntry[]): void {
    this.requireSeries(seriesCode);
    if (entries.length === 0) throw new UnprocessableEntityError('price_indices.nothing_to_record');
    const currentMonth = toIsoMonth(todayIso());
    const seen = new Set<string>();
    for (const entry of entries) {
      assertMonth(entry.period);
      // A month is published after it ends; one that has not begun has no index yet.
      if (entry.period > currentMonth) {
        throw new UnprocessableEntityError('price_indices.period_in_future', { period: entry.period, current: currentMonth });
      }
      if (typeof entry.value !== 'string' || !LEVEL.test(entry.value) || !/[1-9]/.test(entry.value)) {
        throw new UnprocessableEntityError('price_indices.value_invalid', { period: entry.period, value: String(entry.value) });
      }
      if (seen.has(entry.period)) {
        throw new UnprocessableEntityError('price_indices.period_repeated', { period: entry.period });
      }
      seen.add(entry.period);
      if (entry.publishedOn && !/^\d{4}-\d{2}-\d{2}$/.test(entry.publishedOn)) {
        throw new UnprocessableEntityError('price_indices.published_on_invalid', { period: entry.period });
      }
    }
  }

  private async record(
    target: { table: 'price_index_values' | 'tenant_price_index_values'; organizationId: string | null },
    seriesCode: string,
    entries: readonly PriceIndexEntry[],
    userId: string | null,
    manager?: EntityManager,
  ): Promise<{ recorded: number; unchanged: number }> {
    this.validateEntries(seriesCode, entries);
    const execute = async (em: EntityManager) => {
      // One writer per series and scope at a time: the next revision is read and written in the
      // same transaction, and the unique index would refuse the slower of two concurrent loads.
      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `price-index:${target.organizationId ?? 'platform'}:${seriesCode}`,
      ]);
      const scope = target.organizationId ? `AND "organization_id" = $3` : '';
      const params = (period: string) =>
        target.organizationId ? [seriesCode, monthStart(period), target.organizationId] : [seriesCode, monthStart(period)];

      let recorded = 0;
      let unchanged = 0;
      for (const entry of entries) {
        const [latest]: Array<{ value: string; revision: number; reference: string | null; published_on: string | null }> =
          await em.query(
            `SELECT "value"::text AS "value", "revision", "reference", to_char("published_on", 'YYYY-MM-DD') AS "published_on"
               FROM "${target.table}"
              WHERE "series_code" = $1 AND "period" = $2::date ${scope}
              ORDER BY "revision" DESC LIMIT 1`,
            params(entry.period),
          );
        const reference = entry.reference?.trim() || null;
        const publishedOn = entry.publishedOn || null;
        // A revision is a change of figure, or of what was said about it. Metadata left out says
        // nothing: re-importing the bare figures must not record a revision that erases the source.
        if (
          latest &&
          trimLevel(latest.value) === trimLevel(entry.value) &&
          (reference === null || (latest.reference ?? null) === reference) &&
          (publishedOn === null || (latest.published_on ?? null) === publishedOn)
        ) {
          unchanged++;
          continue;
        }
        const revision = (latest ? Number(latest.revision) : 0) + 1;
        if (target.organizationId) {
          await em.query(
            `INSERT INTO "tenant_price_index_values"
               ("organization_id", "series_code", "period", "value", "revision", "published_on", "reference", "recorded_by_user_id")
             VALUES ($1, $2, $3::date, $4::numeric, $5, $6::date, $7, $8)`,
            [target.organizationId, seriesCode, monthStart(entry.period), entry.value, revision, publishedOn, reference, userId],
          );
        } else {
          await em.query(
            `INSERT INTO "price_index_values"
               ("series_code", "period", "value", "revision", "published_on", "reference", "recorded_by_user_id")
             VALUES ($1, $2::date, $3::numeric, $4, $5::date, $6, $7)`,
            [seriesCode, monthStart(entry.period), entry.value, revision, publishedOn, reference, userId],
          );
        }
        recorded++;
      }
      return { recorded, unchanged };
    };
    return manager ? execute(manager) : this.dataSource.transaction(execute);
  }
}

function assertMonth(period: string): void {
  if (typeof period !== 'string' || !ISO_MONTH_PATTERN.test(period)) {
    throw new UnprocessableEntityError('price_indices.period_invalid', { period: String(period) });
  }
}
