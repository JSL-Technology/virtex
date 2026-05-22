import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Filter, FileDown, Calendar, Users } from 'lucide-angular';

interface LedgerLine {
  date: string;
  entryNumber: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

@Component({
  selector: 'app-subsidiary-ledgers-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './subsidiary-ledgers.page.html',
  styleUrls: ['./subsidiary-ledgers.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubsidiaryLedgersPage {
  protected readonly FilterIcon = Filter;
  protected readonly ExportIcon = FileDown;
  protected readonly CalendarIcon = Calendar;
  protected readonly UsersIcon = Users;

  selectedControlAccount = signal<{ code: string; name: string }>({ code: '1200', name: 'Accounts Receivable' });
  selectedAuxiliary = signal<{ id: string; name: string }>({ id: 'CUST-001', name: 'Proyectos Globales S.A.' });

  // Datos simulados para el auxiliar seleccionado
  ledgerLines = signal<LedgerLine[]>([
    { date: 'Jul 1, 2025', entryNumber: 'OPEN', description: 'Opening Balance', debit: null, credit: null, balance: 1000.00 },
    { date: 'Jul 15, 2025', entryNumber: 'INV-0018', description: 'Invoice #INV-0018', debit: 500.75, credit: null, balance: 1500.75 },
    { date: 'Jul 28, 2025', entryNumber: 'PMT-0012', description: 'Payment Received', debit: null, credit: 1000.00, balance: 500.75 },
  ]);

  initialBalance = signal(1000.00);
  finalBalance = signal(500.75);
}