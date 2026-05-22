import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, TrendingUp, TrendingDown, Minus, Trophy } from 'lucide-angular';
import { Kpi } from '../../../../core/models/finance';
import { DashboardApiService } from '../../../../core/api/dashboard-api.service';
import { Observable, map } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-kpi-roe',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './kpi-roe.html',
  styleUrls: ['./kpi-roe.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiRoe implements OnInit {
  private dashboardApiService = inject(DashboardApiService);

  kpi$!: Observable<Kpi>;

  protected readonly CardIcon = Trophy;
  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly TrendingDownIcon = TrendingDown;
  protected readonly NeutralIcon = Minus;

  ngOnInit(): void {
    this.kpi$ = this.dashboardApiService.getROE().pipe(
      map(data => ({
        title: 'DASH.WIDGET.KPI_ROE.TITLE',
        value: (data.roe / 100).toString(), // CORRECCIÓN: Se envía como decimal para el pipe 'percent'
        comparisonValue: '', // El backend no provee comparación aún
        comparisonPeriod: 'DASH.WIDGET.KPI_ROE.COMP_PERIOD',
        isPositive: data.roe > 0, // Un ROE positivo es bueno
        iconName: 'Trophy',
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