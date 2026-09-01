import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Filter, MoreHorizontal, CheckCircle, Clock, AlertCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';

type ReconciliationStatus = 'Reconciled' | 'Pending' | 'With Differences';

export interface ReconciliationItem {
  accountCode: string;
  accountName: string;
  balance: number;
  /** The books' currency: a control account is kept in the functional currency. */
  currencyCode?: string;
  lastReconciledBy: string | null;
  /** `YYYY-MM-DD`, or `null` when the account has never been reconciled. */
  lastReconciledDate: string | null;
  status: ReconciliationStatus;
}

@Component({
  selector: 'app-account-reconciliation-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './account-reconciliation.page.html',
  styleUrls: ['./account-reconciliation.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountReconciliationPage {
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly ReconciledIcon = CheckCircle;
  protected readonly PendingIcon = Clock;
  protected readonly DifferencesIcon = AlertCircle;

  readonly accountsToReconcile = signal<ReconciliationItem[]>([]);

  /**
   * The stored status becomes a catalogue key.
   *
   * `'Reconciled' | 'Pending' | 'With Differences'` are stored values, and the badge printed them
   * straight through — English words on a Spanish screen. An unknown value falls through to
   * itself so a deployment mismatch is visible rather than blank.
   */
  statusKey(status: ReconciliationStatus): string {
    const keys: Record<ReconciliationStatus, string> = {
      Reconciled: 'ACCOUNTING.ACCOUNT_RECONCILIATION.STATUS_RECONCILED',
      Pending: 'ACCOUNTING.ACCOUNT_RECONCILIATION.STATUS_PENDING',
      'With Differences': 'ACCOUNTING.ACCOUNT_RECONCILIATION.STATUS_WITH_DIFFERENCES',
    };
    return keys[status] ?? status;
  }

  getStatusClass(status: ReconciliationStatus): string {
    if (status === 'Reconciled') return 'status-reconciled';
    if (status === 'Pending') return 'status-pending';
    return 'status-differences';
  }

  getIconForStatus(status: ReconciliationStatus) {
    switch (status) {
      case 'Reconciled': return this.ReconciledIcon;
      case 'Pending': return this.PendingIcon;
      default: return this.DifferencesIcon;
    }
  }
}