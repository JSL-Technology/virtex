import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Plus, Pencil, Trash2 } from 'lucide-angular';
import { catchError, of } from 'rxjs';
import { ListShellComponent } from '../../../shared/components/gestures';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { Department, HcmService } from '../../../core/api/hcm.service';

/**
 * Departments: the company's own structure, and the cost centre each part posts to.
 *
 * The endpoints existed and nothing called them, so an employee's department could be set only
 * through a REST client — which meant, in practice, that every employee had none, and the payroll
 * entry could not be split by cost centre.
 *
 * Edited inline rather than through a form page: a department is a name and a cost centre, and a
 * whole screen for two fields is a screen nobody opens twice.
 */
@Component({
  selector: 'app-departments-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './departments.page.html',
  styleUrls: ['./departments.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DepartmentsPage {
  private readonly hcm = inject(HcmService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);

  protected readonly AddIcon = Plus;
  protected readonly EditIcon = Pencil;
  protected readonly DeleteIcon = Trash2;

  readonly departments = signal<Department[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly busy = signal(false);

  readonly creating = signal(false);
  readonly editing = signal<string | null>(null);

  readonly isEmpty = computed(() => !this.loading() && this.departments().length === 0);

  constructor() {
    this.reload();
  }

  create(name: string, costCenter: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.busy.set(true);
    this.hcm.createDepartment({ name: trimmed, costCenter: costCenter.trim() || undefined }).subscribe({
      next: () => { this.busy.set(false); this.creating.set(false); this.reload(); },
      error: (error) => this.fail(error),
    });
  }

  update(department: Department, name: string, costCenter: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.busy.set(true);
    this.hcm
      .updateDepartment(department.id, { name: trimmed, costCenter: costCenter.trim() || undefined })
      .subscribe({
        next: () => { this.busy.set(false); this.editing.set(null); this.reload(); },
        error: (error) => this.fail(error),
      });
  }

  async remove(department: Department): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'DIALOG.DELETE_DEPARTMENT.TITLE',
      message: 'DIALOG.DELETE_DEPARTMENT.MESSAGE',
      messageParams: { name: department.name },
      confirmText: 'COMMON.DELETE',
      variant: 'danger',
    });
    if (!confirmed) return;

    this.busy.set(true);
    this.hcm.removeDepartment(department.id).subscribe({
      next: () => { this.busy.set(false); this.reload(); },
      error: (error) => this.fail(error),
    });
  }

  private reload(): void {
    this.loading.set(true);
    this.hcm.listDepartments().pipe(catchError(() => of(null))).subscribe((rows) => {
      this.departments.set(rows ?? []);
      this.loading.set(false);
      this.failed.set(rows === null);
    });
  }

  private fail(error: { error?: { message?: string } }): void {
    this.busy.set(false);
    const message = error?.error?.message;
    this.notifications.showError(
      typeof message === 'string' ? message : 'HCM.DEPARTMENTS.SAVE_FAILED',
    );
  }
}
