import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxAmountComponent } from '../../../shared/components/amount';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { DepreciationRunResult, FixedAssetsService } from '../data/fixed-assets.service';

/** The month that just ended: what a run is usually for. */
export function previousMonth(today = new Date()): string {
  const date = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Running depreciation (audit H-21): pick the month, see what each asset is due — every month it
 * is behind, not only this one — and post it as one entry. It runs on its own on the first of each
 * month and at each period close; this is for running it now, or catching up an asset registered
 * late. Running it twice charges nothing twice.
 */
@Component({
  selector: 'app-depreciation-run-page',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxAmountComponent, HasPermissionDirective],
  templateUrl: './depreciation-run.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DepreciationRunPage implements OnInit {
  private readonly assets = inject(FixedAssetsService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);

  readonly period = signal(previousMonth());
  readonly preview = signal<DepreciationRunResult | null>(null);
  /** The run just posted, kept on screen with a link to its entry. */
  readonly posted = signal<DepreciationRunResult | null>(null);
  readonly loading = signal(true);
  readonly running = signal(false);
  readonly error = signal<string | null>(null);

  readonly rows = computed(() => this.preview()?.assets ?? []);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0 && !this.preview()?.skipped.length);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(this.period())) return;
    this.loading.set(true);
    this.error.set(null);
    this.assets.previewDepreciation(this.period()).subscribe({
      next: (preview) => {
        this.preview.set(preview);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'fixed_assets.run.load_failed'));
        this.loading.set(false);
      },
    });
  }

  setPeriod(period: string): void {
    this.period.set(period);
    this.posted.set(null);
    this.load();
  }

  async run(): Promise<void> {
    const preview = this.preview();
    if (!preview || preview.assets.length === 0) return;
    const confirmed = await this.dialog.confirm({
      title: 'fixed_assets.run.confirm_title',
      message: 'fixed_assets.run.confirm_message',
      messageParams: { count: preview.assets.length, total: preview.total, period: this.period() },
      confirmText: 'fixed_assets.run.post',
    });
    if (!confirmed) return;
    this.running.set(true);
    this.assets.runDepreciation(this.period()).subscribe({
      next: (result) => {
        this.running.set(false);
        this.posted.set(result);
        this.notifications.showSuccess('fixed_assets.run.posted', { count: result.assets.length });
        this.load();
      },
      error: (error: unknown) => {
        this.running.set(false);
        this.notifications.showHttpError(error, 'fixed_assets.run.failed');
      },
    });
  }

  entryLink(entryId: string | null): string | null {
    return entryId ? this.organization.urlFor(`/accounting/journal-entries/${entryId}/edit`) : null;
  }
}
