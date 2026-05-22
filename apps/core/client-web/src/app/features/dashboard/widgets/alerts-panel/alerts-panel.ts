import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, AlertTriangle, CheckCircle } from 'lucide-angular';
import { AlertItem } from '../../../../core/models/finance';

@Component({
  selector: 'app-alerts-panel', standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './alerts-panel.html',
  styleUrls: ['../widget-styles.scss']
})
export class AlertsPanel {
  protected readonly WarningIcon = AlertTriangle;
  protected readonly CheckIcon = CheckCircle;
  alerts = signal<AlertItem[]>([
    { severity: 'critical', title: 'Margen Bruto -15%', description: 'El margen del producto "Laptop Pro" cayó por debajo del umbral.' },
    { severity: 'warning', title: 'Cartera Vencida > 90 días', description: 'Cliente "Ejemplo Corp" tiene facturas vencidas.' }
  ]);
}