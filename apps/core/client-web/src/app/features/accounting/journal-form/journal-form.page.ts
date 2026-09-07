import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { JournalsService } from '../../../core/api/journals.service';
import { NotificationService } from '../../../core/services/notification';
import { Journal } from '../../../core/models/journal.model';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';

@Component({
  selector: 'app-journal-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, DraftShellComponent],
  templateUrl: './journal-form.page.html',
  styleUrls: ['./journal-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JournalFormPage implements OnInit {
  private fb = inject(FormBuilder);
  private journalsService = inject(JournalsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notification = inject(NotificationService);

  readonly problems = signal<DraftProblem[]>([]);

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
      this.journalsService.getJournalById(this.journalId).subscribe((journal) => {
        this.journalForm.patchValue(journal);
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
          name: 'ACCOUNTING.JOURNAL_FORM.NAME',
          code: 'ACCOUNTING.JOURNAL_FORM.CODE',
          type: 'ACCOUNTING.JOURNAL_FORM.TYPE',
        }),
      );
      return;
    }

    this.problems.set([]);

    const journalData: Journal = this.journalForm.value;

    // Success went to `console.log` and failure went nowhere at all: a rejected save left the
    // user on an unchanged form with no navigation and no message, indistinguishable from a
    // click that had not registered.
    const request =
      this.isEditMode && this.journalId
        ? this.journalsService.update(this.journalId, journalData)
        : this.journalsService.create(journalData);

    request.subscribe({
      next: () => {
        this.notification.showSuccess(
          this.isEditMode
            ? 'ACCOUNTING.JOURNAL_FORM.DIARIO_ACTUALIZADO'
            : 'ACCOUNTING.JOURNAL_FORM.DIARIO_CREADO',
        );
        this.router.navigate(['/accounting/journals']);
      },
      error: (error: { error?: { message?: string } }) => {
        const message = error?.error?.message;
        this.notification.showError(
          typeof message === 'string'
            ? message
            : 'ACCOUNTING.JOURNAL_FORM.NO_SE_PUDO_GUARDAR',
        );
      },
    });
  }
}