import { allMarkets, fiscalAuthorityOf, marketFor } from '../../markets';

/**
 * How a market's electronic documents are signed: which stored certificate signs them, and whose
 * it may be.
 *
 * One shape for every market with a regime, so a certificate is uploaded, assessed and found again
 * the same way in all of them. The upload used to file every certificate as a DGII one, so a
 * Mexican CSD could never be found by the CFDI adapter that looks for `CFDI`.
 *
 * The values are each market's own (`MarketEInvoicing.signing`): this was a table here, keyed by
 * country code, which is the one place that knew which markets sign anything.
 */
export interface CertificatePolicy {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** `signing_certificates.regime` of the certificate that signs this market's documents. */
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

/** The signing policy of a market, or null where no regime signs anything. */
export function certificatePolicyFor(countryCode: string | null | undefined): CertificatePolicy | null {
  const country = (countryCode ?? '').trim().toUpperCase();
  const signing = marketFor(country).einvoicing.signing;
  if (!signing) return null;
  return { country, ...signing, authority: fiscalAuthorityOf(country) };
}

/** The `signing_certificates.regime` a market's adapter looks its certificate up by. */
export function certificateRegimeFor(countryCode: string): string {
  const policy = certificatePolicyFor(countryCode);
  if (!policy) throw new Error(`No signing certificate regime is defined for country "${countryCode}".`);
  return policy.regime;
}

/** Markets whose electronic documents are signed with a certificate the company uploads. */
export function countriesWithCertificateRegime(): readonly string[] {
  return allMarkets()
    .filter((market) => market.einvoicing.signing !== null)
    .map((market) => market.code);
}

/** The policy whose certificates are filed under this regime, or null for an unknown one. */
export function certificatePolicyForRegime(regime: string | null | undefined): CertificatePolicy | null {
  const market = allMarkets().find((candidate) => candidate.einvoicing.signing?.regime === regime);
  return market ? certificatePolicyFor(market.code) : null;
}
