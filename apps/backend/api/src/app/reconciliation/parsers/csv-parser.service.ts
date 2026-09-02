import { Injectable } from '@nestjs/common';
import * as Papa from 'papaparse';
import { parse as parseDate, isValid } from 'date-fns';
import { roundAmount } from '../../common/money';

export interface ParsedBankTransaction {
  /** `YYYY-MM-DD`. */
  date: string;
  description: string;
  reference: string | null;
  /** Money into the account. */
  debit: number;
  /** Money out of the account. */
  credit: number;
  /** 1-based line in the file, so an error can name a row. */
  sourceRow: number;
}

export interface ColumnMapping {
  date: string;
  description: string;
  reference?: string;
  debit?: string;
  credit?: string;
  amount?: string;
}

export interface ParseOptions extends ColumnMapping {
  /**
   * How the bank writes a date, in `date-fns` tokens — `dd/MM/yyyy`, `MM/dd/yyyy`, `yyyy-MM-dd`.
   *
   * There is no safe default here and the old parser handed the string to `new Date()`, which
   * reads `03/04/2026` as 4 March in the United States and 3 April almost everywhere else. On a
   * product sold across Latin America and the United States that silently shifts transactions by
   * up to eleven months, and a reconciliation that is off by a date range balances to nothing.
   */
  dateFormat: string;
  /** `,` for `1.234,56`, `.` for `1,234.56`. */
  decimalSeparator: '.' | ',';
  /**
   * Whether a positive figure in the single `amount` column means money in.
   *
   * Banks disagree, and the ones that state the movement from their own side write a deposit as
   * negative.
   */
  positiveAmountIsMoneyIn: boolean;
}

/** A row the file described but that cannot be turned into a transaction. */
export class CsvParseError extends Error {
  constructor(
    readonly reason: 'MISSING_COLUMNS' | 'INVALID_DATE' | 'INVALID_AMOUNT' | 'NO_ROWS' | 'MALFORMED',
    readonly detail: Record<string, unknown>,
  ) {
    super(`${reason}: ${JSON.stringify(detail)}`);
    this.name = 'CsvParseError';
  }
}

/**
 * Reads a bank's CSV export into transactions.
 *
 * ## What changed
 *
 * The previous parser guessed. `new Date(row[dateColumn])` for the date, `parseFloat` for the
 * amounts, `|| '0'` for anything unparseable, and `isNaN(x) ? 0 : x` to finish. A row whose date
 * the engine could not read became `Invalid Date` and reached the database; a row whose amount was
 * written `1.234,56` — the ordinary format in most of the region — became `1.23`; a mistyped column
 * name silently produced a statement of zero-value transactions rather than an error.
 *
 * Every one of those now fails the import, naming the row.
 */
@Injectable()
export class CsvParserService {
  async parse(fileBuffer: Buffer, options: ParseOptions): Promise<ParsedBankTransaction[]> {
    const content = fileBuffer.toString('utf-8').replace(/^﻿/, '');

    const results = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      transformHeader: (header) => header.trim(),
    });

    // Papaparse reports a delimiter it could not settle on, an unterminated quote, or a row whose
    // field count does not match the header. Any of those means the file is not what it claims.
    const fatal = results.errors.filter((error) => error.type !== 'FieldMismatch');
    if (fatal.length > 0) {
      throw new CsvParseError('MALFORMED', {
        errors: fatal.slice(0, 5).map((error) => ({ row: error.row, message: error.message })),
      });
    }

    const headers = results.meta.fields ?? [];
    const required = [options.date, options.description].filter(Boolean);
    const optional = [options.reference, options.debit, options.credit, options.amount].filter(
      (column): column is string => Boolean(column),
    );
    const missing = [...required, ...optional].filter((column) => !headers.includes(column));
    if (missing.length > 0) {
      throw new CsvParseError('MISSING_COLUMNS', { missing, headers });
    }
    if (!options.amount && !options.debit && !options.credit) {
      throw new CsvParseError('MISSING_COLUMNS', { missing: ['amount|debit|credit'], headers });
    }

    const rows = results.data;
    if (rows.length === 0) throw new CsvParseError('NO_ROWS', {});

    return rows.map((row, index) => {
      // +2: one for the header line, one because files are 1-based to the person reading them.
      const sourceRow = index + 2;

      const rawDate = (row[options.date] ?? '').trim();
      const date = parseDate(rawDate, options.dateFormat, new Date());
      if (!rawDate || !isValid(date)) {
        throw new CsvParseError('INVALID_DATE', {
          row: sourceRow,
          value: rawDate,
          format: options.dateFormat,
        });
      }

      let debit = 0;
      let credit = 0;

      if (options.amount) {
        const amount = this.toNumber(row[options.amount], sourceRow, options.decimalSeparator);
        const moneyIn = options.positiveAmountIsMoneyIn ? amount > 0 : amount < 0;
        if (moneyIn) debit = Math.abs(amount);
        else credit = Math.abs(amount);
      } else {
        debit = options.debit
          ? Math.abs(this.toNumber(row[options.debit], sourceRow, options.decimalSeparator))
          : 0;
        credit = options.credit
          ? Math.abs(this.toNumber(row[options.credit], sourceRow, options.decimalSeparator))
          : 0;
      }

      if (debit !== 0 && credit !== 0) {
        throw new CsvParseError('INVALID_AMOUNT', {
          row: sourceRow,
          reason: 'BOTH_SIDES',
          debit,
          credit,
        });
      }
      if (debit === 0 && credit === 0) {
        throw new CsvParseError('INVALID_AMOUNT', { row: sourceRow, reason: 'ZERO' });
      }

      const reference = options.reference ? (row[options.reference] ?? '').trim() : '';

      return {
        date: this.toIsoDate(date),
        description: (row[options.description] ?? '').trim().slice(0, 500),
        reference: reference ? reference.slice(0, 120) : null,
        debit: roundAmount(debit),
        credit: roundAmount(credit),
        sourceRow,
      };
    });
  }

  /**
   * `"1.234,56"`, `"1,234.56"`, `"(500.00)"`, `"$ 1 234,56"` → a number.
   *
   * Empty is zero — a bank writes one of its debit/credit pair blank on every row — but a value
   * that is present and unreadable is an error, where it used to become zero.
   */
  private toNumber(raw: string | undefined, row: number, decimalSeparator: '.' | ','): number {
    const value = (raw ?? '').trim();
    if (value === '' || value === '-') return 0;

    const negative = /^\(.*\)$/.test(value) || value.trimStart().startsWith('-');
    let digits = value.replace(/[()]/g, '').replace(/[^\d.,-]/g, '');

    if (decimalSeparator === ',') {
      digits = digits.replace(/\./g, '').replace(',', '.');
    } else {
      digits = digits.replace(/,/g, '');
    }
    digits = digits.replace(/(?!^)-/g, '');

    const parsed = Number(digits);
    if (!Number.isFinite(parsed)) {
      throw new CsvParseError('INVALID_AMOUNT', { row, value: raw, reason: 'NOT_A_NUMBER' });
    }
    const magnitude = Math.abs(parsed);
    return negative ? -magnitude : magnitude;
  }

  private toIsoDate(date: Date): string {
    const year = date.getFullYear().toString().padStart(4, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
