import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Filter, FileDown, Calendar } from 'lucide-angular';

interface ProductProfitability {
  id: string;
  sku?: string;
  name: string;
  unitsSold: number;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number; // Porcentaje
}

@Component({
  selector: 'app-profitability-by-product-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './profitability-by-product.page.html',
  styleUrls: ['./profitability-by-product.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfitabilityByProductPage {
  protected readonly FilterIcon = Filter;
  protected readonly ExportIcon = FileDown;
  protected readonly CalendarIcon = Calendar;

  reportData = signal<ProductProfitability[]>([
    { id: 'P001', sku: 'LP-15-PRO', name: 'Laptop Pro 15"', unitsSold: 120, totalRevenue: 191998.80, totalCost: 120000, grossProfit: 71998.80, grossMargin: 37.5 },
    { id: 'P002', name: 'Mouse Inalámbrico Ergonómico', unitsSold: 95, totalRevenue: 4702.50, totalCost: 2375, grossProfit: 2327.50, grossMargin: 49.5 },
    { id: 'P004', name: 'Monitor UltraWide 34"', unitsSold: 88, totalRevenue: 70312.00, totalCost: 52800, grossProfit: 17512.00, grossMargin: 24.9 },
  ]);
}