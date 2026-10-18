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
  EntryTemplate,
  RecurringEntriesService,
  TemplateLine,
  TemplateSide,
  allocateTemplate,
} from '../data/recurring-entries.service';

const todayIso = (): string => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/** What the server would refuse in a template's lines; a translation key and its parameters, or null. */
export function templateProblem(lines: readonly TemplateLine[]): { message: string; params?: Record<string, unknown> } | null {
  for (const [index, line] of lines.entries()) {
    if (!line.accountId) return { message: 'entry_templates.form.line_account_required', params: { line: index + 1 } };
  }
  for (const side of ['DEBIT', 'CREDIT'] as const) {
    const ofSide = lines.filter((line) => line.type === side);
    if (ofSide.length === 0) return { message: 'journal_entries.template_needs_both_sides' };
    const withShare = ofSide.filter((line) => line.percentage !== undefined && line.percentage !== null);
    if (withShare.length && withShare.length !== ofSide.length) {
      return { message: 'journal_entries.template_percentages_all_or_none', params: { side } };
    }
    if (withShare.length) {
      const total = withShare.reduce((sum, line) => sum + Math.round(Number(line.percentage) * 10_000), 0);
      if (total !== 1_000_000) {
        return { message: 'journal_entries.template_percentages_must_total_100', params: { side, total: total / 10_000 } };
      }
    }
  }
  return null;
}

const blankLine = (type: TemplateSide): TemplateLine => ({ accountId: '', description: '', type, dimensions: {} });

/**
 * A journal entry template (audit H-21): the accounts, the side of each and the share of the
 * amount it takes — split equally when no shares are given — and, once saved, the entry it posts
 * for a date and an amount, previewed line by line before posting.
 */
@Component({
  selector: 'app-entry-template-form-page',
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
  templateUrl: './entry-template-form.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss', '../../../shared/styles/document-list.scss', '../recurring/recurring-entry-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryTemplateFormPage implements OnInit {
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

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', [Validators.required, Validators.maxLength(500)]],
  });

  readonly lines = signal<TemplateLine[]>([blankLine('DEBIT'), blankLine('CREDIT')]);
  readonly current = signal<EntryTemplate | null>(null);
  readonly journals = signal<Journal[]>([]);
  readonly saving = signal(false);
  readonly posting = signal(false);
  readonly problems = signal<DraftProblem[]>([]);

  /** Posting from the saved template. */
  readonly useDate = signal(todayIso());
  readonly useDescription = signal('');
  readonly useAmount = signal<number | null>(null);
  readonly useJournal = signal('');
  readonly lastPosted = signal<{ id: string; entryNumber?: string | null } | null>(null);
  /** The amounts each saved line would post, for the preview. */
  readonly preview = computed(() => {
    const template = this.current();
    const amount = Number(this.useAmount()) || 0;
    if (!template || amount <= 0) return [];
    const amounts = allocateTemplate(template.lines, amount);
    return template.lines.map((line, index) => ({ line, amount: amounts[index] }));
  });

  protected readonly searchAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accountingService.searchAccounts(query, limit);
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  ngOnInit(): void {
    this.journalsService.getJournals().subscribe({
      next: (journals) => {
        this.journals.set(journals);
        if (!this.useJournal() && journals.length) {
          const general = journals.find((journal) => journal.code === 'GENERAL') ?? journals[0];
          this.useJournal.set(general.id);
        }
      },
      error: () => this.journals.set([]),
    });
    const id = this.id();
    if (!id) return;
    this.service.template(id).subscribe({
      next: (template) => this.load(template),
      error: (error: unknown) => this.notifications.showHttpError(error, 'entry_templates.form.load_failed'),
    });
  }

  patchLine(index: number, changes: Partial<TemplateLine>): void {
    this.lines.update((lines) => lines.map((line, position) => (position === index ? { ...line, ...changes } : line)));
    this.form.markAsDirty();
  }

  /** An empty percentage field means «split equally», not 0 %. */
  setPercentage(index: number, value: unknown): void {
    const number = value === '' || value === null || value === undefined ? undefined : Number(value);
    this.patchLine(index, { percentage: number !== undefined && Number.isFinite(number) ? number : undefined });
  }

  addLine(type: TemplateSide): void {
    this.lines.update((lines) => [...lines, blankLine(type)]);
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
      name: (raw.name ?? '').trim(),
      description: (raw.description ?? '').trim(),
      lines: this.lines().map((line) => ({
        accountId: line.accountId,
        type: line.type,
        ...(line.description?.trim() ? { description: line.description.trim() } : {}),
        ...(line.percentage !== undefined ? { percentage: line.percentage } : {}),
        ...(line.dimensions && Object.keys(line.dimensions).length ? { dimensions: line.dimensions } : {}),
      })),
    };
    const existing = this.current();
    this.saving.set(true);
    const request = existing ? this.service.updateTemplate(existing.id, body) : this.service.createTemplate(body);
    request.subscribe({
      next: (template) => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.tab?.markClean();
        this.notifications.showSuccess('entry_templates.form.saved', { name: template.name });
        if (!existing) {
          const route = `/accounting/entry-templates/${template.id}`;
          if (this.tab) this.tab.replaceRoute(route, { title: template.name });
          else void this.router.navigateByUrl(this.organization.urlFor(route));
          return;
        }
        this.load(template);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'entry_templates.form.save_failed');
      },
    });
  }

  post(): void {
    const template = this.current();
    const amount = Number(this.useAmount()) || 0;
    if (!template || amount <= 0 || !this.useJournal() || !this.useDate()) {
      this.notifications.showError('entry_templates.use.incomplete');
      return;
    }
    this.posting.set(true);
    this.service
      .useTemplate(template.id, {
        date: this.useDate(),
        description: this.useDescription().trim() || template.description,
        amount: Math.round(amount * 100) / 100,
        journalId: this.useJournal(),
      })
      .subscribe({
        next: (entry) => {
          this.posting.set(false);
          this.lastPosted.set(entry);
          this.useAmount.set(null);
          this.notifications.showSuccess('entry_templates.use.posted');
        },
        error: (error: unknown) => {
          this.posting.set(false);
          this.notifications.showHttpError(error, 'entry_templates.use.failed');
        },
      });
  }

  async remove(): Promise<void> {
    const template = this.current();
    if (!template) return;
    const confirmed = await this.dialog.confirm({
      title: 'entry_templates.form.delete_title',
      message: 'entry_templates.form.delete_message',
      messageParams: { name: template.name },
      confirmText: 'entry_templates.form.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.service.removeTemplate(template.id).subscribe({
      next: () => {
        this.notifications.showSuccess('entry_templates.form.deleted');
        this.cancel();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'entry_templates.form.delete_failed'),
    });
  }

  cancel(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/accounting/entry-templates'));
  }

  entryLink(entryId: string): string {
    return this.organization.urlFor(`/accounting/journal-entries/${entryId}/edit`);
  }

  private load(template: EntryTemplate): void {
    this.current.set(template);
    this.tab?.setTitle(template.name);
    this.form.reset({ name: template.name, description: template.description });
    this.lines.set(template.lines.map((line) => ({ ...line, description: line.description ?? '', dimensions: { ...(line.dimensions ?? {}) } })));
  }

  private validate(): boolean {
    const extra: DraftProblem[] = [];
    const problem = templateProblem(this.lines());
    if (problem) extra.push(problem);
    if (this.form.invalid || extra.length) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form, { name: 'entry_templates.form.name', description: 'entry_templates.form.description' }),
        ...extra,
      ]);
      return false;
    }
    this.problems.set([]);
    return true;
  }
}
