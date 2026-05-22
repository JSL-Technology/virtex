import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, TrendingUp, TrendingDown, Minus, Wallet } from 'lucide-angular';
import { Kpi } from '../../../../core/models/finance';
import { DashboardApiService } from '../../../../core/api/dashboard-api.service';
import { Observable, map } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-kpi-working-capital',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './kpi-working-capital.html',
  styleUrls: ['../kpi-roe/kpi-roe.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiWorkingCapital implements OnInit {
  private dashboardApiService = inject(DashboardApiService);

  kpi$!: Observable<Kpi>;

  protected readonly CardIcon = Wallet;
  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly TrendingDownIcon = TrendingDown;
  protected readonly NeutralIcon = Minus;

  ngOnInit(): void {
    this.kpi$ = this.dashboardApiService.getWorkingCapital().pipe(
      map(data => ({
        title: 'DASH.WIDGET.KPI_WORKING_CAPITAL.TITLE', // Usamos clave de traducción
        value: data.workingCapital.toString(), // CORRECCIÓN: Se envía el número directamente
        comparisonValue: '', // El backend no provee comparación aún
        comparisonPeriod: 'DASH.WIDGET.KPI_WORKING_CAPITAL.COMP_PERIOD', // O 'Actual'
        isPositive: data.workingCapital > 0, // Lógica simple de ejemplo
        iconName: 'Wallet',
        color: 'blue'
      }))
    );
  }

  getChangeIcon(isPositive: boolean) {
    return isPositive ? this.TrendingUpIcon : this.TrendingDownIcon;
  }

  getChangeClass(isPositive: boolean) {
    return isPositive ? 'positive' : 'negative';
  }
}