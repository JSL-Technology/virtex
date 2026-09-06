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
 * - `not-implemented` — not built. Said plainly rather than dressed as a preview.
 */
export type CoverageLevel = 'implemented' | 'needs-credentials' | 'not-implemented';

export interface CapabilityCoverage {
  /** Stable key, for the UI to translate. */
  capability:
    | 'accounting'
    | 'taxDetermination'
    | 'electronicInvoicing'
    | 'periodicReturns'
    | 'electronicAccounting'
    | 'withholding';
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
  requires: 'los regímenes y tarifas que le apliquen, en Ajustes → Impuestos',
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
      einvoicing('DGII e-CF', 'su certificado digital de la DGII'),
      { capability: 'periodicReturns', level: 'implemented', detail: 'Formatos 606, 607, 608 y 609' },
      { capability: 'withholding', level: 'implemented', detail: 'ITBIS e ISR retenidos, Norma 02-05 y Ley 11-92' },
    ],
  },

  MX: {
    countryCode: 'MX',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IVA 16 % / 8 % frontera / 0 %' },
      einvoicing('CFDI 4.0', 'su Certificado de Sello Digital y un contrato con un PAC'),
      { capability: 'electronicAccounting', level: 'implemented', detail: 'Catálogo, Balanza y Pólizas (Anexo 24 v1.3)' },
      noWithholding,
    ],
  },

  CO: {
    countryCode: 'CO',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IVA 19 % / 5 % / excluido' },
      einvoicing('DIAN UBL 2.1 con CUFE', 'su certificado de firma digital, la resolución de facturación y su clave técnica'),
      notImplemented('periodicReturns'),
      noWithholding,
    ],
  },

  PE: {
    countryCode: 'PE',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IGV 18 % / exonerado' },
      einvoicing('SUNAT UBL 2.1', 'su certificado digital y sus credenciales SOL'),
      notImplemented('periodicReturns'),
      noWithholding,
    ],
  },

  EC: {
    countryCode: 'EC',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IVA 15 % / 0 %' },
      einvoicing('SRI 2.1.0 con clave de acceso', 'su certificado de firma electrónica y su punto de emisión'),
      notImplemented('periodicReturns'),
      noWithholding,
    ],
  },

  CL: {
    countryCode: 'CL',
    capabilities: [
      accounting,
      { capability: 'taxDetermination', level: 'implemented', detail: 'IVA 19 % / exento' },
      einvoicing('SII — DTE 33/34/61', 'su certificado digital y sus folios CAF del SII'),
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
      { capability: 'taxDetermination', level: 'implemented', detail: 'IVA 21 % / 10,5 % / 27 %' },
      einvoicing('AFIP WSFEv1 con CAE', 'su certificado de AFIP y el punto de venta habilitado'),
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
  if (known) return known;
  return {
    countryCode: (countryCode ?? '').toUpperCase(),
    capabilities: [
      accounting,
      notImplemented('taxDetermination'),
      notImplemented('electronicInvoicing'),
      notImplemented('periodicReturns'),
      notImplemented('withholding'),
    ],
  };
}
