import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Save } from 'lucide-angular';
import { catchError, forkJoin, of } from 'rxjs';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { NotificationService } from '../../../core/services/notification';
import {
  IncomeTaxBracket,
  PayrollService,
  StatutoryContribution,
  StatutoryReference,
} from '../../../core/api/payroll.service';

/**
 * The statutory parameters a payroll is computed from: the TSS rates, the reference values, and the
 * income-tax scale.
 *
 * ## Why every one of them is versioned
 *
 * A rate is a fact about a *moment*. When the AFP rate changes in March, a February payroll
 * recomputed in April must still produce February's numbers — otherwise a filing already sent to
 * the TSS stops matching the books that produced it. So nothing here is edited in place: a change
 * is a new row with the date it takes effect, and the old one keeps its own date range. The screen
 * is built around that, which is why every editor asks for an effective date before it asks for a
 * number.
 *
 * These endpoints existed with no screen at all, so the only way to reflect a rate change was a
 * REST client or a SQL prompt.
 */
@Component({
  selector: 'app-payroll-parameters-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './parameters.page.html',
  styleUrls: ['./parameters.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayrollParametersPage {
  private readonly payroll = inject(PayrollService);
  private readonly notifications = inject(NotificationService);

  protected readonly SaveIcon = Save;

  readonly country = signal('DO');
  readonly contributions = signal<StatutoryContribution[]>([]);
  readonly references = signal<StatutoryReference[]>([]);
  readonly brackets = signal<IncomeTaxBracket[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);

  /** The row being written. A change is always a *new* effective-dated row, never an edit. */
  readonly contributionDraft = signal<StatutoryContribution | null>(null);
  readonly referenceDraft = signal<StatutoryReference | null>(null);

  readonly inForceContributions = computed(() => this.currentOnly(this.contributions()));
  readonly inForceReferences = computed(() => this.currentOnly(this.references()));

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
      error: (error: { error?: { message?: string } }) => this.fail(error),
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
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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
    }).subscribe(({ contributions, references, brackets }) => {
      this.contributions.set(contributions);
      this.references.set(references);
      this.brackets.set(brackets);
      this.loading.set(false);
    });
  }

  private fail(error: { error?: { message?: string } }): void {
    this.busy.set(false);
    const message = error?.error?.message;
    this.notifications.showError(
      typeof message === 'string' ? message : 'payroll.parameters.save_failed',
    );
  }
}

function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
