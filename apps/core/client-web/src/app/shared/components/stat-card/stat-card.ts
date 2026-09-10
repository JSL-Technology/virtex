import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, DollarSign, Receipt, Package, Users, BarChart3 } from 'lucide-angular';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './stat-card.html',
  styleUrls: ['./stat-card.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatCard {
  // Recibe un objeto 'data' en lugar de inputs individuales
  @Input() data: any = {};

  // Mapeo de nombres de ícono a objetos de ícono para el binding [img]
  private iconMap: { [key: string]: any } = { DollarSign, Receipt, Package, Users };

  get icon() {
    // `lucide-icon` lanza «No icon name or image has been provided» si recibe undefined,
    // así que un `iconName` fuera del mapa (o ausente) debe caer a un ícono por defecto
    // en lugar de reventar el render de la tarjeta.
    return this.iconMap[this.data.iconName] ?? BarChart3;
  }

  isPositive(): boolean {
    return this.data.change?.startsWith('+');
  }
}