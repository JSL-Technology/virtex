import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Plus, Trash2 } from 'lucide-angular';
import { DraftShellComponent, DraftProblem } from '../../../../shared/components/gestures';
import { NotificationService } from '../../../../core/services/notification';
import { AuditAdjustmentsService } from '../../../../core/api/audit-adjustments.service';
import { FiscalYear, FiscalYearsService } from '../../../../core/api/fiscal-years.service';
import { AccountingService } from '../../../../core/api/accounting.service';
import { JournalsService } from '../../../../core/api/journals.service';
import { Account } from '../../../../core/models/account.model';
import { Journal } from '../../../../core/models/journal.model';
import { VxLocalizedNamePipe } from '@virteex/shared/ui-i18n';
import { isChargeable } from '../../../../core/services/account-selection';

/**
 * Proposing a correction to a year that is already closed.
 *
 * ## Why the year offered is only a closed one
 *
 * That is what an audit adjustment IS. `createAuditAdjustment` refuses a year that is still open —
 * an open year takes an ordinary entry — and refuses one that is archived, because an archived
 * year is closed to everybody including the auditor. Offering years the server will reject would
 * make the refusal the screen's way of teaching the rule, which is the worst way to teach it.
 *
 * ## Why it does not post anything
 *
 * It proposes. Whether the proposal becomes an entry depends on the tenant's approval policy for
 * `AUDIT_ADJUSTMENT`: with one, somebody has to grant it; without one it posts immediately. The
 * screen says which of the two happened rather than implying the auditor decided.
 */
@Component({
  selector: 'app-audit-adjustment-form-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    LucideAngularModule,
    DraftShellComponent,
    VxLocalizedNamePipe,
  ],
  templateUrl: './audit-adjustment-form.page.html',
  styleUrls: ['./audit-adjustment-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditAdjustmentFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly adjustments = inject(AuditAdjustmentsService);
  private readonly fiscalYears = inject(FiscalYearsService);
  private readonly accounting = inject(AccountingService);
  private readonly journals = inject(JournalsService);
  private readonly notifications = inject(NotificationService);

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;

  form!: FormGroup;

  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);
  /** Only years that are CLOSED: an open year takes an ordinary entry, an archived one takes none. */
  readonly years = signal<FiscalYear[]>([]);
  readonly journalOptions = signal<Journal[]>([]);
  readonly accounts = signal<Account[]>([]);

  /**
   * Every account a correction can be charged to.
   *
   * `isChargeable` and not the narrower purchase filter: an audit adjustment can touch any side of
   * the books — that is what makes it an adjustment — but never a control account the system posts
   * to by itself, because a manual entry into one of those puts the subledger and the ledger into
   * permanent disagreement.
   */
  readonly postableAccounts = computed(() => this.accounts().filter(isChargeable));

  readonly totalDebit = signal(0);
  readonly totalCredit = signal(0);
  readonly balanced = computed(
    () => Math.abs(this.totalDebit() - this.totalCredit()) < 0.005 && this.totalDebit() > 0,
  );

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  ngOnInit(): void {
    this.form = this.fb.group({
      fiscalYearId: ['', Validators.required],
      description: ['', [Validators.required, Validators.maxLength(500)]],
      journalId: ['', Validators.required],
      lines: this.fb.array([this.newLine(), this.newLine()]),
    });

    this.lines.valueChanges.subscribe(() => this.recalculate());

    this.fiscalYears.list({ status: 'CLOSED' }).subscribe({
      next: (years) => this.years.set(years),
      error: () => this.years.set([]),
    });
    this.journals.getJournals().subscribe({
      next: (rows) => this.journalOptions.set(rows),
      error: () => this.journalOptions.set([]),
    });
    this.accounting.getAccounts().subscribe({
      next: (rows) => this.accounts.set(rows),
      error: () => this.accounts.set([]),
    });
  }

  newLine(): FormGroup {
    return this.fb.group({
      accountId: ['', Validators.required],
      debit: [0, [Validators.required, Validators.min(0)]],
      credit: [0, [Validators.required, Validators.min(0)]],
      description: ['', Validators.required],
    });
  }

  addLine(): void {
    this.lines.push(this.newLine());
  }

  removeLine(index: number): void {
    // Two lines is the minimum a double entry can have; below that there is nothing to balance.
    if (this.lines.length <= 2) return;
    this.lines.removeAt(index);
  }

  private recalculate(): void {
    let debit = 0;
    let credit = 0;
    for (const line of this.lines.controls) {
      debit += Number(line.get('debit')?.value ?? 0);
      credit += Number(line.get('credit')?.value ?? 0);
    }
    this.totalDebit.set(debit);
    this.totalCredit.set(credit);
  }

  /**
   * What is still missing, named field by field.
   *
   * `vx-draft-shell` shows these and focuses the one the reader clicks, which is what makes a long
   * form answerable instead of a form that only says "invalid".
   */
  private collectProblems(): DraftProblem[] {
    const problems: DraftProblem[] = [];
    if (!this.form.get('fiscalYearId')?.value) {
      problems.push({ message: 'audit_adjustments.problem.year', fieldId: 'aa-fiscal-year' });
    }
    if (!this.form.get('journalId')?.value) {
      problems.push({ message: 'audit_adjustments.problem.journal', fieldId: 'aa-journal' });
    }
    if (!this.form.get('description')?.value?.trim()) {
      problems.push({
        message: 'audit_adjustments.problem.description',
        fieldId: 'aa-description',
      });
    }
    this.lines.controls.forEach((line, index) => {
      if (!line.get('accountId')?.value) {
        problems.push({
          message: 'audit_adjustments.problem.line_account',
          params: { line: index + 1 },
          fieldId: `aa-line-account-${index}`,
        });
      }
      if (!line.get('description')?.value?.trim()) {
        problems.push({
          message: 'audit_adjustments.problem.line_description',
          params: { line: index + 1 },
          fieldId: `aa-line-description-${index}`,
        });
      }
    });
    if (!this.balanced()) {
      problems.push({ message: 'audit_adjustments.problem.adjustment_does_not_balance_debits_credits', fieldId: 'aa-lines' });
    }
    return problems;
  }

  save(): void {
    const problems = this.collectProblems();
    this.problems.set(problems);
    if (problems.length > 0) return;

    const year = this.years().find((candidate) => candidate.id === this.form.value.fiscalYearId);
    if (!year) return;

    this.saving.set(true);
    this.adjustments
      .propose({
        fiscalYearId: year.id,
        // The proposal is dated the year it corrects, not the day it was raised: the entry lands
        // on the year's last day and a proposal dated otherwise would say two different things.
        date: year.endDate,
        description: this.form.value.description.trim(),
        journalId: this.form.value.journalId,
        lines: this.lines.value.map(
          (line: { accountId: string; debit: number; credit: number; description: string }) => ({
            accountId: line.accountId,
            debit: Number(line.debit ?? 0),
            credit: Number(line.credit ?? 0),
            description: line.description.trim(),
          }),
        ),
      })
      .subscribe({
        next: (proposal) => {
          this.saving.set(false);
          this.notifications.showSuccess(
            proposal.status === 'POSTED'
              ? 'audit_adjustments.proposed_and_posted'
              : 'audit_adjustments.proposed_pending',
          );
          this.router.navigate(['/accounting/audit-adjustments']);
        },
        error: (error: { error?: { message?: string } }) => {
          this.saving.set(false);
          const message = error?.error?.message;
          this.notifications.showError(
            typeof message === 'string' ? message : 'audit_adjustments.propose_failed',
          );
        },
      });
  }

  cancel(): void {
    this.router.navigate(['/accounting/audit-adjustments']);
  }
}
