import { Controller, Get, Headers, HttpStatus, Res } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { register } from 'prom-client';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { Public } from '../security/decorators/public.decorator';

/**
 * What an orchestrator and a monitoring system ask of a running instance.
 *
 * - `live`: the process answers. A failure means restart it.
 * - `ready`: it can serve — the database and Redis answer. A failure means take it out of the load
 *   balancer, not restart it: a database outage is not cured by restarting every API instance.
 * - `metrics`: Prometheus exposition, behind `METRICS_TOKEN` (a bearer the scraper sends). Without
 *   a token configured it is not served at all: process and business metrics are not public data.
 *
 * Public and unthrottled by necessity — probes run every few seconds and carry no session — and
 * they disclose nothing beyond up/down.
 */
@ApiExcludeController()
@Controller('health')
@Public()
@SkipThrottle()
export class OpsHealthController {
  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue('account-jobs') private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res() reply: FastifyReply) {
    const checks: Record<string, 'ok' | 'down'> = { database: 'down', redis: 'down' };
    await Promise.all([
      this.dataSource
        .query('SELECT 1')
        .then(() => (checks['database'] = 'ok'))
        .catch(() => undefined),
      this.queue
        .getJobCounts('wait')
        .then(() => (checks['redis'] = 'ok'))
        .catch(() => undefined),
    ]);
    const up = Object.values(checks).every((v) => v === 'ok');
    return reply.status(up ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).send({ status: up ? 'ok' : 'degraded', checks });
  }

  @Get('metrics')
  async metrics(@Headers('authorization') authorization: string | undefined, @Res() reply: FastifyReply) {
    const token = this.config.get<string>('METRICS_TOKEN');
    const given = (authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
      return reply.status(HttpStatus.NOT_FOUND).send();
    }
    return reply.type(register.contentType).send(await register.metrics());
  }
}
