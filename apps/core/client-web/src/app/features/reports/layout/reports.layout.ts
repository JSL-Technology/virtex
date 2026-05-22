import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LucideAngularModule, AreaChart, FileText, BarChartHorizontal } from 'lucide-angular';

@Component({
  selector: 'app-reports-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideAngularModule],
  templateUrl: './reports.layout.html',
  styleUrls: ['../../documents/layout/documents.layout.scss'] // Reutiliza estilos
})
export class ReportsLayout {
  protected readonly ProfitabilityIcon = AreaChart;
  protected readonly StatementsIcon = FileText;
  protected readonly ComparativeIcon = BarChartHorizontal;
}