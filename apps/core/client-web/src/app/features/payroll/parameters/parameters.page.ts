import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth';
import { LucideAngularModule, Plus, Save, Trash2 } from 'lucide-angular';
import { catchError, forkJoin, of } from 'rxjs';
import { FORMAT_PIPES, LocaleStore } from '@virteex/shared/ui-i18n';
import { NotificationService } from '../../../core/services/notification';
import {
  CompanyParameterKind,
  CompanyPayrollParameter,
  CompanyPayrollParameterInput,
  IncomeTaxBracket,
  PayrollService,
  StatutoryContribution,
  StatutoryReference,
} from '../../../core/api/payroll.service';
import { CountryPackService } from '../../../core/api/country-pack.service';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { VxDateFieldComponent } from '../../../shared/components/date';

/** A bracket as the editor holds it: the rate as the percentage a person types. */
interface BracketDraft {
  over: number;
  upTo: number | null;
  ratePercent: number;
  baseAmount: number;
}

/**
 * A company parameter being recorded. Rates are percentages here (6.2, not 0.062) because that is
 * how the IRS and every state publish them; the page converts on save.
 */
interface CompanyParameterDraft {
  isNew: boolean;
  code: string;
  name: string;
  kind: CompanyParameterKind;
  jurisdiction: string;
  employeePercent: number | null;
  employerPercent: number | null;
  wageBase: number | null;
  threshold: number | null;
  creditPercent: number | null;
  amount: number | null;
  brackets: BracketDraft[];
  effectiveFrom: string;
  legalBasis: string;
}

/**
 * The figures a payroll is computed from.
 *
 * ## Two kinds of figure
 *
 * - **The platform's statutory tables** — the TSS rates, the reference values and the ISR scale of a
 *   market whose rules the payroll engine computes (the Dominican Republic). The same for every
 *   company, kept by platform operators; a company reads them here.
 * - **The company's own parameters** — any market. A US company starts with FICA Social Security,
 *   Medicare, Additional Medicare and FUTA as editable statutory defaults, plus the ones only it can
 *   fill in: its state's income-tax withholding table and the unemployment rate its state assigned
 *   it. The page used to show a US company three empty tables and no way to add anything (QA C-06);
 *   «Add parameter» is now offered in every market.
 *
 * ## Every figure is dated
 *
 * A change is the new value with the date it takes effect, never an edit in place: a payroll
 * recomputed for an earlier period must still find the figure in force then. The screen asks for the
 * date with the value, and reads «In force since 01/01/2026» rather than «01/01/2026 — …» (QA M-13).
 */
@Component({
  selector: 'app-payroll-parameters-page',
  standalone: true,
  imports: [
    CommonModule,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    VxAmountComponent,
    VxBadgeComponent,
    VxDateFieldComponent,
  ],
  templateUrl: './parameters.page.html',
  styleUrls: ['./parameters.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayrollParametersPage {
  private readonly payroll = inject(PayrollService);
  private readonly auth = inject(AuthService);
  private readonly countryPack = inject(CountryPackService);

  /**
   * The statutory tables every tenant's payroll is computed with.
   * Held only by platform operators: a tenant administrator's `'*'` does not reach it (see
   * `hasPermission`), so the actions are not offered to someone the server would refuse — and the
   * «Actions» column is not drawn at all for them, instead of standing empty (QA M-13).
   */
  readonly canManage = computed(() => this.auth.hasPermissions(['platform:payroll:statutory_manage']));
  /** The company's own parameters: the tenant's parameters grant. */
  readonly canManageCompany = computed(() => this.auth.hasPermissions(['payroll:parameters_manage']));
  private readonly notifications = inject(NotificationService);

  protected readonly SaveIcon = Save;
  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;

  /** The company's market: its statutory tables, not one country's for everybody. */
  private readonly locale = inject(LocaleStore);
  readonly country = signal((this.locale.tenantContext()?.countryCode ?? '').toUpperCase());
  readonly contributions = signal<StatutoryContribution[]>([]);
  readonly references = signal<StatutoryReference[]>([]);
  readonly brackets = signal<IncomeTaxBracket[]>([]);
  readonly companyParameters = signal<CompanyPayrollParameter[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);

  /** The row being written. A change is always a *new* effective-dated row, never an edit. */
  readonly contributionDraft = signal<StatutoryContribution | null>(null);
  readonly referenceDraft = signal<StatutoryReference | null>(null);
  readonly companyDraft = signal<CompanyParameterDraft | null>(null);

  readonly inForceContributions = computed(() => this.currentOnly(this.contributions()));
  readonly inForceReferences = computed(() => this.currentOnly(this.references()));
  readonly inForceCompany = computed(() => this.currentOnly(this.companyParameters()));

  /**
   * Whether the platform's tables are this market's: always shown where the engine computes the
   * market (and wherever they hold rows), never as three empty tables in a market where the company
   * keeps its own figures.
   */
  readonly showStatutoryTables = computed(
    () =>
      this.countryPack.pack()?.payroll.statutoryParameters === 'PLATFORM' ||
      this.contributions().length + this.references().length + this.brackets().length > 0,
  );

  /** The states to attach a state parameter to, from the market's pack. */
  readonly divisions = computed(() => this.countryPack.pack()?.divisions ?? []);

  protected readonly kinds: ReadonlyArray<{ value: CompanyParameterKind; labelKey: string }> = [
    { value: 'CONTRIBUTION', labelKey: 'payroll.parameters.kind.contribution' },
    { value: 'TABLE', labelKey: 'payroll.parameters.kind.table' },
    { value: 'AMOUNT', labelKey: 'payroll.parameters.kind.amount' },
  ];

  constructor() {
    this.reload();
  }

  // ── Contributions ──────────────────────────────────────────────────────────

  startContribution(existing?: StatutoryContribution): void {
    this.contributionDraft.set({
      countryCode: this.country(),
      regime: existing?.regime ?? 'AFP',
      effectiveFrom: todayIso(),
      effectiveTo: null,
      employeeRate: existing?.employeeRate ?? 0,
      employerRate: existing?.employerRate ?? 0,
      base: existing?.base ?? 'SALARY_CAPPED',
      capMinWageMultiplier: existing?.capMinWageMultiplier ?? null,
      floorMinWageMultiplier: existing?.floorMinWageMultiplier ?? null,
    });
  }

  patchContribution(patch: Partial<StatutoryContribution>): void {
    this.contributionDraft.update((current) => (current ? { ...current, ...patch } : current));
  }

  saveContribution(): void {
    const draft = this.contributionDraft();
    if (!draft) return;
    this.busy.set(true);
    this.payroll.upsertContribution(draft).subscribe({
      next: () => { this.busy.set(false); this.contributionDraft.set(null); this.reload(); },
      error: (error: unknown) => this.fail(error),
    });
  }

  // ── References ─────────────────────────────────────────────────────────────

  startReference(existing?: StatutoryReference): void {
    this.referenceDraft.set({
      countryCode: this.country(),
      key: existing?.key ?? 'MIN_WAGE_COTIZABLE',
      effectiveFrom: todayIso(),
      effectiveTo: null,
      value: existing?.value ?? 0,
      currencyCode: existing?.currencyCode ?? 'DOP',
    });
  }

  patchReference(patch: Partial<StatutoryReference>): void {
    this.referenceDraft.update((current) => (current ? { ...current, ...patch } : current));
  }

  saveReference(): void {
    const draft = this.referenceDraft();
    if (!draft) return;
    this.busy.set(true);
    this.payroll.upsertReference(draft).subscribe({
      next: () => { this.busy.set(false); this.referenceDraft.set(null); this.reload(); },
      error: (error: unknown) => this.fail(error),
    });
  }

  // ── Company parameters ─────────────────────────────────────────────────────

  /** «Add parameter»: a new one, of any kind, in any market. */
  startNewCompanyParameter(): void {
    this.companyDraft.set({
      isNew: true,
      code: '',
      name: '',
      kind: 'CONTRIBUTION',
      jurisdiction: '',
      employeePercent: null,
      employerPercent: null,
      wageBase: null,
      threshold: null,
      creditPercent: null,
      amount: null,
      brackets: [{ over: 0, upTo: null, ratePercent: 0, baseAmount: 0 }],
      effectiveFrom: todayIso(),
      legalBasis: '',
    });
  }

  /**
   * «New value» on an existing parameter, or «Enter values» on one seeded empty: the editor opens
   * with what is in force and today's date, ready to record the change from the day it applies.
   */
  startCompanyValue(row: CompanyPayrollParameter): void {
    const percent = (rate: number | null) => (rate === null ? null : round(rate * 100));
    this.companyDraft.set({
      isNew: false,
      code: row.code,
      name: row.name,
      kind: row.kind,
      jurisdiction: row.jurisdiction ?? '',
      employeePercent: percent(row.employeeRate),
      employerPercent: percent(row.employerRate),
      wageBase: row.wageBase,
      threshold: row.threshold,
      creditPercent: percent(row.creditRate),
      amount: row.amount,
      brackets: (row.brackets?.length ? row.brackets : [{ over: 0, upTo: null, rate: 0, baseAmount: 0 }]).map(
        (bracket) => ({ over: bracket.over, upTo: bracket.upTo, ratePercent: round(bracket.rate * 100), baseAmount: bracket.baseAmount }),
      ),
      // A placeholder seeded without figures is filled from its own date; a value already in force
      // changes from today.
      effectiveFrom: row.requiresInput ? row.effectiveFrom : todayIso(),
      legalBasis: row.legalBasis ?? '',
    });
  }

  patchCompany(patch: Partial<CompanyParameterDraft>): void {
    this.companyDraft.update((current) => (current ? { ...current, ...patch } : current));
  }

  patchBracket(index: number, patch: Partial<BracketDraft>): void {
    this.companyDraft.update((current) =>
      current
        ? { ...current, brackets: current.brackets.map((bracket, i) => (i === index ? { ...bracket, ...patch } : bracket)) }
        : current,
    );
  }

  /** A new top bracket starts where the last one ends. */
  addBracket(): void {
    this.companyDraft.update((current) => {
      if (!current) return current;
      const last = current.brackets[current.brackets.length - 1];
      const start = last?.upTo ?? last?.over ?? 0;
      const closed = current.brackets.map((bracket, i) =>
        i === current.brackets.length - 1 && bracket.upTo === null ? { ...bracket, upTo: start } : bracket,
      );
      return { ...current, brackets: [...closed, { over: start, upTo: null, ratePercent: 0, baseAmount: 0 }] };
    });
  }

  removeBracket(index: number): void {
    this.companyDraft.update((current) =>
      current && current.brackets.length > 1
        ? { ...current, brackets: current.brackets.filter((_, i) => i !== index) }
        : current,
    );
  }

  saveCompany(): void {
    const draft = this.companyDraft();
    if (!draft) return;
    if (!draft.code.trim() || !draft.name.trim() || !draft.effectiveFrom) {
      this.notifications.showError('payroll.parameters.company_required_fields');
      return;
    }
    const fraction = (percent: number | null) => (percent === null || Number.isNaN(percent) ? null : percent / 100);
    const body: CompanyPayrollParameterInput = {
      code: draft.code.trim().toUpperCase(),
      name: draft.name.trim(),
      kind: draft.kind,
      jurisdiction: draft.jurisdiction || undefined,
      effectiveFrom: draft.effectiveFrom,
      legalBasis: draft.legalBasis.trim() || undefined,
      ...(draft.kind === 'CONTRIBUTION'
        ? {
            employeeRate: fraction(draft.employeePercent),
            employerRate: fraction(draft.employerPercent),
            wageBase: draft.wageBase,
            threshold: draft.threshold,
            creditRate: fraction(draft.creditPercent),
          }
        : draft.kind === 'AMOUNT'
          ? { amount: draft.amount }
          : {
              brackets: draft.brackets.map((bracket) => ({
                over: Number(bracket.over),
                upTo: bracket.upTo === null || (bracket.upTo as unknown) === '' ? null : Number(bracket.upTo),
                rate: Number(bracket.ratePercent) / 100,
                baseAmount: Number(bracket.baseAmount),
              })),
            }),
    };
    this.busy.set(true);
    this.payroll.recordCompanyParameter(body).subscribe({
      next: () => {
        this.busy.set(false);
        this.companyDraft.set(null);
        this.notifications.showSuccess('payroll.parameters.company_saved', { name: body.name });
        this.reload();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  toggleCompanyActive(row: CompanyPayrollParameter): void {
    this.busy.set(true);
    this.payroll.setCompanyParameterActive(row.id, !row.active).subscribe({
      next: () => {
        this.busy.set(false);
        this.notifications.showSuccess(
          row.active ? 'payroll.parameters.company_retired' : 'payroll.parameters.company_reinstated',
          { name: row.name },
        );
        this.reload();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  /** The version of a parameter in force today (older ones explain past payrolls and read muted). */
  isCurrent(row: CompanyPayrollParameter): boolean {
    return this.inForceCompany().includes(row);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** An emptied number field is «no value», not zero: a missing wage base means uncapped. */
  numberOrNull(raw: string): number | null {
    return raw === '' || raw === null || raw === undefined ? null : Number(raw);
  }

  /**
   * The rows in force today.
   *
   * The whole history is loaded, because that is what makes a past payroll explainable; the screen
   * leads with what applies now and keeps the rest below it.
   */
  private currentOnly<T extends { effectiveFrom: string; effectiveTo: string | null }>(rows: T[]): T[] {
    const today = todayIso();
    return rows.filter((row) => row.effectiveFrom <= today && (!row.effectiveTo || row.effectiveTo >= today));
  }

  private reload(): void {
    this.loading.set(true);
    forkJoin({
      contributions: this.payroll.listContributions(this.country()).pipe(catchError(() => of([] as StatutoryContribution[]))),
      references: this.payroll.listReferences(this.country()).pipe(catchError(() => of([] as StatutoryReference[]))),
      brackets: this.payroll.listBrackets(this.country()).pipe(catchError(() => of([] as IncomeTaxBracket[]))),
      company: this.payroll.listCompanyParameters().pipe(catchError(() => of([] as CompanyPayrollParameter[]))),
    }).subscribe(({ contributions, references, brackets, company }) => {
      this.contributions.set(contributions);
      this.references.set(references);
      this.brackets.set(brackets);
      this.companyParameters.set(company);
      this.loading.set(false);
    });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.notifications.showHttpError(error, 'payroll.parameters.save_failed');
  }
}

function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 6.2 stays 6.2 after `0.062 * 100` (6.200000000000001). */
function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
