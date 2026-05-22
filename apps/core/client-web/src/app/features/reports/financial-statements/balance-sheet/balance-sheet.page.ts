import { Component, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Filter, FileDown, Calendar } from 'lucide-angular';

interface ReportLine {
  accountName: string;
  amount: number;
}

// Interfaz para una sub-sección (Ej. Activos Corrientes)
interface ReportSubSection {
  title: string;
  lines: ReportLine[];
  subtotal: number;
}

@Component({
  selector: 'app-balance-sheet-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './balance-sheet.page.html',
  styleUrls: ['./balance-sheet.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BalanceSheetPage {
  protected readonly FilterIcon = Filter;
  protected readonly ExportIcon = FileDown;
  protected readonly CalendarIcon = Calendar;

  reportDate = signal('Julio 31, 2025');

  // ACTIVOS - Ahora clasificados
  assets = signal({
    current: {
      title: 'Activos Corrientes',
      lines: [
        { accountName: 'Efectivo y Equivalentes', amount: 75000 },
        { accountName: 'Cuentas por Cobrar', amount: 70000 },
        { accountName: 'Inventario', amount: 30000 },
      ],
      subtotal: 175000,
    },
    nonCurrent: {
      title: 'Activos No Corrientes',
      lines: [{ accountName: 'Propiedades, Planta y Equipo', amount: 250000 }],
      subtotal: 250000,
    },
  });
  totalAssets = computed(() => this.assets().current.subtotal + this.assets().nonCurrent.subtotal);


  // PASIVOS Y PATRIMONIO - Ahora clasificados
  liabilities = signal({
      current: {
          title: 'Pasivos Corrientes',
          lines: [
              { accountName: 'Cuentas por Pagar', amount: 55000 },
              { accountName: 'Préstamos a Corto Plazo', amount: 20000 },
          ],
          subtotal: 75000,
      },
      nonCurrent: {
          title: 'Pasivos No Corrientes',
          lines: [{ accountName: 'Deuda a Largo Plazo', amount: 150000 }],
          subtotal: 150000,
      },
  });
  totalLiabilities = computed(() => this.liabilities().current.subtotal + this.liabilities().nonCurrent.subtotal);
  
  equity = signal({
      title: 'Patrimonio',
      lines: [
          { accountName: 'Capital Social', amount: 120000 },
          { accountName: 'Ganancias Retenidas', amount: 80000 },
      ],
      total: 200000,
  });

  totalLiabilitiesAndEquity = computed(() => this.totalLiabilities() + this.equity().total);
}