import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Plus, Pencil, Trash2 } from 'lucide-angular';
import { catchError, of } from 'rxjs';
import { ListShellComponent } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import {
  ConceptCalculation,
  ConceptType,
  PayrollConcept,
  PayrollService,
} from '../../../core/api/payroll.service';

/**
 * The concept catalogue: every line that can appear on a payslip.
 *
 * ## What a concept is, and what it is not
 *
 * An earning adds to gross, a deduction is withheld from the employee, an employer contribution is
 * borne by the company and never taken from the person. `STATUTORY` concepts — AFP, SFS, ISR — are
 * computed by the jurisdiction engine from versioned rates; the row exists so the line has a stable
 * code, a name and an account to post to. They are marked as system concepts and cannot be edited
 * here, because editing the *name* of a legal deduction is reasonable and editing its *rate* from a
 * catalogue screen is how a payroll quietly stops matching the law.
 */
@Component({
  selector: 'app-payroll-concepts-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './concepts.page.html',
  styleUrls: ['./concepts.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayrollConceptsPage {
  private readonly payroll = inject(PayrollService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);

  protected readonly AddIcon = Plus;
  protected readonly EditIcon = Pencil;
  protected readonly DeleteIcon = Trash2;

  readonly concepts = signal<PayrollConcept[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly busy = signal(false);
  readonly includeInactive = signal(false);

  readonly creating = signal(false);
  readonly editing = signal<string | null>(null);

  /** The draft being written, whether new or an edit. */
  readonly draft = signal<Partial<PayrollConcept>>(blank());

  readonly isEmpty = computed(() => !this.loading() && this.concepts().length === 0);

  readonly types: ConceptType[] = ['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION'];
  readonly calculations: ConceptCalculation[] = ['FIXED', 'PERCENTAGE', 'HOURLY'];

  constructor() {
    this.reload();
  }

  startCreate(): void {
    this.draft.set(blank());
    this.editing.set(null);
    this.creating.set(true);
  }

  startEdit(concept: PayrollConcept): void {
    this.draft.set({ ...concept });
    this.creating.set(false);
    this.editing.set(concept.id);
  }

  patch(patch: Partial<PayrollConcept>): void {
    this.draft.update((current) => ({ ...current, ...patch }));
  }

  save(): void {
    const draft = this.draft();
    if (!draft.code?.trim() || !draft.name?.trim()) return;

    this.busy.set(true);
    const body = {
      code: draft.code.trim().toUpperCase(),
      name: draft.name.trim(),
      type: draft.type,
      calculation: draft.calculation,
      rate: draft.rate ?? undefined,
      taxable: draft.taxable,
      contributesToTss: draft.contributesToTss,
      active: draft.active,
    };

    const request = this.editing()
      ? this.payroll.updateConcept(this.editing()!, body)
      : this.payroll.createConcept(body);

    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.creating.set(false);
        this.editing.set(null);
        this.reload();
      },
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  cancel(): void {
    this.creating.set(false);
    this.editing.set(null);
  }

  async remove(concept: PayrollConcept): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_payroll_concept.title',
      message: 'dialog.delete_payroll_concept.message',
      messageParams: { name: concept.name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    this.busy.set(true);
    this.payroll.removeConcept(concept.id).subscribe({
      next: () => { this.busy.set(false); this.reload(); },
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  toggleInactive(value: boolean): void {
    this.includeInactive.set(value);
    this.reload();
  }

  private reload(): void {
    this.loading.set(true);
    this.payroll
      .listConcepts(this.includeInactive())
      .pipe(catchError(() => of(null)))
      .subscribe((rows) => {
        this.concepts.set(rows ?? []);
        this.loading.set(false);
        this.failed.set(rows === null);
      });
  }

  private fail(error: { error?: { message?: string } }): void {
    this.busy.set(false);
    const message = error?.error?.message;
    this.notifications.showError(
      typeof message === 'string' ? message : 'payroll.concepts.save_failed',
    );
  }
}

function blank(): Partial<PayrollConcept> {
  return {
    code: '',
    name: '',
    type: 'EARNING',
    calculation: 'FIXED',
    rate: null,
    taxable: true,
    contributesToTss: true,
    active: true,
  };
}
