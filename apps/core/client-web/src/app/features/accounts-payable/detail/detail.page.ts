import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft, Edit, Send, Trash2 } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import {
  AccountsPayableService,
  VendorBill,
  VendorPayment,
} from '../../../core/services/accounts-payable';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';

/**
 * A supplier bill, in full.
 *
 * ## What was here
 *
 * A header printing `billNumber` and `vendorName` — neither of which the API has ever returned —
 * and, where the lines belong, a paragraph reading "this section will be implemented here". So the
 * page showed a blank title, a blank supplier, blank dates, and no lines: everything a person opens
 * a bill to look at.
 *
 * It now shows what the document actually holds, including the fiscal breakdown the ledger entry is
 * built from and the payments applied against it, and it can submit for approval as well as annul —
 * the submit route existed on the server with nothing calling it.
 */
@Component({
  selector: 'app-vendor-bill-detail-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './detail.page.html',
  styleUrls: ['./detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorBillDetailPage implements OnInit {
  protected readonly BackIcon = ChevronLeft;
  protected readonly EditIcon = Edit;
  protected readonly SubmitIcon = Send;
  protected readonly VoidIcon = Trash2;

  private readonly dialog = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountsPayable = inject(AccountsPayableService);
  private readonly notifications = inject(NotificationService);

  readonly bill = signal<VendorBill | null>(null);
  readonly payments = signal<VendorPayment[]>([]);
  readonly isLoading = signal(true);
  readonly errorKey = signal<string | null>(null);

  /** Only a draft can be edited or submitted; only an unpaid bill can be annulled. */
  readonly canEdit = computed(() => this.bill()?.status === 'DRAFT');
  readonly canSubmit = computed(() => this.bill()?.status === 'DRAFT');
  readonly canVoid = computed(() => {
    const status = this.bill()?.status;
    return status !== undefined && status !== 'VOID' && this.payments().length === 0;
  });

  readonly withheldTotal = computed(() => {
    const bill = this.bill();
    if (!bill) return 0;
    return round2(bill.taxWithheld + bill.incomeTaxWithheld);
  });

  readonly hasFiscalDetail = computed(() => {
    const bill = this.bill();
    if (!bill) return false;
    return (
      bill.taxAmount > 0 ||
      bill.taxWithheld > 0 ||
      bill.incomeTaxWithheld > 0 ||
      bill.taxToCost > 0 ||
      bill.taxProportional > 0 ||
      bill.exciseAmount > 0 ||
      bill.otherTaxes > 0 ||
      bill.serviceCharge > 0
    );
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.route.paramMap
      .pipe(
        switchMap((params) => {
          const id = params.get('id');
          if (!id) {
            this.handleError('ACCOUNTS_PAYABLE.DETAIL.FACTURA_NO_ENCONTRADA');
            return EMPTY;
          }
          this.isLoading.set(true);
          return forkJoin({
            bill: this.accountsPayable.getVendorBillById(id),
            // A bill with payments cannot be annulled, and the payments are worth seeing anyway.
            // A failure here must not take the whole page down with it.
            payments: this.accountsPayable
              .listPayments(id)
              .pipe(catchError(() => of([] as VendorPayment[]))),
          });
        }),
        catchError(() => {
          this.handleError('ACCOUNTS_PAYABLE.DETAIL.ERROR_CARGAR_FACTURA');
          return EMPTY;
        }),
      )
      .subscribe(({ bill, payments }) => {
        this.bill.set(bill);
        this.payments.set(payments);
        this.errorKey.set(null);
        this.isLoading.set(false);
      });
  }

  async submitForApproval(): Promise<void> {
    const id = this.bill()?.id;
    if (!id) return;

    const confirmed = await this.dialog.confirm({
      title: 'DIALOG.SUBMIT_BILL.TITLE',
      message: 'DIALOG.SUBMIT_BILL.MESSAGE',
    });
    if (!confirmed) return;

    this.isLoading.set(true);
    this.accountsPayable.submitForApproval(id).subscribe({
      next: () => {
        this.notifications.showSuccess('ACCOUNTS_PAYABLE.DETAIL.FACTURA_ENVIADA_APROBACION');
        this.load();
      },
      error: (error: unknown) => {
        this.notifications.showError(
          serverMessage(error) ?? 'ACCOUNTS_PAYABLE.DETAIL.ERROR_ENVIAR_APROBACION',
        );
        this.isLoading.set(false);
      },
    });
  }

  async voidBill(): Promise<void> {
    const id = this.bill()?.id;
    if (!id) return;

    const reason = await this.dialog.prompt({
      title: 'DIALOG.VOID_BILL.TITLE',
      message: 'DIALOG.VOID_BILL.MESSAGE',
      placeholder: 'DIALOG.VOID_BILL.PLACEHOLDER',
      minLength: 10,
      tooShort: 'DIALOG.VOID_BILL.TOO_SHORT',
      variant: 'danger',
    });
    if (!reason) return;

    this.isLoading.set(true);
    this.accountsPayable.voidBill(id, reason).subscribe({
      next: () => {
        this.notifications.showSuccess('ACCOUNTS_PAYABLE.DETAIL.FACTURA_ANULADA_EXITO');
        this.load();
      },
      error: (error: unknown) => {
        this.notifications.showError(
          serverMessage(error) ?? 'ACCOUNTS_PAYABLE.DETAIL.ERROR_ANULAR_FACTURA',
        );
        this.isLoading.set(false);
      },
    });
  }

  statusKey(status: string): string {
    return `ACCOUNTS_PAYABLE.STATUS.${status}`;
  }

  statusClass(status: string): string {
    switch (status) {
      case 'PAID':
        return 'status-badge--success';
      case 'OPEN':
      case 'PARTIALLY_PAID':
        return 'status-badge--info';
      case 'PENDING_APPROVAL':
        return 'status-badge--warning';
      case 'VOID':
      case 'REJECTED':
        return 'status-badge--danger';
      default:
        return 'status-badge--neutral';
    }
  }

  private handleError(key: string): void {
    this.errorKey.set(key);
    this.isLoading.set(false);
  }

  backToList(): void {
    this.router.navigate(['/accounts-payable']);
  }
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function serverMessage(error: unknown): string | null {
  const body = (error as { error?: { messageKey?: string; message?: string | string[] } })?.error;
  if (!body) return null;
  if (body.messageKey) return body.messageKey;
  if (Array.isArray(body.message)) return body.message.join(' · ');
  return body.message ?? null;
}
