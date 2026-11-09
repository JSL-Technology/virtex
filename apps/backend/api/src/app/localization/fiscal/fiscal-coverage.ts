import { cancellationCoverageFor, fiscalAuthorityOf } from './document-cancellation';
/**
 * What this product actually does in each market, stated in the product.
 *
 * ## Why a table and not a boolean
 *
 * `marketStatus` was `available` or `preview`, and the audit's finding was that the second told a
 * customer almost nothing: everything else in the ERP works, so "preview" reads as "coming soon"
 * rather than "you can keep books here and you cannot issue a stamped document". A Mexican tenant
 * was shown the CFDI 4.0 requirement, had their RFC validated, paid — and got a fiscal adapter
 * that returned nulls.
 *
 * So the coverage is stated per capability, per market, and it is the same table the signup
 * disclosure, the settings page and the fiscal adapter read. One statement, in one place, which
 * cannot drift from what the code does because the code reads it.
 *
 * ## What each level means
 *
 * - `implemented` — built, tested, and reachable in the product.
 * - `needs-credentials` — built and tested, and the last step needs something only the taxpayer
 *   can supply: their certificate, their PAC contract, their homologation with the authority.
 *   This is not a euphemism for unfinished: it is the true state of every e-invoicing regime in
 *   every product, including the Dominican one that has been in production the longest.
 * - `needs-configuration` — built, and it cannot run until the tenant's own data says something only
 *   they can decide: the SAT grouping code of each account, say. Declaring it `implemented` told a
 *   Mexican tenant the Anexo 24 worked when a fresh tenant got a 400 (audit 2026-10-31, LOC-01).
 * - `not-implemented` — not built. Said plainly rather than dressed as a preview.
 */
export type CoverageLevel = 'implemented' | 'needs-credentials' | 'needs-configuration' | 'not-implemented';

export interface CapabilityCoverage {
  /** Stable key, for the UI to translate. */
  capability:
    | 'accounting'
    | 'taxDetermination'
    | 'electronicInvoicing'
    | 'periodicReturns'
    | 'electronicAccounting'
    | 'withholding'
    | 'payroll'
    | 'debitNotes'
    | 'documentCancellation';
  level: CoverageLevel;
  /** The regime or filing this refers to, in the authority's own words. */
  detail?: string;
  /** What the tenant must supply, when the level is `needs-credentials`. */
  requires?: string;
}

export interface MarketCoverage {
  countryCode: string;
  capabilities: CapabilityCoverage[];
}

/** Bookkeeping works everywhere: it is the part of the product that is not country-specific. */
const accounting: CapabilityCoverage = {
  capability: 'accounting',
  level: 'implemented',
  detail: 'Contabilidad, inventario, compras, tesorería y reportes financieros',
};

const noWithholding: CapabilityCoverage = {
  capability: 'withholding',
  level: 'needs-credentials',
  detail: 'Regímenes configurables por el contribuyente',
  requires: 'los regímenes y tarifas que te apliquen, en Ajustes → Impuestos',
};

const einvoicing = (detail: string, requires: string): CapabilityCoverage => ({
  capability: 'electronicInvoicing',
  level: 'needs-credentials',
  detail,
  requires,
});

const notImplemented = (
  capability: CapabilityCoverage['capability'],
  detail?: string,
): CapabilityCoverage => ({ capability, level: 'not-implemented', detail });

export const FISCAL_COVERAGE: Readonly<Record<string, MarketCoverage>> = {
  DO: {
    countryCode: 'DO',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'ITBIS 18 % / 16 % / exento' },
      einvoicing('DGII e-CF', 'tu certificado digital de la DGII'),
      { capability: 'periodicReturns', level: 'implemented', detail: 'Formatos 606, 607, 608 y 609' },
      // Declared as obligations of a Dominican company, and not generated: said, not implied.
      notImplemented('periodicReturns', 'IT-1, IR-17 e IR-3'),
      { capability: 'withholding', level: 'implemented', detail: 'ITBIS e ISR retenidos, Norma 02-05 y Ley 11-92' },
      { capability: 'payroll', level: 'implemented', detail: 'SDSS (AFP, SFS, SRL), INFOTEP e ISR asalariados' },
    ],
  },

  MX: {
    countryCode: 'MX',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IVA 16 % / 8 % frontera / 0 %' },
      einvoicing('CFDI 4.0', 'tu Certificado de Sello Digital y un contrato con un PAC'),
      {
        capability: 'electronicAccounting',
        level: 'needs-configuration',
        detail: 'Catálogo, Balanza y Pólizas (Anexo 24 v1.3)',
        requires: 'el código agrupador del SAT en cada cuenta de tu catálogo',
      },
      noWithholding,
    ],
  },

  CO: {
    countryCode: 'CO',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IVA 19 % / 5 % / excluido' },
      einvoicing('DIAN UBL 2.1 con CUFE', 'tu certificado de firma digital, la resolución de facturación y tu clave técnica'),
      notImplemented('periodicReturns'),
      noWithholding,
    ],
  },

  PE: {
    countryCode: 'PE',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IGV 18 % / exonerado; sin detracciones, percepciones ni retenciones especiales' },
      einvoicing('SUNAT UBL 2.1', 'tu certificado digital y tus credenciales SOL'),
      notImplemented('periodicReturns'),
      noWithholding,
    ],
  },

  EC: {
    countryCode: 'EC',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IVA 15 % / 0 %; sin detracciones, percepciones ni retenciones especiales' },
      einvoicing('SRI 2.1.0 con clave de acceso', 'tu certificado de firma electrónica y tu punto de emisión'),
      notImplemented('periodicReturns'),
      noWithholding,
    ],
  },

  CL: {
    countryCode: 'CL',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IVA 19 % / exento; sin detracciones, percepciones ni retenciones especiales' },
      einvoicing('SII — DTE 33/34/61', 'tu certificado digital y tus folios CAF del SII'),
      notImplemented('periodicReturns'),
      noWithholding,
    ],
  },

  BR: {
    countryCode: 'BR',
    capabilities: [
      accounting,
      {
        capability: 'taxDetermination',
        level: 'needs-credentials',
        detail: 'ICMS estadual, ISS municipal, PIS/COFINS por regime',
        requires: 'as alíquotas das jurisdições onde tem obrigação, em Configurações → Impostos',
      },
      einvoicing('NF-e 4.00', 'seu certificado A1 ou A3 e a homologação na SEFAZ do seu estado'),
      notImplemented('periodicReturns'),
      noWithholding,
    ],
  },

  AR: {
    countryCode: 'AR',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IVA 21 % / 10,5 % / 27 %; sin detracciones, percepciones ni retenciones especiales' },
      einvoicing('AFIP WSFEv1 con CAE', 'tu certificado de AFIP y el punto de venta habilitado'),
      notImplemented('periodicReturns'),
      noWithholding,
    ],
  },

  US: {
    countryCode: 'US',
    capabilities: [
      accounting,
      {
        capability: 'taxDetermination',
        level: 'needs-credentials',
        detail: 'Sales tax por jurisdicción, con sourcing origen/destino y nexo',
        requires: 'las jurisdicciones donde está registrado, en Ajustes → Impuestos',
      },
      // Not a gap: United States sales invoices carry no fiscal stamp. Saying "not implemented"
      // would suggest something is missing that does not exist.
      {
        capability: 'electronicInvoicing',
        level: 'implemented',
        detail: 'No aplica: la factura de venta estadounidense no lleva sello fiscal',
      },
      notImplemented('periodicReturns', 'Formularios 1099 y declaraciones estatales'),
      noWithholding,
    ],
  },
};

/**
 * The coverage for a market, or the honest default for one this table does not name.
 *
 * Bookkeeping works; nothing else is claimed. A market absent from the table is one nobody has
 * examined, and inventing a row for it would be the same failure this table exists to fix.
 */
export function coverageFor(countryCode: string | null | undefined): MarketCoverage {
  const known = FISCAL_COVERAGE[(countryCode ?? '').toUpperCase()];
  if (known) return withPayroll(known);
  return withPayroll({
    countryCode: (countryCode ?? '').toUpperCase(),
    capabilities: [
      accounting,
      notImplemented('taxDetermination'),
      notImplemented('electronicInvoicing'),
      notImplemented('periodicReturns'),
      notImplemented('withholding'),
    ],
  });
}

/**
 * Payroll is stated for every market (audit 2026-11-07, JUR-02): only a market whose row says
 * otherwise has a payroll strategy; the others learn it before paying, not from the error of their
 * first run. `fiscal-coverage.spec.ts` checks the rows against the strategies that exist.
 */
function withPayroll(coverage: MarketCoverage): MarketCoverage {
  const withPayrollLine = coverage.capabilities.some((c) => c.capability === 'payroll')
    ? coverage
    : { ...coverage, capabilities: [...coverage.capabilities, notImplemented('payroll')] };
  return withDocumentLifecycle(withPayrollLine);
}

/**
 * Markets whose e-invoicing regime the product speaks, but whose builder does not yet issue a debit
 * note (FAC-INV-05). Everywhere else a debit note is issued: under the Dominican regime, or as the
 * commercial document a market without the authority's documents uses. Kept in step with the
 * invoice adapters by `document-lifecycle-coverage.spec.ts`.
 */
export const DEBIT_NOTES_PENDING_IN_REGIME: readonly string[] = ['MX', 'CO', 'PE', 'CL', 'EC', 'AR', 'BR'];

/** Debit notes and cancellation, declared for every market like any other capability. */
function withDocumentLifecycle(coverage: MarketCoverage): MarketCoverage {
  const country = coverage.countryCode.toUpperCase();
  const cancellation = cancellationCoverageFor(country);
  const lines: CapabilityCoverage[] = [
    DEBIT_NOTES_PENDING_IN_REGIME.includes(country)
      ? notImplemented('debitNotes', fiscalAuthorityOf(country))
      : { capability: 'debitNotes', level: 'implemented' },
    cancellation.implemented
      ? { capability: 'documentCancellation', level: 'implemented', detail: cancellation.detail }
      : notImplemented('documentCancellation', cancellation.detail),
  ];
  const present = new Set(coverage.capabilities.map((c) => c.capability));
  return { ...coverage, capabilities: [...coverage.capabilities, ...lines.filter((line) => !present.has(line.capability))] };
}

/** True when the product computes this market's statutory payroll. */
export function payrollImplemented(countryCode: string | null | undefined): boolean {
  return coverageFor(countryCode).capabilities.some((c) => c.capability === 'payroll' && c.level === 'implemented');
}
