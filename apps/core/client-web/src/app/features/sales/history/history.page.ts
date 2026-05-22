import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, MoreHorizontal, FileDown } from 'lucide-angular';

export interface Sale {
  id: string;
  date: string;
  customer: string;
  total: number;
  paymentMethod: 'Efectivo' | 'Tarjeta' | 'Transferencia';
  status: 'Completada' | 'Pendiente' | 'Cancelada';
}

@Component({
  selector: 'app-history-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly FileDownIcon = FileDown;

  sales = signal<Sale[]>([
    { id: 'V-2025-001', date: '20/07/2025', customer: 'Cliente Ejemplo S.R.L.', total: 350.00, paymentMethod: 'Tarjeta', status: 'Completada' },
    { id: 'V-2025-002', date: '20/07/2025', customer: 'Ana Pérez', total: 120.50, paymentMethod: 'Efectivo', status: 'Completada' },
    { id: 'V-2025-003', date: '19/07/2025', customer: 'Proyectos Globales', total: 1500.75, paymentMethod: 'Transferencia', status: 'Pendiente' },
    { id: 'V-2025-004', date: '18/07/2025', customer: 'Juan Rodríguez', total: 75.00, paymentMethod: 'Efectivo', status: 'Cancelada' },
  ]);

  getStatusClass(status: Sale['status']): string {
    switch (status) {
      case 'Completada': return 'status-completed';
      case 'Pendiente': return 'status-pending';
      case 'Cancelada': return 'status-cancelled';
    }
  }
}