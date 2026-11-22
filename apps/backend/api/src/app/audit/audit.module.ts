import { AccessAuditAdapter, ChangeAuditAdapter } from './access-audit.adapter';
import { AccessAuditPort, ChangeAuditPort } from '../contracts/audit/access-audit.contract';
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditTrailService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditAccessInterceptor } from './audit-access.interceptor';

/**
 * The audit trail: who did what to which document.
 *
 * Deliberately small, and deliberately without the audit-ADJUSTMENT feature, which lives in
 * `AuditAdjustmentsModule`. `AuthModule` imports this module, so anything imported here is
 * imported by the authentication graph — and posting an adjustment needs `JournalEntriesModule`,
 * which reaches `BudgetsModule`, which imports `AuthModule` right back. Keeping the two apart is
 * what stops that cycle existing at all rather than being worked around with `forwardRef`.
 *
 * Global, because the trail is the one piece of infrastructure every module writes to, and a
 * platform module (`currencies`) must be able to record its changes through the ports in
 * `contracts/audit` without depending on this one — the module boundaries forbid the import, not the
 * record.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
  ],
  providers: [AuditTrailService, AuditAccessInterceptor, AccessAuditAdapter, { provide: AccessAuditPort, useExisting: AccessAuditAdapter }, ChangeAuditAdapter, { provide: ChangeAuditPort, useExisting: ChangeAuditAdapter }],
  controllers: [AuditController],
  // The interceptor is exported so the modules whose reports and exports are audited can apply it
  // with `@UseInterceptors` without each declaring its own copy — one instance, one audit service.
  exports: [AuditTrailService, AuditAccessInterceptor, AccessAuditPort, ChangeAuditPort],
})
export class AuditModule {}
