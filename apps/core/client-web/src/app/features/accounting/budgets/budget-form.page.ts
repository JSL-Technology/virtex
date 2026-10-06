import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Copy, LucideAngularModule, Plus, Trash2 } from 'lucide-angular';
import { Observable, map } from 'rxjs';
import { FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { VX_SELECT } from '../../../shared/components/select';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { isChargeable } from '../../../core/services/account-selection';
import { Account } from '../../../core/models/account.model';
import { Budget, BudgetsService, VarianceReport, isFavourable } from '../data/budgets.service';

const currentPeriod = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/** The months after `period`, up to the end of its year: the usual target of a copy. */
export function restOfYear(period: string): string[] {
  const [year, month] = period.split('-').map(Number);
  const months: string[] = [];
  for (let m = month + 1; m <= 12; m++) months.push(`${year}-${String(m).padStart(2, '0')}`);
  return months;
}

/**
 * A month's budget: an amount per account (expense, income, investment), the target the budget
 * control holds postings to. Saved, it shows how the month is going against it, and can be laid
 * down over the rest of the year — the way an annual budget is built from one month.
 */
@Component({
  selector: 'app-budget-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SELECT, DraftShellComponent, HasPermissionDirective],
  templateUrl: './budget-form.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss', '../../../shared/styles/document-list.scss', './budget-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly budgets = inject(BudgetsService);
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly id = input<string>();

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;
  protected readonly CopyIcon = Copy;
  protected readonly favourable = isFavourable;

  readonly form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    period: [currentPeriod(), [Validators.required, Validators.pattern(/^\d{4}-(0[1-9]|1[0-2])$/)]],
    lines: this.fb.array([]),
  });

  readonly current = signal<Budget | null>(null);
  readonly report = signal<VarianceReport | null>(null);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);
  readonly copying = signal(false);
  readonly copyPeriods = signal<string[]>([]);
  readonly copyFactor = signal(1);
  readonly total = signal(0);

  readonly copyOptions = computed(() => restOfYear(this.current()?.period ?? currentPeriod()));

  protected readonly searchAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => (list ?? []).filter(isChargeable)));
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  protected accountName(name: unknown): string {
    return accountNameOf(name as Parameters<typeof accountNameOf>[0]);
  }

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  ngOnInit(): void {
    this.form.valueChanges.subscribe(() => this.recomputeTotal());
    const id = this.id();
    if (id) {
      this.budgets.get(id).subscribe({
        next: (budget) => this.load(budget),
        error: (error: unknown) => this.notifications.showHttpError(error, 'budgets.form.load_failed'),
      });
    } else {
      this.addLine();
    }
  }

  addLine(): void {
    this.lines.push(this.fb.group({ accountId: ['', [Validators.required]], amount: [null, [Validators.required, Validators.min(0)]] }));
  }

  removeLine(index: number): void {
    this.lines.removeAt(index);
    this.form.markAsDirty();
  }

  save(): void {
    if (!this.validate()) return;
    const raw = this.form.getRawValue();
    const body = {
      name: String(raw.name).trim(),
      period: raw.period as string,
      lines: (raw.lines as Array<{ accountId: string; amount: number }>).map((line) => ({
        accountId: line.accountId,
        amount: Math.round(Number(line.amount) * 100) / 100,
      })),
    };
    const existing = this.current();
    this.saving.set(true);
    const request = existing ? this.budgets.update(existing.id, body) : this.budgets.create(body);
    request.subscribe({
      next: (budget) => {
        this.saving.set(false);
        this.notifications.showSuccess('budgets.form.saved', { period: budget.period });
        if (!existing && this.tab) {
          this.tab.replaceRoute(`/accounting/budgets/${budget.id}`, { title: budget.period });
          return;
        }
        this.load(budget);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'budgets.form.save_failed');
      },
    });
  }

  cancel(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/accounting/budgets'));
  }

  toggleCopyPeriod(period: string, checked: boolean): void {
    this.copyPeriods.update((all) => (checked ? [...all, period] : all.filter((p) => p !== period)));
  }

  copy(): void {
    const budget = this.current();
    if (!budget || this.copyPeriods().length === 0) return;
    const factor = Number(this.copyFactor()) || 1;
    this.budgets.copy(budget.id, this.copyPeriods(), factor === 1 ? undefined : factor).subscribe({
      next: (created) => {
        this.copying.set(false);
        this.copyPeriods.set([]);
        this.notifications.showSuccess('budgets.form.copied', { count: created.length });
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'budgets.form.copy_failed'),
    });
  }

  private validate(): boolean {
    const extra: DraftProblem[] = [];
    const ids = this.lines.controls.map((control) => control.value.accountId).filter(Boolean);
    if (new Set(ids).size !== ids.length) extra.push({ message: 'budgets.form.repeated_account' });
    if (this.lines.length === 0) extra.push({ message: 'budgets.form.lines_required' });
    if (this.form.invalid || extra.length) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form, { name: 'budgets.form.name', period: 'budgets.form.period' }),
        ...(this.lines.invalid ? [{ message: 'budgets.form.line_incomplete' }] : []),
        ...extra,
      ]);
      return false;
    }
    this.problems.set([]);
    return true;
  }

  private recomputeTotal(): void {
    const sum = (this.lines.getRawValue() as Array<{ amount: number | null }>).reduce((acc, line) => acc + (Number(line.amount) || 0), 0);
    this.total.set(Math.round(sum * 100) / 100);
  }

  private load(budget: Budget): void {
    this.current.set(budget);
    this.tab?.setTitle(budget.period);
    this.lines.clear({ emitEvent: false });
    for (const line of budget.lines) {
      this.lines.push(
        this.fb.group({ accountId: [line.accountId, [Validators.required]], amount: [Number(line.amount), [Validators.required, Validators.min(0)]] }),
        { emitEvent: false },
      );
    }
    this.form.patchValue({ name: budget.name, period: budget.period }, { emitEvent: false });
    this.recomputeTotal();
    this.form.markAsPristine();
    this.tab?.markClean();
    this.budgets.vsActual(budget.id).subscribe({
      next: (report) => this.report.set(report),
      error: () => this.report.set(null),
    });
  }
}
