/**
 * How a market identifies people and taxpayers: the documents it issues, the arithmetic that
 * checks them, and the registration data its authority requires beyond name, identifier and
 * address.
 */

/**
 * Whether the taxpayer is a legal entity or a natural person.
 *
 * Several markets issue a different identifier to each — an EIN versus an SSN/ITIN, a CNPJ versus a
 * CPF, an RNC versus a cédula — and several more encode the distinction inside one identifier (an
 * RFC's length, a CUIT's prefix, a RIF's type letter). Without it a validator has to accept the
 * union of both schemes, which is materially weaker.
 */
export enum TaxpayerKind {
  COMPANY = 'company',
  INDIVIDUAL = 'individual',
}

/** {@link TaxpayerKind} as its string values, for data that travels through JSON. */
export type TaxpayerKindValue = `${TaxpayerKind}`;

/** Who a document identifies. Ternary, not boolean: a Chilean RUT identifies both. */
export type DocumentAppliesTo = 'individual' | 'company' | 'both';

/** Whether the market requires the document where it is used. Absence of a row means "not issued". */
export type DocumentRequirement = 'required' | 'optional';

/**
 * Where in the product a document is asked for. A Mexican employee is identified by a CURP and a
 * Mexican invoice by an RFC; neither substitutes for the other, and a catalogue with no notion of
 * context would offer the wrong one on each form.
 */
export type DocumentContext = 'payroll' | 'invoicing' | 'registration';

/**
 * How the value is normalised before it is stored and compared. A string union rather than a
 * function because it travels through a database column (`identity_document_types.canonical_form`).
 */
export type CanonicalForm = 'digits' | 'alphanumeric' | 'segmented';

/** A check that takes any string and answers. Total: it never throws. */
export type ChecksumAlgorithm = (value: string) => boolean;

/**
 * One identity document a market issues.
 *
 * A document type is `(country, code)`; everything else is an attribute of that pair. A «cédula»
 * is not one thing: the Dominican one is eleven digits with a Luhn check, the Colombian one six to
 * ten digits with none, and the Costa Rican one a tax identifier.
 */
export interface IdentityDocumentTypeSpec {
  /** ISO 3166-1 alpha-2 of the ISSUING jurisdiction, or `XX` for a supranational document. */
  countryCode: string;
  /** The authority's own code, declared explicitly and never derived from the label. */
  code: string;
  /** Catalogue key. The label is never stored as a word. */
  labelKey: string;
  /**
   * Terminology that must not be translated, because it is what the authority prints on the paper
   * the user copies from. «CUIT» glossed as «tax number» is harder to find, not easier.
   */
  labelVerbatim?: string;
  /** Placeholder. Shaped like a real value, never a real issued identifier. */
  example?: string;
  /** Anchored on both ends. Shape only — the authoritative check is `checksum`, server-side. */
  pattern: string;
  /** Name of a check in the catalogue's algorithms. Null means the pattern is the whole check. */
  checksum: string | null;
  canonicalForm: CanonicalForm;
  appliesTo: DocumentAppliesTo;
  requirement: DocumentRequirement;
  usedFor: readonly DocumentContext[];
  /** At most one default per (country, appliesTo, context). */
  isDefault?: boolean;
  issuingAuthority?: string;
  sortOrder: number;
  /**
   * Kind-specific checks, for an identifier whose company-versus-person distinction lives inside
   * the value: an RFC's length, a CUIT's prefix, a RUC's third digit, a RIF's type letter.
   */
  kindChecksums?: Readonly<Partial<Record<TaxpayerKindValue, string>>>;
  /**
   * This document's code in an electronic-invoicing regime, keyed by a tag the regime owns, so a
   * builder states the buyer's document type without inferring it from the number's length.
   */
  regimeCodes?: Readonly<Record<string, string>>;
}

/** A document as its market declares it: the market's code is implied, so it cannot be mistyped. */
export type MarketIdentityDocument = Omit<IdentityDocumentTypeSpec, 'countryCode'>;

/** One entry of a tax authority's published catalogue. */
export interface FiscalFieldOption {
  /** The code as the authority publishes it. Stored verbatim; it goes on the document. */
  code: string;
  label: string;
  /**
   * Catalogue key of `label` where the label describes an ordinary category the reader needs in
   * their language. Absent for an authority's coded catalogue entry, whose exact wording is what the
   * filing is validated against.
   */
  labelKey?: string;
  /** Restrict the option to one kind of taxpayer, where the catalogue does. */
  appliesTo?: readonly TaxpayerKindValue[];
}

/**
 * A fiscal datum the market's authority requires from a taxpayer beyond name, identifier and
 * address: Mexico's `RegimenFiscal`, Argentina's VAT condition and point of sale, Colombia's
 * `responsabilidades fiscales`, Brazil's CRT and state registration. Declared as data so the signup
 * form renders it and the server validates it from one source.
 */
export interface FiscalFieldSpec {
  /** Key under which the answer is stored in `organizations.fiscal_profile`. */
  key: string;
  /** The market's own words for the field. */
  label: string;
  /**
   * Catalogue key of `label` where it describes a kind of value (Tax regime, Point of sale); absent
   * where it is the authority's own term (Ubigeo, Inscrição Estadual), which stays untranslated.
   */
  labelKey?: string;
  /** Shown under the field. Explains why the authority needs it. */
  help?: string;
  /** Catalogue key of `help`. An explanation nobody can read explains nothing. */
  helpKey?: string;
  required: boolean;
  type: 'select' | 'text';
  /** True when the authority admits several answers at once (Colombia's responsibilities). */
  multiple?: boolean;
  /** For `select`. Codes are the authority's own. */
  options?: readonly FiscalFieldOption[];
  /** For `text`. Anchored on both ends by the validator. */
  pattern?: string;
  /** Placeholder, and the shape a support agent will recognise. */
  example?: string;
  /** Restrict the whole field to one kind of taxpayer. */
  appliesTo?: readonly TaxpayerKindValue[];
}

export interface MarketIdentity {
  /** Every identity document the market issues. The passport is offered everywhere by the catalogue. */
  documents: readonly MarketIdentityDocument[];
  /**
   * The checks this market's documents cite, by name. Names are persisted in
   * `identity_document_types.checksum`, so renaming one orphans every row that cites it: they are
   * prefixed with the market's code and treated as a column name.
   */
  checksums: Readonly<Record<string, ChecksumAlgorithm>>;
  /**
   * The checks among `checksums` that test structure only (length, shape, assigned prefixes) and
   * carry no check digit. A form may only claim what is actually checked.
   */
  structuralChecks: readonly string[];
  /** Registration data the authority requires. Empty where it requires none. */
  fiscalFields: readonly FiscalFieldSpec[];
  /**
   * The code this market's e-invoicing regime gives a document no single state issues — a
   * passport — by document code, then by regime tag. A passport is `06` to one authority and `41`
   * to another; the passport itself names neither, the markets do.
   */
  supranationalRegimeCodes: Readonly<Record<string, Readonly<Record<string, string>>>>;
}
