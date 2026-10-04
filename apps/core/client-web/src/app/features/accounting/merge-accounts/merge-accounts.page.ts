import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { LucideAngularModule, AlertTriangle, ArrowRight, Ban, GitMerge } from 'lucide-angular';
import { FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VX_SELECT } from '../../../shared/components/select';
import { VxAmountComponent } from '../../../shared/components/amount';
import { Account } from '../../../core/models/account.model';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { ChartOfAccountsApiService, MergePreview } from '../data/chart-of-accounts.service';

/**
 * Merging one account into another.
 *
 * ## What this was
 *
 * A three-step wizard over six accounts written into the component — «100-01 Caja General» and its
 * neighbours, the same for every tenant — whose «analysis» waited 500 ms and announced 42
 * transactions and a balance of 1,500.75 for any pair, and whose «merge» waited 600 ms and
 * reported success having called nothing. It was reachable from nowhere. Meanwhile the server had
 * a real merge — `POST /chart-of-accounts/merge`, a queued job that moves every line and child
 * account and deactivates the source — that nothing in the client could call.
 *
 * ## What it is now
 *
 * The accounts are searched in the tenant's own chart. The analysis is the server's
 * (`GET /chart-of-accounts/merge/preview`): the lines that would move, both posted balances, how
 * many lines sit in closed periods, and every reason the merge would be refused — stated before
 * anything is queued, and enforced again when it is. The reason is required because the audit
 * trail records it. NetSuite offers the same operation from its chart of accounts; SAP does not,
 * which is why this asks for confirmation rather than treating it as routine.
 */
@Component({
  selector: 'app-merge-accounts-page',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SELECT, VxAmountComponent],
  templateUrl: './merge-accounts.page.html',
  styleUrls: ['./merge-accounts.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MergeAccountsPage {
  private readonly chart = inject(ChartOfAccountsApiService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);

  protected readonly MergeIcon = GitMerge;
  protected readonly ArrowIcon = ArrowRight;
  protected readonly WarningIcon = AlertTriangle;
  protected readonly BlockedIcon = Ban;

  readonly sourceId = signal<string | null>(null);
  readonly destinationId = signal<string | null>(null);
  readonly reason = signal('');

  readonly preview = signal<MergePreview | null>(null);
  readonly analyzing = signal(false);
  readonly merging = signal(false);
  /** Set once the server has queued the merge: the screen then says so and offers a new one. */
  readonly started = signal<{ messageKey: string; messageParams: Record<string, string> } | null>(null);

  readonly canAnalyze = computed(
    () => !!this.sourceId() && !!this.destinationId() && this.sourceId() !== this.destinationId() && !this.analyzing(),
  );
  readonly canMerge = computed(() => {
    const preview = this.preview();
    return !!preview && preview.blockers.length === 0 && this.reason().trim().length >= 3 && !this.merging();
  });

  protected readonly searchAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.chart.searchAccounts(query, limit);
  protected readonly resolveAccount = (id: string): Observable<Account> => this.chart.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountValue = (account: Account): string => account.id;
  protected readonly nameOf = accountNameOf;

  selectSource(id: string | null): void {
    this.sourceId.set(id);
    this.preview.set(null);
  }

  selectDestination(id: string | null): void {
    this.destinationId.set(id);
    this.preview.set(null);
  }

  analyze(): void {
    const source = this.sourceId();
    const destination = this.destinationId();
    if (!source || !destination || source === destination) return;

    this.analyzing.set(true);
    this.chart.previewMerge(source, destination).subscribe({
      next: (preview) => {
        this.preview.set(preview);
        this.analyzing.set(false);
      },
      error: (err) => {
        this.analyzing.set(false);
        this.notifications.showHttpError(err, 'accounting.merge_tool.analysis_failed');
      },
    });
  }

  async merge(): Promise<void> {
    const preview = this.preview();
    if (!preview || !this.canMerge()) return;

    const confirmed = await this.dialog.confirm({
      title: 'accounting.merge_tool.confirm_title',
      message: 'accounting.merge_tool.confirm_message',
      messageParams: {
        source: preview.source.code,
        destination: preview.destination.code,
        lines: preview.linesToMove,
      },
      confirmText: 'accounting.merge_tool.merge_accounts',
      variant: 'danger',
    });
    if (!confirmed) return;

    this.merging.set(true);
    this.chart.merge(preview.source.id, preview.destination.id, this.reason().trim()).subscribe({
      next: (result) => {
        this.merging.set(false);
        this.started.set({ messageKey: result.messageKey, messageParams: result.messageParams });
        this.notifications.showSuccess(result.messageKey, result.messageParams);
      },
      error: (err) => {
        this.merging.set(false);
        this.notifications.showHttpError(err, 'accounting.merge_tool.merge_failed');
      },
    });
  }

  reset(): void {
    this.sourceId.set(null);
    this.destinationId.set(null);
    this.reason.set('');
    this.preview.set(null);
    this.started.set(null);
  }
}
