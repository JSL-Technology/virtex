import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-angular';
import { Observable, catchError, map, of } from 'rxjs';

import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { VxFieldErrorComponent } from '../../../../shared/components/field-error';
import { DraftAutosave } from '../../../../shared/forms/draft-autosave';
import { NotificationService } from '../../../../core/services/notification';
import { DialogService } from '../../../../core/services/dialog.service';
import { AuditAdjustmentsService } from '../../../../core/api/audit-adjustments.service';
import { FiscalYear, FiscalYearsService } from '../../../../core/api/fiscal-years.service';
import { AccountingService } from '../../../../core/api/accounting.service';
import { JournalsService } from '../../../../core/api/journals.service';
import { Account } from '../../../../core/models/account.model';
import { Journal } from '../../../../core/models/journal.model';
import { TranslateModule, FORMAT_PIPES, FormatService, accountNameOf, VxNumberInputDirective } from '@virteex/shared/ui-i18n';
import { isChargeable } from '../../../../core/services/account-selection';
import { TAB_CONTEXT } from '../../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { ChartOfAccountsApiService } from '../../data/chart-of-accounts.service';
import { VX_SELECT } from '../../../../shared/components/select';

const cents = (value: unknown): number => Math.round(Number(value || 0) * 100);

/** A line is a debit or a credit: exactly one side, and more than zero. */
function oneSide(group: AbstractControl): ValidationErrors | null {
  const debit = cents(group.get('debit')?.value);
  const credit = cents(group.get('credit')?.value);
  return (debit > 0) === (credit > 0) ? { oneSide: true } : null;
}

/**
 * Proposing a correction to a closed fiscal year — what an external audit hands over.
 *
 * ## What the screen says before anything is sent
 *
 * The entry is dated the year's last day, and the screen shows it; the debits and credits are
 * totalled in money with the difference still to balance; and «Propose» first says what will
 * happen — waiting for approval (how many steps), or, with no approval policy, posting into the
 * closed year at once, in the proposer's name. That last case used to be a silent posting behind a
 * button labelled «Propose».
 *
 * With no closed year there is nothing to correct; the screen says so and where years are closed,
 * instead of offering an empty list.
 */
@Component({
  selector: 'app-audit-adjustment-form-page',
  standalone: true,
  imports: [VxNumberInputDirective, 
    ReactiveFormsModule,
    RouterLink,
    TranslateModule,
    ...FORMAT_PIPES,
    LucideAngularModule,
    DraftShellComponent,
    VxFieldErrorComponent,
    ...VX_FORM_A11Y,
    ...VX_SELECT,
  ],
  templateUrl: './audit-adjustment-form.page.html',
  styleUrls: ['../../../../shared/styles/document-form.scss', './audit-adjustment-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditAdjustmentFormPage implements OnInit {
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly adjustments = inject(AuditAdjustmentsService);
  private readonly fiscalYears = inject(FiscalYearsService);
  private readonly accounting = inject(AccountingService);
  private readonly chartOfAccounts = inject(ChartOfAccountsApiService);
  private readonly journals = inject(JournalsService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly format = inject(FormatService);
  private readonly organization = inject(ActiveOrganizationService);

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;
  protected readonly OkIcon = CheckCircle2;
  protected readonly WarnIcon = AlertTriangle;

  readonly form: FormGroup = this.fb.group({
    fiscalYearId: ['', Validators.required],
    journalId: ['', Validators.required],
    description: ['', [Validators.required, Validators.maxLength(500)]],
    lines: this.fb.array([this.newLine(), this.newLine()]),
  });

  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);
  /** Only years that are CLOSED: an open year takes an ordinary entry, an archived one takes none. */
  readonly years = signal<FiscalYear[]>([]);
  readonly yearsLoaded = signal(false);
  readonly journalOptions = signal<Journal[]>([]);
  readonly recovered = signal<{ savedAt: number } | null>(null);
  private readonly revision = signal(0);
  private readonly autosave = new DraftAutosave<Record<string, unknown>>(`audit-adjustment.${this.organization.slug() ?? 'org'}.new`);

  readonly closingLink = computed(() => this.organization.urlFor('/accounting/closing/annual-close'));

  readonly totals = computed(() => {
    this.revision();
    let debit = 0;
    let credit = 0;
    for (const line of this.lines.controls) {
      debit += cents(line.get('debit')?.value);
      credit += cents(line.get('credit')?.value);
    }
    return { debit: debit / 100, credit: credit / 100, difference: (debit - credit) / 100, balanced: debit === credit && debit > 0 };
  });

  /** The year chosen, for the date the entry will carry: its last day. */
  readonly chosenYear = computed(() => {
    this.revision();
    return this.years().find((year) => year.id === this.form.value.fiscalYearId) ?? null;
  });

  protected readonly searchAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounting.searchAccounts(query, limit).pipe(map((rows) => rows.filter(isChargeable)));

  /** Nombra la cuenta que un id designa: un ajuste guardado se reabre con cuentas puestas. */
  protected readonly resolveAccount = (id: string): Observable<Account> => this.chartOfAccounts.getAccountById(id);

  /** «1101 — Efectivo en caja». El código primero: es como se busca una cuenta. */
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;

  protected readonly accountId = (account: Account): string => account.id;

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  ngOnInit(): void {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.revision.update((n) => n + 1);
      if (this.problems().length) this.problems.set(this.collectProblems());
      if (this.form.dirty) this.autosave.save(value);
    });

    this.fiscalYears
      .list({ status: 'CLOSED' })
      .pipe(catchError(() => of([] as FiscalYear[])))
      .subscribe((years) => {
        this.years.set([...years].sort((a, b) => b.endDate.localeCompare(a.endDate)));
        this.yearsLoaded.set(true);
        if (years.length === 1 && !this.form.value.fiscalYearId) {
          this.form.patchValue({ fiscalYearId: years[0].id }, { emitEvent: false });
          this.revision.update((n) => n + 1);
        }
      });
    this.journals.getJournals().subscribe({
      next: (rows) => {
        this.journalOptions.set(rows);
        // The general journal is where a manual correction belongs; the person can still pick another.
        const general = rows.find((journal) => journal.code === 'GENERAL') ?? rows.find((journal) => journal.type === 'GENERAL');
        if (general && !this.form.value.journalId) this.form.patchValue({ journalId: general.id }, { emitEvent: false });
      },
      error: () => this.journalOptions.set([]),
    });

    this.tab?.registerSaveHandler(async () => {
      await this.save();
      return !this.form.dirty;
    });
    const stored = this.autosave.load();
    if (stored) this.recovered.set({ savedAt: stored.savedAt });
  }

  newLine(values: Partial<{ accountId: string; debit: number | null; credit: number | null; description: string }> = {}): FormGroup {
    return this.fb.group(
      {
        accountId: [values.accountId ?? '', Validators.required],
        debit: [values.debit ?? null, [Validators.min(0)]],
        credit: [values.credit ?? null, [Validators.min(0)]],
        description: [values.description ?? '', Validators.required],
      },
      { validators: oneSide },
    );
  }

  addLine(): void {
    this.lines.push(this.newLine());
  }

  removeLine(index: number): void {
    if (this.lines.length <= 2) return;
    this.lines.removeAt(index);
    this.form.markAsDirty();
  }

  /** Typing on one side clears the other: a line is a debit or a credit. */
  onAmount(index: number, side: 'debit' | 'credit'): void {
    const line = this.lines.at(index);
    const other = side === 'debit' ? 'credit' : 'debit';
    if (cents(line.get(side)?.value) > 0 && cents(line.get(other)?.value) !== 0) {
      line.get(other)?.setValue(null);
    }
  }

  protected lineFieldId(index: number, control: string): string {
    return `aa-line-${index}-${control}`;
  }

  /** «Ejercicio 2019 (01/01/2019 – 31/12/2019)». */
  protected yearLabel(year: FiscalYear): string {
    return `${year.endDate.slice(0, 4)} (${this.format.date(year.startDate, 'date', { dateOnly: true })} – ${this.format.date(year.endDate, 'date', { dateOnly: true })})`;
  }

  async save(): Promise<void> {
    const problems = this.collectProblems();
    this.problems.set(problems);
    if (problems.length > 0) {
      this.form.markAllAsTouched();
      return;
    }
    const year = this.chosenYear();
    if (!year) return;

    // Say what «Propose» will do before doing it.
    const route = await new Promise<{ requiresApproval: boolean; steps: number } | null>((resolve) =>
      this.adjustments.approvalRoute(this.totals().debit).pipe(catchError(() => of(null))).subscribe(resolve),
    );
    const confirmed = await this.dialog.confirm({
      title: 'audit_adjustments.confirm_title',
      message: route?.requiresApproval ? 'audit_adjustments.confirm_with_approval' : 'audit_adjustments.confirm_without_approval',
      messageParams: {
        amount: this.format.money(this.totals().debit),
        date: this.format.date(year.endDate, 'date', { dateOnly: true }),
        steps: route?.steps ?? 0,
      },
      confirmText: route?.requiresApproval ? 'audit_adjustments.submit_for_approval' : 'audit_adjustments.propose_and_post',
      variant: route?.requiresApproval ? 'primary' : 'warning',
    });
    if (!confirmed) return;

    this.saving.set(true);
    this.adjustments
      .propose({
        fiscalYearId: year.id,
        date: year.endDate,
        description: String(this.form.value.description).trim(),
        journalId: this.form.value.journalId,
        lines: this.lines.controls.map((line) => ({
          accountId: line.value.accountId,
          debit: cents(line.value.debit) / 100,
          credit: cents(line.value.credit) / 100,
          description: String(line.value.description).trim(),
        })),
      })
      .subscribe({
        next: (proposal) => {
          this.saving.set(false);
          this.autosave.clear();
          this.form.markAsPristine();
          this.tab?.markClean();
          this.notifications.showSuccess(
            proposal.status === 'POSTED' ? 'audit_adjustments.proposed_and_posted' : 'audit_adjustments.proposed_pending',
          );
          const detail = `/accounting/audit-adjustments/${proposal.id}`;
          if (this.tab) this.tab.replaceRoute(detail);
          else void this.router.navigateByUrl(this.organization.urlFor(detail));
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'audit_adjustments.propose_failed');
        },
      });
  }

  async cancel(): Promise<void> {
    if (this.form.dirty) {
      const decision = await this.dialog.confirmClose({ message: 'audit_adjustments.leave_unsaved', allowSave: false });
      if (decision === 'cancel') return;
      this.autosave.clear();
      this.tab?.markClean();
    }
    void this.router.navigateByUrl(this.organization.urlFor('/accounting/audit-adjustments'));
  }

  restoreRecovered(): void {
    const stored = this.autosave.load();
    this.recovered.set(null);
    if (!stored) return;
    const value = stored.value as { fiscalYearId?: string; journalId?: string; description?: string; lines?: Array<Record<string, unknown>> };
    this.lines.clear();
    for (const line of value.lines ?? []) this.lines.push(this.newLine(line as never));
    while (this.lines.length < 2) this.lines.push(this.newLine());
    this.form.patchValue({ fiscalYearId: value.fiscalYearId ?? '', journalId: value.journalId ?? '', description: value.description ?? '' });
    this.form.markAsDirty();
    this.tab?.markDirty(true);
  }

  discardRecovered(): void {
    this.autosave.clear();
    this.recovered.set(null);
  }

  private collectProblems(): DraftProblem[] {
    const problems: DraftProblem[] = draftProblems(this.form, {
      fiscalYearId: 'audit_adjustments.fiscal_year',
      journalId: 'audit_adjustments.journal',
      description: 'audit_adjustments.description',
      accountId: 'audit_adjustments.account',
      debit: 'audit_adjustments.debit',
      credit: 'audit_adjustments.credit',
    }).map((problem) => {
      const match = /^lines\.(\d+)\.(\w+)$/.exec(problem.fieldId ?? '');
      if (!match) return { ...problem, fieldId: this.fieldIdOf(problem.fieldId) };
      const index = Number(match[1]);
      return { ...problem, message: `${problem.message}_line`, fieldId: this.lineFieldId(index, match[2]), params: { ...problem.params, line: index + 1 } };
    });
    this.lines.controls.forEach((line, index) => {
      if (line.hasError('oneSide')) {
        problems.push({ message: 'audit_adjustments.problem.line_one_side', params: { line: index + 1 }, fieldId: this.lineFieldId(index, 'debit') });
      }
    });
    const totals = this.totals();
    if (!totals.balanced && totals.debit + totals.credit > 0) {
      problems.push({ message: 'audit_adjustments.problem.unbalanced_by', params: { difference: this.format.money(Math.abs(totals.difference)) }, fieldId: 'aa-totals' });
    }
    return problems;
  }

  private fieldIdOf(control: string | undefined): string | undefined {
    return { fiscalYearId: 'aa-fiscal-year', journalId: 'aa-journal', description: 'aa-description' }[control ?? ''] ?? control;
  }
}
