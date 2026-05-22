import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

interface JournalEntry {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  status: 'Posted' | 'Draft';
}

@Component({
  selector: 'app-journal-entries-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule,RouterLink, TranslateModule],
  templateUrl: './journal-entries.page.html',
  styleUrls: ['./journal-entries.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalEntriesPage {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  entries = signal<JournalEntry[]>([
    { id: 'JE-001', date: 'Jul 28, 2025', description: 'Registro de Venta #V-2025-001', debit: 350.00, credit: 350.00, status: 'Posted' },
    { id: 'JE-002', date: 'Jul 28, 2025', description: 'Pago de Nómina - Quincena 1', debit: 15200.00, credit: 15200.00, status: 'Posted' },
    { id: 'JE-003', date: 'Jul 29, 2025', description: 'Ajuste de fin de mes (Borrador)', debit: 0, credit: 0, status: 'Draft' },
  ]);

  getStatusClass(status: JournalEntry['status']): string {
    if (status === 'Posted') return 'status-posted';
    return 'status-draft';
  }
}