import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Info } from 'lucide-angular';

interface FinancialRatio {
  name: string;
  value: string;
  tooltip: string;
  status: 'good' | 'warning' | 'danger';
}

@Component({
  selector: 'app-financial-ratios',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './financial-ratios.html',
  styleUrls: ['./financial-ratios.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinancialRatios {
  protected readonly InfoIcon = Info;

  ratios = signal<FinancialRatio[]>([
    { name: 'ROE (Retorno s/ Patrimonio)', value: '15.2%', tooltip: 'Mide la rentabilidad generada sobre la inversión de los accionistas.', status: 'good' },
    { name: 'ROA (Retorno s/ Activos)', value: '8.1%', tooltip: 'Mide la eficiencia de la empresa para generar ganancias con sus activos.', status: 'good' },
    { name: 'Liquidez Corriente', value: '2.1', tooltip: 'Capacidad de cubrir deudas a corto plazo (Ideal > 1.5).', status: 'good' },
    { name: 'Prueba Ácida', value: '1.2', tooltip: 'Capacidad de cubrir deudas a corto plazo sin vender inventario (Ideal > 1.0).', status: 'warning' },
    { name: 'Capital de Trabajo', value: '$250.8K', tooltip: 'Recursos disponibles para la operación diaria (Activo Corriente - Pasivo Corriente).', status: 'good' },
  ]);
}