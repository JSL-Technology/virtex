
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ProposedAdjustment, AdjustmentStatus } from '../entities/proposed-adjustment.entity';
import { CreateProposedAdjustmentDto } from '../dto/proposed-adjustment.dto';
import { WorkflowsService } from '../../workflows/workflows.service';
import { DocumentTypeForApproval } from '../../workflows/entities/approval-policy.entity';
import { StorageService } from '../../storage/storage.service';
import { ProposedAdjustmentEvidence } from '../entities/proposed-adjustment-evidence.entity';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { AdjustmentsService } from '../../journal-entries/adjustments.service';
import { User } from '../../users/entities/user.entity/user.entity';
import { FastifyFile, toUploadableFile } from '../../common/interfaces/fastify-file.interface';
import { ForbiddenError, InternalServerError, NotFoundError } from '../../i18n/localized.exception';
import { toIsoDate } from '../../common/dates';
import { Page, resolvePaging, toPage } from '../../common/pagination';
import { LedgerNarrativeService } from '../../journal-entries/ledger-narrative.service';
import { I18nService } from '../../i18n/i18n.service';

@Injectable()
export class AuditAdjustmentsService {
  private readonly logger = new Logger(AuditAdjustmentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly workflowsService: WorkflowsService,
    private readonly storageService: StorageService,
    private readonly eventEmitter: EventEmitter2,
    private readonly journalAdjustmentsService: AdjustmentsService,
    /** Narratives in the tenant's books language; see `LedgerNarrativeService`. */
    private readonly narrative: LedgerNarrativeService = new LedgerNarrativeService(
      new I18nService(),
    ),
  ) {}

  async proposeAdjustment(
    dto: CreateProposedAdjustmentDto,
    organizationId: string,
    proposer: User,
  ): Promise<ProposedAdjustment> {
    return this.dataSource.transaction(async (manager) => {
      this.logger.log(`Usuario ${proposer.id} propone ajuste de auditoría para el año fiscal ${dto.fiscalYearId}`);

      const adjustment = manager.create(ProposedAdjustment, {
        ...dto,
        organizationId,
        proposerId: proposer.id,
        status: AdjustmentStatus.PENDING_APPROVAL,
      });

      const savedAdjustment = await manager.save(adjustment);


      const approvalRequest = await this.workflowsService.startApprovalProcess(
        organizationId,
        savedAdjustment.id,
        DocumentTypeForApproval.AUDIT_ADJUSTMENT,
        0,
      );

      if (approvalRequest) {
        savedAdjustment.approvalRequestId = approvalRequest.id;
        await manager.save(savedAdjustment);
      } else {

        this.logger.log(`Ajuste ${savedAdjustment.id} auto-aprobado por falta de política de aprobación.`);
        this.eventEmitter.emit('audit.adjustment.approved', {
          documentId: savedAdjustment.id,
          organizationId,
        });
      }

      return savedAdjustment;
    });
  }

  /**
   * The tenant's proposed adjustments, newest first.
   *
   * Paged, because an audit of a large group produces hundreds of proposals across several years
   * and a list screen that asks for all of them is a list screen that stops working.
   */
  async findAll(
    organizationId: string,
    query: { page?: number; pageSize?: number; fiscalYearId?: string; status?: AdjustmentStatus } = {},
  ): Promise<Page<ProposedAdjustment>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const where: Record<string, unknown> = { organizationId };
    if (query.fiscalYearId) where['fiscalYearId'] = query.fiscalYearId;
    if (query.status) where['status'] = query.status;

    const [rows, total] = await this.dataSource.getRepository(ProposedAdjustment).findAndCount({
      where,
      relations: ['evidence', 'proposer'],
      order: { createdAt: 'DESC' },
      skip: paging.skip,
      take: paging.pageSize,
    });
    return toPage(rows, total, paging);
  }

  async findOne(id: string, organizationId: string): Promise<ProposedAdjustment> {
    const adjustment = await this.dataSource.getRepository(ProposedAdjustment).findOne({
      where: { id, organizationId },
      relations: ['evidence', 'proposer', 'fiscalYear', 'journal'],
    });
    if (!adjustment) {
      throw new NotFoundError('AUDIT.PROPUESTA_AJUSTE_ID_NO_ENCONTRADA', { adjustmentId: id });
    }
    return adjustment;
  }

  async addEvidence(
    adjustmentId: string,
    file: FastifyFile,
    organizationId: string,
    uploaderId: string,
  ): Promise<ProposedAdjustmentEvidence> {
    return this.dataSource.transaction(async (manager) => {
      const adjustment = await manager.findOneBy(ProposedAdjustment, { id: adjustmentId, organizationId });
      if (!adjustment) {
        throw new NotFoundError('AUDIT.PROPUESTA_AJUSTE_ID_NO_ENCONTRADA', { adjustmentId });
      }
      if (adjustment.status !== AdjustmentStatus.PENDING_APPROVAL) {
        throw new ForbiddenError('AUDIT.SOLO_PUEDE_ANADIR_EVIDENCIA_PROPUESTAS_PENDIENTES_APROBACION');
      }

      const storedFile = await this.storageService.upload(
        toUploadableFile(file),
        `audit-evidence/${organizationId}`,
      );

      const evidence = manager.create(ProposedAdjustmentEvidence, {
        proposedAdjustmentId: adjustmentId,
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: storedFile.fileSize,
        storageKey: storedFile.storageKey,
        uploadedByUserId: uploaderId,
      });

      return manager.save(evidence);
    });
  }

  /**
   * Post an approved proposal, on the caller's transaction.
   *
   * `AuditAdjustmentApprovalHandler` calls this INSIDE the transaction that grants the approval,
   * so a posting that fails — the fiscal year was archived between proposal and approval, an
   * account was retired in the meantime — fails the approval with it and the person who pressed
   * the button sees why. The auto-approve path below opens its own transaction and calls the same
   * method, so there is one implementation rather than two that can drift.
   */
  async postApproved(
    manager: EntityManager,
    documentId: string,
    organizationId: string,
  ): Promise<void> {
    {
      const adjustmentRepo = manager.getRepository(ProposedAdjustment);
      // NOT `relations: ['lines']`. The lines are a `jsonb` COLUMN on the proposal, not a child
      // table, so asking TypeORM for them as a relation threw
      // `EntityPropertyNotFoundError: Property "lines" was not found in "ProposedAdjustment"` —
      // on every approval, before a single line was read. The proposal went to FAILED and no
      // entry was ever posted. Nothing noticed because this listener was registered in no module
      // and had never run.
      const adjustment = await adjustmentRepo.findOne({
        where: { id: documentId, organizationId },
      });

      if (!adjustment || adjustment.status !== AdjustmentStatus.PENDING_APPROVAL) {
        this.logger.warn(`El ajuste ${documentId} no se encontró o ya fue procesado. Estado actual: ${adjustment?.status}`);
        return;
      }

      try {
        const journalEntry = await this.journalAdjustmentsService.createAuditAdjustment(
          {
            fiscalYearId: adjustment.fiscalYearId,
            // `date` is a `date` column and arrives as a string, whatever the entity's type says.
            // `toISOString()` on it threw at runtime — the same defect this whole path already had
            // one instance of, in `createAuditAdjustment`.
            date: toIsoDate(adjustment.date),
            description: await this.narrative.describe(
              manager,
              organizationId,
              'LEDGER.ADJUSTMENT.AUDIT',
              { description: adjustment.description },
            ),
            journalId: adjustment.journalId,
            lines: adjustment.lines.map(line => ({
              accountId: line.accountId,
              debit: line.debit,
              credit: line.credit,
              description: line.description,
              dimensions: line.dimensions,
            })),
          },
          organizationId,
          // The auditor who proposed the adjustment is its author. The approval granted it; it did
          // not author it, and an entry attributed to whoever happened to click approve would be a
          // worse record than one attributed to nobody. Null only if that account has since been
          // deleted, and the entry is then unattributed rather than credited to the wrong person.
          adjustment.proposerId,
        );

        adjustment.status = AdjustmentStatus.POSTED;
        adjustment.journalEntryId = journalEntry.id;
        await adjustmentRepo.save(adjustment);

        this.logger.log(`Ajuste de auditoría ${documentId} contabilizado exitosamente. Asiento contable creado: ${journalEntry.id}`);
      } catch (error) {
        this.logger.error(`Fallo al contabilizar el ajuste de auditoría ${documentId}. Revirtiendo estado.`, (error as Error).stack);
        adjustment.status = AdjustmentStatus.FAILED;
        await adjustmentRepo.save(adjustment);
        throw new InternalServerError('AUDIT.FALLO_PROCESAR_AJUSTE_APROBADO', { p1: (error as Error).message });
      }
    }
  }

  /**
   * The auto-approve path: a tenant with no approval policy for `AUDIT_ADJUSTMENT`.
   *
   * `proposeAdjustment` emits the event when `WorkflowsService` returns no approval request, which
   * means nobody has to grant anything. Where a policy DOES exist the approval goes through
   * `AuditAdjustmentApprovalHandler` instead, inside the approving transaction — this listener
   * never sees it.
   */
  @OnEvent('audit.adjustment.approved', { async: true })
  async handleAdjustmentApproved(payload: {
    documentId: string;
    organizationId: string;
  }): Promise<void> {
    const { documentId, organizationId } = payload;
    this.logger.log(`Procesando aprobación para el ajuste de auditoría ${documentId}`);
    await this.dataSource.transaction((manager) =>
      this.postApproved(manager, documentId, organizationId),
    );
  }

  /** A refused proposal stays in the record, marked, rather than disappearing. */
  async markRejected(
    manager: EntityManager,
    documentId: string,
    organizationId: string,
  ): Promise<void> {
    await manager.update(
      ProposedAdjustment,
      { id: documentId, organizationId, status: AdjustmentStatus.PENDING_APPROVAL },
      { status: AdjustmentStatus.REJECTED },
    );
  }
}