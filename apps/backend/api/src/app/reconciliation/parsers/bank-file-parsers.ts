import { roundAmount } from '../../common/money';
import { ParsedBankTransaction } from './csv-parser.service';

/**
 * The two structured formats banks export besides CSV: OFX (SGML 1.x or XML 2.x) and ISO 20022
 * camt.053. Both carry dates, signed amounts and the bank's own reference in fixed elements, so
 * unlike a CSV they need no column mapping — and they usually carry the statement's balances too.
 *
 * Read with plain element extraction, not an XML parser: OFX 1.x is SGML whose tags are often
 * never closed, and a DTD-processing parser is the classic way an uploaded file reads the server's
 * disk (XXE). Nothing here resolves entities or follows a reference.
 *
 * And every scan over the file is linear: elements are found with `indexOf`, never with a lazy
 * `[\s\S]*?` regex. A regex like that retries from every candidate start, so a crafted upload
 * (thousands of opening tags and no closing one) turns one request into minutes of CPU.
 */

export type BankFileFormat = 'csv' | 'ofx' | 'camt053';

export interface ParsedBankFile {
  format: BankFileFormat;
  transactions: ParsedBankTransaction[];
  startingBalance: number | null;
  endingBalance: number | null;
  startDate: string | null;
  endDate: string | null;
  currency: string | null;
}

export class BankFileParseError extends Error {
  constructor(readonly reason: 'NO_ROWS' | 'INVALID_DATE' | 'INVALID_AMOUNT' | 'MALFORMED', readonly detail: Record<string, unknown> = {}) {
    super(`${reason}: ${JSON.stringify(detail)}`);
    this.name = 'BankFileParseError';
  }
}

export function detectFormat(bytes: Buffer): BankFileFormat {
  const head = bytes.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '');
  if (/OFXHEADER\s*:|<OFX>|<\?OFX\b/i.test(head)) return 'ofx';
  if (/camt\.053|<(\w+:)?BkToCstmrStmt\b/.test(head) || /<(\w+:)?BkToCstmrStmt\b/.test(bytes.toString('utf8'))) return 'camt053';
  return 'csv';
}

// ── OFX ──────────────────────────────────────────────────────────────────────

/** `<TAG>value` up to the next tag or line end — works for SGML (unclosed) and XML alike. */
function ofxValue(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
  const value = match?.[1]?.trim();
  return value ? decodeEntities(value) : null;
}

/** `20261001`, `20261001120000`, `20261001120000.000[-4:AST]` → `2026-10-01`. */
function ofxDate(raw: string | null, row: number): string {
  const match = raw ? /^(\d{4})(\d{2})(\d{2})/.exec(raw) : null;
  if (!match) throw new BankFileParseError('INVALID_DATE', { row, value: raw });
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  if (Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) throw new BankFileParseError('INVALID_DATE', { row, value: raw });
  return iso;
}

function ofxAmount(raw: string | null, row: number): number {
  // OFX amounts use a dot; some banks write a comma. Thousands separators are not allowed.
  const value = Number((raw ?? '').replace(',', '.'));
  if (!raw || !Number.isFinite(value)) throw new BankFileParseError('INVALID_AMOUNT', { row, value: raw });
  return value;
}

export function parseOfx(bytes: Buffer): ParsedBankFile {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((block) => block.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const transactions = blocks.map((block, index) => {
    const row = index + 1;
    const amount = ofxAmount(ofxValue(block, 'TRNAMT'), row);
    const name = ofxValue(block, 'NAME');
    const memo = ofxValue(block, 'MEMO');
    const description = [name, memo && memo !== name ? memo : null].filter(Boolean).join(' — ') || ofxValue(block, 'TRNTYPE') || '';
    return {
      date: ofxDate(ofxValue(block, 'DTPOSTED'), row),
      description: description.slice(0, 500),
      reference: ofxValue(block, 'CHECKNUM') ?? ofxValue(block, 'REFNUM') ?? ofxValue(block, 'FITID'),
      debit: amount > 0 ? roundAmount(amount) : 0,
      credit: amount < 0 ? roundAmount(-amount) : 0,
      sourceRow: row,
    } satisfies ParsedBankTransaction;
  });
  if (!transactions.length) throw new BankFileParseError('NO_ROWS');

  const ledger = between(text, '<LEDGERBAL>', ['</LEDGERBAL>', '<AVAILBAL>', '</STMTRS>']);
  const ending = ledger ? Number(ofxValue(ledger, 'BALAMT')) : NaN;
  const net = transactions.reduce((sum, t) => sum + t.debit - t.credit, 0);
  const list = between(text, '<BANKTRANLIST>', ['<STMTTRN>']);
  return {
    format: 'ofx',
    transactions,
    endingBalance: Number.isFinite(ending) ? roundAmount(ending) : null,
    // OFX states the closing balance only; the opening one is what the movements started from.
    startingBalance: Number.isFinite(ending) ? roundAmount(ending - net) : null,
    startDate: ofxValue(list, 'DTSTART') ? ofxDate(ofxValue(list, 'DTSTART'), 0) : null,
    endDate: ofxValue(list, 'DTEND') ? ofxDate(ofxValue(list, 'DTEND'), 0) : null,
    currency: ofxValue(text, 'CURDEF'),
  };
}

// ── camt.053 ────────────────────────────────────────────────────────────────

/**
 * The contents of every `<tag>…</tag>` (or `<ns:tag …>…</ns:tag>`), in order. The first closing
 * tag ends an element, as a lazy match would; nesting the same tag in itself is handled where it
 * occurs (a balance's `<Dt><Dt>`). One pass: each opening tag is read once, and the search for its
 * closing tag resumes after it.
 */
function elements(xml: string, tag: string): string[] {
  const found: string[] = [];
  let at = 0;
  // The next `>` and `<` are only ever searched forward from where the last search ended, so a
  // run of unclosed tags costs one pass, not one pass per tag.
  let gt = -1;
  while (at < xml.length) {
    const open = xml.indexOf('<', at);
    if (open < 0) break;
    if (gt <= open) gt = xml.indexOf('>', open + 1);
    if (gt < 0) break;
    const nextOpen = xml.indexOf('<', open + 1);
    if (nextOpen >= 0 && nextOpen < gt) {
      // `<` … `<` before any `>`: the first was not a tag.
      at = nextOpen;
      continue;
    }
    const end = gt;
    const head = xml.slice(open + 1, end);
    const name = head.split(/[\s/]/, 1)[0];
    const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
    if (local !== tag || head.endsWith('/')) {
      at = open + 1;
      continue;
    }
    const close = xml.indexOf(`</${name}>`, end + 1);
    if (close < 0) break;
    found.push(xml.slice(end + 1, close));
    at = close + name.length + 3;
  }
  return found;
}

/** The text after `start` up to the first of `ends` (case-insensitive, as OFX tags are). */
function between(text: string, start: string, ends: string[]): string {
  const upper = text.toUpperCase();
  const from = upper.indexOf(start.toUpperCase());
  if (from < 0) return '';
  const body = from + start.length;
  const stops = ends.map((end) => upper.indexOf(end.toUpperCase(), body)).filter((index) => index >= 0);
  return text.slice(body, stops.length ? Math.min(...stops) : text.length);
}

/** An element's text with any markup inside it dropped — one pass, no regex backtracking. */
function textOf(fragment: string): string {
  let out = '';
  let inTag = false;
  for (const char of fragment) {
    if (char === '<') inTag = true;
    else if (char === '>') inTag = false;
    else if (!inTag) out += char;
  }
  return out;
}

function first(xml: string, path: string[]): string | null {
  let scope: string | null = xml;
  for (const tag of path) {
    scope = scope ? elements(scope, tag)[0] ?? null : null;
  }
  const value = scope === null ? undefined : textOf(scope).trim();
  return value ? decodeEntities(value) : null;
}

function camtDate(entry: string, path: string, row: number): string {
  const raw = first(entry, [path, 'Dt']) ?? first(entry, [path, 'DtTm']);
  const match = raw ? /^(\d{4}-\d{2}-\d{2})/.exec(raw) : null;
  if (!match) throw new BankFileParseError('INVALID_DATE', { row, value: raw });
  return match[1];
}

function signed(block: string, row: number): number {
  const amount = Number(first(block, ['Amt']));
  if (!Number.isFinite(amount)) throw new BankFileParseError('INVALID_AMOUNT', { row });
  return first(block, ['CdtDbtInd']) === 'DBIT' ? -amount : amount;
}

export function parseCamt053(bytes: Buffer): ParsedBankFile {
  const xml = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const statement = elements(xml, 'Stmt')[0];
  if (!statement) throw new BankFileParseError('MALFORMED', { reason: 'no Stmt element' });

  const transactions = elements(statement, 'Ntry').map((entry, index) => {
    const row = index + 1;
    // A reversal (RvslInd) flips the direction it states.
    const amount = signed(entry, row) * (first(entry, ['RvslInd']) === 'true' ? -1 : 1);
    const party =
      first(entry, ['NtryDtls', 'TxDtls', 'RltdPties', amount > 0 ? 'Dbtr' : 'Cdtr', 'Nm']) ??
      first(entry, ['NtryDtls', 'TxDtls', 'RltdPties', amount > 0 ? 'Dbtr' : 'Cdtr', 'Pty', 'Nm']);
    const remittance = first(entry, ['NtryDtls', 'TxDtls', 'RmtInf', 'Ustrd']);
    const additional = first(entry, ['AddtlNtryInf']);
    const description = [party, remittance, additional && additional !== remittance ? additional : null].filter(Boolean).join(' — ');
    return {
      date: camtDate(entry, 'BookgDt', row),
      description: description.slice(0, 500),
      reference:
        first(entry, ['NtryDtls', 'TxDtls', 'Refs', 'EndToEndId']) ??
        first(entry, ['AcctSvcrRef']) ??
        first(entry, ['NtryRef']),
      debit: amount > 0 ? roundAmount(amount) : 0,
      credit: amount < 0 ? roundAmount(-amount) : 0,
      sourceRow: row,
    } satisfies ParsedBankTransaction;
  });
  if (!transactions.length) throw new BankFileParseError('NO_ROWS');

  let startingBalance: number | null = null;
  let endingBalance: number | null = null;
  let startDate: string | null = null;
  let endDate: string | null = null;
  for (const balance of elements(statement, 'Bal')) {
    const code = first(balance, ['Tp', 'CdOrPrtry', 'Cd']);
    const value = signed(balance, 0);
    // `<Dt><Dt>2026-10-01</Dt></Dt>` or `<Dt><DtTm>…</DtTm></Dt>`: the same tag nested in itself.
    const date = /<(?:\w+:)?Dt>\s*<(?:\w+:)?(?:Dt|DtTm)>(\d{4}-\d{2}-\d{2})/.exec(balance)?.[1] ?? null;
    if (code === 'OPBD' || code === 'PRCD') {
      startingBalance = roundAmount(value);
      startDate = startDate ?? date;
    } else if (code === 'CLBD') {
      endingBalance = roundAmount(value);
      endDate = date;
    }
  }
  return {
    format: 'camt053',
    transactions,
    startingBalance,
    endingBalance,
    startDate: first(statement, ['FrToDt', 'FrDtTm'])?.slice(0, 10) ?? startDate,
    endDate: first(statement, ['FrToDt', 'ToDtTm'])?.slice(0, 10) ?? endDate,
    currency: /<(?:\w+:)?Amt\s+Ccy="([A-Z]{3})"/.exec(statement)?.[1] ?? null,
  };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}
