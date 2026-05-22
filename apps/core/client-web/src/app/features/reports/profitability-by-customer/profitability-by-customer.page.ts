import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Filter, FileDown, Calendar } from 'lucide-angular';

interface CustomerProfitability {
  id: string;
  name: string;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number; // Porcentaje
}

@Component({
  selector: 'app-profitability-by-customer-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './profitability-by-customer.page.html',
  styleUrls: ['./profitability-by-customer.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfitabilityByCustomerPage {
  protected readonly FilterIcon = Filter;
  protected readonly ExportIcon = FileDown;
  protected readonly CalendarIcon = Calendar;

  reportData = signal<CustomerProfitability[]>([
    { id: 'CUST-001', name: 'Proyectos Globales S.A.', totalRevenue: 52500.50, totalCost: 31500.00, grossProfit: 21000.50, grossMargin: 40.0 },
    { id: 'CUST-002', name: 'Cliente Ejemplo S.R.L.', totalRevenue: 38200.00, totalCost: 25000.00, grossProfit: 13200.00, grossMargin: 34.6 },
    { id: 'CUST-003', name: 'Servicios Creativos', totalRevenue: 15600.75, totalCost: 11200.00, grossProfit: 4400.75, grossMargin: 28.2 },
  ]);
}