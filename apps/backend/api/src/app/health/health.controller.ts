import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { Public } from '../security/decorators/public.decorator';

/** How long a dependency may take to answer a readiness probe before it counts as down. */
const PROBE_TIMEOUT_MS = 2000;

async function probe(check: () => Promise<unknown>): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Queue depth, for the queues that still exist.
 *
 * This used to report on `balance-updates-v2`, the queue that applied account balance deltas after
 * the posting transaction committed. Balances are derived from the journal now, so there is no
 * such queue and nothing to be behind on.
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectQueue('account-jobs') private readonly accountJobsQueue: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Liveness: the process answers (audit 2026-10-31, OBS-03). Public and dependency-free on
   * purpose — an orchestrator that restarted the API because the database blinked would turn an
   * outage of one into an outage of both.
   */
  @Get('live')
  @Public()
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: the API can serve, because its database and its Redis answer. 503 when either does
   * not, so a load balancer stops routing here until they do. Public, with nothing of any tenant
   * in it — only which dependency is down.
   */
  @Get('ready')
  @Public()
  async ready(@Res({ passthrough: true }) reply: { status: (code: number) => unknown }) {
    const [database, redis] = await Promise.all([
      probe(() => this.dataSource.query('SELECT 1')),
      // Any command proves the connection; asking for the queue's counts is one BullMQ exposes.
      probe(() => this.accountJobsQueue.getJobCounts('wait')),
    ]);
    const ready = database === 'up' && redis === 'up';
    reply.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ready ? 'ok' : 'unavailable', checks: { database, redis } };
  }

  @Get('queues')
  @AuthenticatedOnly(
    'Queue depth and worker liveness. Operational telemetry with no tenant data in it; the payload is\n' +
    'the same for every caller.',
  )
  async getQueueHealth() {
    return [
      {
        name: this.accountJobsQueue.name,
        counts: await this.accountJobsQueue.getJobCounts(
          'wait',
          'active',
          'completed',
          'failed',
          'delayed',
        ),
      },
    ];
  }
}
