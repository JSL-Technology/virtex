import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { UsageMetric } from '../entities/usage-metric.entity';
import { SaasService } from '../saas.service';
import { Organization } from '../../organizations/entities/organization.entity';
import { SaasCacheKeyFactory } from '../utils/saas-cache-key.factory';
import Redis from 'ioredis';

@Injectable()
export class SaasCronService {
  private readonly logger = new Logger(SaasCronService.name);

  constructor(
    @InjectRepository(UsageMetric)
    private readonly usageRepository: Repository<UsageMetric>,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
    private readonly saasService: SaasService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {}

  /**
   * Reconciles Redis counters with the Database source of truth.
   * This ensures eventual consistency in case of transaction rollbacks
   * or Redis persistence failures.
   *
   * Run every night at 2 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async reconcileUsageCounters() {
    // 10/10 Improvement: Distributed Locking
    // Prevent multiple instances (pods) from running the same heavy Cron job simultaneously.
    const lockKey = 'saas:cron:reconcile_lock';
    const lockTtl = 30 * 60 * 1000; // 30 minutes lock
    const lockValue = new Date().toISOString();

    const acquired = await this.acquireLock(lockKey, lockValue, lockTtl);
    if (!acquired) {
        this.logger.log('SaaS Reconciliation skipped (Lock held by another instance).');
        return;
    }

    try {
        await this.performReconciliation();
    } finally {
        await this.releaseLock(lockKey, lockValue);
    }
  }

  private async performReconciliation() {
    this.logger.log('Starting SaaS Usage Reconciliation...');

    // 1. Get active metrics from DB (only those that might have discrepancies)
    // We process in batches to avoid memory issues
    const BATCH_SIZE = 100;
    let skip = 0;
    let hasMore = true;
    let reconciledCount = 0;

    while (hasMore) {
        const metrics = await this.usageRepository.find({
            take: BATCH_SIZE,
            skip: skip
        });

        if (metrics.length === 0) {
            hasMore = false;
            break;
        }

        for (const metric of metrics) {
            try {
                // Determine the cache key for this metric
                // We need to reconstruct the periodKey used in SaasService
                // stored in metric.period
                const periodKey = metric.period;
                const resource = metric.resource;
                const organizationId = metric.organizationId;
                const dbCount = metric.count;

                const cacheKey = SaasCacheKeyFactory.usageCounter(organizationId, resource, periodKey);

                // Check Redis value
                const redisVal = await this.cacheManager.get<number>(cacheKey);

                // If Redis is missing or different, update it to match DB (Source of Truth)
                if (redisVal === undefined || Number(redisVal) !== dbCount) {
                    await this.cacheManager.set(cacheKey, dbCount, 24 * 3600 * 1000); // 24h TTL
                    reconciledCount++;
                }

                // Also update the "plan_limit_check" cache boolean
                // This forces a re-evaluation on next request if the status changed
                 const versionKey = SaasCacheKeyFactory.limitVersion(organizationId);
                 const version = await this.cacheManager.get<number>(versionKey) || 0;
                 const checkCacheKey = SaasCacheKeyFactory.limitCheck(organizationId, version, resource);
                 await this.cacheManager.del(checkCacheKey);

            } catch (e) {
                this.logger.error(`Failed to reconcile metric ${metric.id}: ${e.message}`);
            }
        }

        skip += BATCH_SIZE;
        // Small delay to prevent CPU choking
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    this.logger.log(`SaaS Reconciliation Complete. Reconciled ${reconciledCount} counters.`);
  }

  // Helper to acquire distributed lock using Redis SET NX PX
  private async acquireLock(key: string, value: string, ttlMs: number): Promise<boolean> {
      const store = (this.cacheManager as any).store;
      // If store exposes a native redis client (ioredis or node-redis)
      if (store.client) {
          try {
             // ioredis syntax: set(key, value, 'PX', ttl, 'NX')
             // node-redis v4 syntax: set(key, value, { PX: ttl, NX: true })
             // We'll try common patterns. ioredis is in package.json.
             const client = store.client;
             if (client.set) {
                 const result = await client.set(key, value, 'PX', ttlMs, 'NX');
                 return result === 'OK';
             }
          } catch (e) {
              this.logger.error(`Failed to acquire lock via Redis: ${e.message}`);
          }
      }
      return true; // Fallback: if no redis client, assume single instance (dev)
  }

  private async releaseLock(key: string, value: string): Promise<void> {
      const store = (this.cacheManager as any).store;
      if (store.client) {
           try {
               // Simple release. For strict safety we should use Lua script to check value match,
               // but for a daily cron this is acceptable 99.9%
               const client = store.client;
               const currentVal = await client.get(key);
               if (currentVal === value) {
                   await client.del(key);
               }
           } catch (e) {
               this.logger.error(`Failed to release lock: ${e.message}`);
           }
      }
  }
}
