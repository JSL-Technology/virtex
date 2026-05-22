import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, CheckCircle, Circle, Loader, AlertCircle } from 'lucide-angular';

interface ClosingTask {
  id: string;
  name: string;
  responsible: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  link?: string;
}

@Component({
  selector: 'app-month-end-close-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './month-end-close.page.html',
  styleUrls: ['./month-end-close.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonthEndClosePage {
  protected readonly CompletedIcon = CheckCircle;
  protected readonly PendingIcon = Circle;
  protected readonly InProgressIcon = Loader;
  protected readonly ErrorIcon = AlertCircle;

  closingTasks = signal<ClosingTask[]>([
    { id: 't1', name: 'Close Accounts Payable Subledger', responsible: 'Ana Pérez', status: 'completed' },
    { id: 't2', name: 'Close Accounts Receivable Subledger', responsible: 'Ana Pérez', status: 'completed' },
    { id: 't3', name: 'Bank Reconciliation', responsible: 'Carlos López', status: 'in-progress', link: '/treasury/reconciliation' },
    { id: 't4', name: 'Record Accruals and Deferrals', responsible: 'Carlos López', status: 'pending' },
    { id: 't5', name: 'Fixed Assets Depreciation Run', responsible: 'Sistema', status: 'pending' },
    { id: 't6', name: 'Review and Post All Journal Entries', responsible: 'Admin Principal', status: 'pending' },
    { id: 't7', name: 'Financial Statements Review', responsible: 'Admin Principal', status: 'pending' },
  ]);
  
  getIconForStatus(status: ClosingTask['status']) {
    switch(status) {
      case 'completed': return this.CompletedIcon;
      case 'in-progress': return this.InProgressIcon;
      case 'error': return this.ErrorIcon;
      default: return this.PendingIcon;
    }
  }
}