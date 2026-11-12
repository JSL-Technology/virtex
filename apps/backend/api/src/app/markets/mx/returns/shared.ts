/**
 * What every SAT electronic-accounting document shares (Anexo 24, versión 1.3).
 *
 * Amounts carry two decimals, dates are `AAAA-MM-DD`, and the month is zero-padded. Every figure
 * comes from the ledger through the period's dataset — the same source the balance sheet reads, so
 * the file and the statements cannot disagree.
 */
import type { ReturnAccountRecord, ReturnPeriod } from '../../contracts';

export const CATALOGO_NS = 'http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas';
export const BALANZA_NS = 'http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion';
export const POLIZAS_NS = 'http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo';
export const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Two decimals, dot separator, no thousands separator — the format the schema declares. */
export function money(value: number): string {
  return (Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function cents(value: number): number {
  return Math.round(value * 100);
}

/** `Natur`: `D` for an account whose increases are debits, `A` for one whose increases are credits. */
export function natureOf(account: ReturnAccountRecord): 'D' | 'A' {
  return account.nature === 'DEBIT' ? 'D' : 'A';
}

/**
 * A balance in the account's own natural sense.
 *
 * The ledger stores every balance signed `debit − credit`, so a liability with 5,000 owed is
 * −5,000. The SAT states it as 5,000. Flipped once, here, rather than at each attribute.
 */
export function naturalise(account: ReturnAccountRecord, signedBalance: number): number {
  return natureOf(account) === 'D' ? signedBalance : -signedBalance;
}

/** How deep the account sits, counting the separated segments of its code. */
export function levelOf(code: string): number {
  return code.split(/[.-]/).filter(Boolean).length;
}

/** The parent account's own number, or null at the top level. */
export function parentCodeOf(code: string): string | null {
  const separator = code.includes('.') ? '.' : code.includes('-') ? '-' : null;
  if (!separator) return null;
  const segments = code.split(separator).filter(Boolean);
  if (segments.length <= 1) return null;
  return segments.slice(0, -1).join(separator);
}

/** `SAT_balanza_202606.xml`: what the file is called when a person downloads it. */
export function fileName(document: string, period: ReturnPeriod): string {
  return `SAT_${document}_${period.year}${pad2(period.month)}.xml`;
}

/**
 * The taxpayer's RFC, upper case.
 *
 * Refused by name when absent rather than written as an empty attribute: a file whose RFC is blank
 * is rejected on upload, and discovering that at the Buzón Tributario on the deadline is a worse
 * way to learn it.
 */
export function rfcOf(taxId: string): string | null {
  return taxId.trim().toUpperCase() || null;
}
