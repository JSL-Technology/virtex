import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SaasResource } from '../enums/saas-resource.enum';
import { UsageMetric } from '../entities/usage-metric.entity';
import { returnedRows } from '../../shared/database/returned-rows';

@Injectable()
export class UsageMetricRepository {
  private readonly logger = new Logger(UsageMetricRepository.name);

  /**
   * Atomically increments usage count.
   * Abstracts the database-specific SQL (PostgreSQL) from the service layer.
   *
   * SECURITY & CONCURRENCY NOTE:
   * This method uses raw SQL `UPDATE ... RETURNING` which is atomic in PostgreSQL.
   * It ensures that concurrent requests incrementing the same counter will be serialized by the database engine
   * regarding the row lock, preventing "Lost Update" race conditions.
   * (Atomic Increment Verified)
   *
   * For the "Insert if not exists" case, it handles `23505` (Unique Violation) by retrying the Update,
   * ensuring correctness even if two requests try to insert the first record simultaneously.
   */
  async incrementUsage(
    manager: EntityManager,
    organizationId: string,
    resource: SaasResource,
    periodKey: string,
    increment: number,
    limit: number,
    allowOverage: boolean
  ): Promise<{ count: number; limitReached: boolean }> {
    // Runs inside the CALLER's transaction (issuing an invoice, creating a customer…), so it must
    // never raise a database error: PostgreSQL aborts the whole transaction on any error, even one
    // that is caught, and every statement after it fails with "current transaction is aborted".
    // The previous version inserted the counter row and caught the 23505 of a concurrent insert —
    // which left the invoice's transaction dead, so issuing a credit note or voiding with the quota
    // exhausted answered 500 (audit 2026-11-07, FAC-INV-01).
    //
    // 1. Make sure the row exists, without ever raising: ON CONFLICT DO NOTHING.
    await manager.query(
      `INSERT INTO saas_usage_metrics (organization_id, resource, period, count, updated_at)
       VALUES ($1, $2, $3, 0, NOW())
       ON CONFLICT (organization_id, resource, period) DO NOTHING`,
      [organizationId, resource, periodKey],
    );

    // 2. One atomic check-and-increment. The row lock it takes serialises concurrent callers, and
    //    the limit is part of the WHERE clause, so two requests can never both take the last unit.
    const enforce = !allowOverage && limit !== -1;
    const [updated] = returnedRows<{ count: string | number }>(
      await manager.query(
        `UPDATE saas_usage_metrics
            SET count = count + $1, updated_at = NOW()
          WHERE organization_id = $2 AND resource = $3 AND period = $4
            ${enforce ? 'AND count + $1 <= $5' : ''}
          RETURNING count`,
        enforce ? [increment, organizationId, resource, periodKey, limit] : [increment, organizationId, resource, periodKey],
      ),
    );
    if (updated) return { count: Number(updated.count), limitReached: false };

    // 3. Only the limit can stop the update now: report the count as it stands.
    const [current] = returnedRows<{ count: string | number }>(
      await manager.query(
        `SELECT count FROM saas_usage_metrics WHERE organization_id = $1 AND resource = $2 AND period = $3`,
        [organizationId, resource, periodKey],
      ),
    );
    return { count: Number(current?.count ?? 0), limitReached: true };
  }

  /**
   * Give a unit of quota back.
   *
   * Its absence was a hard commercial dead end. `USERS`, `CUSTOMERS`, `SUPPLIERS` and
   * `SUBSIDIARIES` are all `LIFETIME` quotas, and with only an increment they counted "created
   * ever" rather than "existing now": a Starter tenant that deleted fifty customers still could
   * not create one, and removing an employee never freed their seat. The only remedy was a
   * support engineer editing `saas_usage_metrics` by hand.
   *
   * Floors at zero rather than letting the counter go negative — a negative counter would hand
   * out free quota, which is the mirror image of the bug and harder to notice.
   */
  async decrementUsage(
    manager: EntityManager,
    organizationId: string,
    resource: SaasResource,
    periodKey: string,
    decrement = 1,
  ): Promise<number> {
    const [row] = returnedRows<{ count: string | number }>(await manager.query(
      `UPDATE saas_usage_metrics
          SET count = GREATEST(count - $1, 0), updated_at = NOW()
        WHERE organization_id = $2 AND resource = $3 AND period = $4
        RETURNING count`,
      [decrement, organizationId, resource, periodKey],
    ));
    return Number(row?.count ?? 0);
  }

  /**
   * Overwrite a counter with a value counted from the source of truth.
   *
   * Used by reconciliation. `incrementUsage` is authoritative in the moment, but a rolled-back
   * transaction, a restored backup or a bulk import performed outside the metered path all leave
   * it drifted from the rows that actually exist, and nothing ever corrected it.
   */
  async setUsage(
    manager: EntityManager,
    organizationId: string,
    resource: SaasResource,
    periodKey: string,
    count: number,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO saas_usage_metrics (organization_id, resource, period, count, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (organization_id, resource, period)
       DO UPDATE SET count = EXCLUDED.count, updated_at = NOW()`,
      [organizationId, resource, periodKey, count],
    );
  }

  async findOne(manager: EntityManager, organizationId: string, resource: SaasResource, period: string): Promise<UsageMetric | null> {
      return manager.findOne(UsageMetric, {
          where: { organizationId, resource, period }
      });
  }
}
