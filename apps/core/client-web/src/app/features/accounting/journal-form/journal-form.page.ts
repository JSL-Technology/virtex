import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { JournalsService } from '../../../core/api/journals.service';
import { NotificationService } from '../../../core/services/notification';
import { Journal } from '../../../core/models/journal.model';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

@Component({
  selector: 'app-journal-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, DraftShellComponent, ...VX_FORM_A11Y],
  templateUrl: './journal-form.page.html',
  styleUrls: ['./journal-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JournalFormPage implements OnInit {
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  private fb = inject(FormBuilder);
  private journalsService = inject(JournalsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notification = inject(NotificationService);

  readonly problems = signal<DraftProblem[]>([]);
  /** The journal being edited, once loaded: what it allows to change depends on its history. */
  readonly original = signal<Journal | null>(null);
  readonly loadError = signal<string | null>(null);

  journalForm: FormGroup;
  isEditMode = false;
  journalId: string | null = null;

  constructor() {
    this.journalForm = this.fb.group({
      name: ['', Validators.required],
      code: ['', Validators.required],
      type: ['GENERAL', Validators.required]
    });
  }

  ngOnInit() {
    this.journalId = this.route.snapshot.paramMap.get('id');
    if (this.journalId) {
      this.isEditMode = true;
      this.journalsService.getJournalById(this.journalId).subscribe({
        next: (journal) => {
          this.original.set(journal);
          this.journalForm.patchValue(journal);
          this.tab?.setTitle(`${journal.code} · ${journal.name}`);
          // The server enforces the same rule; saying it here spares a refused save. The code
          // prefixes every entry number the journal issued, and the product looks its own
          // journals up by code; the type decides which documents may post to it.
          if (journal.isSystem || (journal.entryCount ?? 0) > 0) this.journalForm.get('code')?.disable();
          if ((journal.entryCount ?? 0) > 0) this.journalForm.get('type')?.disable();
          this.journalForm.markAsPristine();
        },
        error: (error: unknown) =>
          this.loadError.set(this.notification.httpErrorMessage(error, 'accounting.journal_form.journal_could_not_loaded')),
      });
    }
  }

  cancel(): void {
    void this.router.navigate(['/accounting/journals']);
  }

  onSubmit() {
    if (this.journalForm.invalid) {
      //  Antes se salía en silencio: el botón estaba deshabilitado, así que el usuario se
      //  quedaba mirando un formulario que no reaccionaba y sin nada que le dijera por qué.
      this.journalForm.markAllAsTouched();
      this.problems.set(
        draftProblems(this.journalForm, {
          name: 'accounting.journal_form.name',
          code: 'accounting.journal_form.code',
          type: 'accounting.journal_form.type',
        }),
      );
      return;
    }

    this.problems.set([]);

    // `value`, not `getRawValue()`: a field locked by the journal's history is not sent at all.
    const journalData = this.journalForm.value as Partial<Journal>;

    // Success went to `console.log` and failure went nowhere at all: a rejected save left the
    // user on an unchanged form with no navigation and no message, indistinguishable from a
    // click that had not registered.
    const request =
      this.isEditMode && this.journalId
        ? this.journalsService.update(this.journalId, journalData)
        : this.journalsService.create(journalData as Journal);

    request.subscribe({
      next: () => {
        this.notification.showSuccess(
          this.isEditMode
            ? 'accounting.journal_form.journal_updated'
            : 'accounting.journal_form.journal_created',
        );
        //  Esta ventana ya cumplió: el registro existe y la página se va a la lista. Si se dejara
        //  abierta seguiría anunciándose como «el formulario nuevo», y el siguiente clic en «Nuevo»
        //  la enfocaría con el documento ya guardado dentro. Ver `TabContext.close`.
        void this.router.navigate(['/accounting/journals']).then(() => this.tab?.close());
      },
      error: (error: unknown) => {
        this.notification.showHttpError(error, 'accounting.journal_form.journal_could_not_saved');
      },
    });
  }
}