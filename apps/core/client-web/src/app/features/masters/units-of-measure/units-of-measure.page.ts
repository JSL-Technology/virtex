import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, PlusCircle, Trash2 } from 'lucide-angular';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { AuthService } from '../../../core/services/auth';

import { ListShellComponent } from '../../../shared/components/gestures';
import { UnitOfMeasure, UnitsOfMeasureService } from '../../../core/api/units-of-measure.service';
import { UNIT_CATEGORIES } from '../data/units-of-measure.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { VxBadgeComponent } from '../../../shared/components/badge';

type Category = (typeof UNIT_CATEGORIES)[number];

/**
 * The units products are counted, weighed and measured in.
 *
 * Two sources, one list (QA M-18): the shared catalogue — unit, kilogram, metre — that every company
 * has, and the company's own units — «saco de 50 kg», «bulto» — which «Nueva unidad» creates. The
 * screen used to offer creating only to platform operators (the shared catalogue is theirs), so a
 * company could not add the unit it sells by; and it listed everything by symbol without saying so,
 * which put «Pie» and «Pie cuadrado» before «Gramo». Units are now grouped by category, in the
 * catalogue's order, and sorted by name in the reader's own language.
 */
@Component({
  selector: 'app-units-of-measure-page',
  standalone: true,
  imports: [...VX_SORT, CanOpenDirective, LucideAngularModule, TranslateModule, ListShellComponent, FormsModule, ...VX_FORM_A11Y, VxBadgeComponent],
  templateUrl: './units-of-measure.page.html',
  styleUrls: ['./units-of-measure.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitsOfMeasurePage implements OnInit {
  private readonly translate = inject(TranslateService);
  private readonly api = inject(UnitsOfMeasureService);
  private readonly auth = inject(AuthService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);

  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly TrashIcon = Trash2;
  protected readonly CATEGORIES = UNIT_CATEGORIES;

  /** A company's own units are managed by whoever manages its master data. */
  readonly canManage = computed(() => this.auth.hasPermissions(['units_of_measure:manage']));

  readonly units = signal<UnitOfMeasure[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  readonly creating = signal(false);
  readonly draftName = signal('');
  readonly draftSymbol = signal('');
  readonly draftCategory = signal<Category>('Units');

  /** Category first (catalogue order), then name as the reader reads it. Headers still re-sort. */
  readonly ordered = computed(() => {
    const order = new Map<string, number>(UNIT_CATEGORIES.map((c, i) => [c, i]));
    const collator = new Intl.Collator(this.translate.getCurrentLang() || 'es', { sensitivity: 'base' });
    return [...this.units()].sort(
      (a, b) =>
        (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) ||
        collator.compare(this.nameOf(a), this.nameOf(b)),
    );
  });

  /** Sortable by its headers (QA B-01); the default order is the grouped one above. */
  readonly table = sortable(() => this.ordered(), {
    name: (unit) => this.nameOf(unit),
    category: (unit) => this.categoryLabel(unit.category),
  });

  readonly canSave = computed(
    () => !this.saving() && this.draftName().trim().length > 0 && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(this.draftSymbol().trim()),
  );

  ngOnInit(): void {
    this.load();
  }

  nameOf(unit: UnitOfMeasure): string {
    return unit.name ?? (unit.nameKey ? this.translate.instant(unit.nameKey) : unit.symbol);
  }

  categoryLabel(category: string): string {
    const key = `masters.units_of_measure.category.${category.toLowerCase()}`;
    const text = this.translate.instant(key);
    return text === key ? category : text;
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (list) => {
        this.units.set(list ?? []);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.errors.keyFor(err));
        this.loading.set(false);
      },
    });
  }

  toggleCreate(): void {
    this.creating.update((open) => !open);
    if (!this.creating()) this.resetDraft();
  }

  save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.api
      .createForCompany({
        symbol: this.draftSymbol().trim().toUpperCase(),
        name: this.draftName().trim(),
        category: this.draftCategory(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.creating.set(false);
          this.resetDraft();
          this.notifications.showSuccess('masters.units_of_measure.created');
          this.load();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.notifications.showHttpError(err, 'masters.units_of_measure.create_failed');
        },
      });
  }

  async remove(unit: UnitOfMeasure): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'masters.units_of_measure.delete_title',
      message: 'masters.units_of_measure.delete_message',
      messageParams: { name: this.nameOf(unit), symbol: unit.symbol },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.api.removeForCompany(unit.id).subscribe({
      next: () => {
        this.notifications.showSuccess('masters.units_of_measure.deleted', { name: this.nameOf(unit) });
        this.load();
      },
      // «Used by 3 products» — the server's own sentence, not a generic failure.
      error: (err: HttpErrorResponse) => this.notifications.showHttpError(err, 'masters.units_of_measure.delete_failed'),
    });
  }

  private resetDraft(): void {
    this.draftName.set('');
    this.draftSymbol.set('');
    this.draftCategory.set('Units');
  }
}
