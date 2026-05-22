import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Filter, FileDown, Calendar } from 'lucide-angular';

interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: number | null;
  credit: number | null;
}

interface JournalEntryView {
  id: string;
  date: string;
  description: string;
  lines: JournalLine[];
}

@Component({
  selector: 'app-daily-journal-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './daily-journal.page.html',
  styleUrls: ['./daily-journal.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DailyJournalPage {
  protected readonly FilterIcon = Filter;
  protected readonly ExportIcon = FileDown;
  protected readonly CalendarIcon = Calendar;

  journalEntries = signal<JournalEntryView[]>([
    {
      id: 'JE-2025-001',
      date: 'Jul 28, 2025',
      description: 'Registro de Venta #V-2025-001',
      lines: [
        { accountCode: '1200-01', accountName: 'Accounts Receivable - Local', debit: 350.00, credit: null },
        { accountCode: '4100-01', accountName: 'Sales Revenue - Products', debit: null, credit: 350.00 }
      ]
    },
    {
      id: 'JE-2025-002',
      date: 'Jul 28, 2025',
      description: 'Pago de Nómina - Quincena 1 Julio',
      lines: [
        { accountCode: '6100-01', accountName: 'Salaries Expense', debit: 15200.00, credit: null },
        { accountCode: '1010-01', accountName: 'Main Bank Account', debit: null, credit: 15200.00 }
      ]
    },
  ]);
}