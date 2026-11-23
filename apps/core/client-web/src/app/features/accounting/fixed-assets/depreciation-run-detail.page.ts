import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { TranslateModule, FORMAT_PIPES } from '@virtex/shared/ui-i18n';
import { DocumentShellComponent } from '../../../shared/components/gestures';
import { VxAmountComponent } from '../../../shared/components/amount';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { DepreciationRunDetail, FixedAssetsService } from '../data/fixed-assets.service';
import { DEPRECIATION_RUN_TONE, depreciationRunTriggerKey } from './depreciation-runs.page';

/**
 * One depreciation run, read (FINB-17): what set it going and who, through which month, each
 * asset-month it charged with where it left the asset, and the entries — one per month — that
 * carry them. Each of those entries leads here.
 */
@Component({
  selector: 'app-depreciation-run-detail-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, ...FORMAT_PIPES, DocumentShellComponent, VxAmountComponent],
  templateUrl: './depreciation-run-detail.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss', '../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DepreciationRunDetailPage implements OnInit {
  private readonly assets = inject(FixedAssetsService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly id = input.required<string>();

  protected readonly triggerKey = depreciationRunTriggerKey;

  readonly run = signal<DepreciationRunDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly tone = computed(() => {
    const run = this.run();
    return run ? DEPRECIATION_RUN_TONE[run.trigger] : 'neutral';
  });
  /** The entry each month was posted in, by id: the charges table links to it. */
  readonly entryNumbers = computed(() => new Map((this.run()?.entries ?? []).map((entry) => [entry.id, entry.entryNumber])));

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.assets.getRun(this.id()).subscribe({
      next: (run) => {
        this.run.set(run);
        this.tab?.setTitle(run.periodEnd.slice(0, 7));
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'fixed_assets.runs.load_one_failed'));
        this.loading.set(false);
      },
    });
  }

  entryLink(entryId: string): string {
    return this.organization.urlFor(`/accounting/journal-entries/${entryId}/edit`);
  }

  goToList(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/accounting/fixed-assets/depreciation-runs'));
  }
}
