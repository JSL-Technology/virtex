import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Ban, CheckCircle2, LucideAngularModule, Pencil, PlusCircle, RotateCw, Trash2 } from 'lucide-angular';
import { TranslateModule, VxLocalizedNamePipe } from '@virtex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virtex/shared/ui-a11y';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../shared/components/context-menu';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { FixedAssetCategory, FixedAssetsService, TaxCategoryCatalogue, asPercent } from '../data/fixed-assets.service';

/**
 * The company's categories of fixed assets (audit 2026-11-07, FINB-16): what an asset of each
 * starts with — life, method, residual share, accounts — and the tax category and rate its tax
 * book follows. A Dominican company starts with the DGII's three, a Mexican one with the SAT's.
 */
@Component({
  selector: 'app-fixed-asset-categories-page',
  standalone: true,
  imports: [
    ...VX_CONTEXT_MENU,
    FormsModule,
    ...VX_FORM_A11Y,
    RouterLink,
    TranslateModule,
    VxLocalizedNamePipe,
    LucideAngularModule,
    ListShellComponent,
    VxBadgeComponent,
    HasPermissionDirective,
    RowLinkDirective,
  ],
  templateUrl: './fixed-asset-categories.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedAssetCategoriesPage implements OnInit {
  private readonly assets = inject(FixedAssetsService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly navigation = inject(NavigationActionsService);

  protected readonly NewIcon = PlusCircle;
  protected readonly asPercent = asPercent;

  readonly rows = signal<FixedAssetCategory[]>([]);
  readonly catalogue = signal<TaxCategoryCatalogue | null>(null);
  readonly includeInactive = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);
  /** The authority's name for each tax category, by code. */
  private readonly taxNames = computed(() => new Map((this.catalogue()?.categories ?? []).map((entry) => [entry.code, entry.nameKey])));

  readonly menu: ListMenuConfig<FixedAssetCategory> = {
    resource: 'fixed-asset-categories',
    row: (ctx) => {
      const category = ctx.entity as FixedAssetCategory;
      return [
        {
          id: 'document',
          items: [
            { id: 'edit', label: 'fixed_assets.categories.edit', icon: Pencil, permission: 'fixed_assets:manage', run: () => this.navigation.open(`/accounting/fixed-assets/categories/${category.id}`, 'preview') },
            {
              id: 'toggle',
              label: category.isActive ? 'fixed_assets.categories.deactivate' : 'fixed_assets.categories.activate',
              icon: category.isActive ? Ban : CheckCircle2,
              permission: 'fixed_assets:manage',
              run: () => this.setActive(category, !category.isActive),
            },
          ],
        },
        {
          id: 'corrections',
          items: [{ id: 'delete', label: 'fixed_assets.categories.delete', icon: Trash2, danger: true, permission: 'fixed_assets:manage', run: () => void this.remove(category) }],
        },
        { id: 'list', items: [{ id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.load() }] },
      ];
    },
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({ categories: this.assets.listCategories(this.includeInactive()), catalogue: this.assets.taxCategories() }).subscribe({
      next: ({ categories, catalogue }) => {
        this.rows.set(categories);
        this.catalogue.set(catalogue);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'fixed_assets.categories.load_failed'));
        this.loading.set(false);
      },
    });
  }

  setIncludeInactive(value: boolean): void {
    this.includeInactive.set(value);
    this.load();
  }

  /** The authority's name of a tax category, as a catalogue key; null for one it does not fix. */
  taxCategoryKey(code: string | null): string | null {
    return code ? (this.taxNames().get(code) ?? null) : null;
  }

  setActive(category: FixedAssetCategory, isActive: boolean): void {
    this.assets.updateCategory(category.id, { isActive }).subscribe({
      next: () => {
        this.notifications.showSuccess(isActive ? 'fixed_assets.categories.activated' : 'fixed_assets.categories.deactivated', { code: category.code });
        this.load();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'fixed_assets.categories.save_failed'),
    });
  }

  async remove(category: FixedAssetCategory): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'fixed_assets.categories.delete_title',
      message: 'fixed_assets.categories.delete_message',
      messageParams: { code: category.code, name: category.name },
      confirmText: 'fixed_assets.categories.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.assets.removeCategory(category.id).subscribe({
      next: () => {
        this.notifications.showSuccess('fixed_assets.categories.deleted', { code: category.code });
        this.load();
      },
      // A category assets were registered in is refused, with what uses it and the way out.
      error: (error: unknown) => this.notifications.showHttpError(error, 'fixed_assets.categories.delete_failed'),
    });
  }
}
