import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CalendarClock, LucideAngularModule, PlusCircle } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxPagerComponent } from '../../../shared/components/pager';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { NotificationService } from '../../../core/services/notification';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { FixedAsset, FixedAssetStatus, FixedAssetsService } from '../data/fixed-assets.service';

export const FIXED_ASSET_TONE: Record<FixedAssetStatus, VxTone> = { IN_USE: 'ok', SOLD: 'neutral', DISPOSED: 'neutral' };

/**
 * The fixed-asset register (audit H-21): what the company owns, what it cost, what has been
 * written off and what each is worth today — Odoo's *Assets*, NetSuite's *Fixed Assets*, SAP's
 * asset explorer. The server kept the register; nothing on screen showed it.
 */
@Component({
  selector: 'app-fixed-assets-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslatePipe,
    LucideAngularModule,
    ...FORMAT_PIPES,
    ListShellComponent,
    VxBadgeComponent,
    VxPagerComponent,
    VxAmountComponent,
    VxBranchPickerComponent,
    VxBranchLabelComponent,
    HasPermissionDirective,
    RowLinkDirective,
  ],
  templateUrl: './fixed-assets.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedAssetsPage implements OnInit {
  private readonly assets = inject(FixedAssetsService);
  private readonly notifications = inject(NotificationService);
  protected readonly branches = inject(BranchesService);

  protected readonly NewIcon = PlusCircle;
  protected readonly RunIcon = CalendarClock;
  protected readonly tones = FIXED_ASSET_TONE;

  readonly rows = signal<FixedAsset[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(50);
  readonly search = signal('');
  readonly statusFilter = signal<FixedAssetStatus | ''>('IN_USE');
  readonly branchFilter = signal<string | null>(null);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  /** The register's totals on this page: what the visible assets cost and are carried at. */
  readonly totals = computed(() => {
    const cents = (pick: (asset: FixedAsset) => number) =>
      this.rows().reduce((sum, asset) => sum + Math.round(pick(asset) * 100), 0) / 100;
    return {
      cost: cents((asset) => asset.cost),
      accumulated: cents((asset) => asset.accumulatedDepreciation),
      book: cents((asset) => asset.status === 'IN_USE' ? asset.cost - asset.accumulatedDepreciation : 0),
    };
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.assets
      .list({
        status: this.statusFilter() || null,
        search: this.search().trim() || null,
        branchId: this.branchFilter(),
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.rows);
          this.total.set(result.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.notifications.httpErrorMessage(error, 'fixed_assets.page.load_failed'));
          this.loading.set(false);
        },
      });
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  changePageSize(size: number): void {
    this.pageSize.set(size);
    this.applyFilters();
  }

  /** `IN_USE` → `fixed_assets.status.in_use`. */
  statusKey(status: FixedAssetStatus): string {
    return `fixed_assets.status.${status.toLowerCase()}`;
  }
}
