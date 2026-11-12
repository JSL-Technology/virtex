import type { MarketReturnFiling, ReturnDataset, ReturnSalesRecord } from '../../contracts';
import { compactDate, digitsOnly, fileName, fileOf, identificationType, money } from './formats';

/**
 * 607 — Ventas de bienes y servicios.
 *
 * One record per comprobante issued in the period, including credit and debit notes, and including
 * an invoice a credit note later reversed in full: it was a sale of its month and its note reports
 * the reversal, so leaving it out subtracted the sale twice. Only an ANNULLED comprobante is not a
 * sale — that one is the 608's. *Verificar con contador local.*
 *
 * A till ticket that carries a comprobante is a sale like any other and is reported in the same
 * record shape; it simply has no counterparty and no withholding (QA R3-C02).
 */
export const FORMAT_607_BOXES = [
  'RNC/Cédula o Pasaporte',
  'Tipo Identificación',
  'Número Comprobante Fiscal',
  'Número Comprobante Fiscal Modificado',
  'Tipo de Ingreso',
  'Fecha Comprobante',
  'Fecha de Retención',
  'Monto Facturado',
  'ITBIS Facturado',
  'ITBIS Retenido por Terceros',
  'ITBIS Percibido',
  'Retención Renta por Terceros',
  'ISR Percibido',
  'Impuesto Selectivo al Consumo',
  'Otros Impuestos/Tasas',
  'Monto Propina Legal',
  'Efectivo',
  'Cheque/Transferencia/Depósito',
  'Tarjeta Débito/Crédito',
  'Venta a Crédito',
  'Bonos o Certificados de Regalo',
  'Permuta',
  'Otras Formas de Ventas',
] as const;

export const sales607: MarketReturnFiling = {
  code: '607',
  labelKey: 'returns.do.607',
  periodicity: 'MONTHLY',
  mediaType: 'text/plain; charset=utf-8',
  extension: 'txt',
  tracked: true,
  async build(dataset: ReturnDataset) {
    const sales = await dataset.sales();
    // «Tipo de ingreso» is the company's own classification of what it sells, declared once in its
    // fiscal profile; `01` ingresos por operaciones is the ordinary case.
    const incomeType = dataset.filer.fiscalProfile['tipoIngreso'] || '01';
    const rows = sales.filter((sale) => !sale.annulled).map((sale) => record607(sale, incomeType));
    return fileOf('607', dataset.filer.taxId, dataset.period, rows);
  },
  fileName: (period) => fileName('607', period),
};

/** One 607 record: refuses to write a line that is not exactly the published twenty-three boxes. */
function record607(sale: ReturnSalesRecord, incomeType: string): string {
  const taxId = digitsOnly(sale.counterpartyTaxId);
  const withheld = sale.taxWithheld > 0 || sale.incomeTaxWithheld > 0;
  const boxes = [
    taxId,
    identificationType(taxId),
    sale.fiscalNumber,
    sale.modifiedFiscalNumber ?? '',
    incomeType,
    compactDate(sale.issueDate),
    // 7 — only when something was withheld; the DGII requires it then and refuses it otherwise.
    withheld && sale.withheldOn ? compactDate(sale.withheldOn) : '',
    money(sale.netAmount),
    money(sale.taxAmount),
    money(sale.taxWithheld),
    // ITBIS percibido: a perception regime the product does not operate. Zero, not omitted: the
    // record is positional.
    money(0),
    money(sale.incomeTaxWithheld),
    money(0),
    money(sale.exciseAmount),
    money(sale.otherTaxes),
    money(sale.serviceCharge),
    money(sale.settlement.cash),
    money(sale.settlement.transfer),
    money(sale.settlement.card),
    money(sale.settlement.credit),
    money(sale.settlement.giftCard),
    money(sale.settlement.swap),
    money(sale.settlement.other),
  ];
  if (boxes.length !== FORMAT_607_BOXES.length) {
    throw new Error(`607 record has ${boxes.length} boxes; the format has ${FORMAT_607_BOXES.length}`);
  }
  return boxes.join('|');
}
