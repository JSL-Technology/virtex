import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Banknote, LucideAngularModule } from 'lucide-angular';
import { Observable } from 'rxjs';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxPagerComponent } from '../../../shared/components/pager';
import { VX_SELECT } from '../../../shared/components/select';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { NotificationService } from '../../../core/services/notification';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { SuppliersService } from '../../../core/api/suppliers.service';
import { Supplier } from '../../../core/models/supplier.model';
import { BankAccount, TreasuryService } from '../../../core/api/treasury.service';
import {
  AccountsPayableService,
  PaymentBatchStatus,
  VendorPaymentRow,
} from '../../../core/services/accounts-payable';

export const PAYMENT_TONE: Record<PaymentBatchStatus, VxTone> = {
  PENDING: 'draft',
  PROCESSING: 'info',
  PAID: 'ok',
  VOID: 'neutral',
};

/**
 * Payments to suppliers (audit H-14): the list Odoo calls *Payments*, NetSuite *Bill Payments*,
 * SAP *Manage Outgoing Payments* — what left which account, on which day, for whom. The menu used
 * to open straight onto the form, so a payment once made could not be found again.
 */
@Component({
  selector: 'app-vendor-payments-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslateModule,
    LucideAngularModule,
    ...FORMAT_PIPES,
    ...VX_SELECT,
    ListShellComponent,
    VxBadgeComponent,
    VxPagerComponent,
    VxAmountComponent,
    VxBranchPickerComponent,
    VxBranchLabelComponent,
    HasPermissionDirective,
    RowLinkDirective,
  ],
  templateUrl: './payments.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorPaymentsPage implements OnInit {
  private readonly payables = inject(AccountsPayableService);
  private readonly suppliersApi = inject(SuppliersService);
  private readonly treasury = inject(TreasuryService);
  private readonly notifications = inject(NotificationService);
  protected readonly branches = inject(BranchesService);

  protected readonly PayIcon = Banknote;
  protected readonly tones = PAYMENT_TONE;

  readonly rows = signal<VendorPaymentRow[]>([]);
  readonly bankAccounts = signal<BankAccount[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(50);
  readonly supplierFilter = signal<string | null>(null);
  readonly bankAccountFilter = signal('');
  readonly statusFilter = signal<PaymentBatchStatus | ''>('');
  readonly branchFilter = signal<string | null>(null);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  protected readonly searchSuppliers = (query: string, limit: number): Observable<Supplier[]> =>
    this.suppliersApi.searchSuppliers(query, limit);
  protected readonly resolveSupplier = (id: string): Observable<Supplier> => this.suppliersApi.getSupplierById(id);
  protected readonly supplierName = (supplier: Supplier): string => supplier.name;
  protected readonly supplierId = (supplier: Supplier): string => supplier.id;

  ngOnInit(): void {
    this.treasury.listBankAccounts().subscribe({
      next: (accounts) => this.bankAccounts.set(accounts),
      error: () => this.bankAccounts.set([]),
    });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.payables
      .payments({
        supplierId: this.supplierFilter(),
        bankAccountId: this.bankAccountFilter() || null,
        status: this.statusFilter() || null,
        branchId: this.branchFilter(),
        page: this.page(),
        limit: this.limit(),
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.notifications.httpErrorMessage(error, 'accounts_payable.payments.load_failed'));
          this.loading.set(false);
        },
      });
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  changePageSize(size: number): void {
    this.limit.set(size);
    this.applyFilters();
  }
}
