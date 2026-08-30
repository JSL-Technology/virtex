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
import { SAAS_PLANS, minorUnitFactor, type PlanConfig } from './saas.config';
import {
  SaasLimitReachedException,
  SaasFeatureNotEnabledException,
  SaasNoPlanException,
} from './exceptions/saas-exception';
import { DateTime } from 'luxon';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsageMetricRepository } from './repositories/usage-metric.repository';
import { OrganizationSubscriptionHistory } from '../organizations/entities/organization-subscription-history.entity';
import { MetricsService } from '../metrics/metrics.service';
import { SaasCacheKeyFactory } from './utils/saas-cache-key.factory';
import { findCountryProfile } from '../localization/fiscal/country-profiles';

@Injectable()
export class SaasService implements OnModuleInit {
  private readonly logger = new Logger(SaasService.name);

  /** Effectively "never" for the monotonically increasing cache-generation counter. */
  private static readonly CACHE_GENERATION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

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

  /**
   * Bring the plan catalogue into agreement with `SAAS_PLANS` on every boot.
   *
   * This used to run only when `SAAS_SEED_ENABLED` was set to the string `'true'` — a variable
   * declared nowhere, documented nowhere, and absent from every environment. So the limits in
   * `saas.config.ts` were aspirational: adding one changed nothing until somebody remembered the
   * flag, and `enforceLimit` treats a plan with no row for a resource as unlimited. A metered
   * resource that reaches production unseeded is a resource nobody is charged for.
   *
   * The sync is idempotent and derived entirely from code, which is what makes running it
   * unconditionally the safe option rather than the risky one.
   */
  async onModuleInit() {
    await this.seedPlans();
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
                description: pConfig.description,
                monthlyPriceId: monthlyPriceId,
                // The column keeps the BASE-currency amount. Per-currency amounts live in
                // `SAAS_PLANS[].monthlyPrices`, which is what the catalogue endpoint quotes from.
                monthlyPrice: pConfig.monthlyPrices[SaasService.baseCurrency()] ?? null,
                trialPeriodDays: pConfig.trialPeriodDays ?? null,
            },
            ['slug']
        );

        const plan = await this.planRepository.findOne({ where: { slug: pConfig.slug }, relations: ['limits'] });

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

        // Capabilities, on the same footing as limits.
        //
        // `saas_plan_features` was never written by anything, so it was empty after every boot,
        // `checkFeature` returned false for every key, and `FeatureFlagGuard` and `@CheckFeature`
        // were unreachable. Seeding here is what makes the plan tiers differ by capability and
        // not only by six numbers.
        const planWithFeatures = await this.planRepository.findOne({
            where: { slug: pConfig.slug },
            relations: ['features'],
        });
        const existingFeatures = planWithFeatures?.features ?? [];

        for (const cFeature of pConfig.features) {
            const existing = existingFeatures.find(f => f.featureKey === cFeature.featureKey);
            if (existing) {
                if (existing.isEnabled !== cFeature.isEnabled) {
                    existing.isEnabled = cFeature.isEnabled;
                    await this.featureRepository.save(existing);
                }
            } else {
                await this.featureRepository.save(
                    this.featureRepository.create({
                        plan,
                        featureKey: cFeature.featureKey,
                        isEnabled: cFeature.isEnabled,
                    }),
                );
            }
        }

        const configFeatureKeys = pConfig.features.map(f => f.featureKey);
        const featuresToRemove = existingFeatures.filter(f => !configFeatureKeys.includes(f.featureKey));
        if (featuresToRemove.length > 0) {
            await this.featureRepository.remove(featuresToRemove);
        }

        // No cache sweep is needed here: `checkFeature` keys its answer by the organization's
        // cache generation, so `clearOrganizationCache` invalidates it for that tenant, and the
        // 60-second TTL bounds the window after a seed changes a plan globally.
    }

    this.logger.log('SaaS Plans seeded.');
  }

  async getPlans() {
    return this.planRepository.find({
      where: { isActive: true },
      relations: ['limits', 'features'],
      order: { monthlyPrice: 'ASC' },
    });
  }

  /**
   * The plan catalogue, quoted in the currency the market will actually be charged in.
   *
   * `Plan.monthlyPrice` is a single integer of minor units and carries no currency, so every
   * screen implicitly rendered it as USD for all nineteen markets. The amount per currency lives
   * on the Stripe Price's `currency_options` — one Price, many currencies, configured where prices
   * belong — so what this has to get right is which currency applies, and to say so.
   *
   * An unknown or unsupported country falls back to the platform's base currency rather than
   * guessing: converting an amount with an invented rate would be worse than quoting the base.
   */
  /**
   * The catalogue, quoted in the currency the market will actually be charged in — and at the
   * amount it will actually be charged.
   *
   * `currency` and `monthlyPrice` are resolved together, from the same table, by the same
   * function the checkout uses. That is the property that was missing: the endpoint used to
   * relabel a fixed USD amount with the local currency, so a Colombian saw "$49" and Stripe
   * charged 4.900 COP. `minorUnits` is published alongside so a client cannot get the decimal
   * placement wrong for CLP or PYG, which have none.
   */
  async getPlansForCountry(countryCode?: string) {
    const plans = await this.getPlans();
    const currency = SaasService.currencyForCountry(countryCode);
    return plans.map((plan) => ({
      ...plan,
      currency,
      monthlyPrice: SaasService.priceFor(plan.slug, currency) ?? plan.monthlyPrice,
      minorUnits: minorUnitFactor(currency),
    }));
  }

  /** The platform's base currency: what a market with no local price is quoted and charged in. */
  static baseCurrency(): string {
    return (process.env['SAAS_BASE_CURRENCY'] || 'USD').toUpperCase();
  }

  /** The configured amount for a plan in a currency, in that currency's minor units. */
  static priceFor(planSlug: string, currency: string): number | undefined {
    const plan: PlanConfig | undefined = SAAS_PLANS.find((p) => p.slug === planSlug);
    return plan?.monthlyPrices[(currency ?? '').toUpperCase()];
  }

  /**
   * The currency a market is quoted and charged in.
   *
   * A market gets its own currency only when EVERY plan carries an amount for it. Anything less
   * would let one plan be quoted locally and another in dollars on the same screen, or — worse —
   * be quoted locally and charged in the Price's default currency.
   *
   * This used to be gated on a `SAAS_SUPPORTED_CURRENCIES` environment variable that was set
   * nowhere, so the whole feature was inert; and because the amount was not resolved alongside
   * the currency, turning it on would have started charging the wrong number rather than fixing
   * anything.
   */
  static currencyForCountry(countryCode?: string): string {
    const base = SaasService.baseCurrency();
    if (!countryCode) return base;
    const profile = findCountryProfile(countryCode);
    if (!profile) return base;

    const local = profile.currency.toUpperCase();
    if (local === base) return base;

    const pricedEverywhere = SAAS_PLANS.every(
      (plan) => typeof plan.monthlyPrices[local] === 'number',
    );
    return pricedEverywhere ? local : base;
  }

  async getPlanBySlug(slug: string) {
    return this.planRepository.findOne({ where: { slug }, relations: ['limits', 'features'] });
  }

  async changePlan(organizationId: string, newPlanSlug: string, userId?: string, reason = 'upgrade'): Promise<void> {
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

  /**
   * Bump the cache generation for an organization, invalidating every limit answer cached under
   * the previous one.
   *
   * The TTL is a number of milliseconds. It used to be `{ ttl: 0 } as any` — an object where
   * cache-manager expects a number, silenced by the cast — so the counter quietly took the store's
   * default TTL instead of living forever. When it expired the generation reset to 0, and any
   * limit answers still cached under generation 0 became live again. A ten-year TTL is the
   * practical spelling of "does not expire" for a key that is only ever incremented.
   */
  async clearOrganizationCache(organizationId: string) {
      const versionKey = SaasCacheKeyFactory.limitVersion(organizationId);
      const currentVersion = await this.cacheManager.get<number>(versionKey) || 0;
      await this.cacheManager.set(versionKey, currentVersion + 1, SaasService.CACHE_GENERATION_TTL_MS);

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

  async enforceLimit(manager: EntityManager, organizationId: string, resource: SaasResource, increment = 1): Promise<void> {
    const org = await manager.findOne(Organization, {
        where: { id: organizationId },
        relations: ['plan', 'plan.limits']
    });

    if (!org) {
        throw new SaasNoPlanException(organizationId);
    }

    if (!org.plan) {
        // Fail CLOSED. This used to return early "for backward compatibility", which meant an
        // organization without a plan was exempt from every limit in the product — and creating
        // one was trivial, because the (now removed) free registration endpoint never assigned a
        // plan and `completePendingRegistration` also continued past a plan slug it could not
        // resolve. An organization with no plan is a provisioning fault, not a licence to
        // consume without limit.
        this.logger.error(
          { event: 'saas_no_plan', organizationId, resource },
          '[BILLING] Organization has no plan assigned; refusing the metered operation.',
        );
        throw new SaasNoPlanException(organizationId);
    }

    const limitDef = org.plan.limits.find(l => l.resource === resource);
    if (!limitDef) {
        // Fail CLOSED, for the same reason a missing plan does. A plan with no row for a resource
        // used to mean "unlimited", so every resource added to the enum without a matching entry
        // in every plan was silently free on every tier — and the seeding that would have created
        // those rows was itself behind an unset feature flag. `seedPlans` runs on every boot now,
        // so a missing row is a genuine configuration fault and worth refusing over.
        this.logger.error(
          { event: 'saas_no_limit_defined', organizationId, plan: org.plan.slug, resource },
          '[BILLING] Plan defines no limit for this resource; refusing the metered operation.',
        );
        throw new SaasNoPlanException(organizationId);
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
        this.logger.warn(`Redis update failed after DB increment: ${(e as Error).message}`);
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

  /**
   * Whether a plan grants a capability. Fails CLOSED, like `enforceLimit`.
   *
   * Keyed by the organization's cache generation so a plan change through `changePlan` — which
   * calls `clearOrganizationCache` — takes effect immediately rather than at TTL expiry. Keyed
   * without it, an upgrade left the customer refused for up to a minute after paying.
   */
  async checkFeature(organizationId: string, featureKey: string): Promise<boolean> {
     const versionKey = SaasCacheKeyFactory.limitVersion(organizationId);
     const version = (await this.cacheManager.get<number>(versionKey)) || 0;
     const cacheKey = `${SaasCacheKeyFactory.featureFlag(organizationId, featureKey)}:${version}`;
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

  /**
   * Release a unit of a metered resource, so the quota reflects what exists rather than what has
   * ever been created.
   *
   * Only meaningful for `LIFETIME` quotas — a monthly counter is a volume of activity in a
   * period, and deleting an invoice does not un-issue it. Calling it for a monthly resource is a
   * no-op by design rather than an error, so callers do not have to know the period.
   *
   * Failures are logged and swallowed: refusing to delete a customer because a counter could not
   * be decremented would be a worse outcome than a counter that reconciliation will correct.
   */
  async releaseUsage(
    manager: EntityManager,
    organizationId: string,
    resource: SaasResource,
    decrement = 1,
  ): Promise<void> {
    try {
      const org = await manager.findOne(Organization, {
        where: { id: organizationId },
        relations: ['plan', 'plan.limits'],
      });
      const limitDef = org?.plan?.limits?.find((l) => l.resource === resource);
      if (!limitDef || limitDef.period !== QuotaPeriod.LIFETIME) return;

      const periodKey = this.getPeriodKey(limitDef.period, org as Organization);
      const count = await this.usageMetricRepository.decrementUsage(
        manager,
        organizationId,
        resource,
        periodKey,
        decrement,
      );
      await this.setUsageRedis(organizationId, resource, periodKey, count);
    } catch (error) {
      this.logger.error(
        { event: 'usage_release_failed', organizationId, resource },
        `Could not release quota: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Recount a lifetime quota from the rows that actually exist and write that number back.
   *
   * The nightly job only ever reconciled Redis against the database, which corrected the cache
   * and never the counter. Anything that created or removed a record outside the metered path —
   * a rolled-back transaction, a restored backup, a bulk import — left the quota permanently
   * wrong in a direction the customer cannot fix.
   */
  async recountLifetimeUsage(
    manager: EntityManager,
    organizationId: string,
    resource: SaasResource,
    actual: number,
  ): Promise<void> {
    await this.usageMetricRepository.setUsage(
      manager,
      organizationId,
      resource,
      QuotaPeriod.LIFETIME,
      actual,
    );
    await this.setUsageRedis(organizationId, resource, QuotaPeriod.LIFETIME, actual);
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

        // `getPeriodKey` returns a formatted period ('2026-08', or the literal 'lifetime'), not
        // an enum member; typing the variable as the enum made the monthly branch unassignable.
        let periodKey: string = QuotaPeriod.LIFETIME;
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
        // Mirrors enforceLimit: no plan means no entitlement. Returning true here made the guard
        // wave through exactly the requests enforceLimit was meant to stop.
        this.logger.error(
          { event: 'saas_no_plan', organizationId, resource },
          '[BILLING] Organization has no plan assigned; denying the metered operation.',
        );
        return false;
    }

    const limitDef = org.plan.limits.find(l => l.resource === resource);
    if (!limitDef) {
        // Fail CLOSED, exactly as `enforceLimit` does for the same condition.
        //
        // This returned `true`, so the guard waved through precisely the requests `enforceLimit`
        // then refused. The net effect was safe but the experience was not: the user got a
        // success-looking action that failed halfway, and the two functions that answer the same
        // question — "may this tenant consume one more of this?" — gave opposite answers.
        this.logger.error(
          { event: 'saas_no_limit_defined', organizationId, plan: org.plan.slug, resource },
          '[BILLING] Plan defines no limit for this resource; denying the metered operation.',
        );
        return false;
    }

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
