import { AccessAuditAdapter, ChangeAuditAdapter } from './access-audit.adapter';
import { AccessAuditPort, ChangeAuditPort } from '../contracts/audit/access-audit.contract';
import { Module } from '@nestjs/common';
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
 */
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
