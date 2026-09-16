import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
import { AccountPeriodLock } from './entities/account-period-lock.entity';
import { PeriodLockGuard } from './guards/period-lock.guard';

/**
 * Lightweight module that exposes only `PeriodLockGuard`.
 *
 * ## Why this exists
 *
 * `AccountingModule` and `JournalEntriesModule` were in a forwardRef cycle because:
 *   - `JournalEntriesModule` imported `AccountingModule` to get `PeriodLockGuard`
 *   - `AccountingModule` imported `JournalEntriesModule` for the closing service
 *
 * Extracting the guard into its own module lets both depend on a leaf — nothing that itself has
 * upstream dependencies — instead of on each other. `AccountingModule` imports and re-exports
 * this module so existing consumers keep working without changes.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AccountingPeriod, AccountPeriodLock])],
  providers: [PeriodLockGuard],
  exports: [PeriodLockGuard, TypeOrmModule],
})
export class PeriodLockModule {}
