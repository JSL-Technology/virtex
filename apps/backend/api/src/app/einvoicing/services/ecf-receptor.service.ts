import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import * as xmlbuilder from 'xmlbuilder';
import { EcfSignerService } from './ecf-signer.service';
import { EcfLifecycleService } from './ecf-lifecycle.service';
import { CommercialApprovalVerdict } from '../entities/ecf-lifecycle-message.entity';
import { isTerminalStatus } from '../ecf-status.util';
import { CertificateVaultService } from './certificate-vault.service';
import { DGII_CERTIFICATE_REGIME, EcfCertificate } from '../entities/ecf-certificate.entity';
import { EcfReceivedDocument, ReceivedEcfStatus } from '../entities/ecf-received-document.entity';
import { EcfSubmission } from '../entities/ecf-submission.entity';
import { dgiiTimestamp, organizationTimeZone } from '../../shared/fiscal-clock';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { UnauthorizedError, NotFoundError, BadRequestError } from '../../i18n/localized.exception';

/** How long a seed may take to come back signed. */
const SEED_TTL_MS = 5 * 60 * 1000;
/** How long a receptor token is good for. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/** Why a comprobante was not received — the DGII's `CodigoMotivoNoRecibido`. */
export enum NotReceivedReason {
  SPECIFICATION_ERROR = '1',
  SIGNATURE_ERROR = '2',
  DUPLICATE = '3',
  WRONG_BUYER = '4',
}

/** What the reception service answered, with the signed ARECF to send back. */
export interface ReceptionResult {
  received: boolean;
  reason: NotReceivedReason | null;
  ackXml: string;
  documentId: string | null;
}

/** The fields of an e-CF the inbox and the purchase register need, read from its XML. */
export interface ParsedEcf {
  ecfType: string | null;
  ncf: string | null;
  issuerRnc: string | null;
  issuerName: string | null;
  buyerRnc: string | null;
  issueDate: string | null;
  total: number;
  itbis: number;
  currencyCode: string;
}

/** The tenant a public DGII-facing request is addressed to. */
interface ReceptorTenant {
  organizationId: string;
  rnc: string;
  timezone: string | null;
  country: string | null;
}

/**
 * The tenant's e-CF reception services, as the DGII's technical specification defines them.
 *
 * Every electronic issuer is also a receiver. Its suppliers, and the DGII during certification,
 * call four services on it:
 *
 *   GET  {base}/fe/autenticacion/api/semilla              — a seed to sign
 *   POST {base}/fe/autenticacion/api/validacioncertificado — the signed seed → a bearer token
 *   POST {base}/fe/recepcion/api/ecf                       — an e-CF → a signed ARECF
 *   POST {base}/fe/aprobacioncomercial/api/ecf             — a buyer's ACECF on our document
 *
 * `{base}` is per tenant — `/dgii/{rnc}` — and is what the tenant registers in the DGII's directory
 * of electronic issuers. The requests carry no session: the tenant is the RNC in the path, resolved
 * against the organizations register, and everything after that runs inside that tenant's RLS
 * context. Seeds and tokens are stateless HMACs, so any API instance can verify any other's.
 *
 * *Verificar con la DGII:* the element names follow the ARECF/ACECF formats published with the e-CF
 * technical documentation. The DGII's certification set exercises exactly these services, and its
 * rejection messages name the offending element; that run is the conformance test.
 */
@Injectable()
export class EcfReceptorService {
  private readonly logger = new Logger(EcfReceptorService.name);
  private readonly secret: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly signer: EcfSignerService,
    private readonly vault: CertificateVaultService,
    private readonly lifecycle: EcfLifecycleService,
    config: ConfigService,
  ) {
    // A dedicated purpose label: a receptor token can never be mistaken for a session token, even
    // though both are keyed from the deployment's JWT secret.
    this.secret = `${config.get<string>('JWT_SECRET') ?? ''}:dgii-receptor:v1`;
  }

  // ── Authentication ─────────────────────────────────────────────────────────

  /** `SemillaModel` for the caller to sign with its certificate. */
  async seed(rnc: string, now: Date = new Date()): Promise<string> {
    const tenant = await this.tenant(rnc);
    const nonce = randomBytes(16).toString('base64url');
    const issued = now.getTime().toString(36);
    const valor = `${nonce}.${issued}.${this.mac(`seed:${tenant.rnc}:${nonce}:${issued}`)}`;
    return xmlbuilder
      .create('SemillaModel', { encoding: 'UTF-8' })
      .att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
      .ele('valor', valor)
      .up()
      .ele('fecha', now.toISOString().slice(0, 19))
      .end({ pretty: false });
  }

  /** The signed seed back: its signature and freshness checked, a bearer token issued. */
  async validateSeed(
    rnc: string,
    signedSeed: string,
    now: Date = new Date(),
  ): Promise<{ token: string; expira: string; expedido: string }> {
    const tenant = await this.tenant(rnc);
    const doc = this.parse(signedSeed);
    const valor = this.text(doc, 'valor');
    const [nonce, issued, mac] = (valor ?? '').split('.');
    if (!nonce || !issued || !mac || !this.macMatches(`seed:${tenant.rnc}:${nonce}:${issued}`, mac)) {
      throw new UnauthorizedError('einvoicing.receptor.seed_invalid');
    }
    if (now.getTime() - parseInt(issued, 36) > SEED_TTL_MS) {
      throw new UnauthorizedError('einvoicing.receptor.seed_expired');
    }
    if (!this.verifySignature(signedSeed)) {
      throw new UnauthorizedError('einvoicing.receptor.seed_signature_invalid');
    }
    const expires = now.getTime() + TOKEN_TTL_MS;
    const body = Buffer.from(JSON.stringify({ r: tenant.rnc, e: expires })).toString('base64url');
    return {
      token: `${body}.${this.mac(`token:${body}`)}`,
      expira: new Date(expires).toISOString(),
      expedido: now.toISOString(),
    };
  }

  /** Refuses a request whose bearer token was not issued by this receptor, for this tenant, recently. */
  assertToken(rnc: string, authorization: string | undefined, now: Date = new Date()): void {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    const [body, mac] = token.split('.');
    if (!body || !mac || !this.macMatches(`token:${body}`, mac)) {
      throw new UnauthorizedError('einvoicing.receptor.token_invalid');
    }
    let claims: { r?: string; e?: number };
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedError('einvoicing.receptor.token_invalid');
    }
    if (claims.r !== digitsOf(rnc) || !claims.e || claims.e < now.getTime()) {
      throw new UnauthorizedError('einvoicing.receptor.token_invalid');
    }
  }

  // ── Reception ──────────────────────────────────────────────────────────────

  /**
   * Receive a supplier's e-CF and answer with a signed ARECF.
   *
   * «No recibido» is an ANSWER, not an error: a malformed document, a broken signature, a duplicate
   * or a document addressed to somebody else each get an ARECF that says which, so the supplier
   * can fix it. Only a request for a tenant that does not exist, or that cannot sign, fails outright.
   */
  async receive(rnc: string, xml: string, now: Date = new Date()): Promise<ReceptionResult> {
    const tenant = await this.tenant(rnc);
    let parsed: ParsedEcf;
    try {
      parsed = EcfReceptorService.parseEcf(xml);
    } catch {
      return this.acknowledge(tenant, emptyParsed(), NotReceivedReason.SPECIFICATION_ERROR, null, now);
    }
    if (!parsed.ncf || !parsed.issuerRnc || !parsed.ecfType) {
      return this.acknowledge(tenant, parsed, NotReceivedReason.SPECIFICATION_ERROR, null, now);
    }
    if (digitsOf(parsed.buyerRnc ?? '') !== tenant.rnc) {
      return this.acknowledge(tenant, parsed, NotReceivedReason.WRONG_BUYER, null, now);
    }
    const signatureValid = this.verifySignature(xml);
    if (!signatureValid) {
      return this.acknowledge(tenant, parsed, NotReceivedReason.SIGNATURE_ERROR, null, now);
    }

    return runAsTenantJob(this.dataSource, tenant.organizationId, async () => {
      const repo = this.dataSource.getRepository(EcfReceivedDocument);
      const existing = await repo.findOne({
        where: {
          organizationId: tenant.organizationId,
          issuerRnc: digitsOf(parsed.issuerRnc as string),
          ncf: parsed.ncf as string,
        },
      });
      if (existing) {
        return this.acknowledge(tenant, parsed, NotReceivedReason.DUPLICATE, existing.id, now);
      }
      const document = await repo.save(
        repo.create({
          organizationId: tenant.organizationId,
          issuerRnc: digitsOf(parsed.issuerRnc as string),
          issuerName: parsed.issuerName,
          ncf: parsed.ncf as string,
          ecfType: parsed.ecfType as string,
          issueDate: parsed.issueDate,
          total: parsed.total,
          itbis: parsed.itbis,
          currencyCode: parsed.currencyCode,
          xml,
          signatureValid,
          status: ReceivedEcfStatus.RECEIVED,
          receivedAt: now,
        }),
      );
      const result = await this.acknowledge(tenant, parsed, null, document.id, now);
      document.ackXml = result.ackXml;
      await repo.save(document);
      this.logger.log(
        { event: 'ecf_received', organizationId: tenant.organizationId, ncf: document.ncf, issuer: document.issuerRnc },
        'e-CF received',
      );
      return result;
    });
  }

  /**
   * A customer's commercial verdict (ACECF) on a document this tenant issued: recorded on the
   * document's submission, so the invoice shows whether its buyer accepted or disputed it.
   */
  async receiveCommercialApproval(rnc: string, xml: string): Promise<{ recorded: boolean }> {
    const tenant = await this.tenant(rnc);
    const doc = this.parse(xml);
    const issuer = digitsOf(this.text(doc, 'RNCEmisor') ?? '');
    const ncf = this.text(doc, 'eNCF');
    const estado = this.text(doc, 'Estado');
    if (issuer !== tenant.rnc || !ncf || !['1', '2'].includes(estado ?? '')) {
      throw new BadRequestError('einvoicing.receptor.approval_malformed');
    }
    if (!this.verifySignature(xml)) {
      throw new BadRequestError('einvoicing.receptor.approval_signature_invalid');
    }
    return runAsTenantJob(this.dataSource, tenant.organizationId, async () => {
      const repo = this.dataSource.getRepository(EcfSubmission);
      const submission = await repo.findOne({ where: { organizationId: tenant.organizationId, ncf } });
      if (!submission) throw new NotFoundError('einvoicing.receptor.approval_document_unknown', { ncf });
      submission.commercialStatus = estado === '1' ? 'APPROVED' : 'REJECTED';
      submission.commercialReason = this.text(doc, 'DetalleMotivoRechazo');
      submission.commercialAt = new Date();
      await repo.save(submission);
      return { recorded: true };
    });
  }

  // ── The tenant's inbox ─────────────────────────────────────────────────────

  /** What suppliers sent, newest first, optionally only those still awaiting a verdict. */
  listReceived(organizationId: string, status?: ReceivedEcfStatus): Promise<EcfReceivedDocument[]> {
    return this.dataSource.getRepository(EcfReceivedDocument).find({
      where: { organizationId, ...(status ? { status } : {}) },
      order: { receivedAt: 'DESC' },
      take: 500,
      select: [
        'id', 'issuerRnc', 'issuerName', 'ncf', 'ecfType', 'issueDate', 'total', 'itbis',
        'currencyCode', 'signatureValid', 'status', 'rejectionReason', 'vendorBillId', 'receivedAt',
      ],
    });
  }

  async getReceived(organizationId: string, id: string): Promise<EcfReceivedDocument> {
    const document = await this.dataSource
      .getRepository(EcfReceivedDocument)
      .findOne({ where: { organizationId, id } });
    if (!document) throw new NotFoundError('einvoicing.receptor.document_not_found');
    return document;
  }

  /**
   * Accept or dispute a received comprobante: the ACECF goes to the DGII through the lifecycle
   * service, and the document records the verdict. Within three business days of receipt —
   * silence counts as acceptance, but a dispute never registered cannot be argued later.
   */
  async answer(
    organizationId: string,
    id: string,
    verdict: CommercialApprovalVerdict,
    rejectionReason?: string,
  ): Promise<EcfReceivedDocument> {
    const document = await this.getReceived(organizationId, id);
    if (document.status !== ReceivedEcfStatus.RECEIVED) {
      throw new BadRequestError('einvoicing.receptor.document_already_answered');
    }
    const message = await this.lifecycle.answerReceived(organizationId, {
      issuerRnc: document.issuerRnc,
      ncf: document.ncf,
      documentDate: document.issueDate ?? new Date().toISOString().slice(0, 10),
      documentTotal: Number(document.total),
      verdict,
      rejectionReason,
    });
    document.commercialMessageId = message.id;
    // A verdict the DGII has not yet acknowledged still binds the tenant: it was signed and sent,
    // and the lifecycle service retries the transmission. The inbox shows it as decided.
    if (isTerminalStatus(message.status) || message.signedXml) {
      document.status =
        verdict === CommercialApprovalVerdict.APPROVED ? ReceivedEcfStatus.APPROVED : ReceivedEcfStatus.REJECTED;
      document.rejectionReason = rejectionReason ?? null;
    }
    return this.dataSource.getRepository(EcfReceivedDocument).save(document);
  }

  // ── Parsing ────────────────────────────────────────────────────────────────

  /** The e-CF's identifying fields. Throws on XML that does not parse. */
  static parseEcf(xml: string): ParsedEcf {
    const doc = parseXml(xml);
    const get = (name: string) => firstText(doc, name);
    const number = (name: string) => {
      const value = Number(get(name) ?? '');
      return Number.isFinite(value) ? value : 0;
    };
    const fecha = get('FechaEmision');
    return {
      ecfType: get('TipoeCF'),
      ncf: get('eNCF'),
      issuerRnc: get('RNCEmisor'),
      issuerName: get('RazonSocialEmisor'),
      buyerRnc: get('RNCComprador'),
      issueDate: fecha && /^\d{2}-\d{2}-\d{4}$/.test(fecha) ? fecha.split('-').reverse().join('-') : null,
      total: number('MontoTotal'),
      itbis: number('TotalITBIS'),
      currencyCode: (get('TipoMoneda') ?? 'DOP').slice(0, 3).toUpperCase(),
    };
  }

  /** The ARECF: received, or not and why. Signed with the tenant's certificate. */
  static buildAck(input: {
    issuerRnc: string;
    buyerRnc: string;
    ncf: string;
    reason: NotReceivedReason | null;
    timestamp: string;
  }): string {
    const root = xmlbuilder
      .create('ARECF', { encoding: 'UTF-8' })
      .att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
    const detail = root.ele('DetalleAcusedeRecibo');
    detail.ele('Version', '1.0');
    detail.ele('RNCEmisor', input.issuerRnc);
    detail.ele('RNCComprador', input.buyerRnc);
    detail.ele('eNCF', input.ncf);
    detail.ele('Estado', input.reason ? '1' : '0');
    if (input.reason) detail.ele('CodigoMotivoNoRecibido', input.reason);
    detail.ele('FechaHoraAcuseRecibo', input.timestamp);
    return root.end({ pretty: false });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async acknowledge(
    tenant: ReceptorTenant,
    parsed: ParsedEcf,
    reason: NotReceivedReason | null,
    documentId: string | null,
    now: Date,
  ): Promise<ReceptionResult> {
    const xml = EcfReceptorService.buildAck({
      issuerRnc: digitsOf(parsed.issuerRnc ?? ''),
      buyerRnc: tenant.rnc,
      ncf: parsed.ncf ?? '',
      reason,
      timestamp: dgiiTimestamp(organizationTimeZone({ country: tenant.country, timezone: tenant.timezone }), now),
    });
    const certificate = await runAsTenantJob(this.dataSource, tenant.organizationId, () =>
      this.activeCertificate(tenant.organizationId, this.dataSource.manager),
    );
    if (!certificate) throw new BadRequestError('einvoicing.certificate.none_active', { authority: 'DGII' });
    const ackXml = this.signer.sign(xml, this.vault.load(certificate), 'ARECF');
    return { received: reason === null, reason, ackXml, documentId };
  }

  private activeCertificate(organizationId: string, manager: EntityManager): Promise<EcfCertificate | null> {
    return manager.getRepository(EcfCertificate).findOne({
      where: { organizationId, isActive: true, regime: DGII_CERTIFICATE_REGIME },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * The Dominican organization the RNC in the path names. `organizations` is the tenant register
   * itself, outside row-level security, so it can be read before a tenant context exists.
   */
  private async tenant(rnc: string): Promise<ReceptorTenant> {
    const digits = digitsOf(rnc);
    if (digits.length !== 9 && digits.length !== 11) throw new NotFoundError('einvoicing.receptor.unknown_receiver');
    const rows: Array<{ id: string; tax_id: string; timezone: string | null; country: string | null }> =
      await this.dataSource.query(
        `SELECT "id", "tax_id", "timezone", "country" FROM "organizations"
          WHERE regexp_replace(coalesce("tax_id", ''), '\\D', '', 'g') = $1 AND upper("country") = 'DO'
          ORDER BY "created_at" ASC LIMIT 2`,
        [digits],
      );
    // Two companies claiming one RNC cannot both be the receiver; answering for either would hand
    // one company's purchases to the other.
    if (rows.length !== 1) throw new NotFoundError('einvoicing.receptor.unknown_receiver');
    return { organizationId: rows[0].id, rnc: digits, timezone: rows[0].timezone, country: rows[0].country };
  }

  /** Whether the document's enveloped signature verifies against the certificate it carries. */
  private verifySignature(xml: string): boolean {
    try {
      const doc = parseXml(xml);
      const signature = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
      if (!signature) return false;
      const verifier = new SignedXml({ getCertFromKeyInfo: SignedXml.getCertFromKeyInfo });
      verifier.loadSignature(signature as unknown as Node);
      return verifier.checkSignature(xml);
    } catch (error) {
      this.logger.warn(`e-CF signature could not be verified: ${(error as Error).message}`);
      return false;
    }
  }

  private parse(xml: string): Document {
    try {
      return parseXml(xml);
    } catch {
      throw new BadRequestError('einvoicing.receptor.xml_malformed');
    }
  }

  private text(doc: Document, name: string): string | null {
    return firstText(doc, name);
  }

  private mac(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private macMatches(value: string, mac: string): boolean {
    const expected = Buffer.from(this.mac(value));
    const given = Buffer.from(mac);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

function digitsOf(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

function emptyParsed(): ParsedEcf {
  return {
    ecfType: null, ncf: null, issuerRnc: null, issuerName: null, buyerRnc: null,
    issueDate: null, total: 0, itbis: 0, currencyCode: 'DOP',
  };
}

/** Parse XML strictly: a parser warning or error is a malformed document, not a partial one. */
function parseXml(xml: string): Document {
  let failed = false;
  const fail = () => {
    failed = true;
  };
  const doc = new DOMParser({
    errorHandler: { warning: () => undefined, error: fail, fatalError: fail },
  }).parseFromString(xml, 'text/xml') as unknown as Document;
  if (failed || !doc?.documentElement) throw new Error('malformed');
  return doc;
}

function firstText(doc: Document, name: string): string | null {
  const node = doc.getElementsByTagName(name)[0];
  const value = node?.textContent?.trim();
  return value ? value : null;
}
