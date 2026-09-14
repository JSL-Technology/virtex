import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

import { ListShellComponent } from '../../../shared/components/gestures';
import { Warehouse, WarehousesService } from '../../../core/api/warehouses.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { NotificationService } from '../../../core/services/notification';

/**
 * Where stock is held.
 *
 * ## What this replaces
 *
 * Three invented sites with invented managers — Almacén Principal / Carlos Pérez, Almacén de
 * Santiago / María Rodríguez, Almacén Zona Franca / Ana Gómez — held in a signal in this component,
 * with no request made and a "New warehouse" button wired to nothing. The `warehouses` table held
 * zero rows and `/wms/warehouses` had answered full CRUD the whole time. Someone configuring the
 * company believed they had three warehouses; stock could be assigned to none of them.
 *
 * `manager` is gone from the columns because there is no such field: it was part of the fiction.
 */
@Component({
  selector: 'app-warehouses-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent, FormsModule],
  templateUrl: './warehouses.page.html',
  styleUrls: ['./warehouses.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WarehousesPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;

  private readonly api = inject(WarehousesService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly notifications = inject(NotificationService);

  readonly warehouses = signal<Warehouse[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  readonly creating = signal(false);
  readonly draftName = signal('');
  readonly draftCode = signal('');
  readonly draftCity = signal('');

  readonly canSave = computed(() => !this.saving() && this.draftName().trim().length > 0);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (list) => {
        this.warehouses.set(list ?? []);
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
        name: this.draftName().trim(),
        code: this.draftCode().trim() || undefined,
        city: this.draftCity().trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.creating.set(false);
          this.resetDraft();
          this.notifications.showSuccess('masters.warehouses.created');
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
    this.draftCode.set('');
    this.draftCity.set('');
  }
}
