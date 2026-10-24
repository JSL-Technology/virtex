import { Injectable, Logger } from '@nestjs/common';
import { AccessAuditPort, ChangeAuditPort } from '../contracts/audit/access-audit.contract';
import { AuditTrailService } from './audit.service';
import { ActionType } from './entities/audit-log.entity';

/** `AccessAuditPort`, written exactly as `AuditAccessInterceptor` writes a read. */
@Injectable()
export class AccessAuditAdapter extends AccessAuditPort {
  private readonly logger = new Logger(AccessAuditAdapter.name);

  constructor(private readonly audit: AuditTrailService) {
    super();
  }

  recordRead(access: { userId: string; organizationId: string; entity: string; via: string; identifiers?: Record<string, unknown> }): void {
    void this.audit
      .record(
        // A report the scheduler generated reads as no one in particular, not as an empty id.
        access.userId || null,
        access.entity,
        access.entity,
        ActionType.READ,
        { action: 'read', endpoint: access.via, ...(access.identifiers ?? {}) },
        undefined,
        undefined,
        access.organizationId,
      )
      .catch((error: Error) => this.logger.error(`No se pudo registrar el acceso a ${access.entity}: ${error.message}`));
  }
}

/** `ChangeAuditPort`: a settings change, with its before and after, in the same trail. */
@Injectable()
export class ChangeAuditAdapter extends ChangeAuditPort {
  constructor(private readonly audit: AuditTrailService) {
    super();
  }

  recordChange(change: { userId: string | null; organizationId: string; entity: string; entityId: string; before: object | null; after: object }): Promise<void> {
    return this.audit.record(
      change.userId,
      change.entity,
      change.entityId,
      change.before ? ActionType.UPDATE : ActionType.CREATE,
      change.after,
      change.before ?? undefined,
      undefined,
      change.organizationId,
    );
  }

  actorsOf(organizationId: string, entityId: string): Promise<string[]> {
    return this.audit.actorsOf(organizationId, entityId);
  }
}
