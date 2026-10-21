import { countryPackFor } from '../../contracts/country-pack/country-pack';
import { checkReceivedNcf, normalizeNcf, ReceivedNcfError, ReceivedNcfWarning } from './ncf';

/**
 * The number on a supplier's document, as each market defines it.
 *
 * A Dominican bill carries an NCF the DGII assigned; a Mexican one a CFDI folio fiscal (a UUID the
 * SAT stamped); a Brazilian one the 44-digit NF-e access key; a Colombian one the CUFE. A US bill
 * carries only the supplier's own invoice number, which no authority checks. Each market's number is
 * checked by that market's rule and by no other — the failure this exists to end is a US bill told
 * its "NCF is missing".
 *
 * `unverified` is an honest answer, not a failure: the market's number has no published shape this
 * product checks, so it is kept as written and the person is told it was not verified.
 */
export type ReceivedDocumentKind = 'NCF' | 'CFDI_UUID' | 'NFE_KEY' | 'CUFE' | 'FISCAL_NUMBER' | 'INVOICE_NUMBER';

export interface ReceivedDocumentCheck {
  status: 'ok' | 'missing' | 'invalid' | 'unverified';
  kind: ReceivedDocumentKind;
  normalized: string | null;
  /** The authority's document type, where the number encodes one (the NCF's `B01`, `E31`…). */
  type: string | null;
  error: ReceivedNcfError | 'format' | 'check_digit' | null;
  warnings: ReceivedNcfWarning[];
}

/** Which number a supplier's document carries in this market. */
export function receivedDocumentKind(countryCode: string | null | undefined): ReceivedDocumentKind {
  const key = countryPackFor(countryCode).documents.supplierDocumentNumberKey;
  if (key.endsWith('.ncf')) return 'NCF';
  if (key.endsWith('.cfdi_uuid')) return 'CFDI_UUID';
  if (key.endsWith('.nfe_key')) return 'NFE_KEY';
  if (key.endsWith('.cufe')) return 'CUFE';
  if (key.endsWith('.fiscal_number')) return 'FISCAL_NUMBER';
  return 'INVOICE_NUMBER';
}

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const CUFE = /^[0-9a-f]{96}$/;

export function checkReceivedDocument(countryCode: string | null | undefined, raw: string | null | undefined): ReceivedDocumentCheck {
  const kind = receivedDocumentKind(countryCode);
  const text = (raw ?? '').trim();
  const result = (partial: Partial<ReceivedDocumentCheck>): ReceivedDocumentCheck => ({
    status: 'ok',
    kind,
    normalized: null,
    type: null,
    error: null,
    warnings: [],
    ...partial,
  });
  if (!text) return result({ status: 'missing' });

  switch (kind) {
    case 'NCF': {
      const checked = checkReceivedNcf(text);
      return checked.ok
        ? result({ normalized: checked.ncf.normalized, type: checked.ncf.type, warnings: checked.ncf.warnings })
        : result({ status: 'invalid', normalized: checked.normalized ?? normalizeNcf(text), error: checked.error });
    }
    case 'CFDI_UUID': {
      const normalized = text.toUpperCase().replace(/\s/g, '');
      return UUID.test(normalized) ? result({ normalized }) : result({ status: 'invalid', normalized, error: 'format' });
    }
    case 'NFE_KEY': {
      const normalized = text.replace(/\D/g, '');
      if (normalized.length !== 44) return result({ status: 'invalid', normalized, error: 'format' });
      return nfeCheckDigitOk(normalized) ? result({ normalized }) : result({ status: 'invalid', normalized, error: 'check_digit' });
    }
    case 'CUFE': {
      const normalized = text.toLowerCase().replace(/\s/g, '');
      return CUFE.test(normalized) ? result({ normalized }) : result({ status: 'invalid', normalized, error: 'format' });
    }
    default:
      // No published shape this product checks: kept as printed, flagged as not verified.
      return result({ status: 'unverified', normalized: text.slice(0, 64) });
  }
}

/** NF-e access key: the 44th digit is a modulus-11 check over the first 43, weights 2…9 from the right. */
export function nfeCheckDigitOk(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) {
    sum += Number(key[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const digit = rest < 2 ? 0 : 11 - rest;
  return digit === Number(key[43]);
}
