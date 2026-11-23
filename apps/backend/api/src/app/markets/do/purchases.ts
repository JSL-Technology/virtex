// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { FiscalFieldSpec, MarketPurchases, MarketReceivedDocument, ReceivedDocumentCheck } from '../contracts';
import { receivedDocumentResult } from '../kit/purchases';
import { DOCUMENT_TYPES } from './documents';

/**
 * A comprobante fiscal (NCF or e-CF) as received on a purchase, checked against the DGII's rules.
 *
 * The shape is fixed by the DGII: a series letter, the two-digit document type, then the sequence —
 * eight digits for a traditional `B` comprobante (11 characters), ten for an electronic `E` one
 * (13). The type must be one the DGII defines (`DOCUMENT_TYPES` in `documents.ts`).
 *
 * What is WRONG blocks: a malformed number or an unknown type cannot be filed in the 606. What is
 * merely UNUSUAL warns, because it can be right: a consumer invoice (B02/E32) is a valid purchase
 * document, it just carries no ITBIS credit; a credit note belongs on a debit note, not on a bill.
 */
export interface ReceivedNcf {
  /** Upper-cased, without spaces or dashes. */
  normalized: string;
  /** `B01`, `E31`… */
  type: string;
  electronic: boolean;
  /**
   * Issued by the company itself as the buyer (B11/B13/B17, E41/E43/E47): to an informal supplier,
   * for minor expenses, for a payment abroad. Such a purchase need not name a supplier with an RNC.
   */
  selfIssued: boolean;
  /** True when the 606 needs the supplier's RNC or cédula for this purchase. */
  requiresSupplierTaxId: boolean;
  warnings: ReceivedNcfWarning[];
}

export type ReceivedNcfWarning = 'no_tax_credit' | 'credit_note_on_bill' | 'sales_only_type';

export type ReceivedNcfError = 'format' | 'unknown_type';

export type ReceivedNcfCheck = { ok: true; ncf: ReceivedNcf } | { ok: false; error: ReceivedNcfError; normalized: string };

const SHAPE = /^(?:B(\d{2})\d{8}|E(\d{2})\d{10})$/;

/** Types a supplier issues to the buyer that give the buyer no ITBIS credit. */
const NO_CREDIT = new Set(['B02', 'E32']);
/** Self-issued types for purchases where the counterparty has no Dominican tax id. */
const NO_SUPPLIER_TAX_ID = new Set(['B13', 'E43', 'B17', 'E47']);
/**
 * Types that are not a purchase document: a seller's export or a government invoice issued BY the
 * company. Received from a supplier they are almost certainly misread.
 */
const NOT_RECEIVED = new Set(['B16', 'E46']);

export function normalizeNcf(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[\s-]/g, '');
}

export function checkReceivedNcf(raw: string): ReceivedNcfCheck {
  const normalized = normalizeNcf(raw);
  const match = SHAPE.exec(normalized);
  if (!match) return { ok: false, error: 'format', normalized };
  const type = normalized.slice(0, 3);
  const spec = DOCUMENT_TYPES.find((entry) => entry.code === type);
  if (!spec) return { ok: false, error: 'unknown_type', normalized };

  const warnings: ReceivedNcfWarning[] = [];
  if (NO_CREDIT.has(type)) warnings.push('no_tax_credit');
  if (spec.purpose === 'CREDIT_NOTE') warnings.push('credit_note_on_bill');
  if (NOT_RECEIVED.has(type)) warnings.push('sales_only_type');

  const selfIssued = spec.side === 'purchase';
  return {
    ok: true,
    ncf: {
      normalized,
      type,
      electronic: spec.isElectronic,
      selfIssued,
      requiresSupplierTaxId: !NO_SUPPLIER_TAX_ID.has(type),
      warnings,
    },
  };
}

/** The NCF printed on the supplier's comprobante, checked against the DGII's rules. */
function checkComprobante(raw: string): ReceivedDocumentCheck {
  const text = (raw ?? '').trim();
  if (!text) return receivedDocumentResult('NCF', { status: 'missing' });
  const checked = checkReceivedNcf(text);
  return checked.ok
    ? receivedDocumentResult('NCF', {
        normalized: checked.ncf.normalized,
        type: checked.ncf.type,
        warnings: checked.ncf.warnings,
        requiresSupplierTaxId: checked.ncf.requiresSupplierTaxId,
      })
    : receivedDocumentResult('NCF', { status: 'invalid', normalized: checked.normalized ?? normalizeNcf(text), error: checked.error });
}

const RECEIVED_DOCUMENT: MarketReceivedDocument = {
  kind: 'NCF',
  labelKey: 'localization.country_pack.supplier_document.ncf',
  description: 'the NCF / e-NCF: B + 2 digits + 8 digits (11 characters) or E + 2 digits + 10 digits (13 characters), often labelled "NCF", "e-NCF" or "Comprobante"',
  example: 'B0100000001',
  check: checkComprobante,
};

/**
 * What the 606 asks of every purchase besides its figures: what was bought, and what income tax was
 * withheld from the supplier. Without the first the return cannot be produced at all.
 *
 * The codes and their meanings are the ones this product has been filing with — moved here verbatim
 * from the `PurchaseCategory` and `IsrRetentionType` enums of `vendor_bills`, because they are on
 * every purchase already recorded and renumbering them would restate what was declared.
 *
 * *Verificar con contabilidad/legal*: la DGII publica estos catálogos en la Norma General 07-2018
 * («Formato de Envío 606»), y la lista de tipos de bienes y servicios de esa norma puede no coincidir
 * con estas doce entradas. Confirmar código por código antes de la próxima declaración; corregirlos
 * exige además decidir qué hacer con las compras ya clasificadas.
 */
const FISCAL_ATTRIBUTES: readonly FiscalFieldSpec[] = [
  {
    key: 'purchaseCategory',
    label: 'Tipo de bienes y servicios comprados',
    labelKey: 'localization.country_pack.purchase_attribute.purchase_category',
    required: true,
    type: 'select',
    help: 'Clasifica la compra para el 606. Sin este dato la declaración no se puede generar.',
    helpKey: 'localization.country_pack.purchase_attribute.purchase_category_help',
    options: [
      { code: '01', label: 'Gastos de personal', labelKey: 'accounts_payable.purchase_category.personnel_expenses' },
      { code: '02', label: 'Gastos por trabajos, suministros y servicios', labelKey: 'accounts_payable.purchase_category.work_goods_services' },
      { code: '03', label: 'Arrendamientos', labelKey: 'accounts_payable.purchase_category.leasing' },
      { code: '04', label: 'Arrendamiento de activos fijos', labelKey: 'accounts_payable.purchase_category.fixed_asset_leasing' },
      { code: '05', label: 'Gastos de mejoras', labelKey: 'accounts_payable.purchase_category.improvement_expenses' },
      { code: '06', label: 'Compras de mercancías', labelKey: 'accounts_payable.purchase_category.merchandise_purchases' },
      { code: '07', label: 'Servicios conexos', labelKey: 'accounts_payable.purchase_category.related_services' },
      { code: '08', label: 'Gastos financieros', labelKey: 'accounts_payable.purchase_category.financial_expenses' },
      { code: '09', label: 'Gastos extraordinarios', labelKey: 'accounts_payable.purchase_category.extraordinary_expenses' },
      { code: '10', label: 'Costo de ventas', labelKey: 'accounts_payable.purchase_category.cost_of_sales' },
      { code: '11', label: 'Adquisición de activos', labelKey: 'accounts_payable.purchase_category.asset_acquisitions' },
      { code: '12', label: 'Gastos de seguros', labelKey: 'accounts_payable.purchase_category.insurance_expenses' },
    ],
  },
  {
    key: 'isrRetentionType',
    label: 'Tipo de retención en ISR',
    labelKey: 'localization.country_pack.purchase_attribute.isr_retention_type',
    required: false,
    type: 'select',
    help: 'Solo cuando se le retuvo impuesto sobre la renta al proveedor.',
    helpKey: 'localization.country_pack.purchase_attribute.isr_retention_type_help',
    options: [
      { code: '01', label: 'Alquileres', labelKey: 'accounts_payable.isr_retention_type.rentals' },
      { code: '02', label: 'Honorarios por servicios', labelKey: 'accounts_payable.isr_retention_type.service_fees' },
      { code: '03', label: 'Otras rentas', labelKey: 'accounts_payable.isr_retention_type.other_income' },
      { code: '04', label: 'Rentas presuntas', labelKey: 'accounts_payable.isr_retention_type.presumed_income' },
      { code: '05', label: 'Bienes muebles no declarados', labelKey: 'accounts_payable.isr_retention_type.undeclared_movable_property' },
      { code: '06', label: 'Otros', labelKey: 'accounts_payable.isr_retention_type.other' },
    ],
  },
];

/** Dominican Republic: what a supplier's document carries, and how a purchase is recorded. */
export const purchases: MarketPurchases = {
  supplierFiscalNumber: true,
  purchaseClassification: true,
  receivedDocument: RECEIVED_DOCUMENT,
  fiscalAttributes: FISCAL_ATTRIBUTES,
};
