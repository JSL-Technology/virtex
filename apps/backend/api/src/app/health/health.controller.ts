import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

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
  ) {}

  @Get('queues')
  @UseGuards(JwtAuthGuard)
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
