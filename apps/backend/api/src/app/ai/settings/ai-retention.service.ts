import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { forEachTenant } from '../../shared/tenancy/tenant-job';
import { currentTenantStore } from '../../shared/tenancy/tenant-context';
import { SchedulerLockService } from '../../shared/scheduler/scheduler-lock.service';
import { AiSettingsService } from './ai-settings.service';

/**
 * Keeps assistant conversations only as long as each company decided.
 *
 * A conversation stores what the tools read — balances, customers, statements — so it is personal
 * and financial data with no end date unless one is set. Every night, per company:
 *
 *  - a conversation untouched for longer than `conversation_retention_days` is deleted (its
 *    messages and what the tools returned in it go with it);
 *  - so is any conversation of a person who is no longer an active member of the company;
 *  - a proposal still unconfirmed past its 24 h is marked expired.
 *
 * What the copilot proposed and what was decided (`ai_pending_actions`) is kept: it is the record of
 * what the AI did, and outlives the conversation it came from. Runs once per day across replicas.
 */
@Injectable()
export class AiRetentionService {
  private readonly logger = new Logger(AiRetentionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: AiSettingsService,
    private readonly lock: SchedulerLockService,
  ) {}

  @Cron('37 4 * * *')
  async nightly(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    await this.lock.runOnce('ai-retention', day, async () => {
      await forEachTenant(this.dataSource, (organizationId) => this.purge(organizationId).then(() => undefined));
    });
  }

  /** One company's purge, in its tenant context. Returns how many conversations were deleted. */
  async purge(organizationId: string): Promise<number> {
    const manager = currentTenantStore()?.manager ?? this.dataSource.manager;
    const { conversationRetentionDays } = await this.settings.get(organizationId);
    await manager.query(
      `UPDATE "ai_pending_actions" SET "status" = 'EXPIRED', "decided_at" = now()
        WHERE "organization_id" = $1 AND "status" = 'PROPOSED' AND "created_at" < now() - interval '24 hours'`,
      [organizationId],
    );
    const deleted = (await manager.query(
      `DELETE FROM "ai_conversations" c
        WHERE c."organization_id" = $1
          AND (
            c."updated_at" < now() - make_interval(days => $2::int)
            OR NOT EXISTS (
              SELECT 1 FROM "user_organizations" m JOIN "users" u ON u."id" = m."user_id"
               WHERE m."organization_id" = c."organization_id" AND m."user_id" = c."user_id"
                 AND m."suspended_at" IS NULL AND u."status" = 'ACTIVE'
            )
          )
        RETURNING c."id"`,
      [organizationId, conversationRetentionDays],
    )) as [unknown[], number] | unknown[];
    const count = Array.isArray(deleted[0]) ? (deleted[0] as unknown[]).length : (deleted as unknown[]).length;
    if (count) this.logger.log(`AI retention: ${count} conversation(s) deleted for ${organizationId}.`);
    return count;
  }
}
