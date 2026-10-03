import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hasPermission } from '@virteex/shared/util-auth';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as ExcelJS from 'exceljs';
import * as Papa from 'papaparse';
import { Repository } from 'typeorm';
import {
  DataTransferColumn,
  DataTransferContext,
  DataTransferDataset,
} from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { BadRequestError, ForbiddenError, NotFoundError, isLocalizedError } from '../i18n/localized.exception';
import { I18nService } from '../i18n/i18n.service';
import { describeValidationError, flatten } from '../i18n/validation-messages';
import { AuthenticatedUser } from '../security/principal';
import {
  DataTransferKind,
  DataTransferProblem,
  DataTransferRun,
  DataTransferStatus,
} from './entities/data-transfer-run.entity';

export type DataTransferFormat = 'csv' | 'xlsx';

export interface DataTransferFile {
  fileName: string;
  contentType: string;
  body: Buffer;
}

export interface ImportReport {
  runId: string;
  status: DataTransferStatus;
  totalRows: number;
  importedRows: number;
  failedRows: number;
  problems: DataTransferProblem[];
}

/** Larger than any honest master-data file; smaller than what would hold a request for minutes. */
export const MAX_IMPORT_ROWS = 5_000;
/** An export this large is a report, not a file to open; it is refused rather than truncated. */
export const MAX_EXPORT_ROWS = 100_000;
const EXPORT_PAGE = 1_000;
/** Problems kept on the run and returned: enough to correct a file, never a copy of it. */
const MAX_PROBLEMS = 200;

const CONTENT_TYPES: Record<DataTransferFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Export and import of the datasets the domains register (QA A-10).
 *
 * ## Import is all-or-nothing, and checked first
 *
 * Every row is held to the domain's own DTO and rules before anything is written. If any row
 * fails, nothing is imported and the report names every problem by line and column — so fixing
 * the file and uploading it again never duplicates the rows that were fine the first time. That is
 * how the import tools of the major ERPs behave, and `mode=validate` runs exactly the same checks
 * without writing, so a file can be proved before it is committed.
 *
 * ## Export is defused
 *
 * A cell beginning with `=`, `+`, `-`, `@`, tab or CR is a formula to a spreadsheet: a customer
 * named `=HYPERLINK(...)` would run when an accountant opens the export (CSV injection, OWASP).
 * Such cells are written with a leading apostrophe, which spreadsheets show as text.
 */
@Injectable()
export class DataTransferService {
  private readonly logger = new Logger(DataTransferService.name);

  constructor(
    private readonly registry: DataTransferRegistry,
    @InjectRepository(DataTransferRun)
    private readonly runs: Repository<DataTransferRun>,
    private readonly i18n: I18nService,
  ) {}

  /** The datasets this caller may export, and whether they may import each one. */
  datasets(user: AuthenticatedUser) {
    return this.registry
      .all()
      .filter((dataset) => this.holds(user, dataset.viewPermission))
      .map((dataset) => ({
        id: dataset.id,
        labelKey: dataset.labelKey,
        importable: !!dataset.import && this.holds(user, dataset.import.createPermission),
        columns: dataset.columns.map(({ key, required }) => ({ key, required: !!required })),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** The tenant's recent runs, only of datasets this caller may see. */
  async recentRuns(user: AuthenticatedUser, kind?: DataTransferKind): Promise<DataTransferRun[]> {
    const visible = new Set(this.datasets(user).map((dataset) => dataset.id));
    const runs = await this.runs.find({
      where: { organizationId: user.organizationId, ...(kind ? { kind } : {}) },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return runs.filter((run) => visible.has(run.dataset));
  }

  async export(user: AuthenticatedUser, datasetId: string, format: DataTransferFormat): Promise<DataTransferFile> {
    const dataset = this.require(datasetId);
    if (!this.holds(user, dataset.viewPermission)) {
      throw new ForbiddenError('data_transfer.not_allowed_to_export');
    }

    const rows: Array<Record<string, unknown>> = [];
    for (let skip = 0; ; skip += EXPORT_PAGE) {
      const page = await dataset.exportPage(user.organizationId, EXPORT_PAGE, skip);
      if (page.total > MAX_EXPORT_ROWS) {
        throw new BadRequestError('data_transfer.export_too_large', { total: page.total, max: MAX_EXPORT_ROWS });
      }
      rows.push(...page.rows);
      if (page.rows.length < EXPORT_PAGE || rows.length >= page.total) break;
    }

    const fileName = `${dataset.id}_${new Date().toISOString().slice(0, 10)}.${format}`;
    const body =
      format === 'xlsx' ? await this.toXlsx(dataset.columns, rows) : this.toCsv(dataset.columns, rows);

    await this.record(user, {
      kind: DataTransferKind.EXPORT,
      dataset: dataset.id,
      format,
      fileName,
      status: DataTransferStatus.COMPLETED,
      totalRows: rows.length,
      importedRows: 0,
      failedRows: 0,
      problems: [],
    });

    return { fileName, contentType: CONTENT_TYPES[format], body };
  }

  /** A file with the header the import expects and one example row. */
  template(user: AuthenticatedUser, datasetId: string): DataTransferFile {
    const dataset = this.require(datasetId);
    if (!dataset.import || !this.holds(user, dataset.import.createPermission)) {
      throw new ForbiddenError('data_transfer.not_allowed_to_import');
    }
    const example = Object.fromEntries(dataset.columns.map((column) => [column.property, column.example ?? '']));
    return {
      fileName: `${dataset.id}_plantilla.csv`,
      contentType: CONTENT_TYPES.csv,
      body: this.toCsv(dataset.columns, [example]),
    };
  }

  async import(
    user: AuthenticatedUser,
    datasetId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
    mode: 'validate' | 'commit',
  ): Promise<ImportReport> {
    const dataset = this.require(datasetId);
    const importer = dataset.import;
    if (!importer || !this.holds(user, importer.createPermission)) {
      throw new ForbiddenError('data_transfer.not_allowed_to_import');
    }
    const context: DataTransferContext = { organizationId: user.organizationId, userId: user.id };
    const format: DataTransferFormat = /\.xlsx$/i.test(file.originalname) || file.mimetype.includes('spreadsheet') ? 'xlsx' : 'csv';

    const { headers, rows } = format === 'xlsx' ? await this.parseXlsx(file.buffer) : this.parseCsv(file.buffer);
    const problems: DataTransferProblem[] = [];

    // ── The file itself ─────────────────────────────────────────────────────────────────────
    const known = new Map(dataset.columns.map((column) => [column.key, column]));
    const unknown = headers.filter((header) => header && !known.has(header));
    if (unknown.length) {
      problems.push({ row: 1, key: 'data_transfer.unknown_columns', params: { columns: unknown.join(', ') } });
    }
    const missing = dataset.columns.filter((column) => column.required && !headers.includes(column.key));
    if (missing.length) {
      problems.push({
        row: 1,
        key: 'data_transfer.missing_columns',
        params: { columns: missing.map((column) => column.key).join(', ') },
      });
    }
    if (rows.length === 0) problems.push({ row: 0, key: 'data_transfer.file_has_no_rows', params: {} });
    if (rows.length > MAX_IMPORT_ROWS) {
      problems.push({ row: 0, key: 'data_transfer.too_many_rows', params: { max: MAX_IMPORT_ROWS, count: rows.length } });
    }

    // ── Every row, against the domain's own rules ───────────────────────────────────────────
    const dtos: object[] = [];
    if (problems.length === 0) {
      const seen = new Map<string, number>();
      for (let index = 0; index < rows.length; index++) {
        const line = index + 2;
        const plain: Record<string, unknown> = {};
        for (const column of dataset.columns) {
          const value = rows[index][column.key];
          const trimmed = typeof value === 'string' ? value.trim() : value;
          if (trimmed !== '' && trimmed !== undefined && trimmed !== null) plain[column.property] = trimmed;
        }

        const dto = plainToInstance(importer.dto, plain, { enableImplicitConversion: true });
        const errors = await validate(dto as object, { whitelist: true, forbidNonWhitelisted: true });
        const rowProblems: DataTransferProblem[] = flatten(errors).flatMap((error) =>
          describeValidationError(this.i18n, error).map((fieldError) => ({
            row: line,
            column: this.columnOf(dataset.columns, fieldError.property),
            key: fieldError.key,
            params: fieldError.params,
          })),
        );

        if (importer.uniqueBy) {
          const uniqueColumn = known.get(importer.uniqueBy);
          const value = uniqueColumn ? String(plain[uniqueColumn.property] ?? '').trim() : '';
          if (value) {
            const normalized = value.toUpperCase();
            const first = seen.get(normalized);
            if (first !== undefined) {
              rowProblems.push({
                row: line,
                column: importer.uniqueBy,
                key: 'data_transfer.duplicate_in_file',
                params: { value, first },
              });
            } else {
              seen.set(normalized, line);
              if (importer.exists && (await importer.exists(value, context))) {
                rowProblems.push({
                  row: line,
                  column: importer.uniqueBy,
                  key: 'data_transfer.already_exists',
                  params: { value },
                });
              }
            }
          }
        }

        const check = importer.check;
        if (rowProblems.length === 0 && check) {
          const refusal = await this.refusalOf(() => check(dto, context));
          if (refusal) rowProblems.push({ row: line, ...refusal });
        }

        problems.push(...rowProblems);
        dtos.push(dto);
      }
    }

    const failedRows = new Set(problems.filter((p) => p.row > 1).map((p) => p.row)).size;
    if (problems.length > 0 || mode === 'validate') {
      return this.finish(user, dataset.id, format, file.originalname, {
        status: problems.length > 0 ? DataTransferStatus.FAILED : DataTransferStatus.VALIDATED,
        totalRows: rows.length,
        importedRows: 0,
        failedRows,
        problems,
      });
    }

    // ── Commit, in order; a refusal now is a race with another writer ───────────────────────
    let imported = 0;
    for (let index = 0; index < dtos.length; index++) {
      const refusal = await this.refusalOf(() => importer.create(dtos[index], context));
      if (refusal) {
        this.logger.warn(`Importación de ${dataset.id} detenida en la línea ${index + 2}: ${refusal.key}`);
        return this.finish(user, dataset.id, format, file.originalname, {
          status: imported > 0 ? DataTransferStatus.PARTIAL : DataTransferStatus.FAILED,
          totalRows: rows.length,
          importedRows: imported,
          failedRows: 1,
          problems: [{ row: index + 2, ...refusal }],
        });
      }
      imported++;
    }

    return this.finish(user, dataset.id, format, file.originalname, {
      status: DataTransferStatus.COMPLETED,
      totalRows: rows.length,
      importedRows: imported,
      failedRows: 0,
      problems: [],
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────────────────

  private require(id: string): DataTransferDataset {
    const dataset = this.registry.get(id);
    if (!dataset) throw new NotFoundError('data_transfer.unknown_dataset', { dataset: id });
    return dataset;
  }

  private holds(user: AuthenticatedUser, permission: string): boolean {
    return hasPermission(user.permissions ?? [], [permission]);
  }

  private columnOf(columns: readonly DataTransferColumn[], property: string): string | undefined {
    const root = property.split('.')[0];
    return columns.find((column) => column.property === root)?.key ?? property;
  }

  /** A domain refusal as a problem; anything else is a defect and is rethrown. */
  private async refusalOf(action: () => Promise<unknown>): Promise<Omit<DataTransferProblem, 'row'> | null> {
    try {
      await action();
      return null;
    } catch (error) {
      if (isLocalizedError(error)) {
        return { key: error.messageKey, params: error.params ?? {} };
      }
      throw error;
    }
  }

  private async finish(
    user: AuthenticatedUser,
    dataset: string,
    format: DataTransferFormat,
    fileName: string,
    outcome: Omit<ImportReport, 'runId'>,
  ): Promise<ImportReport> {
    const run = await this.record(user, {
      kind: DataTransferKind.IMPORT,
      dataset,
      format,
      fileName: fileName.slice(0, 255),
      ...outcome,
      problems: outcome.problems.slice(0, MAX_PROBLEMS),
    });
    return { runId: run.id, ...outcome, problems: outcome.problems.slice(0, MAX_PROBLEMS) };
  }

  private record(user: AuthenticatedUser, run: Partial<DataTransferRun>): Promise<DataTransferRun> {
    return this.runs.save(
      this.runs.create({
        ...run,
        organizationId: user.organizationId,
        userId: user.id,
        userName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || null,
      }),
    );
  }

  private parseCsv(buffer: Buffer): { headers: string[]; rows: Array<Record<string, string>> } {
    // Excel's UTF-8 byte-order mark would otherwise become part of the first header.
    const content = buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
    // Spanish-locale spreadsheets save CSV with semicolons; detected from the header, not guessed
    // per row.
    const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
    const parsed = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      delimiter,
      transformHeader: (header) => header.trim().toLowerCase(),
    });
    // More fields than the header means the delimiter cut through a value: refuse rather than
    // shift every column after it (see the journal-entry parser for the case that taught this).
    const fatal = parsed.errors.filter((error) => error.type !== 'FieldMismatch' || error.code === 'TooManyFields');
    if (fatal.length) {
      throw new BadRequestError('data_transfer.file_unreadable', {
        detail: fatal.slice(0, 3).map((error) => `${error.message} (${(error.row ?? 0) + 2})`).join('; '),
      });
    }
    return { headers: parsed.meta.fields ?? [], rows: parsed.data };
  }

  private async parseXlsx(buffer: Buffer): Promise<{ headers: string[]; rows: Array<Record<string, string>> }> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch (error) {
      throw new BadRequestError('data_transfer.file_unreadable', { detail: (error as Error).message });
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) return { headers: [], rows: [] };

    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
      headers[column - 1] = cellText(cell).trim().toLowerCase();
    });
    const rows: Array<Record<string, string>> = [];
    sheet.eachRow({ includeEmpty: false }, (row, number) => {
      if (number === 1) return;
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        if (header) record[header] = cellText(row.getCell(index + 1));
      });
      if (Object.values(record).some((value) => value.trim() !== '')) rows.push(record);
    });
    return { headers: headers.filter(Boolean), rows };
  }

  private toCsv(columns: readonly DataTransferColumn[], rows: ReadonlyArray<Record<string, unknown>>): Buffer {
    const escape = (value: unknown): string => {
      const text = defuse(formatCell(value));
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [
      columns.map((column) => column.key).join(','),
      ...rows.map((row) => columns.map((column) => escape(row[column.property])).join(',')),
    ];
    // BOM so Excel reads UTF-8 accents correctly; CRLF per RFC 4180.
    return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf-8');
  }

  private async toXlsx(
    columns: readonly DataTransferColumn[],
    rows: ReadonlyArray<Record<string, unknown>>,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Datos');
    sheet.columns = columns.map((column) => ({ header: column.key, key: column.property, width: 22 }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of rows) {
      sheet.addRow(
        Object.fromEntries(
          columns.map((column) => {
            const value = row[column.property];
            // Numbers and dates stay typed so they sum and sort; text is defused.
            if (typeof value === 'number' || value instanceof Date) return [column.property, value];
            return [column.property, defuse(formatCell(value))];
          }),
        ),
      );
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    // A localized name (`{ es, en }`) exports in the first language it has.
    const values = Object.values(value as Record<string, unknown>).filter((v) => typeof v === 'string');
    return values.length ? String(values[0]) : JSON.stringify(value);
  }
  return String(value);
}

/**
 * CSV/formula injection: a leading formula character is neutralised with an apostrophe. A plain
 * number (`-500`, `-12.75`) is data, not a formula, and is left as it is.
 */
function defuse(text: string): string {
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value && value.result !== undefined) return String(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
  }
  return String(value);
}
