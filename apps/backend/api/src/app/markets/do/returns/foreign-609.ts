import type { MarketReturnFiling, ReturnDataset } from '../../contracts';
import { compactDate, fileName, fileOf, money } from './formats';

/**
 * 609 — Pagos al exterior.
 *
 * Payments to non-resident suppliers, with the income tax withheld at source: the bills of
 * suppliers established outside the Dominican Republic.
 */
export const foreign609: MarketReturnFiling = {
  code: '609',
  labelKey: 'returns.do.609',
  periodicity: 'MONTHLY',
  mediaType: 'text/plain; charset=utf-8',
  extension: 'txt',
  tracked: true,
  async build(dataset: ReturnDataset) {
    const documents = await dataset.foreignPurchases();
    const rows = documents.map((document) =>
      [
        (document.supplierName ?? '').trim(),
        // Tipo de renta: fees for services is the ordinary case for a cross-border payment; where
        // the bill declares an ISR retention type, that classification wins.
        document.fiscalAttributes['isrRetentionType'] || '02',
        compactDate(document.date),
        money(document.servicesAmount + document.goodsAmount || document.total),
        money(document.incomeTaxWithheld),
      ].join('|'),
    );
    return fileOf('609', dataset.filer.taxId, dataset.period, rows);
  },
  fileName: (period) => fileName('609', period),
};
