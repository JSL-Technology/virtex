import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Plus, Pencil, Trash2, PlusCircle } from 'lucide-angular';
import { catchError, of } from 'rxjs';
import { ListShellComponent } from '../../../shared/components/gestures';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import {
  ProductCategoriesService,
  ProductCategory,
} from '../../../core/api/product-categories.service';

/** One row as the table draws it: the category plus how deep it sits in the tree. */
interface CategoryRow {
  category: ProductCategory;
  depth: number;
}

/**
 * The product-category master.
 *
 * ## What this was
 *
 * A placeholder. The page said "the list and management of categories will appear here", the
 * "New category" button did nothing, and the only categories the product had were three options
 * written into the product form's template — `Electrónica`, `Accesorios`, `Monitores`. Every
 * tenant, in every market, was asked to file what they sell under a demo catalogue from a computer
 * shop, and because the stored value was free text the same category read `Electronics` in the
 * form and `Electrónica` in the register.
 *
 * Categories are now the tenant's own: created, renamed, nested and retired by them, with every
 * product pointing at a row rather than carrying a copy of its name.
 *
 * Edited inline rather than through a form page: a category is a name, a parent and a code, and a
 * whole screen for three fields is a screen nobody opens twice.
 */
@Component({
  selector: 'app-categories-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './categories.page.html',
  styleUrls: ['./categories.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriesPage {
  private readonly categoriesService = inject(ProductCategoriesService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);

  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly AddIcon = Plus;
  protected readonly EditIcon = Pencil;
  protected readonly DeleteIcon = Trash2;

  readonly categories = signal<ProductCategory[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly busy = signal(false);
  /** Retired categories are hidden by default; they are history, not choices. */
  readonly includeInactive = signal(false);

  readonly creating = signal(false);
  readonly editing = signal<string | null>(null);

  readonly isEmpty = computed(() => !this.loading() && this.categories().length === 0);

  /**
   * The tree, flattened for a table, parents before their children.
   *
   * A category list read in insertion order is unreadable the moment anything is nested: the
   * child appears far from the parent it belongs to, and the reader has to rebuild the structure
   * in their head. `depth` is what the template indents by.
   */
  readonly rows = computed<CategoryRow[]>(() => {
    const all = this.categories();
    const byParent = new Map<string | null, ProductCategory[]>();
    for (const category of all) {
      const key = category.parentId ?? null;
      byParent.set(key, [...(byParent.get(key) ?? []), category]);
    }

    const out: CategoryRow[] = [];
    const walk = (parentId: string | null, depth: number): void => {
      for (const category of byParent.get(parentId) ?? []) {
        out.push({ category, depth });
        walk(category.id, depth + 1);
      }
    };
    walk(null, 0);

    // Anything whose parent is not in the list — a child of a retired category while the filter
    // hides it — still has to appear, or it would silently vanish from the master.
    const shown = new Set(out.map((row) => row.category.id));
    for (const category of all) {
      if (!shown.has(category.id)) out.push({ category, depth: 0 });
    }
    return out;
  });

  /** Candidate parents when creating or editing: everything except the row being edited. */
  readonly parentOptions = computed(() =>
    this.categories().filter((category) => category.id !== this.editing()),
  );

  constructor() {
    this.reload();
  }

  toggleInactive(): void {
    this.includeInactive.update((value) => !value);
    this.reload();
  }

  create(name: string, code: string, parentId: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.busy.set(true);
    this.categoriesService
      .create({ name: trimmed, code: code.trim() || null, parentId: parentId || null })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.creating.set(false);
          this.reload();
        },
        error: (error) => this.fail(error),
      });
  }

  update(category: ProductCategory, name: string, code: string, parentId: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.busy.set(true);
    this.categoriesService
      .update(category.id, {
        name: trimmed,
        code: code.trim() || null,
        parentId: parentId || null,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.editing.set(null);
          this.reload();
        },
        error: (error) => this.fail(error),
      });
  }

  /**
   * Retire a category instead of deleting it.
   *
   * A category that has been used is part of the record of what was sold under it. Deactivating
   * takes it out of every dropdown without reclassifying a single product.
   */
  setActive(category: ProductCategory, isActive: boolean): void {
    this.busy.set(true);
    this.categoriesService.update(category.id, { isActive }).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
      },
      error: (error) => this.fail(error),
    });
  }

  async remove(category: ProductCategory): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_product_category.title',
      message: 'dialog.delete_product_category.message',
      messageParams: { name: category.name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    this.busy.set(true);
    this.categoriesService.remove(category.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
      },
      error: (error) => this.fail(error),
    });
  }

  reload(): void {
    this.loading.set(true);
    this.categoriesService
      .list({ includeInactive: this.includeInactive() })
      .pipe(catchError(() => of(null)))
      .subscribe((rows) => {
        this.categories.set(rows ?? []);
        this.loading.set(false);
        this.failed.set(rows === null);
      });
  }

  /**
   * The server's own message when it has one.
   *
   * It is the server that knows a category still has products under it and how many, and that
   * sentence is more useful than any generic failure this page could invent.
   */
  private fail(error: { error?: { message?: string } }): void {
    this.busy.set(false);
    const message = error?.error?.message;
    this.notifications.showError(
      typeof message === 'string' ? message : 'inventory.categories.save_failed',
    );
  }
}
