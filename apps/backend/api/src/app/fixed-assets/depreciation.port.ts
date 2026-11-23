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
   * Charge every in-use asset everything it is due through the period's end.
   *
   * Idempotent: a month already charged to an asset is not charged again, whichever run reached it
   * first. The caller may pass its own `EntityManager` to take part in an outer transaction — the
   * close does — and who is closing, whom the run's record names.
   */
  abstract runForPeriod(
    organizationId: string,
    period: { startDate: IsoDate; endDate: IsoDate },
    manager?: EntityManager,
    closedByUserId?: string | null,
  ): Promise<void>;
}
