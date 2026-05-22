
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ProposedAdjustment, AdjustmentStatus } from '../entities/proposed-adjustment.entity';
import { CreateProposedAdjustmentDto } from '../dto/proposed-adjustment.dto';
import { WorkflowsService } from '../workflows/workflows.service';
import { DocumentTypeForApproval } from '../workflows/entities/approval-policy.entity';
import { StorageService } from '../storage/storage.service';
import { ProposedAdjustmentEvidence } from '../entities/proposed-adjustment-evidence.entity';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { AdjustmentsService } from '../journal-entries/adjustments.service';
import { User } from '../users/entities/user.entity/user.entity';

@Injectable()
export class AuditAdjustmentsService {
  private readonly logger = new Logger(AuditAdjustmentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly workflowsService: WorkflowsService,
    private readonly storageService: StorageService,
    private readonly eventEmitter: EventEmitter2,
    private readonly journalAdjustmentsService: AdjustmentsService,
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

  async addEvidence(
    adjustmentId: string,
    file: Express.Multer.File,
    organizationId: string,
    uploaderId: string,
  ): Promise<ProposedAdjustmentEvidence> {
    return this.dataSource.transaction(async (manager) => {
      const adjustment = await manager.findOneBy(ProposedAdjustment, { id: adjustmentId, organizationId });
      if (!adjustment) {
        throw new NotFoundException(`Propuesta de ajuste con ID "${adjustmentId}" no encontrada.`);
      }
      if (adjustment.status !== AdjustmentStatus.PENDING_APPROVAL) {
        throw new ForbiddenException('Solo se puede añadir evidencia a propuestas pendientes de aprobación.');
      }

      const storedFile = await this.storageService.upload({
        fileName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
      }, organizationId);

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

  @OnEvent('audit.adjustment.approved', { async: true })
  async handleAdjustmentApproved(payload: { documentId: string; organizationId: string }): Promise<void> {
    const { documentId, organizationId } = payload;
    this.logger.log(`Procesando aprobación para el ajuste de auditoría ${documentId}`);

    await this.dataSource.transaction(async (manager) => {
      const adjustmentRepo = manager.getRepository(ProposedAdjustment);
      const adjustment = await adjustmentRepo.findOne({
        where: { id: documentId, organizationId },
        relations: ['lines'],
      });

      if (!adjustment || adjustment.status !== AdjustmentStatus.PENDING_APPROVAL) {
        this.logger.warn(`El ajuste ${documentId} no se encontró o ya fue procesado. Estado actual: ${adjustment?.status}`);
        return;
      }

      try {
        const journalEntry = await this.journalAdjustmentsService.createAuditAdjustment(
          {
            fiscalYearId: adjustment.fiscalYearId,
            date: adjustment.date.toISOString(),
            description: `Ajuste de Auditoría: ${adjustment.description}`,
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
        );

        adjustment.status = AdjustmentStatus.POSTED;
        adjustment.journalEntryId = journalEntry.id;
        await adjustmentRepo.save(adjustment);

        this.logger.log(`Ajuste de auditoría ${documentId} contabilizado exitosamente. Asiento contable creado: ${journalEntry.id}`);
      } catch (error) {
        this.logger.error(`Fallo al contabilizar el ajuste de auditoría ${documentId}. Revirtiendo estado.`, error.stack);
        adjustment.status = AdjustmentStatus.FAILED;
        await adjustmentRepo.save(adjustment);
        throw new InternalServerErrorException(`Fallo al procesar el ajuste aprobado: ${error.message}`);
      }
    });
  }
}