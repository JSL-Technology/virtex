import { Injectable, OnModuleInit } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { ISO_MONTH_PATTERN } from '@virtex/shared/types';
import {
  DataTransferContext,
  DataTransferDataset,
  DataTransferFileProblem,
} from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { PERMISSIONS } from '../shared/permissions';
import { inflationAccountingOf } from '../markets';
import { addMonthsIso, todayIso, toIsoMonth } from '../common/dates';
import { PriceIndicesService, trimLevel } from './price-indices.service';
import { IsIsoDate } from '../common/validators/is-iso-date.validator';

/** A date cell (`2026-03-01`) is the month it falls in; a month (`2026-03`) is itself. */
function monthOfCell({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const raw = obj[key];
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.slice(0, 7) : text;
}

/** A level as the file holds it: a number cell arrives as its text, a decimal comma as a point. */
function levelOfCell({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const raw = obj[key];
  if (typeof raw === 'number') return String(raw);
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  // `7694,0072` — a decimal comma, with no thousands separator to confuse it with.
  return /^\d+,\d+$/.test(text) ? text.replace(',', '.') : text;
}

/** One month of one series, as a row of the file. */
export class PriceIndexImportRowDto {
  @IsString()
  @Matches(/^[A-Z]{2}-[A-Z0-9-]{1,37}$/, { message: 'validation.price_indices.series_format' })
  seriesCode: string;

  @Transform(monthOfCell)
  @Matches(ISO_MONTH_PATTERN, { message: 'validation.price_indices.period_format' })
  period: string;

  @Transform(levelOfCell)
  @IsString({ message: 'validation.price_indices.value_format' })
  @Matches(/^(?:0|[1-9]\d{0,19})(?:\.\d{1,10})?$/, { message: 'validation.price_indices.value_format' })
  value: string;

  @IsOptional()
  @IsIsoDate()
  publishedOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reference?: string;
}

/**
 * The months of a price index a company recorded for itself, exported and imported (FIN-AC-04).
 *
 * The publisher's table is pasted into a spreadsheet and loaded in one go, rather than typed a month
 * at a time: each month becomes a new revision only where its figure changed, so re-importing the
 * same file records nothing. The export is what the company recorded — the file it can correct and
 * import again — not the published figures, which are the platform's.
 */
@Injectable()
export class PriceIndexValuesDataTransferProvider implements DataTransferDataset<PriceIndexImportRowDto>, OnModuleInit {
  readonly id = 'price-index-values';
  readonly labelKey = 'data_transfer.datasets.price_index_values';
  readonly hintKey = 'data_transfer.hints.price_index_values';
  readonly viewPermission = PERMISSIONS.ACCOUNTING_VIEW;

  readonly columns = [
    { key: 'serie', property: 'seriesCode', required: true, example: 'AR-FACPCE' },
    { key: 'periodo', property: 'period', required: true, example: '2026-01' },
    { key: 'valor', property: 'value', required: true, example: '100.0000' },
    { key: 'publicado', property: 'publishedOn', example: '2026-02-12' },
    { key: 'fuente', property: 'reference', example: '' },
  ] as const;

  readonly import = {
    createPermission: PERMISSIONS.ACCOUNTING_MANAGE_PRICE_INDICES,
    dto: PriceIndexImportRowDto,
    check: async (row: PriceIndexImportRowDto) => this.indices.validateEntries(row.seriesCode, [row]),
    checkFile: async (rows: readonly PriceIndexImportRowDto[]) => this.checkFile(rows),
    createAll: (rows: readonly PriceIndexImportRowDto[], context: DataTransferContext) => this.importAll(rows, context),
    templateExample: (context: DataTransferContext) => this.example(context),
  };

  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly dataSource: DataSource,
    private readonly indices: PriceIndicesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this as DataTransferDataset);
  }

  async exportPage(organizationId: string, take: number, skip: number): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
    const latest = `
      SELECT DISTINCT ON ("series_code", "period") "series_code", "period", "value", "published_on", "reference"
        FROM "tenant_price_index_values"
       WHERE "organization_id" = $1
       ORDER BY "series_code", "period", "revision" DESC`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total FROM (${latest}) months`, [organizationId]);
    const rows: Array<{ series_code: string; period: string; value: string; published_on: string | null; reference: string | null }> =
      await this.dataSource.query(
        `SELECT "series_code", to_char("period", 'YYYY-MM') AS "period", "value"::text AS "value",
                to_char("published_on", 'YYYY-MM-DD') AS "published_on", "reference"
           FROM (${latest}) months
          ORDER BY "series_code", "period"
          LIMIT $2 OFFSET $3`,
        [organizationId, take, skip],
      );
    return {
      rows: rows.map((row) => ({
        seriesCode: row.series_code,
        period: row.period,
        value: trimLevel(row.value),
        publishedOn: row.published_on,
        reference: row.reference,
      })),
      total: Number(total),
    };
  }

  /** The same month twice in one file would make «the value of March» depend on row order. */
  private checkFile(rows: readonly PriceIndexImportRowDto[]): DataTransferFileProblem[] {
    const problems: DataTransferFileProblem[] = [];
    const first = new Map<string, number>();
    rows.forEach((row, index) => {
      const key = `${row.seriesCode}|${row.period}`;
      const earlier = first.get(key);
      if (earlier === undefined) {
        first.set(key, index);
        return;
      }
      problems.push({
        index,
        column: 'periodo',
        key: 'price_indices.period_repeated_in_file',
        params: { series: row.seriesCode, period: row.period, line: earlier + 2 },
      });
    });
    return problems;
  }

  /** Every series of the file, in one transaction: half a table is not a smaller table. */
  private async importAll(rows: readonly PriceIndexImportRowDto[], context: DataTransferContext): Promise<void> {
    const bySeries = new Map<string, PriceIndexImportRowDto[]>();
    for (const row of rows) bySeries.set(row.seriesCode, [...(bySeries.get(row.seriesCode) ?? []), row]);
    await this.dataSource.transaction(async (manager) => {
      for (const [series, entries] of bySeries) {
        await this.indices.recordForCompany(context.organizationId, series, entries, context.userId, manager);
      }
    });
  }

  /** The company's own series and last month, so the sample row is one it could keep. */
  private async example(context: DataTransferContext): Promise<Record<string, string>> {
    const [organization]: Array<{ country: string | null }> = await this.dataSource.query(
      `SELECT "country" FROM "organizations" WHERE "id" = $1`,
      [context.organizationId],
    );
    const series = inflationAccountingOf(organization?.country)?.series.code ?? this.indices.catalogue()[0]?.code ?? '';
    return { seriesCode: series, period: toIsoMonth(addMonthsIso(todayIso(), -1)) };
  }
}
