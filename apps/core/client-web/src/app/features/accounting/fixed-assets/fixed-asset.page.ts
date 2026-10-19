import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Ban, LucideAngularModule, Pencil, Trash2 } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { DocumentShellComponent } from '../../../shared/components/gestures';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxBranchLabelComponent } from '../../../shared/components/branch-picker';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { FixedAsset, FixedAssetSchedule, FixedAssetsService, hasBeenDepreciated } from '../data/fixed-assets.service';
import { FIXED_ASSET_TONE } from './fixed-assets.page';

/**
 * One fixed asset, read: what it cost and is worth, its depreciation board — the months charged,
 * each with its entry, and the projection of the rest — and, once retired, how and with which
 * entry it left the books.
 */
@Component({
  selector: 'app-fixed-asset-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, DocumentShellComponent, VxAmountComponent, VxBranchLabelComponent, HasPermissionDirective],
  templateUrl: './fixed-asset.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss', '../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedAssetPage implements OnInit {
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
