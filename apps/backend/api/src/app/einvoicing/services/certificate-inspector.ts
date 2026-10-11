import * as forge from 'node-forge';
import { BadRequestError } from '../../i18n/localized.exception';

/**
 * What a signing certificate says about itself, read once when it is uploaded.
 *
 * A pure module — no I/O, no injection — so every rule below is tested directly against real
 * PKCS#12 files (`tools/fixtures/ecf-certificates`).
 */
export interface CertificateFacts {
  subjectCommonName: string | null;
  issuerCommonName: string | null;
  /**
   * Every Dominican identifier the subject carries, digits only: 9 digits is an RNC, 11 a cédula.
   * Read from the attributes certification authorities put it in — `serialNumber` (2.5.4.5),
   * `organizationIdentifier` (2.5.4.97) — and, as a fallback, the organisational unit and the
   * common name, where some authorities write it.
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
  /** The identifier that tied it to the company, digits only. */
  holderTaxId: string;
  /**
   * `company`: issued to the company's own RNC. `person`: issued to a natural person's cédula —
   * the DGII issues e-CF certificates to the person the taxpayer authorises in its Oficina
   * Virtual, and that link is not something the certificate itself can prove.
   */
  holderKind: 'company' | 'person';
  /** Self-signed and accepted only because this is a development process that allows it. */
  test: boolean;
}

const RNC_LENGTH = 9;
const CEDULA_LENGTH = 11;
const ID_ATTRIBUTE_OIDS = ['2.5.4.5', '2.5.4.97'];
const FALLBACK_ATTRIBUTES = ['OU', 'CN'];

/** Runs of exactly 9 or 11 digits, once separators (`-`, spaces, dots) are removed. */
function dominicanIds(value: string): string[] {
  const compact = value.replace(/[\s.\-/]/g, '');
  const runs = compact.match(/\d+/g) ?? [];
  return runs.filter((run) => run.length === RNC_LENGTH || run.length === CEDULA_LENGTH);
}

export function inspectCertificate(cert: forge.pki.Certificate): CertificateFacts {
  const attributeValues = (oids: string[], shortNames: string[]): string[] =>
    cert.subject.attributes
      .filter((a) => (a.type && oids.includes(a.type)) || (a.shortName && shortNames.includes(a.shortName)))
      .map((a) => String(a.value ?? ''));

  const primary = attributeValues(ID_ATTRIBUTE_OIDS, []).flatMap(dominicanIds);
  const fallback = primary.length ? [] : attributeValues([], FALLBACK_ATTRIBUTES).flatMap(dominicanIds);

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
 * Whether this company may sign its e-CF with this certificate.
 *
 * Each refusal names what is wrong so the person can fix it — a file of another company, an
 * expired one, one issued to nobody — instead of finding out from a DGII rejection days later.
 * QA V01: a certificate of «Ferreteria Demo SRL» was accepted for «Colmado La Esquina SRL».
 */
export function assessCertificate(
  facts: CertificateFacts,
  organizationTaxId: string | null | undefined,
  options: { allowTestCertificates: boolean; now?: Date },
): CertificateAssessment {
  const now = options.now ?? new Date();

  if (facts.notAfter && facts.notAfter.getTime() < now.getTime()) {
    throw new BadRequestError('einvoicing.do.certificate_expired', {
      expiredOn: facts.notAfter.toISOString().slice(0, 10),
    });
  }
  if (facts.notBefore && facts.notBefore.getTime() > now.getTime()) {
    throw new BadRequestError('einvoicing.do.certificate_not_yet_valid', {
      date: facts.notBefore.toISOString().slice(0, 10),
    });
  }
  if (!facts.canSign) {
    throw new BadRequestError('einvoicing.do.certificate_cannot_sign');
  }
  if (facts.selfSigned && !options.allowTestCertificates) {
    throw new BadRequestError('einvoicing.do.certificate_self_signed');
  }

  const company = (organizationTaxId ?? '').replace(/\D/g, '');
  if (!facts.holderIds.length) {
    throw new BadRequestError('einvoicing.do.certificate_holder_unidentified', {
      holder: facts.subjectCommonName ?? '—',
    });
  }

  // The company's own identifier — its RNC, or the cédula of a taxpayer who is a natural person.
  if (company && facts.holderIds.includes(company)) {
    return {
      holderTaxId: company,
      holderKind: company.length === CEDULA_LENGTH ? 'person' : 'company',
      test: facts.selfSigned,
    };
  }

  // Issued to another company: never this one's to sign with.
  const otherRnc = facts.holderIds.find((id) => id.length === RNC_LENGTH);
  if (otherRnc) {
    throw new BadRequestError('einvoicing.do.certificate_belongs_to_other_rnc', {
      holder: facts.subjectCommonName ?? '—',
      rnc: otherRnc,
      company: company || '—',
    });
  }

  // Issued to a person: the representative the company authorised before the DGII.
  const cedula = facts.holderIds.find((id) => id.length === CEDULA_LENGTH);
  if (cedula) {
    return { holderTaxId: cedula, holderKind: 'person', test: facts.selfSigned };
  }

  throw new BadRequestError('einvoicing.do.certificate_holder_unidentified', {
    holder: facts.subjectCommonName ?? '—',
  });
}
