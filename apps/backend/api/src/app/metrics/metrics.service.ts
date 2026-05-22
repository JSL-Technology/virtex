
import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';

@Injectable()
export class MetricsService {
  constructor(
    @InjectMetric('saas_limit_hit_total') public limitHitCounter: Counter<string>,
    @InjectMetric('saas_webhook_failure_total') public webhookFailureCounter: Counter<string>
  ) {}
}
