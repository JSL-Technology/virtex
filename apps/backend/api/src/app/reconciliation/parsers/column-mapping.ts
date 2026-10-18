import * as Papa from 'papaparse';
import { parse as parseDate, isValid } from 'date-fns';
import { parseDecimal } from '../../common/parse-decimal';

/**
 * Which column of a bank's CSV is which — proposed, for the person to confirm before importing.
 *
 * Deterministic first: header names in Spanish, English and Portuguese, then the sample values to
 * settle what the names leave open (which date format the dates actually parse with, which decimal
 * separator the amounts use, whether a single amount column writes deposits as positive). A
 * language model is asked only when the headers say nothing usable, and its answer is held to the
 * same checks (see ReconciliationColumnMappingService).
 *
 * The statement's point of view: a bank writes the money it CREDITED to the account — a deposit —
 * in its "Crédito" column. So "crédito / depósito / abono" is money in, "débito / retiro / cargo"
 * money out, whatever the words mean in the books.
 */
export interface ProposedMapping {
  date: string | null;
  description: string | null;
  reference: string | null;
  /** Money into the account (the importer's `debitColumn`). */
  moneyIn: string | null;
  /** Money out of the account (the importer's `creditColumn`). */
  moneyOut: string | null;
  /** A single signed amount column, when there is no in/out pair. */
  amount: string | null;
  dateFormat: string | null;
  decimalSeparator: '.' | ',';
  positiveAmountIsMoneyIn: boolean;
}

export interface CsvSample {
  headers: string[];
  rows: Array<Record<string, string>>;
}

const SYNONYMS: Record<'date' | 'description' | 'reference' | 'moneyIn' | 'moneyOut' | 'amount', RegExp> = {
  date: /^(fecha|date|data|f\.? ?valor|fecha (valor|operaci[oó]n|transacci[oó]n|contable)|posted|booking date|value date|dt)\b/,
  description: /(descripci[oó]n|description|concepto|detalle|detail|memo|narrativa|narrative|glosa|movimiento|transacci[oó]n|descri[cç][aã]o|hist[oó]rico)/,
  reference: /(referencia|reference|\bref\b|no\.? ?(de )?documento|documento|cheque|check|n[uú]mero|comprobante|serial)/,
  moneyIn: /(cr[eé]dito|credit|dep[oó]sito|deposit|abono|entrada|ingreso|haber|entradas)/,
  moneyOut: /(d[eé]bito|debit|retiro|withdrawal|cargo|salida|egreso|debe|sa[ií]das?)/,
  amount: /^(monto|importe|amount|valor|value|cantidad)\b/,
};

/** Formats tried on the sample, most common in the region first. */
const DATE_FORMATS = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy', 'dd.MM.yyyy', 'd/M/yyyy', 'dd/MM/yy', 'yyyyMMdd', 'dd-MMM-yyyy'];

export function readSample(bytes: Buffer, rows = 8): CsvSample {
  const content = bytes.toString('utf-8').replace(/^\uFEFF/, '');
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    preview: rows,
    transformHeader: (header) => header.trim(),
  });
  return { headers: (parsed.meta.fields ?? []).filter(Boolean), rows: parsed.data };
}

const norm = (header: string) =>
  header.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** The header that names `field`, if exactly one does (or the best of several). */
function byName(headers: string[], field: keyof typeof SYNONYMS, taken: Set<string>): string | null {
  const pattern = SYNONYMS[field];
  const hits = headers.filter((header) => !taken.has(header) && pattern.test(norm(header)));
  return hits[0] ?? null;
}

/** The date format every sampled date parses with; ambiguous day/month resolved by a day > 12. */
export function inferDateFormat(values: string[]): string | null {
  const sample = values.map((value) => value.trim()).filter(Boolean);
  if (!sample.length) return null;
  const reference = new Date(2000, 0, 1);
  const fits = DATE_FORMATS.filter((format) =>
    sample.every((value) => {
      const date = parseDate(value, format, reference);
      return isValid(date) && date.getFullYear() > 1990 && date.getFullYear() < 2100;
    }),
  );
  return fits[0] ?? null;
}

/** `1.234,56` vs `1,234.56`: the separator that comes last, and has two digits after it. */
export function inferDecimalSeparator(values: string[]): '.' | ',' {
  let comma = 0;
  let dot = 0;
  for (const raw of values) {
    const value = raw.replace(/[^\d.,-]/g, '');
    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');
    if (lastComma > lastDot && /,\d{1,2}$/.test(value)) comma++;
    else if (lastDot > lastComma && /\.\d{1,2}$/.test(value)) dot++;
  }
  return comma > dot ? ',' : '.';
}

export function proposeMapping(sample: CsvSample): ProposedMapping {
  const taken = new Set<string>();
  const take = (value: string | null) => {
    if (value) taken.add(value);
    return value;
  };
  const date = take(byName(sample.headers, 'date', taken));
  const moneyIn = take(byName(sample.headers, 'moneyIn', taken));
  const moneyOut = take(byName(sample.headers, 'moneyOut', taken));
  const amount = moneyIn || moneyOut ? null : take(byName(sample.headers, 'amount', taken));
  const description = take(byName(sample.headers, 'description', taken));
  const reference = take(byName(sample.headers, 'reference', taken));

  const values = (column: string | null) => (column ? sample.rows.map((row) => row[column] ?? '').filter((v) => v.trim()) : []);
  const amounts = [...values(moneyIn), ...values(moneyOut), ...values(amount)];
  const decimalSeparator = inferDecimalSeparator(amounts);
  return {
    date,
    description,
    reference,
    moneyIn,
    moneyOut,
    amount,
    dateFormat: inferDateFormat(values(date)),
    decimalSeparator,
    positiveAmountIsMoneyIn: true,
  };
}

/** Whether a mapping can be imported as it stands: the minimum the importer needs, and it parses. */
export function mappingProblems(mapping: ProposedMapping, sample: CsvSample): string[] {
  const problems: string[] = [];
  const has = (column: string | null) => !!column && sample.headers.includes(column);
  if (!has(mapping.date)) problems.push('date');
  if (!has(mapping.description)) problems.push('description');
  if (!has(mapping.amount) && !has(mapping.moneyIn) && !has(mapping.moneyOut)) problems.push('amount');
  if (has(mapping.date) && !mapping.dateFormat) problems.push('dateFormat');
  for (const column of [mapping.amount, mapping.moneyIn, mapping.moneyOut]) {
    if (!has(column)) continue;
    const unreadable = sample.rows
      .map((row) => (row[column as string] ?? '').trim())
      .filter((value) => value && parseDecimal(value, mapping.decimalSeparator) === null);
    if (unreadable.length) problems.push(`numbers:${column}`);
  }
  return problems;
}
