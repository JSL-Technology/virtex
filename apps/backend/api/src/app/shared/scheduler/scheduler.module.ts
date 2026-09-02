import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledJobRun } from './scheduled-job-run.entity';
import { SchedulerLockService } from './scheduler-lock.service';

/**
 * Global so any module with a `@Cron` can claim its work without importing anything.
 *
 * Twelve cron declarations had no coordination at all, and the friction of wiring a shared module
 * into each of them is exactly the reason a control like this gets skipped. There is nothing tenant
 * or feature specific here — it is one table and one method.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ScheduledJobRun])],
  providers: [SchedulerLockService],
  exports: [SchedulerLockService],
})
export class SchedulerModule {}
