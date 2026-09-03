import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  AlertCircle,
  CheckCircle,
  Clock,
  Link2,
  Undo2,
  Wand2,
  XCircle,
} from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';
import { BankAccount, TreasuryService } from '../../../../core/api/treasury.service';
import {
  BankStatement,
  MatchCandidateGroup,
  ReconciliationApiService,
  ReconciliationSummary,
  TransactionSuggestion,
} from '../../../../core/api/reconciliation.service';

/**
 * The bank reconciliation workbench.
 *
 * ## What this page was
 *
 * A table of "accounts to reconcile" driven by `accountsToReconcile = signal([])` — a signal
 * nothing ever wrote to. It rendered an empty table with a disabled filter button, for every
 * tenant, always. There was no statement, no matching, no proof and no way to reach the endpoints
 * that would have provided them, because most of them did not exist either.
 *
 * What a reconciliation actually needs, and what this now does: pick the bank account, open a
 * statement, see the two adjusted balances and the difference between them, work through the
 * unmatched bank movements against the ledger lines the server proposes, and close the statement
 * only when the difference is zero.
 *
 * Nothing here computes a balance. Every figure on the screen is the server's, including the proof,
 * because a reconciliation whose arithmetic lives in the browser proves nothing about the ledger.
 */
@Component({
  selector: 'app-account-reconciliation-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './account-reconciliation.page.html',
  styleUrls: ['./account-reconciliation.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountReconciliationPage {
  private readonly treasury = inject(TreasuryService);
  private readonly api = inject(ReconciliationApiService);

  protected readonly ReconciledIcon = CheckCircle;
  protected readonly PendingIcon = Clock;
  protected readonly DifferencesIcon = AlertCircle;
  protected readonly MatchIcon = Link2;
  protected readonly UndoIcon = Undo2;
  protected readonly RulesIcon = Wand2;
  protected readonly ExcludeIcon = XCircle;

  readonly bankAccounts = signal<BankAccount[]>([]);
  readonly selectedBankAccountId = signal<string | null>(null);
  readonly statements = signal<BankStatement[]>([]);
  readonly selectedStatementId = signal<string | null>(null);

  readonly statement = signal<BankStatement | null>(null);
  readonly summary = signal<ReconciliationSummary | null>(null);
  readonly suggestions = signal<TransactionSuggestion[]>([]);

  readonly loading = signal(true);
  readonly working = signal(false);
  readonly failed = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /** Which ledger lines the user has ticked for the movement they are working on. */
  readonly selectedLineIds = signal<Set<string>>(new Set());
  readonly openTransactionId = signal<string | null>(null);

  readonly currency = computed(
    () =>
      this.bankAccounts().find(
        (account) => account.id === this.selectedBankAccountId(),
      )?.currencyCode ?? '',
  );

  readonly canClose = computed(() => {
    const summary = this.summary();
    return (
      summary !== null &&
      summary.status === 'IMPORTED' &&
      summary.isReconciled &&
      summary.statementIsInternallyConsistent &&
      summary.unrecordedStatementCount === 0
    );
  });

  constructor() {
    this.loadBankAccounts();
  }

  // ── loading ────────────────────────────────────────────────────────────────

  loadBankAccounts(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.treasury.listBankAccounts().subscribe({
      next: (accounts) => {
        this.bankAccounts.set(accounts);
        this.loading.set(false);
        const first = accounts[0];
        if (first) this.selectBankAccount(first.id);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  selectBankAccount(bankAccountId: string): void {
    this.selectedBankAccountId.set(bankAccountId);
    this.selectedStatementId.set(null);
    this.statement.set(null);
    this.summary.set(null);
    this.suggestions.set([]);

    this.api.listStatements(bankAccountId).subscribe({
      next: (statements) => {
        this.statements.set(statements);
        const openOne = statements.find((candidate) => candidate.status === 'IMPORTED');
        const target = openOne ?? statements[0];
        if (target) this.selectStatement(target.id);
      },
      error: () => this.failed.set(true),
    });
  }

  selectStatement(statementId: string): void {
    this.selectedStatementId.set(statementId);
    this.openTransactionId.set(null);
    this.selectedLineIds.set(new Set());
    this.refreshStatement();
  }

  private refreshStatement(): void {
    const statementId = this.selectedStatementId();
    if (!statementId) return;

    this.working.set(true);
    this.api.findStatement(statementId).subscribe({
      next: (statement) => this.statement.set(statement),
      error: () => this.failed.set(true),
    });
    this.api.summary(statementId).subscribe({
      next: (summary) => this.summary.set(summary),
      error: () => this.failed.set(true),
    });
    this.api.suggestions(statementId).subscribe({
      next: (suggestions) => {
        this.suggestions.set(suggestions);
        this.working.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.working.set(false);
      },
    });
  }

  // ── matching ───────────────────────────────────────────────────────────────

  openTransaction(bankTransactionId: string): void {
    const current = this.openTransactionId();
    this.openTransactionId.set(current === bankTransactionId ? null : bankTransactionId);
    this.selectedLineIds.set(new Set());
  }

  toggleLine(journalEntryLineId: string): void {
    const next = new Set(this.selectedLineIds());
    if (next.has(journalEntryLineId)) next.delete(journalEntryLineId);
    else next.add(journalEntryLineId);
    this.selectedLineIds.set(next);
  }

  selectGroup(group: MatchCandidateGroup): void {
    this.selectedLineIds.set(new Set(group.journalEntryLineIds));
  }

  isLineSelected(journalEntryLineId: string): boolean {
    return this.selectedLineIds().has(journalEntryLineId);
  }

  /**
   * What the ticked lines add up to, so the user can see the two sides agree before confirming.
   *
   * The server rejects a match whose sides differ, so this is a courtesy rather than the check —
   * but a button that fails on click without saying why is worse than one that is disabled.
   */
  selectedTotal(suggestion: TransactionSuggestion): number {
    const selected = this.selectedLineIds();
    const fromCandidates = suggestion.candidates
      .filter((candidate) => selected.has(candidate.journalEntryLineId))
      .reduce((sum, candidate) => sum + candidate.amount, 0);
    return Math.round(fromCandidates * 100) / 100;
  }

  canConfirm(suggestion: TransactionSuggestion): boolean {
    if (this.selectedLineIds().size === 0) return false;
    // A group chosen wholesale is trusted: its lines may sit outside the candidate list.
    const fromGroup = suggestion.candidateGroups.some(
      (group) =>
        group.journalEntryLineIds.length === this.selectedLineIds().size &&
        group.journalEntryLineIds.every((id) => this.selectedLineIds().has(id)),
    );
    if (fromGroup) return true;
    return (
      Math.round(this.selectedTotal(suggestion) * 100) === Math.round(suggestion.amount * 100)
    );
  }

  confirmMatch(suggestion: TransactionSuggestion): void {
    const statementId = this.selectedStatementId();
    if (!statementId) return;

    this.working.set(true);
    this.errorMessage.set(null);
    this.api
      .confirmMatch({
        statementId,
        bankTransactionIds: [suggestion.bankTransactionId],
        journalEntryLineIds: [...this.selectedLineIds()],
      })
      .subscribe({
        next: () => {
          this.openTransactionId.set(null);
          this.selectedLineIds.set(new Set());
          this.refreshStatement();
        },
        error: (error) => this.reportFailure(error),
      });
  }

  unmatch(matchId: string): void {
    this.working.set(true);
    this.errorMessage.set(null);
    this.api.unmatch(matchId).subscribe({
      next: () => this.refreshStatement(),
      error: (error) => this.reportFailure(error),
    });
  }

  exclude(bankTransactionId: string, reason: string): void {
    if (!reason || reason.trim().length < 5) return;
    this.working.set(true);
    this.errorMessage.set(null);
    this.api.exclude(bankTransactionId, reason.trim()).subscribe({
      next: () => this.refreshStatement(),
      error: (error) => this.reportFailure(error),
    });
  }

  applyRules(): void {
    const statementId = this.selectedStatementId();
    if (!statementId) return;
    this.working.set(true);
    this.errorMessage.set(null);
    this.api.applyRules(statementId).subscribe({
      next: () => this.refreshStatement(),
      error: (error) => this.reportFailure(error),
    });
  }

  close(): void {
    const statementId = this.selectedStatementId();
    if (!statementId) return;
    this.working.set(true);
    this.errorMessage.set(null);
    this.api.close(statementId).subscribe({
      next: () => {
        this.reloadStatements();
        this.refreshStatement();
      },
      error: (error) => this.reportFailure(error),
    });
  }

  reopen(): void {
    const statementId = this.selectedStatementId();
    if (!statementId) return;
    this.working.set(true);
    this.errorMessage.set(null);
    this.api.reopen(statementId).subscribe({
      next: () => {
        this.reloadStatements();
        this.refreshStatement();
      },
      error: (error) => this.reportFailure(error),
    });
  }

  // ── presentation ───────────────────────────────────────────────────────────

  statusKey(status: BankStatement['status']): string {
    return `ACCOUNTING.RECONCILIATION.ESTATUS.${status}`;
  }

  statusClass(status: BankStatement['status']): string {
    if (status === 'RECONCILED') return 'status-reconciled';
    if (status === 'FAILED') return 'status-differences';
    return 'status-pending';
  }

  statusIcon(status: BankStatement['status']) {
    if (status === 'RECONCILED') return this.ReconciledIcon;
    if (status === 'FAILED') return this.DifferencesIcon;
    return this.PendingIcon;
  }

  /** Positive into the account, negative out of it — the same sense the server uses. */
  signedAmount(transaction: { debit: number; credit: number }): number {
    return Math.round((transaction.debit - transaction.credit) * 100) / 100;
  }

  private reloadStatements(): void {
    const bankAccountId = this.selectedBankAccountId();
    if (!bankAccountId) return;
    this.api.listStatements(bankAccountId).subscribe({
      next: (statements) => this.statements.set(statements),
    });
  }

  /**
   * The server's own message, when it sent one.
   *
   * These errors are the point — "the two sides do not agree", "movements are still unmatched" —
   * so swallowing them into a generic failure would hide the reason the operation was refused.
   */
  private reportFailure(error: unknown): void {
    const message = (error as { error?: { message?: string } })?.error?.message;
    this.errorMessage.set(typeof message === 'string' ? message : null);
    this.working.set(false);
  }
}
