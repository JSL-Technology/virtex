import { EntityManager } from 'typeorm';
import { type IsoDate } from '../common/dates';

/**
 * The surface `AccountingModule` uses to run depreciation during period closing.
 *
 * ## Why this exists
 *
 * `AccountingModule` imported `FixedAssetsModule` via `forwardRef` so that
 * `ClosingAutomationService` could inject `DepreciationService`. That created a three-way cycle:
 *
 *   Accounting → FixedAssets → JournalEntries → (PeriodLockModule, which is from Accounting)
 *
 * Extracting the narrow contract into a port and a leaf `DepreciationModule` lets Accounting
 * depend on a leaf — something that has no upstream dependency on Accounting itself — instead of
 * on the full FixedAssetsModule.
 *
 * ## How to use it in AccountingModule
 *
 * ```ts
 * imports: [DepreciationModule],   // the leaf, not FixedAssetsModule
 * ```
 * ```ts
 * constructor(private readonly depreciation: DepreciationPort) {}
 * ```
 */
export abstract class DepreciationPort {
  /**
   * Post the monthly depreciation charge for every in-use asset.
   *
   * Idempotent: if the charge for the period has already been claimed (via `SchedulerLockService`)
   * this method returns without posting again. The caller may pass its own `EntityManager` to
   * participate in an outer transaction; if omitted the service opens its own.
   */
  abstract runForPeriod(
    organizationId: string,
    period: { startDate: IsoDate; endDate: IsoDate },
    manager?: EntityManager,
  ): Promise<void>;
}
