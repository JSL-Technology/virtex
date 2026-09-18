/**
 * The fiscal document types each authority publishes, as data.
 *
 * ## What this replaces
 *
 * `ncf_sequences.type` and `ecf_lifecycle_messages.ecf_type` were PostgreSQL enums of `NcfType` —
 * `B01`…`E47`, the DGII's own comprobante codes — in modules (`compliance`, `einvoicing`) that
 * are not scoped to the Dominican Republic by anything but habit. Peru's `01`/`03`/`07`/`08`,
 * Chile's DTE `33`/`34`/`61` and Mexico's `I`/`E`/`P` were not expressible, and adding them meant
 * `ALTER TYPE … ADD VALUE`: a migration and a deploy per market.
 *
 * Meanwhile `fiscal_document_type_definitions` — a table with `code`, `name`, `sequenceFormat` and
 * `expirationRequired`, related to `fiscal_regions`, present since the baseline schema — had never
 * been written to or read from. The shape was right and nothing used it.
 *
 * ## The invoicing module already made this decision
 *
 * `FiscalDocumentTypeOption` in `invoices/interfaces/fiscal-adapter.interface.ts` records that the
 * document type stopped being an `NcfType` and became a plain string owned by the market's
 * adapter, precisely because "an interface that can only describe one country's codes is an
 * interface that resolves every other country to the generic adapter". This finishes that change
 * at the persistence layer, which is where it was left undone.
 *
 * ## What is seeded, and what is not
 *
 * The Dominican set, because this repository already holds it in full — the codes, which are
 * electronic, which are issuable as a sale and which credit an earlier document are all declared
 * in `ncf-sequence.entity.ts` and covered by its tests. **Nothing else is invented here.** The
 * other markets' document types are known to their regime adapters and belong beside them; adding
 * them is rows in this file or, for an operator, rows in the table. What is no longer true is that
 * adding them needs a schema migration.
 */

/** Which side of the ledger a document type belongs to. */
export type FiscalDocumentSide = 'sales' | 'purchase' | 'either';

export interface FiscalDocumentTypeSpec {
  /** ISO 3166-1 alpha-2 of the authority that publishes the code. */
  countryCode: string;
  /** The authority's own code, written verbatim into the document: `E31`, `01`, `33`, `55`. */
  code: string;
  /** Catalogue key. Never a Spanish literal: `name` on the row is a fallback, not a label. */
  labelKey: string;
  /** The authority's own name for the type, for support and for the row's `name` column. */
  name: string;
  /** Mask for the number drawn from a range of this type, where the authority fixes one. */
  sequenceFormat: string | null;
  /** True when a range of this type carries an expiry the document must state. */
  expirationRequired: boolean;
  /**
   * True when the type must be signed and transmitted to the authority.
   *
   * Dominican `E*` codes are e-CF; `B*` are the pre-printed contingency series.
   */
  isElectronic: boolean;
  side: FiscalDocumentSide;
  /** True when the type credits a previously issued document. */
  isCreditNote: boolean;
  /**
   * True when the buyer's tax identifier is mandatory.
   *
   * Only the Factura de Crédito Fiscal entitles the buyer to the ITBIS credit, and it is the one
   * type the DGII refuses without a valid RNC or cédula.
   */
  requiresBuyerTaxId: boolean;
  sortOrder: number;
}

/**
 * Dominican Republic — DGII.
 *
 * `B*` are the legacy pre-printed comprobantes, still valid for contingency. `E*` are the e-CF
 * series, whose two trailing digits are the DGII's document-type code.
 */
const DOMINICAN_DOCUMENT_TYPES: readonly FiscalDocumentTypeSpec[] = [
  { countryCode: 'DO', code: 'B01', labelKey: 'fiscal.do.B01', name: 'Factura de Crédito Fiscal', sequenceFormat: 'B01########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: false, requiresBuyerTaxId: true, sortOrder: 10 },
  { countryCode: 'DO', code: 'B02', labelKey: 'fiscal.do.B02', name: 'Factura de Consumo', sequenceFormat: 'B02########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 20 },
  { countryCode: 'DO', code: 'B03', labelKey: 'fiscal.do.B03', name: 'Nota de Débito', sequenceFormat: 'B03########', expirationRequired: true, isElectronic: false, side: 'either', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 30 },
  { countryCode: 'DO', code: 'B04', labelKey: 'fiscal.do.B04', name: 'Nota de Crédito', sequenceFormat: 'B04########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 40 },
  { countryCode: 'DO', code: 'B11', labelKey: 'fiscal.do.B11', name: 'Comprobante de Compras', sequenceFormat: 'B11########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 50 },
  { countryCode: 'DO', code: 'B15', labelKey: 'fiscal.do.B15', name: 'Comprobante Gubernamental', sequenceFormat: 'B15########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: false, requiresBuyerTaxId: true, sortOrder: 60 },

  { countryCode: 'DO', code: 'E31', labelKey: 'fiscal.do.E31', name: 'Factura de Crédito Fiscal Electrónica', sequenceFormat: 'E31##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: true, sortOrder: 110 },
  { countryCode: 'DO', code: 'E32', labelKey: 'fiscal.do.E32', name: 'Factura de Consumo Electrónica', sequenceFormat: 'E32##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 120 },
  { countryCode: 'DO', code: 'E33', labelKey: 'fiscal.do.E33', name: 'Nota de Débito Electrónica', sequenceFormat: 'E33##########', expirationRequired: true, isElectronic: true, side: 'either', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 130 },
  { countryCode: 'DO', code: 'E34', labelKey: 'fiscal.do.E34', name: 'Nota de Crédito Electrónica', sequenceFormat: 'E34##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 140 },
  // Self-issued against a supplier, and therefore Accounts Payable's rather than invoicing's.
  // Offering them on a sales document produces a comprobante the DGII rejects.
  { countryCode: 'DO', code: 'E41', labelKey: 'fiscal.do.E41', name: 'Compras Electrónico', sequenceFormat: 'E41##########', expirationRequired: true, isElectronic: true, side: 'purchase', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 150 },
  { countryCode: 'DO', code: 'E43', labelKey: 'fiscal.do.E43', name: 'Gastos Menores Electrónico', sequenceFormat: 'E43##########', expirationRequired: true, isElectronic: true, side: 'purchase', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 160 },
  { countryCode: 'DO', code: 'E44', labelKey: 'fiscal.do.E44', name: 'Regímenes Especiales Electrónico', sequenceFormat: 'E44##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 170 },
  { countryCode: 'DO', code: 'E45', labelKey: 'fiscal.do.E45', name: 'Gubernamental Electrónico', sequenceFormat: 'E45##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: true, sortOrder: 180 },
  { countryCode: 'DO', code: 'E46', labelKey: 'fiscal.do.E46', name: 'Exportaciones Electrónico', sequenceFormat: 'E46##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 190 },
  { countryCode: 'DO', code: 'E47', labelKey: 'fiscal.do.E47', name: 'Pagos al Exterior Electrónico', sequenceFormat: 'E47##########', expirationRequired: true, isElectronic: true, side: 'purchase', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 200 },
];

/**
 * The other markets' document types — the codes their regime adapters ALREADY emit.
 *
 * These are not invented (C-04). Each is the value a `documentType()` in `einvoicing/regimes/`
 * writes into the stamped document today, transcribed here so the code lives as data beside the
 * others instead of only inside a `switch`: Brazil's `55`, Peru's `01`/`03`/`07`, Mexico's `I`/`E`,
 * Colombia's `01`/`91`, Chile's `33`/`34`/`61`, Ecuador's `01`/`04`, Argentina's `1`…`13`.
 *
 * Two columns are deliberately left unconfirmed: `sequenceFormat` (null) and `expirationRequired`
 * (false). The exact mask a series takes and whether the authorisation is time-boxed are facts to
 * confirm with each authority, and the report is explicit that inventing them is worse than leaving
 * them open. `name` carries the authority's own wording as the label fallback until each market's
 * `fiscal.<cc>.*` keys are translated. `side` is `sales` for all of these: every code above is one
 * a `documentType()` emits on an invoice; the buyer-document codes (Ecuador's `05`, Argentina's
 * `80`) are a different axis and are not document types.
 */
const BRAZIL_DOCUMENT_TYPES: readonly FiscalDocumentTypeSpec[] = [
  { countryCode: 'BR', code: '55', labelKey: 'fiscal.br.55', name: 'Nota Fiscal Eletrônica (NF-e)', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 10 },
];

const PERU_DOCUMENT_TYPES: readonly FiscalDocumentTypeSpec[] = [
  { countryCode: 'PE', code: '01', labelKey: 'fiscal.pe.01', name: 'Factura', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 10 },
  { countryCode: 'PE', code: '03', labelKey: 'fiscal.pe.03', name: 'Boleta de Venta', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 20 },
  { countryCode: 'PE', code: '07', labelKey: 'fiscal.pe.07', name: 'Nota de Crédito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 30 },
];

const MEXICO_DOCUMENT_TYPES: readonly FiscalDocumentTypeSpec[] = [
  { countryCode: 'MX', code: 'I', labelKey: 'fiscal.mx.I', name: 'CFDI de Ingreso', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 10 },
  { countryCode: 'MX', code: 'E', labelKey: 'fiscal.mx.E', name: 'CFDI de Egreso', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 20 },
];

const COLOMBIA_DOCUMENT_TYPES: readonly FiscalDocumentTypeSpec[] = [
  { countryCode: 'CO', code: '01', labelKey: 'fiscal.co.01', name: 'Factura de Venta', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 10 },
  { countryCode: 'CO', code: '91', labelKey: 'fiscal.co.91', name: 'Nota Crédito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 20 },
];

const CHILE_DOCUMENT_TYPES: readonly FiscalDocumentTypeSpec[] = [
  { countryCode: 'CL', code: '33', labelKey: 'fiscal.cl.33', name: 'Factura Electrónica', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 10 },
  { countryCode: 'CL', code: '34', labelKey: 'fiscal.cl.34', name: 'Factura No Afecta o Exenta Electrónica', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 20 },
  { countryCode: 'CL', code: '61', labelKey: 'fiscal.cl.61', name: 'Nota de Crédito Electrónica', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 30 },
];

const ECUADOR_DOCUMENT_TYPES: readonly FiscalDocumentTypeSpec[] = [
  { countryCode: 'EC', code: '01', labelKey: 'fiscal.ec.01', name: 'Factura', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 10 },
  { countryCode: 'EC', code: '04', labelKey: 'fiscal.ec.04', name: 'Nota de Crédito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 20 },
];

const ARGENTINA_DOCUMENT_TYPES: readonly FiscalDocumentTypeSpec[] = [
  { countryCode: 'AR', code: '1', labelKey: 'fiscal.ar.1', name: 'Factura A', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 10 },
  { countryCode: 'AR', code: '3', labelKey: 'fiscal.ar.3', name: 'Nota de Crédito A', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 20 },
  { countryCode: 'AR', code: '6', labelKey: 'fiscal.ar.6', name: 'Factura B', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 30 },
  { countryCode: 'AR', code: '8', labelKey: 'fiscal.ar.8', name: 'Nota de Crédito B', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 40 },
  { countryCode: 'AR', code: '11', labelKey: 'fiscal.ar.11', name: 'Factura C', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 50 },
  { countryCode: 'AR', code: '13', labelKey: 'fiscal.ar.13', name: 'Nota de Crédito C', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 60 },
];

export const FISCAL_DOCUMENT_TYPES: readonly FiscalDocumentTypeSpec[] = Object.freeze([
  ...DOMINICAN_DOCUMENT_TYPES,
  ...BRAZIL_DOCUMENT_TYPES,
  ...PERU_DOCUMENT_TYPES,
  ...MEXICO_DOCUMENT_TYPES,
  ...COLOMBIA_DOCUMENT_TYPES,
  ...CHILE_DOCUMENT_TYPES,
  ...ECUADOR_DOCUMENT_TYPES,
  ...ARGENTINA_DOCUMENT_TYPES,
]);

/** Every declared type for a country, in the order a form should offer them. */
export function fiscalDocumentTypesFor(countryCode: string): FiscalDocumentTypeSpec[] {
  const country = (countryCode ?? '').trim().toUpperCase();
  return FISCAL_DOCUMENT_TYPES.filter((spec) => spec.countryCode === country).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}
