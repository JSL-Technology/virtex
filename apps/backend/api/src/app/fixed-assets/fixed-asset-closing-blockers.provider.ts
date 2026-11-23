import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ClosingBlocker, ClosingBlockerProvider, ClosingPeriodQuery } from '../contracts/closing-blockers/closing-blocker.contract';
import { ClosingBlockerRegistry } from '../contracts/closing-blockers/closing-blocker.registry';
import { DepreciationService } from './depreciation.service';
import { FixedAssetCapitalizationService } from './capitalization.service';
import { toIsoMonth, type IsoDate } from '../common/dates';

/** The assets a line names, before it says how many more there are. */
const NAMED = 5;

/**
 * What the fixed-asset register brings to the period's close (audit 2026-11-07, FINB-15).
 *
 * The checklist carried «run the fixed-asset depreciation for the period» as a manual step that
 * could never be ticked — while the close runs that depreciation itself. Now it says, from the very
 * computation the close runs, what the close will charge, or which assets it cannot charge and why.
 * And it adds the control a subledger owes its ledger before the books close: whether the register
 * agrees with the ledger on the period's last day, and if not, by how much and why.
 */
@Injectable()
export class FixedAssetClosingBlockersProvider implements ClosingBlockerProvider, OnModuleInit {
  readonly providerName = 'fixed-assets';

  constructor(
    private readonly dataSource: DataSource,
    private readonly depreciation: DepreciationService,
    private readonly capitalization: FixedAssetCapitalizationService,
    private readonly registry: ClosingBlockerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async blockersFor(period: ClosingPeriodQuery): Promise<readonly ClosingBlocker[]> {
    const endDate = period.endDate as IsoDate;
    // A company with no fixed asset by then has nothing to say about them.
    const [{ count }] = await this.dataSource.manager.query<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM "fixed_asset" WHERE "organization_id" = $1 AND "acquisition_date" <= $2::date`,
      [period.organizationId, endDate],
    );
    if (Number(count) === 0) return [];
    const [preview, report] = await Promise.all([
      this.depreciation.preview(period.organizationId, endDate),
      this.capitalization.reconciliation(period.organizationId, endDate),
    ]);
    const depreciationLink = `/accounting/fixed-assets/depreciation?period=${toIsoMonth(endDate)}`;

    const depreciation: ClosingBlocker =
      preview.skipped.length > 0
        ? {
            id: 'fixed-assets-depreciation',
            descriptionKey: 'fixed_assets.closing.depreciation_skipped',
            params: { count: preview.skipped.length, assets: named(preview.skipped.map((asset) => asset.number)) },
            isCompleted: false,
            details: { pendingCount: preview.skipped.length },
            resolutionLink: depreciationLink,
          }
        : preview.assets.length > 0
          ? {
              id: 'fixed-assets-depreciation',
              descriptionKey: 'fixed_assets.closing.depreciation_ready',
              params: { count: preview.assets.length, amount: preview.total },
              // The close posts it: nothing to do but know what it will be.
              isCompleted: true,
              details: { pendingCount: 0 },
              resolutionLink: depreciationLink,
            }
          : {
              id: 'fixed-assets-depreciation',
              descriptionKey: 'fixed_assets.closing.depreciation_nothing',
              isCompleted: true,
              details: { pendingCount: 0 },
            };

    const reconciled = report.accounts.every(
      (row) => cents(row.difference) === 0 && cents(row.untraced) === 0 && cents(row.unlinked) === 0,
    );
    const reconciliation: ClosingBlocker = {
      id: 'fixed-assets-reconciliation',
      descriptionKey: reconciled ? 'fixed_assets.closing.register_reconciled' : 'fixed_assets.closing.register_not_reconciled',
      params: {
        date: endDate,
        difference: report.totals.difference,
        unlinked: report.counts.unlinkedAssets,
        untraced: report.counts.untracedPostings,
      },
      isCompleted: reconciled,
      ...(reconciled ? {} : { noteKey: 'fixed_assets.closing.register_note' }),
      details: { pendingCount: reconciled ? 0 : report.counts.unlinkedAssets + report.counts.untracedPostings },
      resolutionLink: `/accounting/fixed-assets/reconciliation?asOf=${endDate}`,
    };
    return [depreciation, reconciliation];
  }
}

function named(numbers: string[]): string {
  return numbers.length > NAMED ? `${numbers.slice(0, NAMED).join(', ')}…` : numbers.join(', ');
}

function cents(value: number): number {
  return Math.round(value * 100);
}
