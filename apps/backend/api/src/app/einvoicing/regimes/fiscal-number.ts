import { Invoice } from '../../invoices/entities/invoice.entity';
import { BadRequestError } from '../../i18n/localized.exception';

/**
 * The number an authority authorised, as opposed to the one this product assigned itself.
 *
 * ## Why this exists
 *
 * Every one of these documents carries two numbers, and they are not the same:
 *
 * - **`invoiceNumber`** — the tenant's own document sequence (`FAC-1`), from `document_sequences`.
 *   It identifies the sale inside this product and has no fiscal force anywhere.
 * - **`ncfNumber`** — the number drawn from the range the authority granted (`F001-00000123`,
 *   `SETP990000001`, a bare folio). It is the document's fiscal identity.
 *
 * The builders were written before the numbering existed and read `invoiceNumber`, which meant a
 * Peruvian factura would have gone to SUNAT numbered from the internal sequence rather than from
 * the authorised series: accepted only until the two drifted, and then rejected for a correlative
 * SUNAT never authorised — while the range the tenant is paying for went unused.
 *
 * Neither is a fallback for the other. A document with no fiscal number cannot be built, and
 * substituting the internal one produces a document that looks issued and is not.
 */

/**
 * The consecutive alone: the last hyphen-separated segment, digits only.
 *
 * `F001-00000123` → `123`, `001-002-000000045` → `45`, `SETP990000001` → `990000001`, `7` → `7`.
 * The inverse of what the numbering adapters compose, and deliberately the same rule, so the two
 * cannot disagree about which digits are the number.
 */
export function fiscalConsecutive(invoice: Invoice): string {
  const digits = (invoice.ncfNumber ?? '').split('-').pop()?.replace(/\D/g, '') ?? '';
  if (!digits) {
    throw new BadRequestError('EINVOICING.DOCUMENTO_SIN_NUMERO_FISCAL', {
      document: invoice.invoiceNumber ?? '',
    });
  }
  return digits;
}

/** The fiscal number exactly as the authority granted it, prefix and all. */
export function fiscalNumber(invoice: Invoice): string {
  const number = (invoice.ncfNumber ?? '').trim();
  if (!number) {
    throw new BadRequestError('EINVOICING.DOCUMENTO_SIN_NUMERO_FISCAL', {
      document: invoice.invoiceNumber ?? '',
    });
  }
  return number;
}
