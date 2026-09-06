import { Injectable } from '@nestjs/common';
import * as Papa from 'papaparse';
import * as ExcelJS from 'exceljs';
import { CsvParsingOptionsDto } from '../dto/journal-entry-import.dto';
import { FastifyFile } from '../../common/interfaces/fastify-file.interface';
import { readFile } from 'fs/promises';
import { BadRequestError } from '../../i18n/localized.exception';

export enum FileType {
    CSV = 'text/csv',
    EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/**
 * A spreadsheet or a CSV, as rows of strings.
 *
 * ## Why this no longer uses `xlsx`
 *
 * `xlsx@0.18.5` — the version the npm registry serves, and the one this repo installed — carries
 * two HIGH advisories that `npm audit` reports by name:
 *
 * - **Prototype Pollution in SheetJS** (GHSA-4r6h-8v6p-xvw6, fixed in 0.19.3)
 * - **Regular Expression Denial of Service** (GHSA-5pgg-2g8v-p4x9, fixed in 0.20.2)
 *
 * Both sit in the parsing path, and the parsing path here is an authenticated file upload:
 * `POST /journal-entries/import/preview` hands an attacker-chosen workbook straight to it. The
 * registry copy is frozen at 0.18.5 — SheetJS publishes newer releases only from its own CDN — so
 * there is no version to move to, and pinning a build to a non-npm host is not a dependency a
 * commercial product's CI should carry.
 *
 * `exceljs` is on npm, maintained, and audits clean of anything high: its only finding is a
 * transitive `uuid` advisory about a buffer it never passes.
 *
 * ## And why the headers are read from the sheet, not from the first row of data
 *
 * `XLSX.utils.sheet_to_json` omits empty cells, so `Object.keys(data[0])` lost any column whose
 * *first* row happened to be blank — and losing a header silently is how a mapping ends up
 * pointing at the wrong column. The header row is read as a row.
 */
@Injectable()
export class FileParserService {

    async parse(file: FastifyFile, options?: CsvParsingOptionsDto): Promise<{ headers: string[], data: Record<string, string>[] }> {
        // `buffer` is optional on an uploaded file: a streamed upload arrives as a path instead.
        // Reading it unconditionally passed `undefined` into the parsers, which failed later and
        // less clearly than saying so here.
        const bytes = file.buffer ?? (file.path ? await readFile(file.path) : undefined);
        if (!bytes) {
            throw new BadRequestError('JOURNAL_ENTRIES.ARCHIVO_SUBIDO_ESTA_VACIO_NO_PUDO_LEER');
        }

        if (file.mimetype === FileType.CSV) {
            return this.parseCsv(bytes, options);
        } else if (file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel')) {
            return this.parseExcel(bytes);
        } else {
            throw new BadRequestError('JOURNAL_ENTRIES.TIPO_ARCHIVO_NO_SOPORTADO', { mimetype: file.mimetype });
        }
    }

    private parseCsv(buffer: Buffer, options?: CsvParsingOptionsDto): { headers: string[], data: Record<string, string>[] } {
        // The byte-order mark Excel writes ahead of a UTF-8 CSV would otherwise become part of the
        // first column's name, so no mapping could ever match it.
        const content = buffer.toString('utf-8').replace(/^﻿/, '');

        const results = Papa.parse<Record<string, string>>(content, {
            header: true,
            skipEmptyLines: 'greedy',
            dynamicTyping: false,
            delimiter: options?.delimiter || ',',
            quoteChar: options?.quoteChar || '"',
            transformHeader: (header) => header.trim(),
        });

        // A row with FEWER fields than the header is a ragged trailing line — tolerable, and the
        // missing columns simply read as empty. A row with MORE is not: it means the delimiter cut
        // through something, and the commonest way that happens is a file written with comma
        // decimals AND comma delimiters, where `58.750,00` becomes the field `58.750` and a stray
        // `00`. Tolerating it imported an amount a thousand times too small, in silence.
        const fatal = results.errors.filter(
          (error) => error.type !== 'FieldMismatch' || error.code === 'TooManyFields',
        );
        if (fatal.length > 0) {
            throw new BadRequestError('JOURNAL_ENTRIES.ARCHIVO_CSV_MAL_FORMADO', {
                detail: fatal.slice(0, 3).map((error) => error.message).join('; '),
            });
        }

        return { headers: results.meta.fields ?? [], data: results.data };
    }

    private async parseExcel(buffer: Buffer): Promise<{ headers: string[], data: Record<string, string>[] }> {
        const workbook = new ExcelJS.Workbook();
        try {
            await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        } catch (error) {
            throw new BadRequestError('JOURNAL_ENTRIES.ARCHIVO_EXCEL_MAL_FORMADO', {
                detail: (error as Error).message,
            });
        }

        const worksheet = workbook.worksheets[0];
        if (!worksheet) throw new BadRequestError('JOURNAL_ENTRIES.ARCHIVO_NO_CONTIENE_DATOS');

        const headerRow = worksheet.getRow(1);
        const headers: string[] = [];
        // `eachCell` skips empty cells by default, which is exactly how a header disappeared;
        // `includeEmpty` keeps the column positions aligned with the rows below.
        headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
            headers[columnNumber - 1] = cellText(cell).trim();
        });

        const data: Record<string, string>[] = [];
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return;

            const record: Record<string, string> = {};
            let hasValue = false;
            for (const [index, header] of headers.entries()) {
                if (!header) continue;
                const text = cellText(row.getCell(index + 1));
                record[header] = text;
                if (text !== '') hasValue = true;
            }
            if (hasValue) data.push(record);
        });

        return { headers: headers.filter(Boolean), data };
    }
}

/**
 * A cell as the text the file shows.
 *
 * Everything downstream reads strings and decides for itself how to read them: the amounts go
 * through `parseDecimal` with the convention the caller declared, and the dates through `date-fns`
 * with the format it declared. Handing on Excel's own guesses — a `Date` for anything that looks
 * like one, a `number` for anything numeric — would put a second, invisible interpretation ahead
 * of both.
 */
function cellText(cell: ExcelJS.Cell): string {
    const value = cell?.value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    // A date cell: rendered as `YYYY-MM-DD` in UTC, which is the calendar day the file stores.
    // Excel has no zone, so reading it in the server's would shift it by a day either side of the
    // boundary.
    if (value instanceof Date) return value.toISOString().slice(0, 10);

    const rich = value as {
        text?: string;
        result?: unknown;
        richText?: { text: string }[];
        hyperlink?: string;
        error?: string;
    };
    if (Array.isArray(rich.richText)) return rich.richText.map((run) => run.text).join('');
    // A formula cell carries its computed result; the formula itself is not what the row means.
    if (rich.result !== undefined && rich.result !== null) return String(rich.result);
    if (typeof rich.text === 'string') return rich.text;
    if (typeof rich.error === 'string') return '';

    return '';
}
