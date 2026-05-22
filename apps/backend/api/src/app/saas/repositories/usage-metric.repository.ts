import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SaasResource } from '../enums/saas-resource.enum';
import { UsageMetric } from '../entities/usage-metric.entity';

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
    // 1. Construct Query
    // We use COALESCE to handle cases but here we are updating existing or inserting.
    let updateQuery = `
         UPDATE saas_usage_metrics
         SET count = count + $1, updated_at = NOW()
         WHERE organization_id = $2 AND resource = $3 AND period = $4
    `;

    const params = [increment, organizationId, resource, periodKey];

    if (!allowOverage && limit !== -1) {
        // Atomic Check-and-Set: Only update if new value is within limit
        updateQuery += ` AND count + $1 <= $5`;
        params.push(limit);
    }

    updateQuery += ` RETURNING count`;

    // 2. Try Update (Optimistic Locking / Row Locking)
    const updateResult = await manager.query(updateQuery, params);

    if (updateResult[0]) {
        return { count: updateResult[0].count, limitReached: false };
    }

    // 3. If Update failed...
    // Scenario A: Row doesn't exist -> Try Insert
    // Scenario B: Row exists but Limit Reached -> Check existing count

    // Let's check if row exists to distinguish A vs B
    // Actually, checking existence is an extra RTT. We can try insert and catch error.

    try {
        const insertQuery = `
            INSERT INTO saas_usage_metrics (organization_id, resource, period, count, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING count
        `;
        const insertParams = [organizationId, resource, periodKey, increment];

        const insertResult = await manager.query(insertQuery, insertParams);

        // Check immediate limit violation on insert (e.g. if increment > limit)
        if (!allowOverage && limit !== -1 && insertResult[0].count > limit) {
             // This effectively rolls back because we throw in Service,
             // but here we just return state. The caller will likely throw.
             return { count: insertResult[0].count, limitReached: true };
        }

        return { count: insertResult[0].count, limitReached: false };

    } catch (err: any) {
        // 4. Handle Race Condition (Unique Violation 23505)
        // If two threads reach here, one inserted, the other failed.
        // The failure means the row NOW exists. So we retry the Update.
        if (err.code === '23505') {
            const retryResult = await manager.query(updateQuery, params);

            if (retryResult[0]) {
                return { count: retryResult[0].count, limitReached: false };
            }

            // If retry fails and we don't allow overage, it strongly suggests limit is reached.
            // Or the row disappeared (unlikely in transaction).
            if (!allowOverage && limit !== -1) {
                // To be precise, we should fetch current count to confirm.
                const current = await manager.query(
                    `SELECT count FROM saas_usage_metrics WHERE organization_id = $1 AND resource = $2 AND period = $3`,
                    [organizationId, resource, periodKey]
                );
                const currentCount = current[0]?.count ?? 0;
                return { count: currentCount, limitReached: true };
            }
        }
        throw err;
    }
  }

  async findOne(manager: EntityManager, organizationId: string, resource: SaasResource, period: string): Promise<UsageMetric | null> {
      return manager.findOne(UsageMetric, {
          where: { organizationId, resource, period }
      });
  }
}
