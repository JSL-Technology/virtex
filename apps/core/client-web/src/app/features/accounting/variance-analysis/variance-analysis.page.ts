import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Filter, FileDown, ArrowUp, ArrowDown } from 'lucide-angular';

interface VarianceItem {
  accountCode: string;
  accountName: string;
  actual: number;
  budget: number;
  varianceAmount: number;
  variancePercent: number;
}

@Component({
  selector: 'app-variance-analysis-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './variance-analysis.page.html',
  styleUrls: ['./variance-analysis.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VarianceAnalysisPage {
  protected readonly FilterIcon = Filter;
  protected readonly ExportIcon = FileDown;
  protected readonly PositiveIcon = ArrowDown; // Un gasto menor al presupuesto es positivo (flecha abajo)
  protected readonly NegativeIcon = ArrowUp;   // Un gasto mayor al presupuesto es negativo (flecha arriba)

  // Datos simulados de un reporte de P&L vs Presupuesto
  variances = signal<VarianceItem[]>([
    { accountCode: '4000', accountName: 'Sales Revenue', actual: 250000, budget: 240000, varianceAmount: 10000, variancePercent: 4.17 },
    { accountCode: '5000', accountName: 'Cost of Goods Sold', actual: 115000, budget: 120000, varianceAmount: -5000, variancePercent: -4.17 },
    { accountCode: '6100', accountName: 'Salaries Expense', actual: 45000, budget: 45000, varianceAmount: 0, variancePercent: 0 },
    { accountCode: '6200', accountName: 'Marketing Expense', actual: 22000, budget: 20000, varianceAmount: 2000, variancePercent: 10 },
    { accountCode: '6300', accountName: 'Rent Expense', actual: 10000, budget: 10000, varianceAmount: 0, variancePercent: 0 },
  ]);

  isVariancePositive(item: VarianceItem): boolean {
    // Para ingresos, una varianza positiva es buena. Para gastos, una negativa es buena.
    if (item.accountName.toLowerCase().includes('revenue') || item.accountName.toLowerCase().includes('sales')) {
      return item.varianceAmount >= 0;
    } else {
      return item.varianceAmount <= 0;
    }
  }
}