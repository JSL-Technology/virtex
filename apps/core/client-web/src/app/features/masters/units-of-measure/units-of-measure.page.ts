import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

import { ListShellComponent } from '../../../shared/components/gestures';
import { UnitOfMeasure, UnitsOfMeasureService } from '../../../core/api/units-of-measure.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { NotificationService } from '../../../core/services/notification';

/**
 * The units products are counted, weighed and measured in.
 *
 * ## What this replaces
 *
 * Six invented units held in a signal — kilogram, gram, piece, unit, litre, metre — with no request
 * made and a "New" button wired to nothing, while `/units-of-measure` answered GET and POST and the
 * table held none. A product could not be given a unit this screen claimed to offer.
 *
 * The name is a catalogue key rather than text, because a unit's name is translated; where a key is
 * not seeded the missing-key handler renders its last segment, so a unit added by a tenant still
 * reads as words.
 */
@Component({
  selector: 'app-units-of-measure-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent, FormsModule],
  templateUrl: './units-of-measure.page.html',
  styleUrls: ['./units-of-measure.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitsOfMeasurePage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;

  private readonly api = inject(UnitsOfMeasureService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly notifications = inject(NotificationService);

  readonly units = signal<UnitOfMeasure[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  readonly creating = signal(false);
  readonly draftName = signal('');
  readonly draftSymbol = signal('');
  readonly draftCategory = signal('');

  readonly canSave = computed(
    () =>
      !this.saving() &&
      this.draftName().trim().length > 0 &&
      this.draftSymbol().trim().length > 0 &&
      this.draftCategory().trim().length > 0,
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (list) => {
        this.units.set([...(list ?? [])].sort((a, b) => a.symbol.localeCompare(b.symbol)));
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
      .create({
        symbol: this.draftSymbol().trim(),
        category: this.draftCategory().trim(),
        nameKey: unitNameKey(this.draftName()),
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
          this.notifications.showError(this.errors.keyFor(err));
        },
      });
  }

  private resetDraft(): void {
    this.draftName.set('');
    this.draftSymbol.set('');
    this.draftCategory.set('');
  }
}

/**
 * `Caja de 12` becomes `uom.caja_de_12`.
 *
 * The column is a catalogue key, so what the user typed has to become one. Same normalisation the
 * catalogue itself uses: lower snake, no punctuation.
 */
export function unitNameKey(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `uom.${slug}`;
}
