/**
 * Who withholds what, from whom, and on what authority.
 *
 * ## Why the rate cannot come from the request
 *
 * `taxWithholdingRate` and `incomeTaxWithholdingRate` arrived on the create-invoice DTO as any
 * fraction between 0 and 1, and the engine checked only that range. Withholding is not a
 * commercial term the parties agree on: it is a legal obligation whose rate is set by the payer's
 * status, the payee's status, and what is being sold. A seller who under-withholds owes the
 * difference plus penalties; one who over-withholds has taken money from the buyer it had no
 * authority to take. Either way the figure is not the invoicing clerk's to choose, and a field the
 * client fills in is a field an integration fills in wrongly.
 *
 * The consumption-tax rate was already handled correctly — derived from the tenant's catalogue and
 * validated against `COUNTRY_TAX_SCHEMES`. This is the same treatment for the withholdings.
 *
 * ## What this table is, and what it deliberately is not
 *
 * It is the set of regimes this product will apply **on its own initiative**, each with the
 * instrument that establishes it. It is not a complete withholding code for any country: a
 * complete one does not fit in a table, because in several of these markets the rate depends on
 * the municipality (ReteICA in Colombia), the activity code, the good or service (detracciones in
 * Peru), or a taxpayer classification the tax authority assigns and publishes.
 *
 * Where that is the case the country is marked `configurationRequired` and the product applies
 * **nothing** by default: the tenant configures its own regimes, or states the rate per document
 * as a recorded exception. A plausible-looking default in this table would be a wrong filing
 * signed by the tenant.
 *
 * Every rate below must be confirmed against the tenant's own tax advice before it is relied on —
 * rates change by decree between releases, and a taxpayer's classification is a fact about that
 * taxpayer, not about this software. `legalBasis` names the instrument so the confirmation is a
 * lookup rather than a research project, and `TenantWithholdingRegime` lets an accountant amend or
 * add regimes without waiting for a release.
 */

/** What the withholding is levied on. */
export type WithholdingKind =
  /** A share of the output consumption tax on the document (ITBIS/IVA/IGV retenido). */
  | 'VAT'
  /** A share of the taxable base, on account of the seller's income tax (ISR/ReteFuente). */
  | 'INCOME';

/**
 * The buyer's fiscal classification — the fact that decides whether they withhold.
 *
 * Assigned by the tax authority, not inferred by this product: a company is a designated
 * withholding agent because it appears on the authority's list, and no amount of information on
 * the customer record can establish that. It is recorded on the customer and confirmed by the
 * tenant.
 */
export enum TaxpayerType {
  /** Persona física / natural person, not registered as a business. */
  INDIVIDUAL = 'INDIVIDUAL',
  /** Persona jurídica / company, ordinary regime. */
  COMPANY = 'COMPANY',
  /**
   * A taxpayer the authority has designated a withholding agent — gran contribuyente,
   * contribuyente especial, grande contribuinte. The designation is published; it is not derived
   * from size.
   */
  WITHHOLDING_AGENT = 'WITHHOLDING_AGENT',
  /** The State and its dependencies, which withhold on their own account. */
  GOVERNMENT = 'GOVERNMENT',
  /** A buyer outside the country. Exports are generally zero-rated and nothing is withheld here. */
  FOREIGN = 'FOREIGN',
}

/** What is being sold, which several regimes distinguish. */
export type WithholdingScope = 'SERVICES' | 'GOODS' | 'ANY';

export interface WithholdingRegime {
  /** Stable identifier recorded on the document, so a filing can be traced to the rule applied. */
  code: string;
  kind: WithholdingKind;
  /**
   * As a fraction. For `VAT`, of the output tax on the document; for `INCOME`, of the taxable
   * base.
   */
  rate: number;
  /** The buyer classifications this regime applies to. */
  payers: TaxpayerType[];
  /** The seller classifications it applies to. Empty means any. */
  payees?: TaxpayerType[];
  scope: WithholdingScope;
  /** What the tenant sees, in the country's own terminology. */
  label: string;
  /** The instrument that establishes it, so the tenant's advisor can confirm it in one lookup. */
  legalBasis: string;
}

export interface CountryWithholdingScheme {
  regimes: WithholdingRegime[];
  /**
   * True when the country's withholding cannot be expressed as a national table, and the product
   * must therefore apply nothing until the tenant configures its own.
   */
  configurationRequired: boolean;
  /** Shown to the tenant when `configurationRequired`, naming precisely what has to be set up. */
  configurationNote?: string;
}

/**
 * The Dominican Republic is the market whose regimes this product applies by default, because it
 * is the market whose fiscal package it implements end to end (e-CF, NCF, 606/607/608/609).
 *
 * The four regimes below are the ones that arise on an ordinary sales invoice. Withholding on
 * dividends, on payments abroad, and the rates that apply to specific professions are not here:
 * they are not sales-invoice events, and inventing entries for them would put rates in front of a
 * user for transactions this document cannot represent.
 */
const DOMINICAN_REPUBLIC: CountryWithholdingScheme = {
  configurationRequired: false,
  regimes: [
    {
      code: 'DO-ITBIS-100-PF',
      kind: 'VAT',
      rate: 1,
      payers: [TaxpayerType.COMPANY, TaxpayerType.WITHHOLDING_AGENT],
      payees: [TaxpayerType.INDIVIDUAL],
      scope: 'SERVICES',
      label: 'ITBIS retenido 100 % — servicios prestados por persona física',
      legalBasis: 'Norma General 02-05, art. 2 (DGII)',
    },
    {
      code: 'DO-ITBIS-30-ESTADO',
      kind: 'VAT',
      rate: 0.3,
      payers: [TaxpayerType.GOVERNMENT],
      scope: 'ANY',
      label: 'ITBIS retenido 30 % — pagos del Estado a proveedores',
      legalBasis: 'Ley 253-12, art. 25; Norma General 07-09 (DGII)',
    },
    {
      code: 'DO-ISR-10-SERV-PF',
      kind: 'INCOME',
      rate: 0.1,
      payers: [TaxpayerType.COMPANY, TaxpayerType.WITHHOLDING_AGENT, TaxpayerType.GOVERNMENT],
      payees: [TaxpayerType.INDIVIDUAL],
      scope: 'SERVICES',
      label: 'ISR retenido 10 % — honorarios y servicios de persona física',
      legalBasis: 'Ley 11-92 (Código Tributario), art. 309',
    },
    {
      code: 'DO-ISR-5-ESTADO',
      kind: 'INCOME',
      rate: 0.05,
      payers: [TaxpayerType.GOVERNMENT],
      payees: [TaxpayerType.COMPANY, TaxpayerType.WITHHOLDING_AGENT],
      scope: 'ANY',
      label: 'ISR retenido 5 % — pagos del Estado a personas jurídicas',
      legalBasis: 'Ley 11-92, art. 309, párrafo; Ley 253-12',
    },
  ],
};

/**
 * A market whose withholding this product will not guess at.
 *
 * Each of these has withholding — in some of them a great deal of it — and in each the rate turns
 * on something this software does not and cannot know: the municipality, the activity code, the
 * good or service being sold, or a classification the authority assigns per taxpayer. The tenant
 * configures its own regimes, and until it does, nothing is withheld automatically and a rate
 * stated on a document is a recorded exception rather than a silent default.
 */
const configureLocally = (note: string): CountryWithholdingScheme => ({
  configurationRequired: true,
  configurationNote: note,
  regimes: [],
});

export const COUNTRY_WITHHOLDING_SCHEMES: Readonly<Record<string, CountryWithholdingScheme>> = {
  DO: DOMINICAN_REPUBLIC,

  CO: configureLocally(
    'En Colombia la ReteFuente depende del concepto y de la calidad del beneficiario, la ReteIVA ' +
      'de si el pagador es agente de retención, y la ReteICA de la actividad y del municipio donde ' +
      'se realiza el hecho generador. Configura los conceptos y tarifas que apliquen a tu ' +
      'actividad y a los municipios donde tributas antes de facturar con retención.',
  ),

  PE: configureLocally(
    'En Perú el régimen de retenciones del IGV aplica sólo a los agentes de retención designados ' +
      'por la SUNAT, y las detracciones dependen del bien o servicio y de su código en el Anexo ' +
      'correspondiente. Configura los regímenes que la SUNAT te haya designado.',
  ),

  MX: configureLocally(
    'En México la retención de IVA e ISR depende del tipo de servicio (honorarios, arrendamiento, ' +
      'autotransporte, servicios profesionales) y de si el receptor es persona moral. El CFDI ' +
      'exige declarar cada retención con su impuesto y su base. Configura los supuestos que ' +
      'apliquen a tus operaciones.',
  ),

  AR: configureLocally(
    'En Argentina las retenciones de IVA y de Ganancias dependen del régimen en que la AFIP ' +
      'inscribió al pagador y de la condición del beneficiario, y las percepciones de Ingresos ' +
      'Brutos dependen de la jurisdicción. Configura los regímenes en los que estés designado.',
  ),

  CL: configureLocally(
    'En Chile la retención aplica a las boletas de honorarios y a los cambios de sujeto que el SII ' +
      'establece por resolución para determinados productos. Configura los que te apliquen.',
  ),

  EC: configureLocally(
    'En Ecuador la retención en la fuente de IVA y de Renta depende del tipo de contribuyente del ' +
      'agente de retención y del bien o servicio. Configura los porcentajes vigentes conforme al ' +
      'SRI.',
  ),

  BR: configureLocally(
    'No Brasil a retenção de PIS/COFINS/CSLL, do INSS e do ISS depende do serviço prestado, do ' +
      'município e do regime tributário do prestador. Configure as retenções conforme o seu ' +
      'enquadramento antes de emitir com retenção.',
  ),

  US: configureLocally(
    'United States sales invoices do not carry withholding; backup withholding and non-resident ' +
      'withholding are payment-level obligations reported on Forms 1099 and 1042-S, not on the ' +
      'invoice. Nothing is withheld automatically.',
  ),
};

export function findWithholdingScheme(
  countryCode: string | null | undefined,
): CountryWithholdingScheme | undefined {
  return COUNTRY_WITHHOLDING_SCHEMES[countryCode?.toUpperCase() ?? ''];
}

/**
 * The regimes that apply to a sale, given who is buying, who is selling and what is being sold.
 *
 * Returns at most one of each kind: a document cannot be subject to two rates of the same
 * withholding at once, and where the table would allow it the more specific rule — the one that
 * names the payee's classification — wins over the general one.
 */
export function applicableRegimes(
  scheme: CountryWithholdingScheme | undefined,
  context: { payer: TaxpayerType; payee: TaxpayerType; scope: Exclude<WithholdingScope, 'ANY'> },
): WithholdingRegime[] {
  if (!scheme || scheme.configurationRequired) return [];

  const matches = scheme.regimes.filter(
    (regime) =>
      regime.payers.includes(context.payer) &&
      (regime.payees === undefined || regime.payees.includes(context.payee)) &&
      (regime.scope === 'ANY' || regime.scope === context.scope),
  );

  const bestOf = (kind: WithholdingKind): WithholdingRegime | undefined => {
    const ofKind = matches.filter((regime) => regime.kind === kind);
    if (ofKind.length <= 1) return ofKind[0];
    // The rule that names the payee is the specific one; the one that does not is the fallback.
    return ofKind.sort((a, b) => Number(Boolean(b.payees)) - Number(Boolean(a.payees)))[0];
  };

  return [bestOf('VAT'), bestOf('INCOME')].filter(
    (regime): regime is WithholdingRegime => regime !== undefined,
  );
}
