import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  EcfLifecycleMessage,
  EcfMessageKind,
  CommercialApprovalVerdict,
} from '../entities/ecf-lifecycle-message.entity';
import { EcfStatus } from '../entities/ecf-submission.entity';
import { DGII_CERTIFICATE_REGIME, EcfCertificate } from '../entities/ecf-certificate.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { isElectronicDocumentType, knownMarket } from '../../markets';
import { certificatePolicyFor } from '../contracts/certificate-policy';
import { FiscalRangeService } from './fiscal-range.service';
import { CertificateVaultService } from './certificate-vault.service';
import { EcfSignerService } from './ecf-signer.service';
import {
  EcfLifecycleXmlBuilder,
  VoidedSequenceRange,
} from './ecf-lifecycle-xml.builder';
import { DgiiAuthService } from './dgii-auth.service';
import { DgiiTransportService } from './dgii-transport.service';
import { mapDgiiEstado, isTerminalStatus } from '../ecf-status.util';
import { dgiiTimestamp, isoToDgiiDate, organizationTimeZone } from '../../shared/fiscal-clock';
import { BadRequestError, ConflictError, NotFoundError } from '../../i18n/localized.exception';

export interface CommercialApprovalRequest {
  /** RNC of the supplier that issued the comprobante. */
  issuerRnc: string;
  /** The supplier's e-NCF. */
  ncf: string;
  /** Issue date the supplier stated, `YYYY-MM-DD`. */
  documentDate: string;
  /** Total the supplier stated. It must match theirs to the cent or the DGII rejects the answer. */
  documentTotal: number;
  verdict: CommercialApprovalVerdict;
  /** Mandatory when the verdict is a rejection. */
  rejectionReason?: string;
}

export interface SequenceVoidRequest {
  /** A document-type code, not `NcfType`: the boundary carries a plain string now (C-03). */
  type: string;
  /** First sequence number of the stretch, inclusive. */
  from: number;
  /** Last sequence number of the stretch, inclusive. */
  to: number;
}

/**
 * The half of the e-CF cycle that is not about issuing: answering what suppliers send, and
 * declaring the numbers that will never be used.
 *
 * Neither obligation could be met before. `DgiiTransportService` could send both messages and their
 * endpoints resolved in configuration, but no XML was ever built for them, nothing signed them and
 * no route reached them — so the code read as if the feature existed while a tenant could not
 * dispute a supplier's invoice or explain a gap in its own numbering.
 *
 * Both messages take the same path as a comprobante: build → sign with the tenant's certificate →
 * transmit → record the verdict, with the row written BEFORE anything can fail so an attempt is
 * never invisible.
 */
@Injectable()
export class EcfLifecycleService {
  private readonly logger = new Logger(EcfLifecycleService.name);

  constructor(
    @InjectRepository(EcfLifecycleMessage)
    private readonly messageRepo: Repository<EcfLifecycleMessage>,
    @InjectRepository(EcfCertificate)
    private readonly certRepo: Repository<EcfCertificate>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    private readonly vault: CertificateVaultService,
    private readonly signer: EcfSignerService,
    private readonly builder: EcfLifecycleXmlBuilder,
    private readonly auth: DgiiAuthService,
    private readonly transport: DgiiTransportService,
    /** The tenant's authorised ranges, the DGII's among every market's. */
    private readonly ranges: FiscalRangeService,
    private readonly dataSource: DataSource,
  ) {}

  // ── Aprobación comercial ───────────────────────────────────────────────────

  /**
   * Answer a comprobante a supplier issued to this tenant: accept it, or reject it with a reason.
   */
  async answerReceived(
    organizationId: string,
    request: CommercialApprovalRequest,
  ): Promise<EcfLifecycleMessage> {
    if (
      request.verdict === CommercialApprovalVerdict.REJECTED &&
      !request.rejectionReason?.trim()
    ) {
      throw new BadRequestError('einvoicing.do.commercial_rejection_must_state_reason_dgii');
    }

    const issuerRnc = digitsOf(request.issuerRnc);
    if (!issuerRnc) {
      throw new BadRequestError('einvoicing.do.issuer_rnc_required_document');
    }

    const org = await this.requireIssuer(organizationId);

    // One answer per supplier comprobante. Re-answering would leave the DGII holding two verdicts
    // for the same document with no way to tell which is current.
    const existing = await this.messageRepo.findOne({
      where: {
        organizationId,
        kind: EcfMessageKind.COMMERCIAL_APPROVAL,
        issuerRnc,
        ncf: request.ncf,
      },
    });
    if (existing && isTerminalStatus(existing.status)) {
      throw new ConflictError('einvoicing.do.document_ncf_from_issuer_rnc_has', { ncf: request.ncf, issuerRnc });
    }

    const message =
      existing ??
      (await this.messageRepo.save(
        this.messageRepo.create({
          organizationId,
          kind: EcfMessageKind.COMMERCIAL_APPROVAL,
          issuerRnc,
          ncf: request.ncf,
          documentDate: request.documentDate,
          documentTotal: request.documentTotal.toFixed(2),
          verdict: request.verdict,
          rejectionReason: request.rejectionReason ?? null,
          status: EcfStatus.PENDING,
          attempts: 0,
        }),
      ));

    try {
      const { loaded, taxId } = await this.credentials(organizationId, org);
      const xml = this.builder.buildCommercialApproval({
        rncEmisor: issuerRnc,
        rncComprador: taxId,
        eNCF: request.ncf,
        fechaEmision: isoToDgiiDate(request.documentDate),
        montoTotal: request.documentTotal,
        estado: request.verdict,
        detalleMotivoRechazo: request.rejectionReason,
        fechaHoraAprobacion: dgiiTimestamp(organizationTimeZone(org)),
      });

      const signedXml = this.signer.sign(xml, loaded, 'ACECF');
      message.signedXml = signedXml;
      message.status = EcfStatus.SIGNED;
      message.attempts += 1;
      await this.messageRepo.save(message);

      const token = await this.auth.getToken(organizationId, loaded);
      const result = await this.transport.sendCommercialApproval(organizationId, token, signedXml, request.ncf);

      return this.recordResult(message, result);
    } catch (error) {
      return this.recordFailure(message, error);
    }
  }

  // ── Anulación de e-NCF ─────────────────────────────────────────────────────

  /**
   * Declare a stretch of an authorized range as annulled, and close it locally so the numbers
   * cannot be issued afterwards.
   *
   * Voiding at the authority while the range keeps handing the numbers out would produce documents
   * the authority has already been told do not exist — worse than not voiding at all. So the range
   * is locked for the whole exchange, the stretch must start at its next unissued number (a hole in
   * the middle cannot be expressed by a single cursor), and the numbers are closed in the same
   * transaction once the authority has taken the message. Nothing can be drawn from the range while
   * it is asked, which a rare, deliberate act can afford and a duplicated or undeclared number cannot.
   *
   * The stretch used to be checked against the number LAST issued as if it were the next one: the
   * authority was told an issued number did not exist, and the cursor then skipped one number nobody
   * declared. Both are what `FiscalRangeService.assertClosableStretch` and `closeThrough` now rule out.
   */
  async voidRange(
    organizationId: string,
    request: SequenceVoidRequest,
  ): Promise<EcfLifecycleMessage> {
    const type = request.type.trim().toUpperCase();
    const org = await this.requireIssuer(organizationId);
    const countryCode = (org.country ?? '').toUpperCase();
    // Only an electronic type is declared void to the authority; a traditional range is simply retired.
    if (!isElectronicDocumentType(countryCode, type)) {
      throw new BadRequestError('einvoicing.do.type_not_electronic_type_voiding_ranges', { type });
    }

    return this.dataSource.transaction(async (manager) => {
      const range = await this.ranges.lockActive(manager, { organizationId, countryCode, documentType: type, series: '' });
      if (!range) {
        throw new NotFoundError('einvoicing.do.no_active_type_sequence_organization', { type });
      }
      this.ranges.assertClosableStretch(range, request.from, request.to);

      // The authority already took this very stretch and its closure here did not commit (the
      // connection dropped between the two): close it now, and do not declare it a second time.
      const taken = await this.messageRepo.findOne({
        where: {
          organizationId,
          kind: EcfMessageKind.SEQUENCE_VOID,
          ecfType: type,
          sequenceFrom: String(request.from),
          sequenceTo: String(request.to),
          status: In(TAKEN_BY_THE_AUTHORITY),
        },
        order: { createdAt: 'DESC' },
      });
      if (taken) {
        await this.ranges.closeThrough(manager, range, request.to);
        return taken;
      }

      const stretch: VoidedSequenceRange = {
        tipoECF: type.substring(1),
        desde: this.fiscalNumberOf(countryCode, type, request.from),
        hasta: this.fiscalNumberOf(countryCode, type, request.to),
      };

      // Saved outside the transaction, so the attempt is on record whatever happens to it.
      const message = await this.messageRepo.save(
        this.messageRepo.create({
          organizationId,
          kind: EcfMessageKind.SEQUENCE_VOID,
          ecfType: type,
          sequenceFrom: String(request.from),
          sequenceTo: String(request.to),
          status: EcfStatus.PENDING,
          attempts: 0,
        }),
      );

      let recorded: EcfLifecycleMessage;
      try {
        const { loaded, taxId } = await this.credentials(organizationId, org);
        const xml = this.builder.buildSequenceVoid({
          rnc: taxId,
          fechaHoraAnulacion: dgiiTimestamp(organizationTimeZone(org)),
          ranges: [stretch],
        });

        const signedXml = this.signer.sign(xml, loaded, 'ANECF');
        message.signedXml = signedXml;
        message.status = EcfStatus.SIGNED;
        message.attempts += 1;
        await this.messageRepo.save(message);

        const token = await this.auth.getToken(organizationId, loaded);
        const result = await this.transport.voidSequenceRange(organizationId, token, signedXml);
        recorded = await this.recordResult(message, result);
      } catch (error) {
        // Nothing reached the authority, or it could not be reached: the numbers stay as they were.
        return this.recordFailure(message, error);
      }

      // Only close the numbers once the authority has taken the message. Closing first would strand
      // them if the transmission failed — unusable here and still live there. And outside the `try`:
      // a failure to close after the message was taken is not a failed annulment, so it must not be
      // recorded as one. It surfaces as an error, the message keeps the answer it received, and
      // asking again for the same stretch closes it without declaring it twice.
      if (!this.isRejected(recorded)) {
        await this.ranges.closeThrough(manager, range, request.to);
        this.logger.log(
          `Anulados ${request.to - request.from + 1} e-NCF de ${type} (${stretch.desde}–${stretch.hasta}).`,
        );
      }

      return recorded;
    });
  }

  /** The number as the market writes it (`E31` + ten digits), by the market's own mask. */
  private fiscalNumberOf(countryCode: string, documentType: string, sequence: number): string {
    const format = knownMarket(countryCode)?.documents.numbering.format;
    const point = { establishment: null, emissionPoint: null };
    return format ? format({ sequence, series: '', documentType }, point) : String(sequence);
  }

  // ── Consulta ───────────────────────────────────────────────────────────────

  async list(organizationId: string, kind?: EcfMessageKind): Promise<EcfLifecycleMessage[]> {
    return this.messageRepo.find({
      where: { organizationId, ...(kind ? { kind } : {}) },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * The company, as a taxpayer of the regime these messages belong to. A commercial approval and an
   * annulment of sequences are messages of one regime: a company of another market has no such
   * message to send, and is told so before anything is built in its name.
   */
  private async requireIssuer(organizationId: string): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundError('einvoicing.do.organization_not_found');
    if (certificatePolicyFor(org.country)?.regime !== DGII_CERTIFICATE_REGIME) {
      throw new BadRequestError('einvoicing.do.message_belongs_to_dgii_regime');
    }
    if (!org.taxId) {
      throw new BadRequestError('einvoicing.certificate.organization_has_no_tax_id', { label: 'RNC' });
    }
    return org;
  }

  private async credentials(organizationId: string, org: Organization) {
    // The DGII's certificate: a tenant that also operates in another market holds that market's
    // certificate too, and signing a DGII message with it would be rejected.
    const cert = await this.certRepo.findOne({
      where: { organizationId, isActive: true, regime: DGII_CERTIFICATE_REGIME },
      order: { createdAt: 'DESC' },
    });
    if (!cert) {
      throw new BadRequestError('einvoicing.certificate.none_active', { authority: 'DGII' });
    }
    if (cert.notAfter && cert.notAfter.getTime() < Date.now()) {
      throw new BadRequestError('einvoicing.certificate.expired', {
        expiredOn: cert.notAfter.toISOString().split('T')[0],
      });
    }
    return { loaded: this.vault.load(cert), taxId: digitsOf(org.taxId as string) };
  }

  private async recordResult(
    message: EcfLifecycleMessage,
    result: { trackId?: string; estado?: string; mensajes: string[]; raw: unknown },
  ): Promise<EcfLifecycleMessage> {
    message.trackId = result.trackId ?? null;
    message.dgiiResponse = result.raw;
    message.messages = result.mensajes;
    message.sentAt = new Date();
    message.status = result.estado ? mapDgiiEstado(result.estado) : EcfStatus.SENT;
    if (isTerminalStatus(message.status)) message.respondedAt = new Date();
    return this.messageRepo.save(message);
  }

  private isRejected(message: EcfLifecycleMessage): boolean {
    return message.status === EcfStatus.REJECTED || message.status === EcfStatus.ERROR;
  }

  private async recordFailure(
    message: EcfLifecycleMessage,
    error: unknown,
  ): Promise<EcfLifecycleMessage> {
    // An outage is retriable; a refusal is not. Conflating them either retries forever or gives up
    // on a message that would have gone through on the next attempt.
    message.status =
      error instanceof ServiceUnavailableException ? EcfStatus.CONTINGENCY : EcfStatus.ERROR;
    message.messages = [(error as Error).message];
    message.attempts += 1;
    this.logger.error(
      `Mensaje ${message.kind} (${message.ncf ?? message.ecfType}) falló: ${(error as Error).message}`,
    );
    return this.messageRepo.save(message);
  }
}

/** The states of a message the authority has taken: transmitted and not refused. */
const TAKEN_BY_THE_AUTHORITY = [EcfStatus.SENT, EcfStatus.ACCEPTED, EcfStatus.ACCEPTED_WITH_OBSERVATIONS];

/** The digits of a tax id, which is what the DGII expects in every RNC element. */
function digitsOf(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}
