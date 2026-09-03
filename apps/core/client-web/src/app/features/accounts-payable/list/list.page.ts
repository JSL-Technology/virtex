import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, MoreHorizontal } from 'lucide-angular';
import { AccountsPayableService, VendorBill } from '../../../core/services/accounts-payable';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';

@Component({
  selector: 'app-vendor-bills-list-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorBillsListPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;
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

  /**
   * The stored status becomes a catalogue key.
   *
   * The switch below compared against `'Paid'`, `'Approved'`, `'Submitted'` and `'Void'` — five
   * title-case words the server has never sent, since the enum is uppercase. Every bill therefore
   * fell through to `status-draft`, and the badge printed the raw enum member next to it.
   */
  statusKey(status: VendorBill['status']): string {
    return `ACCOUNTS_PAYABLE.STATUS.${status}`;
  }

  getStatusClass(status: VendorBill['status']): string {
    switch (status) {
      case 'PAID': return 'status-paid';
      case 'PARTIALLY_PAID': return 'status-approved';
      case 'OPEN': return 'status-approved';
      case 'PENDING_APPROVAL': return 'status-pending';
      case 'VOID':
      case 'REJECTED': return 'status-overdue';
      default: return 'status-draft';
    }
  }
}
