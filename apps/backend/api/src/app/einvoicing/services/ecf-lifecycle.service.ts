import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EcfLifecycleMessage,
  EcfMessageKind,
  CommercialApprovalVerdict,
} from '../entities/ecf-lifecycle-message.entity';
import { EcfStatus } from '../entities/ecf-submission.entity';
import { EcfCertificate } from '../entities/ecf-certificate.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import {
  NcfSequence,
  NcfType,
  isElectronicNcfType,
  dgiiDocumentCode,
} from '../../compliance/entities/ncf-sequence.entity';
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
  type: NcfType;
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
    @InjectRepository(NcfSequence)
    private readonly sequenceRepo: Repository<NcfSequence>,
    private readonly vault: CertificateVaultService,
    private readonly signer: EcfSignerService,
    private readonly builder: EcfLifecycleXmlBuilder,
    private readonly auth: DgiiAuthService,
    private readonly transport: DgiiTransportService,
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
      throw new BadRequestException(
        'Un rechazo comercial debe indicar el motivo: la DGII lo exige y el emisor lo necesita para corregir.',
      );
    }

    const issuerRnc = digitsOf(request.issuerRnc);
    if (!issuerRnc) {
      throw new BadRequestException('El RNC del emisor del comprobante es obligatorio.');
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
      throw new ConflictException(
        `El comprobante ${request.ncf} de ${issuerRnc} ya fue respondido comercialmente.`,
      );
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
      const result = await this.transport.sendCommercialApproval(token, signedXml, request.ncf);

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
   * Voiding at the DGII while the local sequence keeps handing the numbers out would produce
   * comprobantes the DGII has already been told do not exist — worse than not voiding at all. The
   * local range is therefore advanced in the same call, and only for a stretch that starts at the
   * sequence's current position: a hole in the middle of an authorized range cannot be expressed by
   * a single cursor, and pretending otherwise would silently skip numbers.
   */
  async voidRange(
    organizationId: string,
    request: SequenceVoidRequest,
  ): Promise<EcfLifecycleMessage> {
    if (!isElectronicNcfType(request.type)) {
      throw new BadRequestException(
        `${request.type} no es un tipo electrónico; la anulación de rangos aplica solo a e-NCF.`,
      );
    }
    if (request.to < request.from) {
      throw new BadRequestException('El final del rango no puede ser menor que su inicio.');
    }

    const sequence = await this.sequenceRepo.findOne({
      where: { organizationId, type: request.type, isActive: true },
    });
    if (!sequence) {
      throw new NotFoundException(
        `No hay una secuencia activa de ${request.type} para esta organización.`,
      );
    }

    const current = Number(sequence.currentSequence);
    const endsAt = Number(sequence.endsAt);
    if (request.from < current) {
      throw new BadRequestException(
        `Los e-NCF anteriores a ${current} ya fueron emitidos y no pueden anularse por rango; ` +
          `emite una nota de crédito sobre el comprobante correspondiente.`,
      );
    }
    if (request.from > current) {
      throw new BadRequestException(
        `La anulación debe comenzar en el siguiente número disponible (${current}); ` +
          `anular un tramo intermedio dejaría números inalcanzables sin declarar.`,
      );
    }
    if (request.to > endsAt) {
      throw new BadRequestException(
        `El rango autorizado termina en ${endsAt}; no puedes anular más allá de su límite.`,
      );
    }

    const org = await this.requireIssuer(organizationId);
    const code = dgiiDocumentCode(request.type);
    const range: VoidedSequenceRange = {
      tipoECF: code,
      desde: eNcfOf(request.type, request.from),
      hasta: eNcfOf(request.type, request.to),
    };

    const message = await this.messageRepo.save(
      this.messageRepo.create({
        organizationId,
        kind: EcfMessageKind.SEQUENCE_VOID,
        ecfType: request.type,
        sequenceFrom: String(request.from),
        sequenceTo: String(request.to),
        status: EcfStatus.PENDING,
        attempts: 0,
      }),
    );

    try {
      const { loaded, taxId } = await this.credentials(organizationId, org);
      const xml = this.builder.buildSequenceVoid({
        rnc: taxId,
        fechaHoraAnulacion: dgiiTimestamp(organizationTimeZone(org)),
        ranges: [range],
      });

      const signedXml = this.signer.sign(xml, loaded, 'ANECF');
      message.signedXml = signedXml;
      message.status = EcfStatus.SIGNED;
      message.attempts += 1;
      await this.messageRepo.save(message);

      const token = await this.auth.getToken(organizationId, loaded);
      const result = await this.transport.voidSequenceRange(token, signedXml);
      const recorded = await this.recordResult(message, result);

      // Only close the numbers once the DGII has taken the message. Advancing first would strand
      // the range if the transmission failed — the numbers unusable locally and still live at DGII.
      if (!this.isRejected(recorded)) {
        sequence.currentSequence = request.to + 1;
        if (sequence.currentSequence > endsAt) sequence.isActive = false;
        await this.sequenceRepo.save(sequence);
        this.logger.log(
          `Anulados ${request.to - request.from + 1} e-NCF de ${request.type} (${range.desde}–${range.hasta}).`,
        );
      }

      return recorded;
    } catch (error) {
      return this.recordFailure(message, error);
    }
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

  private async requireIssuer(organizationId: string): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organización no encontrada.');
    if (!org.taxId) {
      throw new BadRequestException(
        'La organización no tiene RNC configurado. Complétalo en Ajustes → Empresa.',
      );
    }
    return org;
  }

  private async credentials(organizationId: string, org: Organization) {
    const cert = await this.certRepo.findOne({
      where: { organizationId, isActive: true },
      order: { createdAt: 'DESC' },
    });
    if (!cert) {
      throw new BadRequestException(
        'No hay un certificado digital activo para firmar. Cárgalo en Ajustes → Facturación Electrónica.',
      );
    }
    if (cert.notAfter && cert.notAfter.getTime() < Date.now()) {
      throw new BadRequestException(
        `El certificado digital venció el ${cert.notAfter.toISOString().split('T')[0]}. ` +
          `Carga el certificado renovado antes de transmitir.`,
      );
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

/** The digits of a tax id, which is what the DGII expects in every RNC element. */
function digitsOf(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

/** `E31` + 10 padded digits — the e-NCF shape the DGII expects in an annulment range. */
function eNcfOf(type: NcfType, sequence: number): string {
  return `${type}${String(sequence).padStart(10, '0')}`;
}
