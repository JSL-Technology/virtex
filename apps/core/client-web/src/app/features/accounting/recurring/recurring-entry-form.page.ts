import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { LucideAngularModule, Plus, Trash2 } from 'lucide-angular';
import { Observable } from 'rxjs';
import { TranslateModule, FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';
import { VxAmountComponent } from '../../../shared/components/amount';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AccountingService } from '../../../core/api/accounting.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { JournalsService } from '../../../core/api/journals.service';
import { Journal } from '../../../core/models/journal.model';
import { Account } from '../../../core/models/account.model';
import { VxDimensionTagsComponent } from '../dimensions/dimension-tags.component';
import {
  FREQUENCIES,
  Frequency,
  RecurringEntriesService,
  RecurringEntry,
  RecurringPostedEntry,
  StoredEntryLine,
} from '../data/recurring-entries.service';

const todayIso = (): string => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const cents = (value: unknown): number => Math.round((Number(value) || 0) * 100);
const blankLine = (): StoredEntryLine => ({ accountId: '', description: '', debit: 0, credit: 0, dimensions: {} });

/** Debit and credit totals of the lines, and whether they balance — to the cent. */
export function lineTotals(lines: readonly StoredEntryLine[]): { debit: number; credit: number; balanced: boolean } {
  const debit = lines.reduce((sum, line) => sum + cents(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + cents(line.credit), 0);
  return { debit: debit / 100, credit: credit / 100, balanced: debit === credit && debit > 0 };
}

/**
 * A recurring journal entry (audit H-21): what it posts, how often, from when and until when —
 * and, once saved, the entries it has posted. Pausing keeps the schedule; resuming catches up
 * what fell due meanwhile, unless the start date is moved past it.
 */
@Component({
  selector: 'app-recurring-entry-form-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    TranslateModule,
    LucideAngularModule,
    ...FORMAT_PIPES,
    ...VX_FORM_A11Y,
    ...VX_SELECT,
    DraftShellComponent,
    VxDateFieldComponent,
    VxAmountComponent,
    VxDimensionTagsComponent,
    HasPermissionDirective,
  ],
  templateUrl: './recurring-entry-form.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss', '../../../shared/styles/document-list.scss', './recurring-entry-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecurringEntryFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly service = inject(RecurringEntriesService);
  private readonly accountingService = inject(AccountingService);
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly journalsService = inject(JournalsService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly id = input<string>();

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;
  protected readonly frequencies = FREQUENCIES;

  readonly form = this.fb.group({
    description: ['', [Validators.required, Validators.maxLength(500)]],
    journalId: ['', [Validators.required]],
    frequency: ['MONTHLY' as Frequency, [Validators.required]],
    startDate: [todayIso(), [Validators.required]],
    endDate: [null as string | null],
    isActive: [true],
  });

  readonly lines = signal<StoredEntryLine[]>([blankLine(), blankLine()]);
  readonly journals = signal<Journal[]>([]);
  readonly current = signal<RecurringEntry | null>(null);
  readonly posted = signal<RecurringPostedEntry[]>([]);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);
  readonly totals = computed(() => lineTotals(this.lines()));

  protected readonly searchAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accountingService.searchAccounts(query, limit);
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  ngOnInit(): void {
    this.journalsService.getJournals().subscribe({
      next: (journals) => {
        this.journals.set(journals);
        const control = this.form.controls.journalId;
        if (!control.value && journals.length === 1) control.setValue(journals[0].id);
      },
      error: () => this.journals.set([]),
    });
    const id = this.id();
    if (!id) return;
    this.service.get(id).subscribe({
      next: (entry) => this.load(entry),
      error: (error: unknown) => this.notifications.showHttpError(error, 'recurring_entries.form.load_failed'),
    });
    this.service.postedEntries(id).subscribe({
      next: (posted) => this.posted.set(posted),
      error: () => this.posted.set([]),
    });
  }

  patchLine(index: number, changes: Partial<StoredEntryLine>): void {
    this.lines.update((lines) => lines.map((line, position) => (position === index ? { ...line, ...changes } : line)));
    this.form.markAsDirty();
  }

  addLine(): void {
    this.lines.update((lines) => [...lines, blankLine()]);
    this.form.markAsDirty();
  }

  removeLine(index: number): void {
    if (this.lines().length <= 2) return;
    this.lines.update((lines) => lines.filter((_, position) => position !== index));
    this.form.markAsDirty();
  }

  save(): void {
    if (!this.validate()) return;
    const raw = this.form.getRawValue();
    const body = {
      description: (raw.description ?? '').trim(),
      journalId: raw.journalId as string,
      frequency: raw.frequency as Frequency,
      startDate: raw.startDate as string,
      endDate: raw.endDate || null,
      isActive: Boolean(raw.isActive),
      lines: this.lines().map((line) => ({
        accountId: line.accountId,
        description: line.description?.trim() || undefined,
        debit: cents(line.debit) / 100,
        credit: cents(line.credit) / 100,
        dimensions: line.dimensions && Object.keys(line.dimensions).length ? line.dimensions : undefined,
      })),
    };
    const existing = this.current();
    this.saving.set(true);
    const request = existing ? this.service.update(existing.id, body) : this.service.create(body);
    request.subscribe({
      next: (entry) => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.tab?.markClean();
        this.notifications.showSuccess('recurring_entries.form.saved', { description: entry.description });
        if (!existing) {
          const route = `/accounting/recurring-entries/${entry.id}`;
          if (this.tab) this.tab.replaceRoute(route, { title: entry.description });
          else void this.router.navigateByUrl(this.organization.urlFor(route));
          return;
        }
        this.load(entry);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'recurring_entries.form.save_failed');
      },
    });
  }

  async remove(): Promise<void> {
    const entry = this.current();
    if (!entry) return;
    const confirmed = await this.dialog.confirm({
      title: 'recurring_entries.form.delete_title',
      message: 'recurring_entries.form.delete_message',
      messageParams: { description: entry.description },
      confirmText: 'recurring_entries.form.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.service.remove(entry.id).subscribe({
      next: () => {
        this.notifications.showSuccess('recurring_entries.form.deleted');
        this.cancel();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'recurring_entries.form.delete_failed'),
    });
  }

  cancel(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/accounting/recurring-entries'));
  }

  entryLink(entryId: string): string {
    return this.organization.urlFor(`/accounting/journal-entries/${entryId}/edit`);
  }

  frequencyKey(frequency: string): string {
    return `recurring_entries.frequency.${frequency.toLowerCase()}`;
  }

  private load(entry: RecurringEntry): void {
    this.current.set(entry);
    this.tab?.setTitle(entry.description);
    this.form.reset({
      description: entry.description,
      journalId: entry.journalId,
      frequency: entry.frequency,
      startDate: entry.startDate,
      endDate: entry.endDate,
      isActive: entry.isActive,
    });
    this.lines.set(
      entry.lines.map((line) => ({
        accountId: line.accountId,
        description: line.description ?? '',
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        dimensions: { ...(line.dimensions ?? {}) },
      })),
    );
  }

  private validate(): boolean {
    const raw = this.form.getRawValue();
    const extra: DraftProblem[] = [];
    this.lines().forEach((line, index) => {
      if (!line.accountId) extra.push({ message: 'recurring_entries.form.line_account_required', params: { line: index + 1 } });
      if ((cents(line.debit) > 0) === (cents(line.credit) > 0)) {
        extra.push({ message: 'journal_entries.stored_line_one_side', params: { line: index + 1 } });
      }
    });
    if (!this.totals().balanced) extra.push({ message: 'journal_entries.journal_entry_does_not_balance' });
    if (raw.endDate && raw.startDate && raw.endDate < raw.startDate) {
      extra.push({ message: 'journal_entries.recurring_end_before_start' });
    }
    if (this.form.invalid || extra.length) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form, {
          description: 'recurring_entries.form.description',
          journalId: 'recurring_entries.form.journal',
          frequency: 'recurring_entries.form.frequency',
          startDate: 'recurring_entries.form.start_date',
        }),
        ...extra,
      ]);
      return false;
    }
    this.problems.set([]);
    return true;
  }
}
