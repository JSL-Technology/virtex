import { Module, Global, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from './entities/plan.entity';
import { PlanLimit } from './entities/plan-limit.entity';
import { UsageMetric } from './entities/usage-metric.entity';
import { PlanFeature } from './entities/plan-feature.entity';
import { SaasService } from './saas.service';
import { SaasController } from './saas.controller';
import { Organization } from '../organizations/entities/organization.entity';
import { SubscriptionActiveGuard } from './guards/subscription-active.guard';
import { PlanLimitCheckGuard } from './guards/plan-limit-check.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsageMetricRepository } from './repositories/usage-metric.repository';
import { OrganizationSubscriptionHistory } from '../organizations/entities/organization-subscription-history.entity';
import { MetricsModule } from '../metrics/metrics.module';
import { UserCacheModule } from '../auth/modules/user-cache.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { BillingNotificationsListener } from './listeners/billing-notifications.listener';
import { User } from '../users/entities/user.entity/user.entity';
import { SaasCronService } from './services/saas-cron.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, PlanLimit, PlanFeature, Organization, UsageMetric, OrganizationSubscriptionHistory, User]),
    MetricsModule,
    // Billing changes invalidate the cached principal, which is where the entitlement guard
    // reads the subscription status from.
    UserCacheModule,
    // Billing and quota events reach the customer through these two.
    NotificationsModule,
    MailModule,
    // No local CacheModule registration.
    //
    // This module used to register its own `CacheModule` with `cache-manager-redis-store`, and so
    // did two others. Nest resolves `CACHE_MANAGER` from the nearest registration, so the
    // application ran on FOUR separate cache instances — none of which was Redis, because that
    // adapter is written for cache-manager 4/5 and this project is on 7, so each silently fell
    // back to an in-process Map. A revoked session denylisted through one of them was invisible
    // to the other three.
    //
    // The single `CacheModule` in `app/cache` is `@Global()`, so `CACHE_MANAGER` resolves to one
    // shared, Redis-backed instance everywhere.
  ],
  controllers: [SaasController],
  providers: [SaasService, SubscriptionActiveGuard, PlanLimitCheckGuard, UsageMetricRepository, SaasCronService,
    BillingNotificationsListener,
  ],
  exports: [SaasService, SubscriptionActiveGuard, PlanLimitCheckGuard],
})
export class SaasModule {}
