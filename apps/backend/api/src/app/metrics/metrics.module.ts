
import { Module } from '@nestjs/common';
import { PrometheusModule, makeCounterProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';
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
      // By resource only. It was labelled by organization as well: one series per tenant, growing
      // without bound, and a tenant identifier in a system that is not isolated per tenant
      // (PLT-OBS-03). Which tenant hit a limit is in the structured log, where it belongs.
      help: 'Operations a plan limit refused, by resource',
      labelNames: ['resource'],
    }),
    makeCounterProvider({
      name: 'saas_webhook_failure_total',
      // The provider redelivers a failed event for days; without this a webhook failing on every
      // attempt was visible only by reading logs.
      help: 'Payment webhook deliveries that were not processed, by reason',
      labelNames: ['reason'],
    }),
    makeGaugeProvider({
      name: 'payment_provider_info',
      // 1 for the provider this process charges through. A deployment that reports
      // provider="simulated" grants subscriptions without charging: alert on it (IAM-P2).
      help: 'The payment provider this process charges through (1 for the active one)',
      labelNames: ['provider'],
    }),
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
