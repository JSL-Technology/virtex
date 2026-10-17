import { Injectable, Logger } from '@nestjs/common';
import { AccessAuditPort } from '../contracts/audit/access-audit.contract';
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
        access.userId,
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
