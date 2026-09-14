import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft, Edit, Send, Trash2 } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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
import { DocumentShellComponent, DocumentTone } from '../../../shared/components/gestures';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';

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
  imports: [RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, DocumentShellComponent],
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
  private readonly translate = inject(TranslateService);
  private readonly accountsPayable = inject(AccountsPayableService);
  private readonly notifications = inject(NotificationService);
  /** Optional: the page is also reachable through the router outlet, where there is no tab. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

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
            this.handleError('accounts_payable.detail.bill_not_found');
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
          this.handleError('accounts_payable.detail.supplier_bill_could_not_loaded');
          return EMPTY;
        }),
      )
      .subscribe(({ bill, payments }) => {
        this.bill.set(bill);
        //  Ya se conoce el NCF: la pestaña deja de llamarse por el UUID de la ruta.
        this.tab?.setTitle(this.documentTitle(bill));
        this.payments.set(payments);
        this.errorKey.set(null);
        this.isLoading.set(false);
      });
  }

  async submitForApproval(): Promise<void> {
    const id = this.bill()?.id;
    if (!id) return;

    const confirmed = await this.dialog.confirm({
      title: 'dialog.submit_bill.title',
      message: 'dialog.submit_bill.message',
    });
    if (!confirmed) return;

    this.isLoading.set(true);
    this.accountsPayable.submitForApproval(id).subscribe({
      next: () => {
        this.notifications.showSuccess('accounts_payable.detail.bill_submitted_approval');
        this.load();
      },
      error: (error: unknown) => {
        this.notifications.showError(
          serverMessage(error) ?? 'accounts_payable.detail.bill_could_not_submitted_approval',
        );
        this.isLoading.set(false);
      },
    });
  }

  async voidBill(): Promise<void> {
    const id = this.bill()?.id;
    if (!id) return;

    const reason = await this.dialog.prompt({
      title: 'dialog.void_bill.title',
      message: 'dialog.void_bill.message',
      placeholder: 'dialog.void_bill.reason_voiding',
      minLength: 10,
      tooShort: 'dialog.void_bill.too_short',
      variant: 'danger',
    });
    if (!reason) return;

    this.isLoading.set(true);
    this.accountsPayable.voidBill(id, reason).subscribe({
      next: () => {
        this.notifications.showSuccess('accounts_payable.detail.invoice_voided');
        this.load();
      },
      error: (error: unknown) => {
        this.notifications.showError(
          serverMessage(error) ?? 'accounts_payable.detail.bill_could_not_annulled',
        );
        this.isLoading.set(false);
      },
    });
  }

  statusKey(status: string): string {
    return `accounts_payable.status.${status}`;
  }

  /**
   * Cómo se pinta el estado en el encabezado. Semántico: dice si la factura admite trabajo.
   *
   * Estaba dentro de la ficha «Información general», junto a la fecha y la moneda, como un dato
   * más. No lo es: una factura anulada no se paga y una pendiente de aprobación no se contabiliza,
   * y eso condiciona los botones que hay al lado.
   */
  statusTone(status: string): DocumentTone {
    switch (status) {
      case 'PAID':
        return 'ok';
      case 'OPEN':
      case 'PARTIALLY_PAID':
        return 'neutral';
      case 'PENDING_APPROVAL':
        return 'warning';
      case 'VOID':
      case 'REJECTED':
        return 'danger';
      case 'DRAFT':
        return 'draft';
      default:
        return 'neutral';
    }
  }

  /** Nombre del documento, ya compuesto: el armazón lo pone junto al estado. */
  documentTitle(bill: VendorBill): string {
    const ncf = bill.ncf || this.translate.instant('accounts_payable.list.no_fiscal_number');
    return `${this.translate.instant('accounts_payable.detail.supplier_bill')} ${ncf}`;
  }

  goToList(): void {
    void this.router.navigate(['/accounts-payable']);
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
