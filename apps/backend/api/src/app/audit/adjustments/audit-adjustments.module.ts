import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProposedAdjustment } from '../entities/proposed-adjustment.entity';
import { ProposedAdjustmentEvidence } from '../entities/proposed-adjustment-evidence.entity';
import { AuditAdjustmentsService } from './audit-adjustments.service';
import { AuditAdjustmentsController } from './audit-adjustments.controller';
import { AuditAdjustmentApprovalHandler } from './audit-adjustment-approval.handler';
import { WorkflowsModule } from '../../workflows/workflows.module';
import { StorageModule } from '../../storage/storage.module';
import { JournalEntriesModule } from '../../journal-entries/journal-entries.module';
import { AuthModule } from '../../auth/auth.module';

/**
 * An external audit's proposed corrections to a year that is already closed.
 *
 * ## Why this module did not exist
 *
 * `AuditAdjustmentsService`, `ProposedAdjustment` and `ProposedAdjustmentEvidence` were registered
 * NOWHERE. The proposal, the approval workflow, the evidence upload and the listener that posts
 * the entry once approved were all written, documented and unit-tested — and unreachable, because
 * no module provided the service and no controller called it.
 * `AdjustmentsService.createAuditAdjustment`, which posts into a closed year and transfers the
 * adjusted result to retained earnings, had no caller at all outside that dead listener, and the
 * permissions `audit:propose_adjustment` and `audit:approve_adjustment` sat in the catalogue with
 * nothing declaring them. A provider nobody provides still compiles and its tests still pass, so
 * nothing in the build said so.
 *
 * ## Why it is separate from `AuditModule`
 *
 * `AuthModule` imports `AuditModule`, so anything `AuditModule` imports is imported by the
 * authentication graph. Posting an adjustment needs `JournalEntriesModule`, which reaches
 * `BudgetsModule`, which imports `AuthModule` — a cycle that leaves `BudgetsModule`'s own import
 * of `AuthModule` evaluating to `undefined` at scan time and the application refusing to start.
 * The audit TRAIL and the audit ADJUSTMENT are different concerns anyway; keeping them in separate
 * modules means the cycle never forms rather than being papered over with `forwardRef`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProposedAdjustment, ProposedAdjustmentEvidence]),
    // The approval policy that decides whether a proposal needs a second pair of eyes.
    WorkflowsModule,
    // Working papers are uploaded as evidence against a proposal.
    StorageModule,
    // Where an approved proposal is actually posted.
    JournalEntriesModule,
    // `CsrfGuard` injects `CookieService`, which `AuthModule` provides. Every module with a
    // state-changing route does the same.
    AuthModule,
  ],
  providers: [AuditAdjustmentsService, AuditAdjustmentApprovalHandler],
  controllers: [AuditAdjustmentsController],
})
export class AuditAdjustmentsModule {}
