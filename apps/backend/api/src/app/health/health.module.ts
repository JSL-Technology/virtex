import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';

@Module({
  // The queue is registered here rather than borrowed from `ChartOfAccountsModule`: a queue token
  // is only visible to the module that registers it, and importing a whole feature module to read
  // one job count pulls its providers into the health check's dependency graph.
  imports: [BullModule.registerQueue({ name: 'account-jobs' })],
  controllers: [HealthController],
})
export class HealthModule {}
