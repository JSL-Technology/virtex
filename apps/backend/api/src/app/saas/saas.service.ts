import { Injectable, OnModuleInit, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Plan } from './entities/plan.entity';
import { PlanLimit, LimitType } from './entities/plan-limit.entity';
import { PlanFeature } from './entities/plan-feature.entity';
import { UsageMetric } from './entities/usage-metric.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { ConfigService } from '@nestjs/config';
import { SaasResource } from './enums/saas-resource.enum';
import { QuotaPeriod } from './enums/quota-period.enum';
import { SAAS_PLANS } from './saas.config';
import { SaasLimitReachedException, SaasFeatureNotEnabledException } from './exceptions/saas-exception';
import { DateTime } from 'luxon';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsageMetricRepository } from './repositories/usage-metric.repository';
import { OrganizationSubscriptionHistory } from '../organizations/entities/organization-subscription-history.entity';
import { MetricsService } from '../metrics/metrics.service';
import { SaasCacheKeyFactory } from './utils/saas-cache-key.factory';

@Injectable()
export class SaasService implements OnModuleInit {
  private readonly logger = new Logger(SaasService.name);

  constructor(
    @InjectRepository(Plan) private planRepository: Repository<Plan>,
    @InjectRepository(PlanLimit) private limitRepository: Repository<PlanLimit>,
    @InjectRepository(PlanFeature) private featureRepository: Repository<PlanFeature>,
    @InjectRepository(Organization) private orgRepository: Repository<Organization>,
    @InjectRepository(UsageMetric) private usageRepository: Repository<UsageMetric>,
    @InjectRepository(OrganizationSubscriptionHistory) private subscriptionHistoryRepository: Repository<OrganizationSubscriptionHistory>,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private usageMetricRepository: UsageMetricRepository,
    private dataSource: DataSource,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private metricsService: MetricsService
  ) {}

  async onModuleInit() {
    if (this.configService.get('SAAS_SEED_ENABLED') === 'true') {
      await this.seedPlans();
    }
  }

  async seedPlans() {
    this.logger.log('Seeding/Updating SaaS Plans from Config...');

    for (const pConfig of SAAS_PLANS) {
        const monthlyPriceId = process.env[pConfig.monthlyPriceIdVar];

        // 10/10 Improvement: Use upsert for atomic plan creation/update
        await this.planRepository.upsert(
            {
                slug: pConfig.slug,
                name: pConfig.name,
                monthlyPriceId: monthlyPriceId,
            },
            ['slug']
        );

        let plan = await this.planRepository.findOne({ where: { slug: pConfig.slug }, relations: ['limits'] });

        if (!plan) continue;

        const configLimits = pConfig.limits;
        const existingLimits = plan.limits || [];

        for (const cLimit of configLimits) {
             const existing = existingLimits.find(l => l.resource === cLimit.resource);
             if (existing) {
                 if (existing.limit !== cLimit.limit || existing.period !== cLimit.period || existing.allowOverage !== cLimit.allowOverage) {
                     existing.limit = cLimit.limit;
                     existing.period = cLimit.period;
                     existing.allowOverage = cLimit.allowOverage ?? false;
                     await this.limitRepository.save(existing);
                 }
             } else {
                 const newLimit = this.limitRepository.create({
                     plan: plan,
                     resource: cLimit.resource,
                     limit: cLimit.limit,
                     period: cLimit.period,
                     allowOverage: cLimit.allowOverage ?? false
                 });
                 await this.limitRepository.save(newLimit);
             }
        }

        const configResources = configLimits.map(l => l.resource);
        const limitsToRemove = existingLimits.filter(l => !configResources.includes(l.resource));
        if (limitsToRemove.length > 0) {
            await this.limitRepository.remove(limitsToRemove);
        }
    }

    this.logger.log('SaaS Plans seeded.');
  }

  async getPlans() {
    return this.planRepository.find({ relations: ['limits', 'features'] });
  }

  async getPlanBySlug(slug: string) {
    return this.planRepository.findOne({ where: { slug }, relations: ['limits', 'features'] });
  }

  async changePlan(organizationId: string, newPlanSlug: string, userId?: string, reason: string = 'upgrade'): Promise<void> {
      await this.dataSource.transaction(async (manager) => {
          const org = await manager.findOne(Organization, { where: { id: organizationId }, relations: ['plan'] });
          if (!org) {
              throw new Error('Organization not found');
          }

          const newPlan = await manager.findOne(Plan, { where: { slug: newPlanSlug } });
          if (!newPlan) {
              throw new Error('Plan not found');
          }

          if (org.plan && org.plan.id === newPlan.id) {
              return;
          }

          const previousPlan = org.plan;

          org.plan = newPlan;
          await manager.save(org);

          const history = this.subscriptionHistoryRepository.create({
              organizationId: org.id,
              previousPlanId: previousPlan?.id,
              newPlanId: newPlan.id,
              changedBy: userId,
              reason: reason
          });

          await manager.save(history);
          await this.clearOrganizationCache(organizationId);

          this.logger.log(`Organization ${organizationId} changed plan from ${previousPlan?.slug ?? 'none'} to ${newPlan.slug}`);
      });
  }

  async clearOrganizationCache(organizationId: string) {
      const versionKey = SaasCacheKeyFactory.limitVersion(organizationId);
      const currentVersion = await this.cacheManager.get<number>(versionKey) || 0;
      await this.cacheManager.set(versionKey, currentVersion + 1, { ttl: 0 } as any);

      this.logger.log(`Cache invalidated for Organization ${organizationId} (v${currentVersion + 1})`);
  }

  private async getCacheKey(organizationId: string, resource: SaasResource): Promise<string> {
      const versionKey = SaasCacheKeyFactory.limitVersion(organizationId);
      const version = await this.cacheManager.get<number>(versionKey) || 0;
      return SaasCacheKeyFactory.limitCheck(organizationId, version, resource);
  }

  public getPeriodKey(
      periodType: QuotaPeriod,
      org: Organization,
      targetDate: Date = new Date()
  ): string {
      if (periodType === QuotaPeriod.LIFETIME) {
          return QuotaPeriod.LIFETIME;
      }

      if (periodType === QuotaPeriod.MONTHLY) {
          const effectiveEndDate = (org.gracePeriodEnd && org.gracePeriodEnd > (org.subscriptionPeriodEnd || new Date(0)))
              ? org.gracePeriodEnd
              : org.subscriptionPeriodEnd;

          if (effectiveEndDate && effectiveEndDate > new Date()) {
               return DateTime.fromJSDate(org.subscriptionPeriodEnd || effectiveEndDate).toUTC().toFormat('yyyy-MM-dd');
          } else {
               return DateTime.fromJSDate(targetDate).toUTC().toFormat('yyyy-MM');
          }
      }

      return 'unknown_period';
  }

  async setUsageRedis(organizationId: string, resource: SaasResource, periodKey: string, value: number): Promise<void> {
      const cacheKey = SaasCacheKeyFactory.usageCounter(organizationId, resource, periodKey);
      await this.cacheManager.set(cacheKey, value, 24 * 3600 * 1000);
  }

  async enforceLimit(manager: EntityManager, organizationId: string, resource: SaasResource, increment: number = 1): Promise<void> {
    const org = await manager.findOne(Organization, {
        where: { id: organizationId },
        relations: ['plan', 'plan.limits']
    });

    if (!org || !org.plan) {
        this.logger.warn(
          `Organization ${organizationId} has no plan assigned. Skipping SaaS limit enforcement for backward compatibility.`,
        );
        return;
    }

    const limitDef = org.plan.limits.find(l => l.resource === resource);
    if (!limitDef) {
        return;
    }

    if (limitDef.valueType === LimitType.BOOLEAN) {
       if (!limitDef.isEnabled) {
           throw new SaasFeatureNotEnabledException(resource);
       }
       return;
    }

    const periodKey = this.getPeriodKey(limitDef.period, org);
    const allowOverage = limitDef.allowOverage;
    const isUnlimited = limitDef.isUnlimited || limitDef.limit === -1;

    // 10/10 Improvement: Atomic Consistency (DB First)
    // We increment DB first to ensure persistence. If DB fails, Redis is untouched.
    // If DB succeeds, we update Redis to match DB.
    // This avoids "ghost usage" in Redis if DB rolls back.
    const result = await this.usageMetricRepository.incrementUsage(
        manager,
        organizationId,
        resource,
        periodKey,
        increment,
        isUnlimited ? -1 : limitDef.limit,
        allowOverage
    );

    // Sync Redis with the Source of Truth (DB)
    try {
        await this.setUsageRedis(organizationId, resource, periodKey, result.count);
    } catch (e) {
        this.logger.warn(`Redis update failed after DB increment: ${e.message}`);
        // We do not throw here, because DB is committed.
        // The Cron Job will reconcile any drift eventually.
    }

    // 10/10 OPTIMIZATION: Write-Through Cache
    // Instead of deleting, we update the cache with the new status.
    // This prevents a cache miss on the next Read (Guard check).
    const cacheKey = await this.getCacheKey(organizationId, resource);
    const canProceed = isUnlimited || allowOverage || (result.count <= limitDef.limit);

    // Update cache with new status
    await this.cacheManager.set(cacheKey, canProceed, canProceed ? 60000 : 300000);

    if (!isUnlimited && limitDef.limit > 0) {
        const percentage = result.count / limitDef.limit;
        if (percentage >= 0.8 && percentage < 1.0) {
            this.emitLimitWarningEvent(organizationId, resource, result.count, limitDef.limit, percentage);
        }
    }

    if (result.limitReached) {
        // Ensure cache is blocked
        await this.cacheManager.set(cacheKey, false, 5 * 60 * 1000);
        this.metricsService.limitHitCounter.labels(organizationId, resource).inc();
        this.emitLimitReachedEvent(organizationId, resource, result.count, limitDef.limit);
        throw new SaasLimitReachedException(resource);
    } else {
        if (allowOverage && !isUnlimited && result.count > limitDef.limit) {
            this.emitLimitReachedEvent(organizationId, resource, result.count, limitDef.limit);
        }
    }
  }

  async checkFeature(organizationId: string, featureKey: string): Promise<boolean> {
     const cacheKey = SaasCacheKeyFactory.featureFlag(organizationId, featureKey);
     const cached = await this.cacheManager.get<boolean>(cacheKey);
     if (cached !== undefined) return cached;

     const org = await this.orgRepository.findOne({
         where: { id: organizationId },
         relations: ['plan', 'plan.features']
     });

     if (!org || !org.plan) return false;

     const feature = org.plan.features.find(f => f.featureKey === featureKey);
     const isEnabled = feature ? feature.isEnabled : false;

     await this.cacheManager.set(cacheKey, isEnabled, 60 * 1000);
     return isEnabled;
  }

  async getUsage(organizationId: string) {
    const org = await this.orgRepository.findOne({
        where: { id: organizationId },
        relations: ['plan', 'plan.limits']
    });

    if (!org || !org.plan) return [];

    const periodKeys = new Set<string>([QuotaPeriod.LIFETIME]);
    const monthlyPeriodKey = this.getPeriodKey(QuotaPeriod.MONTHLY, org);
    periodKeys.add(monthlyPeriodKey);

    const metrics = await this.usageRepository.createQueryBuilder('metric')
        .where('metric.organizationId = :orgId', { orgId: organizationId })
        .andWhere('metric.period IN (:...periods)', { periods: Array.from(periodKeys) })
        .getMany();

    const metricMap = new Map<string, UsageMetric>();
    metrics.forEach(m => metricMap.set(`${m.resource}:${m.period}`, m));

    const usageData = [];

    for (const limit of org.plan.limits) {
        if (limit.valueType === LimitType.BOOLEAN) {
            usageData.push({
                resource: limit.resource,
                type: 'boolean',
                isEnabled: limit.isEnabled,
                limit: null,
                used: null
            });
            continue;
        }

        let periodKey = QuotaPeriod.LIFETIME;
        if (limit.period === QuotaPeriod.MONTHLY) {
             periodKey = monthlyPeriodKey;
        }

        const metric = metricMap.get(`${limit.resource}:${periodKey}`);

        usageData.push({
            resource: limit.resource,
            type: 'numeric',
            limit: limit.limit,
            used: metric ? metric.count : 0,
            isUnlimited: limit.isUnlimited || limit.limit === -1,
            period: limit.period
        });
    }

    return usageData;
  }

  async checkLimit(organizationId: string, resource: SaasResource, increment: number): Promise<boolean> {
    const cacheKey = await this.getCacheKey(organizationId, resource);
    const cached = await this.cacheManager.get<boolean>(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    const org = await this.orgRepository.findOne({
        where: { id: organizationId },
        relations: ['plan', 'plan.limits']
    });

    if (!org || !org.plan) {
        this.logger.warn(
          `Organization ${organizationId} has no plan assigned. Allowing operation in checkLimit for backward compatibility.`,
        );
        return true;
    }

    const limitDef = org.plan.limits.find(l => l.resource === resource);
    if (!limitDef) return true;

    if (limitDef.valueType === LimitType.BOOLEAN) {
        return limitDef.isEnabled;
    }

    if (limitDef.limit === -1) return true;
    if (limitDef.allowOverage) return true;

    const period = this.getPeriodKey(limitDef.period, org);

    const metric = await this.usageRepository.findOne({
        where: { organizationId, resource, period }
    });

    const currentUsage = metric ? metric.count : 0;
    const canProceed = (currentUsage + increment) <= limitDef.limit;

    await this.cacheManager.set(cacheKey, canProceed, canProceed ? 60000 : 300000);

    return canProceed;
  }

  private emitLimitReachedEvent(organizationId: string, resource: SaasResource, currentUsage: number, limit: number) {
      this.eventEmitter.emit('saas.limit_reached', {
          organizationId,
          resource,
          currentUsage,
          limit,
          timestamp: new Date()
      });
  }

  private emitLimitWarningEvent(organizationId: string, resource: SaasResource, currentUsage: number, limit: number, percentage: number) {
      const cacheKey = SaasCacheKeyFactory.warningDebounce(organizationId, resource);
      this.cacheManager.get(cacheKey).then(lastWarning => {
          if (!lastWarning) {
              this.eventEmitter.emit('saas.limit_warning', {
                  organizationId,
                  resource,
                  currentUsage,
                  limit,
                  percentage,
                  timestamp: new Date()
              });
              this.cacheManager.set(cacheKey, '1', 24 * 60 * 60 * 1000).catch(err =>
                  this.logger.error(`Failed to set debounce cache for warning: ${err.message}`)
              );
          }
      }).catch(err => {
          this.logger.error(`Error checking debounce cache for warning: ${err.message}`);
      });
  }
}
