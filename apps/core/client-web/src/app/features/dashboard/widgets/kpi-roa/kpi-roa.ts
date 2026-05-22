import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, TrendingUp, TrendingDown, Minus, Target } from 'lucide-angular';
import { Kpi } from '../../../../core/models/finance';
import { DashboardApiService } from '../../../../core/api/dashboard-api.service';
import { Observable, map } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-kpi-roa',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './kpi-roa.html',
  styleUrls: ['../kpi-roe/kpi-roe.scss'], // Reutiliza los estilos del KPI de ROE
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiRoa implements OnInit {
  private dashboardApiService = inject(DashboardApiService);

  kpi$!: Observable<Kpi>;

  protected readonly CardIcon = Target;
  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly TrendingDownIcon = TrendingDown;
  protected readonly NeutralIcon = Minus;

  ngOnInit(): void {
    this.kpi$ = this.dashboardApiService.getROA().pipe(
      map(data => ({
        title: 'DASH.WIDGET.KPI_ROA.TITLE',
        value: (data.roa / 100).toString(), // CORRECCIÓN: Se envía como decimal para el pipe 'percent'
        comparisonValue: '', // El backend no provee comparación aún
        comparisonPeriod: 'DASH.WIDGET.KPI_ROA.COMP_PERIOD',
        isPositive: data.roa > 0, // Un ROA positivo es bueno
        iconName: 'Target',
        color: 'green'
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