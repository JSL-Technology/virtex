import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { JournalsService } from '../../../core/api/journals.service';
import { NotificationService } from '../../../core/services/notification';
import { Journal } from '../../../core/models/journal.model';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-journal-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslateModule],
  templateUrl: './journal-form.page.html',
  styleUrls: ['./journal-form.page.scss']
})
export class JournalFormPage implements OnInit {
  private fb = inject(FormBuilder);
  private journalsService = inject(JournalsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notification = inject(NotificationService);

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

  onSubmit() {
    if (this.journalForm.invalid) {
      return;
    }

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