import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog, ActionType } from './entities/audit-log.entity';

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * Record something that is not a financial mutation — a session event, an access, an
   * administrative change.
   *
   * **Not for financial mutations.** Those use `recordWithManager`, so the row commits with the
   * change or rolls back with it; a change to the books that is recorded outside their transaction
   * can survive a rollback or be lost while the change commits, and both leave the trail lying.
   * The financial document tables write their rows automatically through
   * `FinancialAuditSubscriber`, which does exactly that.
   *
   * This one awaits its save. It used to return before the row was written and swallow the failure
   * into `console.error`, on the reasoning that logging should not hold up a request — which meant
   * a login, a permission change or a data export could be dropped from the trail with no signal
   * anywhere. Awaiting costs one insert; the failure is logged at error level with its context and
   * still does not break the caller, because refusing a login because its audit row failed is not
   * an improvement either.
   */
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
    try {
      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(
        `No se pudo registrar la auditoría de ${entity}/${entityId} (${actionType}) ` +
          `para el usuario ${userId}: ${(error as Error).message}`,
      );
    }
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

  /**
   * The tenant's audit trail, newest first.
   *
   * ## Two things this signature now makes impossible
   *
   * `organizationId` was the **last** parameter and optional, spread into the where clause as
   * `...(organizationId && { organizationId })`. A caller that omitted it — or passed a value that
   * happened to be falsy — got every organization's audit trail on the platform. Nothing in the
   * type system objected, because the parameter was optional by declaration.
   *
   * There was also no limit. An established tenant's trail is one row per business action for the
   * life of the account; the route loaded all of it into memory and serialised it.
   */
  async find(
    organizationId: string,
    filters: { entity?: string; entityId?: string; page?: number; pageSize?: number } = {},
  ): Promise<{ rows: AuditLog[]; page: number; pageSize: number; total: number; hasMore: boolean }> {
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(filters.pageSize ?? 50)));

    const [rows, total] = await this.auditLogRepository.findAndCount({
      where: {
        organizationId,
        ...(filters.entity && { entity: filters.entity }),
        ...(filters.entityId && { entityId: filters.entityId }),
      },
      order: { timestamp: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { rows, page, pageSize, total, hasMore: page * pageSize < total };
  }

  
}
