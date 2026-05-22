import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, FileDown } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

// Interfaz para definir la estructura de una Orden de Compra
interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierName: string;
  orderDate: string;
  total: number;
  status: 'Draft' | 'Pending Approval' | 'Approved' | 'Sent';
}

@Component({
  selector: 'app-orders-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, TranslateModule],
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdersPage {
  // Íconos para la plantilla
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly FileDownIcon = FileDown;

  // Datos simulados para la demostración
  orders = signal<PurchaseOrder[]>([
    { id: '1', poNumber: 'PO-2025-001', supplierName: 'OfiSuministros SRL', orderDate: 'Jul 28, 2025', total: 1250.00, status: 'Sent' },
    { id: '2', poNumber: 'PO-2025-002', supplierName: 'TecnoImportaciones', orderDate: 'Jul 25, 2025', total: 2500.00, status: 'Approved' },
    { id: '3', poNumber: 'PO-2025-003', supplierName: 'Soluciones Gráficas', orderDate: 'Jul 24, 2025', total: 450.75, status: 'Pending Approval' },
    { id: '4', poNumber: 'PO-2025-004', supplierName: 'OfiSuministros SRL', orderDate: 'Jul 22, 2025', total: 300.00, status: 'Draft' },
  ]);

  /**
   * Determina la clase CSS para el estado de la orden.
   * @param status El estado actual de la orden.
   * @returns Una clase de CSS para el estilo del badge.
   */
  getStatusClass(status: PurchaseOrder['status']): string {
    switch (status) {
      case 'Sent': return 'status-sent';
      case 'Approved': return 'status-approved';
      case 'Pending Approval': return 'status-pending';
      case 'Draft': return 'status-draft';
    }
  }
}