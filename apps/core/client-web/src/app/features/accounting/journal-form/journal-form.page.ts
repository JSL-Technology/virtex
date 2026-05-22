import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { JournalsService } from '../../../core/api/journals.service';
import { NotificationService } from '../../../core/services/notification';
import { Journal } from '../../../core/models/journal.model';
// import { JournalsService } from '@app/core/api/journals.service';
// import { Journal } from '@app/core/models/journal.model';
// import { NotificationService } from '@app/core/services/notification';

@Component({
  selector: 'app-journal-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
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

    if (this.isEditMode && this.journalId) {
      this.journalsService.update(this.journalId, journalData).subscribe(() => {
        console.log('Journal updated successfully');
        this.router.navigate(['/accounting/journals']);
      });
    } else {
      this.journalsService.create(journalData).subscribe(() => {
        console.log('Journal created successfully');
        this.router.navigate(['/accounting/journals']);
      });
    }
  }
}