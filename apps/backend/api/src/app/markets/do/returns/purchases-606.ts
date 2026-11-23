import type { MarketReturnFiling, MarketReturnResult, ReturnDataset, ReturnPurchaseRecord } from '../../contracts';
import { isValidDominicanTaxId } from '../identity';
import { compactDate, digitsOnly, fileName, fileOf, identificationType, money } from './formats';

/**
 * 606 — Compras de bienes y servicios.
 *
 * One record per supplier comprobante received in the period: the bills, and the credit notes the
 * supplier issued against them. A supplier's NCF B04 / e-CF 34 reduces the ITBIS the buyer may
 * deduct, so a 606 without it overstates the tax credit for the month; it is reported as its own
 * record, with the bill's NCF as «NCF modificado» and forma de pago `06`, which is how the DGII
 * pairs the two.
 */

/**
 * «Forma de pago» 06: the DGII reports a supplier's credit note on that column, whatever method
 * paid the bill it corrects. It is the 606's rule, so it lives with the 606.
 */
const CREDIT_NOTE_PAYMENT_FORM = '06';

export const purchases606: MarketReturnFiling = {
  code: '606',
  labelKey: 'returns.do.606',
  periodicity: 'MONTHLY',
  mediaType: 'text/plain; charset=utf-8',
  extension: 'txt',
  tracked: true,
  async build(dataset: ReturnDataset) {
    const documents = await dataset.purchases();

    // Every line of the 606 identifies the supplier by RNC or cédula, and the DGII rejects the
    // whole file over one that does not (QA B-02: a bill without one was reported anyway). The file
    // is not produced; the documents to correct are named instead.
    const unidentified = documents.filter((document) => !isValidDominicanTaxId(document.supplierTaxId ?? ''));
    if (unidentified.length > 0) {
      return refuse('compliance.report_606_supplier_tax_id_missing', { count: unidentified.length, bills: name(unidentified, (d) => `${d.fiscalNumber} (${d.supplierName ?? '—'})`) });
    }

    // A credit note modifies a comprobante; without the bill's NCF the record has nothing to point
    // at and the DGII rejects it.
    const unpaired = documents.filter((document) => document.kind === 'credit_note' && !document.modifiedFiscalNumber);
    if (unpaired.length > 0) {
      return refuse('compliance.report_606_credit_note_without_modified_ncf', { count: unpaired.length, notes: name(unpaired, (d) => `${d.reference} (${d.fiscalNumber})`) });
    }

    // Every line states what was bought. A purchase used to be filed as `06` (compras de
    // mercancías) when nobody had said what it was, because the column defaulted to it: the file
    // said something the taxpayer had never stated. The documents to classify are named instead
    // (`PATCH /accounts-payable/:id/fiscal-attributes`).
    const unclassified = documents.filter((document) => !document.fiscalAttributes['purchaseCategory']);
    if (unclassified.length > 0) {
      return refuse('compliance.report_606_purchase_not_classified', { count: unclassified.length, bills: name(unclassified, (d) => `${d.fiscalNumber ?? d.reference} (${d.supplierName ?? '—'})`), });
    }

    return fileOf('606', dataset.filer.taxId, dataset.period, documents.map(record606));
  },
  fileName: (period) => fileName('606', period),
};

function record606(document: ReturnPurchaseRecord): string {
  const taxId = digitsOnly(document.supplierTaxId);
  return [
    taxId,
    identificationType(taxId),
    // The 606's own columns, from what the market asked the purchase to state, by the keys
    // `markets/do/purchases.ts` declares. Checked above: nothing is filed unclassified.
    document.fiscalAttributes['purchaseCategory'],
    document.fiscalNumber ?? '',
    document.modifiedFiscalNumber ?? '',
    compactDate(document.date),
    document.paidOn ? compactDate(document.paidOn) : '',
    money(document.servicesAmount),
    money(document.goodsAmount),
    money(document.servicesAmount + document.goodsAmount),
    money(document.taxAmount),
    money(document.taxWithheld),
    money(document.taxProportional),
    money(document.taxToCost),
    // ITBIS por adelantar: what remains deductible after proportionality and cost allocation. On a
    // credit note, the ITBIS it gives back: the credit the buyer no longer carries.
    money(Math.max(0, document.taxAmount - document.taxProportional - document.taxToCost)),
    money(0),
    document.fiscalAttributes['isrRetentionType'] ?? '',
    money(document.incomeTaxWithheld),
    money(0),
    money(document.exciseAmount),
    money(document.otherTaxes),
    money(document.serviceCharge),
    // «Forma de pago»: the DGII's code for the method that settled it, and `06` for a credit note,
    // which is how the 606 reports one whatever method the bill was paid by.
    (document.kind === 'credit_note' ? CREDIT_NOTE_PAYMENT_FORM : document.paymentFiscalCode) || '01',
  ].join('|');
}

/** The first ten offenders, named: a count alone does not tell anyone what to fix. */
function name(documents: readonly ReturnPurchaseRecord[], describe: (document: ReturnPurchaseRecord) => string): string {
  return documents.slice(0, 10).map(describe).join(', ');
}

/** A refusal, typed once so each one is a `MarketReturnResult` and not a shape of its own. */
function refuse(messageKey: string, params: Record<string, string | number>): MarketReturnResult {
  return { refusal: { messageKey, params } };
}
