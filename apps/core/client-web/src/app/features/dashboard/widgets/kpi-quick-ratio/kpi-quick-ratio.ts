import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, TrendingUp, TrendingDown, Minus, FlaskConical } from 'lucide-angular';
import { Kpi } from '../../../../core/models/finance';
import { DashboardApiService } from '../../../../core/api/dashboard-api.service';
import { Observable, map } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-kpi-quick-ratio',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './kpi-quick-ratio.html',
  styleUrls: ['../kpi-roe/kpi-roe.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiQuickRatio implements OnInit {
  private dashboardApiService = inject(DashboardApiService);

  kpi$!: Observable<Kpi>;

  protected readonly CardIcon = FlaskConical;
  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly TrendingDownIcon = TrendingDown;
  protected readonly NeutralIcon = Minus;

  ngOnInit(): void {
    this.kpi$ = this.dashboardApiService.getQuickRatio().pipe(
      map(data => ({
        title: 'DASH.WIDGET.KPI_QUICK_RATIO.TITLE',
        value: data.quickRatio.toString(), // CORRECCIÓN: Se envía el número directamente
        comparisonValue: '', // El backend no provee comparación aún
        comparisonPeriod: 'DASH.WIDGET.KPI_QUICK_RATIO.COMP_PERIOD',
        isPositive: data.quickRatio > 1, // Un ratio > 1 se considera saludable
        iconName: 'FlaskConical',
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