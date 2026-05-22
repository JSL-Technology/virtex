import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Lock, Unlock } from 'lucide-angular';

interface AccountingPeriod {
  month: string;
  year: number;
  startDate: string;
  endDate: string;
  status: 'Open' | 'Closed' | 'Future';
}

@Component({
  selector: 'app-periods-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './periods.page.html',
  styleUrls: ['./periods.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeriodsPage {
  protected readonly LockIcon = Lock;
  protected readonly UnlockIcon = Unlock;

  // Datos simulados para el año fiscal 2025
  periods = signal<AccountingPeriod[]>([
    { month: 'January', year: 2025, startDate: 'Jan 1, 2025', endDate: 'Jan 31, 2025', status: 'Closed' },
    { month: 'February', year: 2025, startDate: 'Feb 1, 2025', endDate: 'Feb 28, 2025', status: 'Closed' },
    { month: 'March', year: 2025, startDate: 'Mar 1, 2025', endDate: 'Mar 31, 2025', status: 'Closed' },
    { month: 'April', year: 2025, startDate: 'Apr 1, 2025', endDate: 'Apr 30, 2025', status: 'Closed' },
    { month: 'May', year: 2025, startDate: 'May 1, 2025', endDate: 'May 31, 2025', status: 'Closed' },
    { month: 'June', year: 2025, startDate: 'Jun 1, 2025', endDate: 'Jun 30, 2025', status: 'Closed' },
    { month: 'July', year: 2025, startDate: 'Jul 1, 2025', endDate: 'Jul 31, 2025', status: 'Open' },
    { month: 'August', year: 2025, startDate: 'Aug 1, 2025', endDate: 'Aug 31, 2025', status: 'Future' },
    { month: 'September', year: 2025, startDate: 'Sep 1, 2025', endDate: 'Sep 30, 2025', status: 'Future' },
    { month: 'October', year: 2025, startDate: 'Oct 1, 2025', endDate: 'Oct 31, 2025', status: 'Future' },
    { month: 'November', year: 2025, startDate: 'Nov 1, 2025', endDate: 'Nov 30, 2025', status: 'Future' },
    { month: 'December', year: 2025, startDate: 'Dec 1, 2025', endDate: 'Dec 31, 2025', status: 'Future' },
  ]);

  getStatusClass(status: AccountingPeriod['status']): string {
    if (status === 'Open') return 'status-open';
    if (status === 'Closed') return 'status-closed';
    return 'status-future';
  }

  togglePeriodStatus(periodToUpdate: AccountingPeriod): void {
    // Lógica simulada para abrir/cerrar períodos
    console.log(`Toggling status for period: ${periodToUpdate.month}`);
    this.periods.update(currentPeriods =>
      currentPeriods.map(p => {
        if (p.month === periodToUpdate.month) {
          return { ...p, status: p.status === 'Open' ? 'Closed' : 'Open' };
        }
        return p;
      })
    );
  }
}