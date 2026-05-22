import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, TrendingUp, TrendingDown, Minus, Percent } from 'lucide-angular';
import { Kpi } from '../../../../core/models/finance';
import { DashboardApiService } from '../../../../core/api/dashboard-api.service';
import { Observable, map } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-kpi-net-margin',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './kpi-net-margin.html',
  styleUrls: ['../kpi-roe/kpi-roe.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiNetMarginComponent implements OnInit {
  private dashboardApiService = inject(DashboardApiService);

  kpi$!: Observable<Kpi>;

  protected readonly CardIcon = Percent;
  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly TrendingDownIcon = TrendingDown;
  protected readonly NeutralIcon = Minus;

  ngOnInit(): void {
    this.kpi$ = this.dashboardApiService.getNetMargin().pipe(
      map(data => ({
        title: 'DASH.WIDGET.KPI_NET_MARGIN.TITLE',
        value: data.netMargin.toFixed(2) + '%',
        comparisonValue: '', // El backend no provee comparación aún
        comparisonPeriod: 'DASH.WIDGET.KPI_NET_MARGIN.COMP_PERIOD',
        isPositive: data.netMargin > 0,
        iconName: 'Percent',
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
