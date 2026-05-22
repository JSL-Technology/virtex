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
  selector: 'app-annual-close-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './annual-close.page.html',
  styleUrls: ['./annual-close.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnnualClosePage {
  protected readonly CompletedIcon = CheckCircle;
  protected readonly PendingIcon = Circle;
  protected readonly InProgressIcon = Loader;
  protected readonly ErrorIcon = AlertCircle;

  // Datos simulados para el proceso de cierre anual
  annualClosingTasks = signal<ClosingTask[]>([
    { id: 'at1', name: 'Final Reconciliation of All Accounts', responsible: 'Admin Principal', status: 'completed' },
    { id: 'at2', name: 'Year-End Inventory Count Adjustment', responsible: 'Inventory Team', status: 'completed' },
    { id: 'at3', name: 'Generate Final Financial Statements', responsible: 'System', status: 'in-progress' },
    { id: 'at4', name: 'Prepare Documentation for External Audit', responsible: 'Carlos López', status: 'pending' },
    { id: 'at5', name: 'Close Fiscal Year 2025', responsible: 'Admin Principal', status: 'pending' },
  ]);

  getIconForStatus(status: ClosingTask['status']) {
    switch (status) {
      case 'completed': return this.CompletedIcon;
      case 'in-progress': return this.InProgressIcon;
      case 'error': return this.ErrorIcon;
      default: return this.PendingIcon;
    }
  }
}