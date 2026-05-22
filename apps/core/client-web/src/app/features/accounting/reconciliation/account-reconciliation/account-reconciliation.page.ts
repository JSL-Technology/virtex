import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Filter, MoreHorizontal, CheckCircle, Clock, AlertCircle } from 'lucide-angular';

type ReconciliationStatus = 'Reconciled' | 'Pending' | 'With Differences';

interface ReconciliationItem {
  accountCode: string;
  accountName: string;
  balance: number;
  lastReconciledBy: string;
  lastReconciledDate: string;
  status: ReconciliationStatus;
}

@Component({
  selector: 'app-account-reconciliation-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
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

  accountsToReconcile = signal<ReconciliationItem[]>([
    // { accountCode: '1010-01', accountName: 'Main Bank Account', balance: 44800.00, lastReconciledBy: 'Carlos López', lastReconciledDate: 'Jun 30, 2025', status: 'Pending' },
    // { accountCode: '1200', accountName: 'Accounts Receivable', balance: 75000.00, lastReconciledBy: 'Ana Pérez', lastReconciledDate: 'Jun 30, 2025', status: 'Reconciled' },
    // { accountCode: '2100', accountName: 'Accounts Payable', balance: 25000.00, lastReconciledBy: 'Carlos López', lastReconciledDate: 'Jun 30, 2025', status: 'With Differences' },
    // { accountCode: '1500', accountName: 'Inventory', balance: 60000.00, lastReconciledBy: 'N/A', lastReconciledDate: 'N/A', status: 'Pending' },
  ]);

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