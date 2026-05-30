import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, ActionType } from './entities/audit-log.entity';

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async record(
    userId: string,
    organizationId: string,
    entity: string,
    entityId: string,
    actionType: ActionType,
    newValue: object,
    previousValue?: object,
    ipAddress?: string,
  ): Promise<void> {
    const auditLog = this.auditLogRepository.create({
      userId,
      organizationId,
      entity,
      entityId,
      actionType,
      newValue,
      previousValue,
      ipAddress,
    });
    // Fire-and-forget: No esperamos a que se guarde para no bloquear la request.
    this.auditLogRepository.save(auditLog).catch(err => {
      this.logger.error('Error saving audit log', err);
    });
  }

  async getLastLogin(userId: string): Promise<AuditLog | null> {
    return this.auditLogRepository.findOne({
      where: {
        userId,
        actionType: ActionType.LOGIN,
      },
      order: {
        timestamp: 'DESC',
      },
    });
  }

  async find(
    organizationId: string,
    entity?: string,
    entityId?: string,
    page = 1,
    pageSize = 50,
  ): Promise<{ data: AuditLog[]; total: number }> {
    const [data, total] = await this.auditLogRepository.findAndCount({
      where: {
        organizationId,
        ...(entity ? { entity } : {}),
        ...(entityId ? { entityId } : {}),
      },
      order: {
        timestamp: 'DESC',
      },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return { data, total };
  }
}
