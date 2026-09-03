import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
    organizationId?: string | null,
  ): Promise<void> {
    const auditLog = this.auditLogRepository.create({
      userId,
      entity,
      entityId,
      actionType,
      newValue,
      previousValue,
      ipAddress,
      organizationId: organizationId ?? null,
    });
    // Fire-and-forget: No esperamos a que se guarde para no bloquear la request.
    // Capturamos errores para no romper el flujo principal.
    this.auditLogRepository.save(auditLog).catch(err => {
      console.error('Error saving audit log', err);
    });
  }

  /**
   * An audit row that shares the fate of the thing it describes.
   *
   * `record` above deliberately does not await its own save, so an HTTP request is never held up
   * by logging and a logging failure never breaks the operation. For an accounting event that
   * trade is the wrong way round: if the row is dropped, the posting it accounts for still
   * happened and the book has a movement nobody is answerable for. Written through the caller's
   * `EntityManager`, this row commits with the entry or rolls back with it.
   */
  async recordWithManager(
    manager: EntityManager,
    event: {
      userId: string | null;
      organizationId: string | null;
      entity: string;
      entityId: string;
      actionType: ActionType;
      newValue: object;
      previousValue?: object;
      ipAddress?: string;
    },
  ): Promise<void> {
    await manager.save(
      manager.create(AuditLog, {
        userId: event.userId ?? null,
        entity: event.entity,
        entityId: event.entityId,
        actionType: event.actionType,
        newValue: event.newValue,
        previousValue: event.previousValue,
        ipAddress: event.ipAddress,
        organizationId: event.organizationId ?? null,
      }),
    );
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

  /**
   * Everything one user did inside one tenant, newest first.
   *
   * Backs `GET /users/:id/activity`, which returned a hardcoded empty array while these rows were
   * being written all along. The organization is part of the WHERE clause, not a post-filter, so
   * a cross-tenant id returns nothing rather than someone else's history.
   */
  async findByActor(userId: string, organizationId: string, limit = 100): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { userId, organizationId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async find(entity?: string, entityId?: string, organizationId?: string): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
        where: {
            ...(entity && { entity }),
            ...(entityId && { entityId }),
            ...(organizationId && { organizationId }),
        },
        order: {
            timestamp: 'DESC'
        }
    });
  }

  
}
