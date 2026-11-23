import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { TranslateModule, FORMAT_PIPES, FormatService, VxLocalizedNamePipe, tenantToday } from '@virtex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virtex/shared/ui-a11y';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxPagerComponent } from '../../../shared/components/pager';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import type { Page } from '../../../core/api/page';
import { CapitalizationSource, FixedAssetsService, ReconciliationReport, UnlinkedAsset, UntracedPosting } from '../data/fixed-assets.service';

/**
 * The register against the ledger (audit 2026-11-07, FINB-15): on a day, each asset account and
 * accumulated depreciation account the register uses, what the register holds there — the assets
 * acquired and not disposed of —, what the ledger says, the difference, and what explains it to the
 * cent: the assets whose cost is not in the ledger that day, and why; what the ledger moved there
 * with no asset behind it; and the purchases still waiting to be registered.
 */
@Component({
  selector: 'app-fixed-asset-reconciliation-page',
  standalone: true,
  imports: [
    FormsModule,
    ...VX_FORM_A11Y,
    RouterLink,
    TranslateModule,
    VxLocalizedNamePipe,
    ...FORMAT_PIPES,
    ListShellComponent,
    VxAmountComponent,
    VxPagerComponent,
    VxDateFieldComponent,
    HasPermissionDirective,
  ],
  templateUrl: './fixed-asset-reconciliation.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedAssetReconciliationPage implements OnInit {
  private readonly assets = inject(FixedAssetsService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly format = inject(FormatService);

  /** The day to open on — the period's last, from the close's checklist (`?asOf=`); today otherwise. */
  readonly asOfParam = input<string | undefined>(undefined, { alias: 'asOf' });
  readonly asOf = signal(tenantToday());
  readonly report = signal<ReconciliationReport | null>(null);
  readonly unlinked = signal<Page<UnlinkedAsset> | null>(null);
  readonly unlinkedPage = signal(1);
  readonly unlinkedPageSize = signal(50);
  readonly untraced = signal<Page<UntracedPosting> | null>(null);
  readonly untracedPage = signal(1);
  readonly untracedPageSize = signal(50);
  readonly waiting = signal<CapitalizationSource[]>([]);
  readonly waitingTotal = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly accounts = computed(() => this.report()?.accounts ?? []);
  /** Every account agrees with the register, and nothing on either side is unexplained. */
  readonly reconciled = computed(() => {
    const report = this.report();
    return (
      !!report &&
      report.accounts.length > 0 &&
      report.accounts.every((row) => cents(row.difference) === 0 && cents(row.untraced) === 0 && cents(row.unlinked) === 0)
    );
  });
  readonly empty = computed(() => !this.loading() && !this.error() && this.accounts().length === 0);
  private readonly accountCodes = computed(() => new Map(this.accounts().map((row) => [row.accountId, row.code])));

  ngOnInit(): void {
    const requested = this.asOfParam();
    if (requested && ISO_DATE.test(requested)) this.asOf.set(requested);
    this.load();
  }

  /** The report on the day, both lists from their first page, and what is waiting. */
  load(): void {
    if (!ISO_DATE.test(this.asOf())) return;
    this.loading.set(true);
    this.error.set(null);
    this.unlinkedPage.set(1);
    this.untracedPage.set(1);
    forkJoin({
      report: this.assets.reconciliation(this.asOf()),
      unlinked: this.assets.unlinkedAssets(this.asOf(), 1, this.unlinkedPageSize()),
      untraced: this.assets.untracedPostings(this.asOf(), 1, this.untracedPageSize()),
      waiting: this.assets.capitalizationSources({ pageSize: 100 }),
    }).subscribe({
      next: ({ report, unlinked, untraced, waiting }) => {
        this.report.set(report);
        this.unlinked.set(unlinked);
        this.untraced.set(untraced);
        this.waiting.set(waiting.rows);
        this.waitingTotal.set(waiting.total);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'fixed_assets.reconciliation.load_failed'));
        this.loading.set(false);
      },
    });
  }

  setAsOf(date: string): void {
    this.asOf.set(date);
    this.load();
  }

  goToUnlinkedPage(page: number): void {
    this.unlinkedPage.set(page);
    this.assets.unlinkedAssets(this.asOf(), page, this.unlinkedPageSize()).subscribe({
      next: (rows) => this.unlinked.set(rows),
      error: (error: unknown) => this.notifications.showHttpError(error, 'fixed_assets.reconciliation.load_failed'),
    });
  }

  goToUntracedPage(page: number): void {
    this.untracedPage.set(page);
    this.assets.untracedPostings(this.asOf(), page, this.untracedPageSize()).subscribe({
      next: (rows) => this.untraced.set(rows),
      error: (error: unknown) => this.notifications.showHttpError(error, 'fixed_assets.reconciliation.load_failed'),
    });
  }

  codeOf(accountId: string | null): string {
    return accountId ? (this.accountCodes().get(accountId) ?? '') : '';
  }

  entryLink(entryId: string): string {
    return this.organization.urlFor(`/accounting/journal-entries/${entryId}/edit`);
  }

  /** What the reason of an asset's row names: its entry, and the entry's date. */
  reasonParams(asset: UnlinkedAsset): Record<string, string> {
    return {
      entry: asset.entryNumber ?? asset.entryId?.slice(0, 8) ?? '',
      date: asset.entryDate ? this.format.date(asset.entryDate, 'date', { dateOnly: true }) : '',
    };
  }

  /** A source posted after the day explains itself with time: there is nothing to correct. */
  correctable(asset: UnlinkedAsset): boolean {
    return asset.reason !== 'SOURCE_LATER';
  }

  /** The new asset's form, opened on a purchase waiting to be registered. */
  registerParams(source: CapitalizationSource): Record<string, string> {
    return {
      sourceKind: source.kind,
      sourceId: source.id,
      sourceAccountId: source.accountId,
      cost: String(source.available),
      date: source.date,
      ...(source.reference ? { name: source.reference } : {}),
    };
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cents(value: number): number {
  return Math.round(value * 100);
}
