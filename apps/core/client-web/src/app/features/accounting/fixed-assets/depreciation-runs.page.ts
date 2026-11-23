import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CalendarClock, LucideAngularModule } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virtex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxPagerComponent } from '../../../shared/components/pager';
import { VxAmountComponent } from '../../../shared/components/amount';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { NotificationService } from '../../../core/services/notification';
import { DepreciationRunSummary, DepreciationRunTrigger, FixedAssetsService } from '../data/fixed-assets.service';
import { VX_FORM_A11Y } from '@virtex/shared/ui-a11y';

export const DEPRECIATION_RUN_TRIGGERS: readonly DepreciationRunTrigger[] = ['SCHEDULE', 'PERIOD_CLOSE', 'MANUAL', 'DISPOSAL'];

export const DEPRECIATION_RUN_TONE: Record<DepreciationRunTrigger, VxTone> = {
  SCHEDULE: 'neutral',
  PERIOD_CLOSE: 'info',
  MANUAL: 'accent',
  DISPOSAL: 'warning',
};

/** `PERIOD_CLOSE` → `fixed_assets.runs.trigger.period_close`. */
export function depreciationRunTriggerKey(trigger: DepreciationRunTrigger): string {
  return `fixed_assets.runs.trigger.${trigger.toLowerCase()}`;
}

/**
 * The depreciation runs that charged something (FINB-17): when each ran, what set it going — the
 * monthly job, a period close, a person, an asset's disposal — who, through which month and how
 * much. A run left no trace of its own before: its entries all said «monthly» whoever had run it.
 */
@Component({
  selector: 'app-depreciation-runs-page',
  standalone: true,
  imports: [
    FormsModule,
    ...VX_FORM_A11Y,
    RouterLink,
    TranslateModule,
    LucideAngularModule,
    ...FORMAT_PIPES,
    ListShellComponent,
    VxBadgeComponent,
    VxPagerComponent,
    VxAmountComponent,
    HasPermissionDirective,
    RowLinkDirective,
  ],
  templateUrl: './depreciation-runs.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DepreciationRunsPage implements OnInit {
  private readonly assets = inject(FixedAssetsService);
  private readonly notifications = inject(NotificationService);

  protected readonly RunIcon = CalendarClock;
  protected readonly triggers = DEPRECIATION_RUN_TRIGGERS;
  protected readonly tones = DEPRECIATION_RUN_TONE;
  protected readonly triggerKey = depreciationRunTriggerKey;

  readonly rows = signal<DepreciationRunSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(50);
  readonly triggerFilter = signal<DepreciationRunTrigger | ''>('');
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.assets
      .listRuns({ trigger: this.triggerFilter() || null, page: this.page(), pageSize: this.pageSize() })
      .subscribe({
        next: (result) => {
          this.rows.set(result.rows);
          this.total.set(result.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.notifications.httpErrorMessage(error, 'fixed_assets.runs.load_failed'));
          this.loading.set(false);
        },
      });
  }

  setTrigger(trigger: DepreciationRunTrigger | ''): void {
    this.triggerFilter.set(trigger);
    this.page.set(1);
    this.load();
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  changePageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
    this.load();
  }
}
