import type { MarketReturnFiling, ReturnDataset } from '../../contracts';
import { compactDate, fileName, fileOf } from './formats';

/**
 * 608 — Comprobantes anulados.
 *
 * A fiscal number that was assigned and then annulled must be declared, or the DGII sees a gap in
 * the taxpayer's numbering and asks about it. A comprobante a credit note reversed is not annulled:
 * it stays in the 607 and its note is the record of the reversal.
 */
export const annulled608: MarketReturnFiling = {
  code: '608',
  labelKey: 'returns.do.608',
  periodicity: 'MONTHLY',
  mediaType: 'text/plain; charset=utf-8',
  extension: 'txt',
  tracked: true,
  async build(dataset: ReturnDataset) {
    const sales = await dataset.sales();
    const rows = sales
      .filter((sale) => sale.annulled)
      .map((sale) =>
        [
          sale.fiscalNumber,
          compactDate(sale.issueDate),
          // The code chosen when it was annulled (FAC-INV-05); derived from the reason's words only
          // for a document voided before the product recorded one.
          sale.annulmentCode ?? annulmentCode(sale.annulmentReason),
        ].join('|'),
      );
    return fileOf('608', dataset.filer.taxId, dataset.period, rows);
  },
  fileName: (period) => fileName('608', period),
};

/**
 * DGII «Tipo de Anulación» from the words whoever voided the document wrote.
 *
 * Only where they are unambiguous, and `06` (otros) otherwise: a code the taxpayer never chose is a
 * declaration they never made.
 */
export function annulmentCode(reason: string | null | undefined): string {
  const text = (reason ?? '').toLowerCase();
  if (text.includes('deterioro') || text.includes('impresión') || text.includes('impresion')) return '01';
  if (text.includes('error') && text.includes('impres')) return '02';
  if (text.includes('duplic')) return '03';
  if (text.includes('correcc') || text.includes('información') || text.includes('informacion')) return '04';
  if (text.includes('devol') || text.includes('cancel')) return '05';
  return '06';
}
