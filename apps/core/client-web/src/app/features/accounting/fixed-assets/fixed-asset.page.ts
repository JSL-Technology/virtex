import { handleDocumentIntents } from '../../../core/navigation/document-intent.service';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Ban, LucideAngularModule, Pencil, Trash2 } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES, VxLocalizedNamePipe } from '@virtex/shared/ui-i18n';
import { DocumentShellComponent } from '../../../shared/components/gestures';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxBranchLabelComponent } from '../../../shared/components/branch-picker';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { FixedAsset, FixedAssetSchedule, FixedAssetsService, ScheduledCharge, asPercent, hasBeenDepreciated } from '../data/fixed-assets.service';

/** A fiscal year of a tax book: what it deducted, and where it left the book. */
export interface TaxYear {
  /** `2026`, or `2025/2026` for a year that does not start in January. */
  label: string;
  deduction: number;
  accumulatedAfter: number;
  taxValueAfter: number;
  /** Charged already, still projected, or both — a year in progress. */
  state: 'posted' | 'projected' | 'partial';
}

/**
 * A tax book's months grouped by the company's fiscal year — what a tax return reads — from the
 * months charged and those projected.
 */
export function taxYearsOf(posted: readonly ScheduledCharge[], projected: readonly ScheduledCharge[], startMonth: number): TaxYear[] {
  const years = new Map<number, { cents: number; last: ScheduledCharge; posted: boolean; projected: boolean }>();
  const add = (charge: ScheduledCharge, kind: 'posted' | 'projected') => {
    const year = Number(charge.periodEnd.slice(0, 4));
    const month = Number(charge.periodEnd.slice(5, 7));
    const startYear = month >= startMonth ? year : year - 1;
    const entry = years.get(startYear) ?? { cents: 0, last: charge, posted: false, projected: false };
    entry.cents += Math.round(charge.amount * 100);
    entry.last = charge;
    entry[kind] = true;
    years.set(startYear, entry);
  };
  posted.forEach((charge) => add(charge, 'posted'));
  projected.forEach((charge) => add(charge, 'projected'));
  return [...years.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startYear, entry]) => ({
      label: startMonth === 1 ? String(startYear) : `${startYear}/${startYear + 1}`,
      deduction: entry.cents / 100,
      accumulatedAfter: entry.last.accumulatedAfter,
      taxValueAfter: entry.last.bookValueAfter,
      state: entry.posted && entry.projected ? 'partial' : entry.posted ? 'posted' : 'projected',
    }));
}
import { FIXED_ASSET_TONE } from './fixed-assets.page';

/**
 * One fixed asset, read: what it cost and is worth, its depreciation board — the months charged,
 * each with its entry, and the projection of the rest — and, once retired, how and with which
 * entry it left the books.
 */
@Component({
  selector: 'app-fixed-asset-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, VxLocalizedNamePipe, LucideAngularModule, ...FORMAT_PIPES, DocumentShellComponent, VxAmountComponent, VxBranchLabelComponent, HasPermissionDirective],
  templateUrl: './fixed-asset.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss', '../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedAssetPage implements OnInit {
  /**
   * What a list row's menu asked of this document (QA R3-B08): the same methods its own buttons
   * run, once it has loaded, and only while its own rules still allow them.
   */
  private readonly documentIntents = handleDocumentIntents({
    route: () => `/accounting/fixed-assets/${this.id()}`,
    ready: () => !!this.asset(),
    actions: {
      'delete': () => this.deletable() && this.remove(),
    },
  });

  private readonly assets = inject(FixedAssetsService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  protected readonly branches = inject(BranchesService);

  readonly id = input.required<string>();

  protected readonly EditIcon = Pencil;
  protected readonly DisposeIcon = Ban;
  protected readonly DeleteIcon = Trash2;

  readonly asset = signal<FixedAsset | null>(null);
  readonly schedule = signal<FixedAssetSchedule | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  /** The projection is long — sixty months for a vehicle — so it opens folded. */
  readonly showProjection = signal(false);
  /** The tax book's months, one by one; its years are what opens. */
  readonly showTaxMonths = signal(false);
  protected readonly asPercent = asPercent;

  /** The tax book's years, in the company's fiscal years. */
  readonly taxYears = computed(() => {
    const book = this.schedule()?.taxBook;
    return book ? taxYearsOf(book.posted, book.projected, book.fiscalYearStartMonth) : [];
  });

  readonly tone = computed(() => FIXED_ASSET_TONE[this.asset()?.status ?? 'IN_USE']);
  readonly inUse = computed(() => this.asset()?.status === 'IN_USE');
  /** Deletion is for an asset registered by mistake: nothing charged here yet. */
  readonly deletable = computed(() => {
    const asset = this.asset();
    return !!asset && asset.status === 'IN_USE' && !hasBeenDepreciated(asset);
  });
  readonly carrying = computed(() => {
    const asset = this.asset();
    return asset ? Math.round((asset.cost - asset.accumulatedDepreciation) * 100) / 100 : 0;
  });
  /** What remains to charge, and the month the asset will be fully written down. */
  readonly remaining = computed(() => {
    const projected = this.schedule()?.projected ?? [];
    const total = projected.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100;
    return { total, months: projected.length, endsOn: projected.at(-1)?.periodEnd ?? null };
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.assets.get(this.id()).subscribe({
      next: (asset) => {
        this.asset.set(asset);
        this.tab?.setTitle(asset.number);
        this.loading.set(false);
        this.assets.schedule(asset.id).subscribe({
          next: (schedule) => this.schedule.set(schedule),
          error: (error: unknown) => this.notifications.showHttpError(error, 'fixed_assets.document.schedule_failed'),
        });
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'fixed_assets.document.load_failed'));
        this.loading.set(false);
      },
    });
  }

  entryLink(entryId: string | null | undefined): string | null {
    return entryId ? this.organization.urlFor(`/accounting/journal-entries/${entryId}/edit`) : null;
  }

  async remove(): Promise<void> {
    const asset = this.asset();
    if (!asset) return;
    const confirmed = await this.dialog.confirm({
      title: 'fixed_assets.document.delete_title',
      message: 'fixed_assets.document.delete_message',
      messageParams: { number: asset.number, name: asset.name },
      confirmText: 'fixed_assets.document.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.busy.set(true);
    this.assets.remove(asset.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.notifications.showSuccess('fixed_assets.document.deleted', { number: asset.number });
        this.goToList();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(error, 'fixed_assets.document.delete_failed');
      },
    });
  }

  goToList(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/accounting/fixed-assets'));
  }

  statusKey(status: FixedAsset['status']): string {
    return `fixed_assets.status.${status.toLowerCase()}`;
  }
}
