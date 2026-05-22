import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, ActionType } from './entities/audit-log.entity';

@Injectable()
export class AuditTrailService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async record(
    userId: string,
    entity: string,
    entityId: string,
    actionType: ActionType,
    newValue: object,
    previousValue?: object,
    ipAddress?: string,
  ): Promise<void> {
    const auditLog = this.auditLogRepository.create({
      userId,
      entity,
      entityId,
      actionType,
      newValue,
      previousValue,
      ipAddress,
    });
    // Fire-and-forget: No esperamos a que se guarde para no bloquear la request.
    // Capturamos errores para no romper el flujo principal.
    this.auditLogRepository.save(auditLog).catch(err => {
      console.error('Error saving audit log', err);
    });
  }

  async getLastLogin(userId: string): Promise<AuditLog | null> {
    return this.auditLogRepository.findOne({
      where: {
        userId,
        actionType: ActionType.LOGIN, // Filtramos solo eventos de login
      },
      order: {
        timestamp: 'DESC', // Obtenemos el más reciente
      },
    });
  }

  async find(entity?: string, entityId?: string): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
        where: {
            ...(entity && { entity }),
            ...(entityId && { entityId }),
        },
        order: {
            timestamp: 'DESC'
        }
    });
  }

  
}