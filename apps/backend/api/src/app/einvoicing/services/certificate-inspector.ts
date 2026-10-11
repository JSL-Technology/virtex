import * as forge from 'node-forge';
import { BadRequestError } from '../../i18n/localized.exception';
import { TaxpayerKind, fiscalIdentifierLabel, validateTaxId } from '../../localization/contracts/tax-id.contract';
import { CertificatePolicy } from '../contracts/certificate-policy';

/**
 * What a signing certificate says about itself, read once when it is uploaded.
 *
 * A pure module — no I/O, no injection — so every rule below is tested directly against real
 * PKCS#12 files (`tools/fixtures/ecf-certificates`). Nothing here is about one country: the
 * identifiers are matched against the company's own, and classified with the identity-document
 * catalogue of the company's market.
 */
export interface CertificateFacts {
  subjectCommonName: string | null;
  issuerCommonName: string | null;
  /**
   * Every identifier the subject may carry, upper-case and without separators, most specific
   * first. Read from the attributes certification authorities put it in — `serialNumber`
   * (2.5.4.5), `organizationIdentifier` (2.5.4.97, ETSI `VATDO-…`, `IDCMX-…`) and
   * `x500UniqueIdentifier` (2.5.4.45, where the SAT writes the RFC) — and, only when none of those
   * is present, the organisational unit and the common name, where some authorities write it.
   *
   * Candidates, not verdicts: which of them is a tax identifier is a question about a market, and
   * is answered by `assessCertificate` with the company's country.
   */
  holderIds: string[];
  /** Issued by itself: no authority vouches for the holder. */
  selfSigned: boolean;
  /** The key may sign: no `keyUsage` extension, or one that includes digital signature. */
  canSign: boolean;
  notBefore: Date | null;
  notAfter: Date | null;
}

/** Who the certificate was accepted as belonging to. */
export interface CertificateAssessment {
  /** The identifier that tied it to the company, upper-case and without separators. */
  holderTaxId: string;
  /**
   * `company`: issued to the company's own identifier. `person`: issued to a natural person — the
   * company itself when it is one, or the representative it authorised before its tax authority in
   * a market that signs that way (see `CertificatePolicy.representativeAllowed`).
   */
  holderKind: 'company' | 'person';
  /** Self-signed and accepted only because this is a development process that allows it. */
  test: boolean;
}

/** The company the certificate must belong to. */
export interface CertificateOwner {
  /** ISO 3166-1 alpha-2 of the company's market. */
  country: string;
  /** The company's identifier as recorded, or null when it has none yet. */
  taxId: string | null | undefined;
}

const ID_ATTRIBUTE_OIDS = ['2.5.4.5', '2.5.4.97', '2.5.4.45'];
const FALLBACK_ATTRIBUTES = ['OU', 'CN'];
/**
 * ETSI EN 319 412-1 semantics identifiers: `VAT` (tax), `NTR` (trade register), `IDC` (identity
 * card), `PAS` (passport), `PNO` (national personal number), `TIN`, `CPI`, then the country and a
 * hyphen. `VATDO-130456781` names RNC 130456781.
 */
const ETSI_PREFIX = /^(?:VAT|NTR|IDC|PAS|PNO|TIN|CPI|LEI)[A-Z]{2}[-:]/;
/** A national label written before the number: `RNC 130456781`, `RFC:EKU9003173C9`, `CUIT 20-…`. */
const LABEL_PREFIX = /^(?:RNC|RFC|RUC|RUT|NIT|CUIT|CUIL|CNPJ|CPF|CI|DNI|CC|CEDULA)[\s:.#-]*/;

const compact = (value: string): string => value.toUpperCase().replace(/[^0-9A-ZÑ&]/g, '');

/** The ways one attribute value may spell an identifier, most specific first. */
function identifierCandidates(raw: string): string[] {
  const value = raw.trim().toUpperCase();
  if (!value) return [];
  const unprefixed = value.replace(ETSI_PREFIX, '').replace(LABEL_PREFIX, '');
  const out = [compact(unprefixed)];
  // `EKU9003173C9 / VADA800927HSRSRL05` — the SAT writes the RFC and the representative's CURP in
  // one attribute; each part is a candidate of its own.
  for (const part of unprefixed.split(/[\s/,;|]+/)) out.push(compact(part.replace(LABEL_PREFIX, '')));
  // A number written after letters with no separator: `RNC130456781`, `IDCDO00112345673`.
  const trailingDigits = compact(unprefixed).match(/\d[\dK]*$/);
  if (trailingDigits) out.push(trailingDigits[0]);
  return out.filter((candidate) => candidate.length >= 5);
}

export function inspectCertificate(cert: forge.pki.Certificate): CertificateFacts {
  const attributeValues = (oids: string[], shortNames: string[]): string[] =>
    cert.subject.attributes
      .filter((a) => (a.type && oids.includes(a.type)) || (a.shortName && shortNames.includes(a.shortName)))
      .map((a) => String(a.value ?? ''));

  const primary = attributeValues(ID_ATTRIBUTE_OIDS, []).flatMap(identifierCandidates);
  const fallback = primary.length ? [] : attributeValues([], FALLBACK_ATTRIBUTES).flatMap(identifierCandidates);

  let selfSigned = false;
  try {
    selfSigned = cert.isIssuer(cert) && cert.verify(cert);
  } catch {
    selfSigned = false;
  }

  const keyUsage = cert.getExtension('keyUsage') as { digitalSignature?: boolean } | null;

  return {
    subjectCommonName: (cert.subject.getField('CN')?.value as string | undefined) ?? null,
    issuerCommonName: (cert.issuer.getField('CN')?.value as string | undefined) ?? null,
    holderIds: [...new Set([...primary, ...fallback])],
    selfSigned,
    canSign: !keyUsage || keyUsage.digitalSignature === true,
    notBefore: cert.validity?.notBefore ?? null,
    notAfter: cert.validity?.notAfter ?? null,
  };
}

/**
 * The same identifier, written with or without its check character.
 *
 * A Colombian NIT is recorded as `900373913-4` and a DIAN certificate may carry `900373913`; a
 * Chilean RUT is `76086428-5` on both but one of them may drop the hyphen. Equal once compacted, or
 * one is the other plus a single trailing check character.
 */
export function sameIdentifier(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return longer.length === shorter.length + 1 && shorter.length >= 8 && longer.startsWith(shorter);
}

/**
 * Whether this company may sign its electronic documents with this certificate.
 *
 * Each refusal names what is wrong so the person can fix it — a file of another company, an
 * expired one, one issued to nobody — instead of finding out from the authority's rejection days
 * later. QA V01: a certificate of «Ferreteria Demo SRL» was accepted for «Colmado La Esquina SRL».
 */
export function assessCertificate(
  facts: CertificateFacts,
  owner: CertificateOwner,
  policy: CertificatePolicy,
  options: { allowTestCertificates: boolean; now?: Date },
): CertificateAssessment {
  const now = options.now ?? new Date();
  const country = owner.country.toUpperCase();
  const label = fiscalIdentifierLabel(country);

  if (facts.notAfter && facts.notAfter.getTime() < now.getTime()) {
    throw new BadRequestError('einvoicing.certificate.expired', {
      expiredOn: facts.notAfter.toISOString().slice(0, 10),
    });
  }
  if (facts.notBefore && facts.notBefore.getTime() > now.getTime()) {
    throw new BadRequestError('einvoicing.certificate.not_yet_valid', {
      date: facts.notBefore.toISOString().slice(0, 10),
    });
  }
  if (!facts.canSign) {
    throw new BadRequestError('einvoicing.certificate.cannot_sign');
  }
  if (facts.selfSigned && !options.allowTestCertificates) {
    throw new BadRequestError('einvoicing.certificate.self_signed', { authority: policy.authority });
  }

  const company = compact(owner.taxId ?? '');
  if (!company) {
    throw new BadRequestError('einvoicing.certificate.organization_has_no_tax_id', { label });
  }

  // The company's own identifier — of a legal person, or of a taxpayer who is a natural person.
  const own = facts.holderIds.find((id) => sameIdentifier(id, company));
  if (own) {
    const companyKind = validateTaxId(country, company, TaxpayerKind.COMPANY) || !validateTaxId(country, company, TaxpayerKind.INDIVIDUAL);
    return { holderTaxId: company, holderKind: companyKind ? 'company' : 'person', test: facts.selfSigned };
  }

  // Issued to another company: never this one's to sign with.
  const otherCompany = facts.holderIds.find((id) => validateTaxId(country, id, TaxpayerKind.COMPANY));
  if (otherCompany && !validateTaxId(country, otherCompany, TaxpayerKind.INDIVIDUAL)) {
    throw new BadRequestError('einvoicing.certificate.belongs_to_other_company', {
      holder: facts.subjectCommonName ?? '—',
      label,
      id: otherCompany,
      company: owner.taxId ?? '—',
    });
  }

  // Issued to a person: the representative the company authorised, where the market signs that way.
  const person = facts.holderIds.find((id) => validateTaxId(country, id, TaxpayerKind.INDIVIDUAL));
  if (person) {
    if (!policy.representativeAllowed) {
      throw new BadRequestError('einvoicing.certificate.person_not_allowed', {
        holder: facts.subjectCommonName ?? '—',
        authority: policy.authority,
        label,
        company: owner.taxId ?? '—',
      });
    }
    return { holderTaxId: person, holderKind: 'person', test: facts.selfSigned };
  }

  // An identifier of the company's market that is neither the company's nor a person's.
  if (otherCompany) {
    throw new BadRequestError('einvoicing.certificate.belongs_to_other_company', {
      holder: facts.subjectCommonName ?? '—',
      label,
      id: otherCompany,
      company: owner.taxId ?? '—',
    });
  }

  throw new BadRequestError('einvoicing.certificate.holder_unidentified', {
    holder: facts.subjectCommonName ?? '—',
    label,
    company: owner.taxId ?? '—',
  });
}

/**
 * Whether a certificate already stored may sign today, for the company as it is now.
 *
 * The upload checked everything once; this re-checks what can change after it — time passing, the
 * environment the row was carried into, the company's identifier being corrected — at the moment a
 * document is about to be numbered and signed.
 */
export function assertStoredCertificateUsable(
  cert: {
    notAfter?: Date | null;
    isTest?: boolean | null;
    holderKind?: string | null;
    holderTaxId?: string | null;
    subjectCommonName?: string | null;
  },
  owner: CertificateOwner,
  policy: CertificatePolicy,
  options: { allowTestCertificates: boolean; now?: Date },
): void {
  const now = options.now ?? new Date();
  if (cert.notAfter && cert.notAfter.getTime() < now.getTime()) {
    throw new BadRequestError('einvoicing.certificate.expired', {
      expiredOn: cert.notAfter.toISOString().slice(0, 10),
    });
  }
  // A self-signed test certificate signs only where tests are allowed — never because its row was
  // carried into another environment.
  if (cert.isTest && !options.allowTestCertificates) {
    throw new BadRequestError('einvoicing.certificate.self_signed', { authority: policy.authority });
  }
  // Issued to the company's identifier, and the company's identifier has since changed.
  const company = compact(owner.taxId ?? '');
  if (cert.holderKind === 'company' && cert.holderTaxId && !sameIdentifier(compact(cert.holderTaxId), company)) {
    throw new BadRequestError('einvoicing.certificate.belongs_to_other_company', {
      holder: cert.subjectCommonName ?? '—',
      label: fiscalIdentifierLabel(owner.country),
      id: cert.holderTaxId,
      company: owner.taxId ?? '—',
    });
  }
}
