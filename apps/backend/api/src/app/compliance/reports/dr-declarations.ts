import { roundAmount, sumAmounts } from '../../common/money';
import type { PurchaseFiscalDocument } from '../../contracts/fiscal-records/purchase-fiscal-records.contract';

/**
 * The Dominican monthly declarations an accountant files from the books: the IT-1 (ITBIS) and the
 * IR-17 (withholdings to third parties). The IR-3 (withholdings on salaries) lives in Payroll.
 *
 * ## What these are, and what they are not
 *
 * The 606–609 are files the DGII ingests. The IT-1 and IR-17 are FORMS, filled in the Oficina
 * Virtual box by box. What the product owes the accountant is every box worked out from the same
 * documents the formats were built from, with the arithmetic shown, so filing is transcription and
 * the declaration reconciles with the 606/607 the DGII already has — the cross-check its audits run.
 *
 * Every figure is in the company's base currency (DOP): a document in another currency is converted
 * at the rate it was booked at.
 *
 * *Verificar con contabilidad:* the line numbering follows the forms' published sections; the DGII
 * revises the forms, and a box added or renumbered is a change here, not a different calculation.
 */

/** A sale or credit note as the IT-1 needs it. Amounts in the document's currency. */
export interface It1SaleDocument {
  isCreditNote: boolean;
  /** Rate to the base currency the document was booked at. */
  exchangeRate: number;
  /** Net of discounts, before tax. */
  netAmount: number;
  taxedAmount: number;
  exemptAmount: number;
  tax: number;
  /** ITBIS the buyer withheld from the company. */
  taxWithheld: number;
  /** An export (E46, or a foreign buyer with zero rate). */
  isExport: boolean;
}

export interface DeclarationLine {
  /** Stable identifier of the box, for the screen to label it (`it1.sales.total`). */
  code: string;
  amount: number;
}

export interface It1Worksheet {
  period: string;
  rnc: string;
  lines: DeclarationLine[];
  /** Share of purchase ITBIS subject to proportionality the company may deduct (0–1). */
  proportionalityFactor: number;
  /** Positive: ITBIS to pay. Zero when there is a credit balance. */
  payable: number;
  /** Credit to carry to next month. */
  creditForward: number;
  documents: { sales: number; purchases: number };
}

export interface Ir17Line {
  /** DGII 606 «tipo de retención en ISR» (`01` alquileres, `02` honorarios…) or `ITBIS`. */
  type: string;
  count: number;
  /** What was paid, before tax. */
  base: number;
  withheld: number;
}

export interface Ir17Worksheet {
  period: string;
  rnc: string;
  isr: Ir17Line[];
  itbis: Ir17Line;
  totalWithheld: number;
}

/** The IT-1 from the month's sales and purchases. */
export function buildIt1(input: {
  rnc: string;
  year: number;
  month: number;
  sales: readonly It1SaleDocument[];
  purchases: readonly PurchaseFiscalDocument[];
  /** Saldo a favor from the previous month's IT-1. */
  priorCredit?: number;
}): It1Worksheet {
  const base = (doc: It1SaleDocument, amount: number) =>
    (doc.isCreditNote ? -1 : 1) * amount * (Number(doc.exchangeRate) || 1);
  const sum = (pick: (doc: It1SaleDocument) => number) =>
    sumAmounts(input.sales.map((doc) => base(doc, pick(doc))));

  const total = sum((d) => d.netAmount);
  const exports = sumAmounts(input.sales.filter((d) => d.isExport).map((d) => base(d, d.netAmount)));
  const exempt = sumAmounts(input.sales.filter((d) => !d.isExport).map((d) => base(d, d.exemptAmount)));
  const taxed = sum((d) => d.taxedAmount);
  const taxCharged = sum((d) => d.tax);
  const withheldByCustomers = sum((d) => d.taxWithheld);

  // Proportionality (Reglamento ITBIS, art. 14): ITBIS on purchases used for taxed AND exempt
  // operations is deductible in the proportion taxed sales bear to all sales.
  const proportionalityFactor = total > 0 ? Math.min(1, Math.max(0, (taxed + exports) / total)) : 1;

  const purchaseSign = (doc: PurchaseFiscalDocument) => (doc.kind === 'credit_note' ? -1 : 1);
  const purchaseSum = (pick: (doc: PurchaseFiscalDocument) => number) =>
    sumAmounts(input.purchases.map((doc) => purchaseSign(doc) * pick(doc)));
  const purchaseTax = purchaseSum((d) => d.taxAmount);
  const toCost = purchaseSum((d) => d.taxToCost);
  const proportional = purchaseSum((d) => d.taxProportional);
  // Fully deductible: what was paid, less what went to cost and what is subject to the factor.
  const fullyDeductible = roundAmount(purchaseTax - toCost - proportional);
  const proportionalDeductible = roundAmount(proportional * proportionalityFactor);
  const deductible = roundAmount(fullyDeductible + proportionalDeductible);

  const priorCredit = roundAmount(Math.max(0, input.priorCredit ?? 0));
  const net = roundAmount(taxCharged - deductible - withheldByCustomers - priorCredit);

  const lines: DeclarationLine[] = [
    { code: 'it1.sales.total', amount: roundAmount(total) },
    { code: 'it1.sales.exports', amount: roundAmount(exports) },
    { code: 'it1.sales.exempt', amount: roundAmount(exempt) },
    { code: 'it1.sales.taxed', amount: roundAmount(taxed) },
    { code: 'it1.tax.charged', amount: roundAmount(taxCharged) },
    { code: 'it1.purchases.tax_paid', amount: roundAmount(purchaseTax) },
    { code: 'it1.purchases.tax_to_cost', amount: roundAmount(toCost) },
    { code: 'it1.purchases.tax_proportional', amount: roundAmount(proportional) },
    { code: 'it1.purchases.tax_proportional_deductible', amount: proportionalDeductible },
    { code: 'it1.purchases.tax_deductible', amount: deductible },
    { code: 'it1.credits.withheld_by_customers', amount: roundAmount(withheldByCustomers) },
    { code: 'it1.credits.prior_balance', amount: priorCredit },
    { code: 'it1.result.payable', amount: Math.max(0, net) },
    { code: 'it1.result.credit_forward', amount: Math.max(0, -net) },
  ];

  return {
    period: `${input.year}${String(input.month).padStart(2, '0')}`,
    rnc: (input.rnc ?? '').replace(/\D/g, ''),
    lines,
    proportionalityFactor: roundAmount(proportionalityFactor * 10000) / 10000,
    payable: Math.max(0, net),
    creditForward: Math.max(0, -net),
    documents: { sales: input.sales.length, purchases: input.purchases.length },
  };
}

/** The IR-17 from the bills paid in the month with a withholding. */
export function buildIr17(input: {
  rnc: string;
  year: number;
  month: number;
  paid: readonly PurchaseFiscalDocument[];
}): Ir17Worksheet {
  const byType = new Map<string, Ir17Line>();
  const itbis: Ir17Line = { type: 'ITBIS', count: 0, base: 0, withheld: 0 };
  for (const doc of input.paid) {
    const base = roundAmount(Number(doc.servicesAmount) + Number(doc.goodsAmount));
    if (Number(doc.incomeTaxWithheld) > 0) {
      const type = doc.isrRetentionType || '06';
      const line = byType.get(type) ?? { type, count: 0, base: 0, withheld: 0 };
      line.count += 1;
      line.base = roundAmount(line.base + base);
      line.withheld = roundAmount(line.withheld + Number(doc.incomeTaxWithheld));
      byType.set(type, line);
    }
    if (Number(doc.taxWithheld) > 0) {
      itbis.count += 1;
      itbis.base = roundAmount(itbis.base + base);
      itbis.withheld = roundAmount(itbis.withheld + Number(doc.taxWithheld));
    }
  }
  const isr = [...byType.values()].sort((a, b) => a.type.localeCompare(b.type));
  return {
    period: `${input.year}${String(input.month).padStart(2, '0')}`,
    rnc: (input.rnc ?? '').replace(/\D/g, ''),
    isr,
    itbis,
    totalWithheld: sumAmounts([...isr.map((l) => l.withheld), itbis.withheld]),
  };
}

/** A worksheet as CSV, for the accountant's working papers. Codes, not prose: the file is data. */
export function worksheetCsv(rows: Array<[string, string | number]>): string {
  const cell = (value: string | number) => {
    const text = typeof value === 'number' ? value.toFixed(2) : value;
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map(([a, b]) => `${cell(a)},${cell(b)}`).join('\n');
}
