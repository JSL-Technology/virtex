import { Component, ChangeDetectionStrategy, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Search, X } from 'lucide-angular';
import { InvoicesService, Invoice } from '../../../../core/services/invoices';

@Component({
  selector: 'app-invoice-selection-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './invoice-selection-dialog.component.html',
  styleUrls: ['./invoice-selection-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceSelectionDialogComponent implements OnInit {
  private invoicesService = inject(InvoicesService);

  protected readonly SearchIcon = Search;
  protected readonly CloseIcon = X;

  invoices = signal<Invoice[]>([]);
  isLoading = signal(true);
  searchTerm = signal('');

  // The dialog will be controlled by a parent via a modal service or direct @Output
  // For simplicity here, we'll assume a pattern where we can close it.
  isOpen = signal(false);
  onSelect = signal<((invoice: Invoice) => void) | null>(null);

  filteredInvoices = computed(() => {
    const search = this.searchTerm().toLowerCase();
    if (!search) return this.invoices();
    return this.invoices().filter(inv =>
      inv.invoiceNumber.toLowerCase().includes(search) ||
      inv.customerName.toLowerCase().includes(search)
    );
  });

  ngOnInit(): void {
    this.loadInvoices();
  }

  loadInvoices(): void {
    this.invoicesService.getInvoices().subscribe({
      next: (data) => {
        this.invoices.set(data);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false)
    });
  }

  open(callback: (invoice: Invoice) => void): void {
    this.onSelect.set(() => callback);
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  selectInvoice(invoice: Invoice): void {
    const callback = this.onSelect();
    if (callback) {
      callback(invoice);
    }
    this.close();
  }
}
