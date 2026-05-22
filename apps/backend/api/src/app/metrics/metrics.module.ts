
import { Module } from '@nestjs/common';
import { PrometheusModule, makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { MetricsService } from './metrics.service';

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
  providers: [
    MetricsService,
    makeCounterProvider({
      name: 'saas_limit_hit_total',
      help: 'Total number of times a SaaS limit was reached',
      labelNames: ['organization_id', 'resource'],
    }),
    makeCounterProvider({
      name: 'saas_webhook_failure_total',
      help: 'Total number of failed SaaS webhooks',
      labelNames: ['type'],
    }),
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
