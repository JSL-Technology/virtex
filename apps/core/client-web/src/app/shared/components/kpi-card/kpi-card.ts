import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, TrendingUp, TrendingDown } from 'lucide-angular';
import { Kpi } from '../../../core/models/finance';

@Component({
  selector: 'app-kpi-card',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './kpi-card.html',
  styleUrls: ['./kpi-card.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiCard {
  @Input() data: Kpi | undefined;

  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly TrendingDownIcon = TrendingDown;
}