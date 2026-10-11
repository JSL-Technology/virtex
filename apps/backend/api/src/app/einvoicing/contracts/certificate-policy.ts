import { findCountryProfile } from '../../localization/contracts/country-profile.contract';

/**
 * How a market's electronic documents are signed: which stored certificate signs them, and whose
 * it may be.
 *
 * One table for every market with a regime, so a certificate is uploaded, assessed and found again
 * the same way in all of them. The upload used to file every certificate as a DGII one, so a
 * Mexican CSD could never be found by the CFDI adapter that looks for `CFDI`.
 */
export interface CertificatePolicy {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** `ecf_certificates.regime` of the certificate that signs this market's documents. */
  regime: string;
  /** The tax authority, as the market calls it — for messages: «DGII», «SAT», «DIAN». */
  authority: string;
  /**
   * Whether a certificate issued to a natural person — the representative the company authorised —
   * signs for the company.
   *
   * - **DO**: the DGII issues e-CF certificates to the person the taxpayer authorises in its
   *   Oficina Virtual.
   * - **CL**: the SII's DTE are signed with the certificate of a person the company authorises.
   * - **EC**: the SRI accepts the firma electrónica of the legal representative.
   * - **MX, CO, PE, BR, AR**: the certificate is the taxpayer's own (CSD, certificado de la DIAN,
   *   CDT, e-CNPJ, certificado de AFIP) and names its RFC, NIT, RUC, CNPJ or CUIT.
   */
  representativeAllowed: boolean;
}

const POLICIES: Readonly<Record<string, Omit<CertificatePolicy, 'country' | 'authority'>>> = Object.freeze({
  DO: { regime: 'DGII', representativeAllowed: true },
  MX: { regime: 'CFDI', representativeAllowed: false },
  CO: { regime: 'DIAN', representativeAllowed: false },
  PE: { regime: 'SUNAT', representativeAllowed: false },
  EC: { regime: 'SRI', representativeAllowed: true },
  CL: { regime: 'SII', representativeAllowed: true },
  BR: { regime: 'NFE', representativeAllowed: false },
  AR: { regime: 'AFIP', representativeAllowed: false },
});

/** The signing policy of a market, or null where no regime signs anything. */
export function certificatePolicyFor(countryCode: string | null | undefined): CertificatePolicy | null {
  const country = (countryCode ?? '').trim().toUpperCase();
  const policy = POLICIES[country];
  if (!policy) return null;
  return { country, ...policy, authority: findCountryProfile(country)?.fiscalAuthority ?? country };
}

/** The `ecf_certificates.regime` a market's adapter looks its certificate up by. */
export function certificateRegimeFor(countryCode: string): string {
  const policy = certificatePolicyFor(countryCode);
  if (!policy) throw new Error(`No signing certificate regime is defined for country "${countryCode}".`);
  return policy.regime;
}

/** Markets whose electronic documents are signed with a certificate the company uploads. */
export function countriesWithCertificateRegime(): readonly string[] {
  return Object.keys(POLICIES);
}

/** The policy whose certificates are filed under this regime, or null for an unknown one. */
export function certificatePolicyForRegime(regime: string | null | undefined): CertificatePolicy | null {
  const country = Object.keys(POLICIES).find((code) => POLICIES[code].regime === regime);
  return country ? certificatePolicyFor(country) : null;
}
