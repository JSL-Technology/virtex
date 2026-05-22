import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Check, X, FileText, ShoppingCart, Briefcase } from 'lucide-angular';

// Tipos de datos para la página
type ApprovalStatus = 'pending' | 'approved' | 'rejected';
type ApprovalType = 'invoices' | 'expenses' | 'purchase-orders';

interface ApprovalItem {
  id: string;
  requester: string;
  date: string;
  description: string;
  amount: number;
  status: ApprovalStatus;
  link: string;
}

@Component({
  selector: 'app-approvals-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './approvals.page.html',
  styleUrls: ['./approvals.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalsPage {
  // Íconos
  protected readonly ApproveIcon = Check;
  protected readonly RejectIcon = X;
  protected readonly InvoiceIcon = FileText;
  protected readonly ExpenseIcon = Briefcase;
  protected readonly POIcon = ShoppingCart;

  activeTab = signal<ApprovalType>('invoices');

  // Datos simulados
  pendingInvoices = signal<ApprovalItem[]>([
    { id: 'INV-A-01', requester: 'Ana Pérez', date: 'Jul 25, 2025', description: 'Factura de proveedor "OfiSuministros"', amount: 1250.00, status: 'pending', link: '/payables/bills/1' },
  ]);
  pendingExpenses = signal<ApprovalItem[]>([
    { id: 'EXP-A-01', requester: 'Carlos López', date: 'Jul 24, 2025', description: 'Reporte de gastos de viaje a Santiago', amount: 350.75, status: 'pending', link: '/expenses/reports/1' },
  ]);
  pendingPOs = signal<ApprovalItem[]>([]);

  setActiveTab(tab: ApprovalType): void {
    this.activeTab.set(tab);
  }

  approveItem(itemId: string, type: ApprovalType): void {
    console.log(`Approving ${type} item with ID: ${itemId}`);
    // Aquí iría la lógica para llamar al servicio y actualizar el estado
  }

  rejectItem(itemId: string, type: ApprovalType): void {
    console.log(`Rejecting ${type} item with ID: ${itemId}`);
    // Aquí iría la lógica para llamar al servicio y actualizar el estado
  }
}