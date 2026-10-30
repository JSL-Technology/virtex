
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ProposedAdjustment, AdjustmentStatus } from '../entities/proposed-adjustment.entity';
import { CreateProposedAdjustmentDto } from '../dto/proposed-adjustment.dto';
import { WorkflowsService } from '../../workflows/workflows.service';
import { DocumentTypeForApproval } from '../../workflows/entities/approval-policy.entity';
import { StorageService } from '../../storage/storage.service';
import { ProposedAdjustmentEvidence } from '../entities/proposed-adjustment-evidence.entity';
import { AdjustmentsService } from '../../journal-entries/adjustments.service';
import { User } from '../../users/entities/user.entity/user.entity';
import { FastifyFile, toUploadableFile } from '../../common/interfaces/fastify-file.interface';
import { BadRequestError, ForbiddenError, InternalServerError, NotFoundError, isLocalizedError } from '../../i18n/localized.exception';
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
    this.assertLines(dto);
    let raisedRequestId: string | null = null;
    const proposed = await this.dataSource.transaction(async (manager) => {
      this.logger.log(`Usuario ${proposer.id} propone ajuste de auditoría para el año fiscal ${dto.fiscalYearId}`);

      const adjustment = manager.create(ProposedAdjustment, {
        ...dto,
        organizationId,
        proposerId: proposer.id,
        status: AdjustmentStatus.PENDING_APPROVAL,
      });

      const savedAdjustment = await manager.save(adjustment);


      // On THIS transaction, and naming who proposed it. Without the manager the request was
      // written outside the transaction — it survived a proposal that rolled back — and without
      // the proposer nothing stopped them approving their own adjustment.
      const approvalRequest = await this.workflowsService.startApprovalProcess(
        organizationId,
        savedAdjustment.id,
        DocumentTypeForApproval.AUDIT_ADJUSTMENT,
        // The amount the policy's thresholds are measured against: what the adjustment moves.
        // It was 0, so a policy «above 10,000 needs the CFO» never applied to any adjustment.
        this.amountOf(dto),
        proposer.id,
        manager,
      );

      if (approvalRequest) {
        raisedRequestId = approvalRequest.id;
        savedAdjustment.approvalRequestId = approvalRequest.id;
        await manager.save(savedAdjustment);
        return savedAdjustment;
      }

      /*
       * No policy: nobody has to grant anything, so it posts here — on THIS transaction.
       *
       * It used to emit `audit.adjustment.approved` and let an `@OnEvent` listener open a second
       * transaction. That listener ran while this one was still in flight, TypeORM turned its
       * `dataSource.transaction()` into a `SAVEPOINT` on a connection that was not in a
       * transaction block, and every auto-approved proposal failed with
       * `SAVEPOINT can only be used in transaction blocks` — leaving it PENDING_APPROVAL with no
       * entry and no approver, forever. Posting inline also makes the pair atomic: a proposal
       * whose entry cannot be posted is not recorded as proposed.
       */
      this.logger.log(
        `Ajuste ${savedAdjustment.id} auto-aprobado por falta de política de aprobación.`,
      );
      await this.postApproved(manager, savedAdjustment.id, organizationId);
      return manager.findOneByOrFail(ProposedAdjustment, { id: savedAdjustment.id });
    });
    if (raisedRequestId) await this.workflowsService.announcePending(raisedRequestId);
    return proposed;
  }

  /**
   * Whether a proposal of this amount would wait for approval or post at once — told before it is
   * submitted, so «Propose» is never a surprise posting into a closed year.
   */
  async approvalRoute(organizationId: string, amount: number): Promise<{ requiresApproval: boolean; steps: number }> {
    const steps = await this.workflowsService.approvalSteps(organizationId, DocumentTypeForApproval.AUDIT_ADJUSTMENT, amount);
    return { requiresApproval: steps > 0, steps };
  }

  /** What the adjustment moves: its total debit, which is also its total credit. */
  private amountOf(dto: CreateProposedAdjustmentDto): number {
    return Math.round(dto.lines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0) * 100) / 100;
  }

  /**
   * Each line is a debit or a credit, never both and never neither, and the two sides balance —
   * checked here, before anything is written, with the line named. The journal posting would also
   * refuse an unbalanced entry, but only after approval, and with no line to point at.
   */
  private assertLines(dto: CreateProposedAdjustmentDto): void {
    if (dto.lines.length < 2) throw new BadRequestError('audit.adjustment_needs_two_lines');
    dto.lines.forEach((line, index) => {
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);
      if ((debit > 0) === (credit > 0)) {
        throw new BadRequestError('audit.adjustment_line_one_side', { line: index + 1 });
      }
    });
    const cents = (value: number) => Math.round(value * 100);
    const debit = dto.lines.reduce((sum, line) => sum + cents(Number(line.debit ?? 0)), 0);
    const credit = dto.lines.reduce((sum, line) => sum + cents(Number(line.credit ?? 0)), 0);
    if (debit !== credit) throw new BadRequestError('audit.adjustment_unbalanced');
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
      throw new NotFoundError('audit.adjustment_proposal_adjustment_id_not_found', { adjustmentId: id });
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
        throw new NotFoundError('audit.adjustment_proposal_adjustment_id_not_found', { adjustmentId });
      }
      if (adjustment.status !== AdjustmentStatus.PENDING_APPROVAL) {
        throw new ForbiddenError('audit.evidence_can_only_added_proposals_awaiting');
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
              'ledger.adjustment.audit',
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
          // The approving transaction. Opening a second one from inside it is what produced
          // `SAVEPOINT can only be used in transaction blocks` the first time this ran.
          manager,
        );

        adjustment.status = AdjustmentStatus.POSTED;
        adjustment.journalEntryId = journalEntry.id;
        await adjustmentRepo.save(adjustment);

        this.logger.log(`Ajuste de auditoría ${documentId} contabilizado exitosamente. Asiento contable creado: ${journalEntry.id}`);
      } catch (error) {
        this.logger.error(`Fallo al contabilizar el ajuste de auditoría ${documentId}. Revirtiendo estado.`, (error as Error).stack);
        adjustment.status = AdjustmentStatus.FAILED;
        await adjustmentRepo.save(adjustment);
        // A refusal the person can act on — a closed subledger, a blocked account, an archived
        // year — keeps its own status and message. Wrapping it in a 500 told them only that
        // «the adjustment could not be proposed», with the reason buried in a log.
        if (isLocalizedError(error) && error.getStatus() < 500) throw error;
        throw new InternalServerError('audit.approved_adjustment_could_not_processed_p1', { p1: (error as Error).message });
      }
    }
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