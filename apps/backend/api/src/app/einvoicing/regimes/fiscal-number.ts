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
 * - **`fiscalNumber`** — the number drawn from the range the authority granted (`F001-00000123`,
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
 * The consecutive the document's number was drawn as, recorded when it was drawn
 * (`invoices.fiscal_sequence`).
 *
 * It used to be parsed back out of the formatted number — the digits of its last hyphen-separated
 * segment — which is wrong the moment a series carries a digit: a DIAN prefix `FE2` and the number
 * `1001` read back as `21001`, a number outside every range the tenant holds.
 */
export function fiscalConsecutive(invoice: Invoice): string {
  const sequence = Number(invoice.fiscalSequence ?? NaN);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new BadRequestError('einvoicing.document_document_has_no_fiscal_number', {
      document: invoice.invoiceNumber ?? '',
    });
  }
  return String(sequence);
}

/**
 * The authority's type the document was numbered as, by the market's own rule
 * (`MarketNumbering.typeOf`), recorded at issuance — and one this regime's builder writes.
 *
 * Each builder used to decide the type again from the invoice, a second copy of the rule beside the
 * numbering's: the way a document ends up numbered from the exenta range and built as an afecta.
 * A type the builder does not write (a note its regime cannot transmit yet) is refused by name.
 */
export function issuedDocumentType<T extends string>(invoice: Invoice, built: readonly T[]): T {
  const type = (invoice.fiscalDocumentType ?? '').trim().toUpperCase();
  if (!type) {
    throw new BadRequestError('einvoicing.document_has_no_fiscal_document_type', { document: invoice.invoiceNumber ?? '' });
  }
  const match = built.find((candidate) => candidate.toUpperCase() === type);
  if (!match) throw new BadRequestError('einvoicing.document_type_not_built_by_regime', { type });
  return match;
}

/** The fiscal number exactly as the authority granted it, prefix and all. */
export function fiscalNumber(invoice: Invoice): string {
  const number = (invoice.fiscalNumber ?? '').trim();
  if (!number) {
    throw new BadRequestError('einvoicing.document_document_has_no_fiscal_number', {
      document: invoice.invoiceNumber ?? '',
    });
  }
  return number;
}
