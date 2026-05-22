import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Receipt, Package, UserPlus, FilePlus } from 'lucide-angular';

// Interfaz para definir la estructura de un item de actividad
interface ActivityItem {
  type: 'invoice' | 'product' | 'user' | 'sale';
  icon: any; // Se pasará el objeto del ícono directamente
  text: string;
  time: string;
}

@Component({
  selector: 'app-recent-activity',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './recent-activity.html',
  styleUrls: ['./recent-activity.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecentActivity {
  // Exponemos los íconos directamente para usarlos en la señal
  protected readonly ReceiptIcon = Receipt;
  protected readonly PackageIcon = Package;
  protected readonly UserPlusIcon = UserPlus;
  protected readonly SaleIcon = FilePlus;

  // Usamos datos simulados para la demostración
  activities = signal<ActivityItem[]>([
    { 
      type: 'invoice', 
      icon: this.ReceiptIcon, 
      text: 'Factura #005 fue enviada a Proyectos Globales S.A.', 
      time: 'hace 5 minutos' 
    },
    { 
      type: 'product', 
      icon: this.PackageIcon, 
      text: 'Nuevo producto "Silla de Oficina Ergonómica" fue añadido al inventario.', 
      time: 'hace 2 horas' 
    },
    { 
      type: 'user', 
      icon: this.UserPlusIcon, 
      text: 'Juan Pérez fue añadido como nuevo usuario con rol de Vendedor.', 
      time: 'hace 8 horas' 
    },
    { 
      type: 'invoice', 
      icon: this.ReceiptIcon, 
      text: 'Pago completo recibido para la factura #002.', 
      time: 'ayer' 
    },
    { 
      type: 'sale', 
      icon: this.SaleIcon, 
      text: 'Venta rápida registrada por un total de $89.99.', 
      time: 'ayer' 
    },
  ]);
}