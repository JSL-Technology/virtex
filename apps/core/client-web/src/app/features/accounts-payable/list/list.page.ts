import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, MoreHorizontal } from 'lucide-angular';
import { AccountsPayableService, VendorBill } from '../../../core/services/accounts-payable';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxAmountComponent } from '../../../shared/components/amount';

@Component({
  selector: 'app-vendor-bills-list-page',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, VxAmountComponent],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorBillsListPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;

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
        this.error.set('accounts_payable.list.load_failed');
        this.notificationService.showError('accounts_payable.list.load_failed');
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
    return `accounts_payable.status.${status}`;
  }

  /**
   * What the state of a bill MEANS, which is the only thing a badge needs.
   *
   * It used to return a CSS class, and the five classes it returned were not five colours: `PAID`
   * and `OPEN` both rendered green-ish through `.status-paid` / `.status-approved` defined in
   * this page's own stylesheet. The tone says the thing directly — settled, in progress, waiting,
   * rejected — and one stylesheet gives each one its colour for the whole product.
   */
  statusTone(status: VendorBill['status']): VxTone {
    switch (status) {
      case 'PAID':
        return 'ok';
      case 'PARTIALLY_PAID':
      case 'OPEN':
        return 'info';
      case 'PENDING_APPROVAL':
        return 'warning';
      case 'VOID':
      case 'REJECTED':
        return 'danger';
      default:
        return 'draft';
    }
  }

  /** Anulada o rechazada: la factura existe y ya no cuenta. */
  isVoid(status: VendorBill['status']): boolean {
    return status === 'VOID' || status === 'REJECTED';
  }
}
