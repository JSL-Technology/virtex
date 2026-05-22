import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal } from 'lucide-angular';
import { AccountsPayableService, VendorBill } from '../../../core/services/accounts-payable';
import { NotificationService } from '../../../core/services/notification';

@Component({
  selector: 'app-vendor-bills-list-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorBillsListPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  private accountsPayableService = inject(AccountsPayableService);
  private notificationService = inject(NotificationService);

  vendorBills = signal<VendorBill[]>([]);
  isLoading = signal(true);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadVendorBills();
  }

  loadVendorBills(): void {
    this.isLoading.set(true);
    this.error.set(null);
    this.accountsPayableService.getVendorBills().subscribe({
      next: (data) => {
        this.vendorBills.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set('Could not load vendor bills. Please try again later.');
        this.notificationService.showError(this.error()!);
        this.isLoading.set(false);
      },
    });
  }

  getStatusClass(status: VendorBill['status']): string {
    switch (status) {
      case 'Paid': return 'status-paid';
      case 'Approved': return 'status-approved';
      case 'Submitted': return 'status-pending';
      case 'Void': return 'status-overdue';
      default: return 'status-draft';
    }
  }
}
