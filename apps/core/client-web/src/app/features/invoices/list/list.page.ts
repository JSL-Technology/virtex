import { Component, ChangeDetectionStrategy, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Search, Download, FileSpreadsheet, ArrowUp, ArrowDown } from 'lucide-angular';
import { InvoicesService, Invoice } from '../../../core/services/invoices';
import { NotificationService } from '../../../core/services/notification';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-invoices-list-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, FormsModule],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoicesListPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly SearchIcon = Search;
  protected readonly DownloadIcon = Download;
  protected readonly SpreadsheetIcon = FileSpreadsheet;
  protected readonly ArrowUpIcon = ArrowUp;
  protected readonly ArrowDownIcon = ArrowDown;

  private invoicesService = inject(InvoicesService);
  private notificationService = inject(NotificationService);

  invoices = signal<Invoice[]>([]);
  isLoading = signal(true);
  error = signal<string | null>(null);
  today = new Date().toISOString().split('T')[0];

  // Search and Filter State
  searchTerm = signal('');
  statusFilter = signal<string>('All');
  sortBy = signal<keyof Invoice | 'customerName'>('issueDate');
  sortDirection = signal<'asc' | 'desc'>('desc');

  filteredInvoices = computed(() => {
    let result = [...this.invoices()];

    // Search
    const search = this.searchTerm().toLowerCase();
    if (search) {
      result = result.filter(inv =>
        inv.invoiceNumber.toLowerCase().includes(search) ||
        inv.customerName.toLowerCase().includes(search)
      );
    }

    // Filter
    const status = this.statusFilter();
    if (status !== 'All') {
      result = result.filter(inv => inv.status === status);
    }

    // Sort
    const field = this.sortBy();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;

    result.sort((a, b) => {
      const aVal = a[field as keyof Invoice] ?? '';
      const bVal = b[field as keyof Invoice] ?? '';

      if (aVal < bVal) return -1 * direction;
      if (aVal > bVal) return 1 * direction;
      return 0;
    });

    return result;
  });

  ngOnInit(): void {
    this.loadInvoices();
  }

  loadInvoices(): void {
    this.isLoading.set(true);
    this.error.set(null);
    this.invoicesService.getInvoices().subscribe({
      next: (data) => {
        this.invoices.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set('Could not load invoices. Please try again later.');
        this.notificationService.showError(this.error()!);
        this.isLoading.set(false);
      },
    });
  }

  getStatusClass(status: Invoice['status']): string {
    switch (status) {
      case 'Paid': return 'status-paid';
      case 'Pending': return 'status-pending';
      case 'Partially Paid': return 'status-partial';
      case 'Void': return 'status-overdue';
      case 'Credit Note': return 'status-draft';
      default: return 'status-pending';
    }
  }

  toggleSort(field: keyof Invoice | 'customerName'): void {
    if (this.sortBy() === field) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortBy.set(field);
      this.sortDirection.set('asc');
    }
  }

  exportToExcel(): void {
    const data = this.filteredInvoices().map(inv => ({
      'Factura #': inv.invoiceNumber,
      'NCF': inv.ncfNumber || '',
      'Cliente': inv.customerName,
      'Fecha Emisión': inv.issueDate,
      'Fecha Vencimiento': inv.dueDate,
      'Total': inv.total,
      'Moneda': inv.currencyCode,
      'Estado': inv.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Facturas');
    XLSX.writeFile(workbook, `Facturas_${new Date().toISOString().split('T')[0]}.xlsx`);
    this.notificationService.showSuccess('Exportación a Excel completada.');
  }
}