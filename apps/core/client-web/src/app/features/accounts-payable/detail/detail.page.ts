import { handleDocumentIntents } from '../../../core/navigation/document-intent.service';
import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Banknote, ChevronLeft, Edit, FileMinus, Send, Trash2 } from 'lucide-angular';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import {
  AccountsPayableService,
  VendorBill,
  VendorDebitNoteRow,
  VendorPayment,
} from '../../../core/services/accounts-payable';
import { CountryPackService } from '../../../core/api/country-pack.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { DocumentShellComponent, DocumentTone } from '../../../shared/components/gestures';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { refreshWhenStale } from '../../../core/data/data-version.service';
import { AiProvenanceBadgeComponent } from '../../ai/provenance/ai-provenance-badge.component';

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
  imports: [AiProvenanceBadgeComponent, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, DocumentShellComponent, HasPermissionDirective],
  templateUrl: './detail.page.html',
  styleUrls: ['./detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorBillDetailPage implements OnInit {
  /**
   * What a list row's menu asked of this document (QA R3-B08): the same methods its own buttons
   * run, once it has loaded, and only while its own rules still allow them.
   */
  private readonly documentIntents = handleDocumentIntents({
    route: () => (this.bill()?.id ? `/accounts-payable/${this.bill()!.id}` : null),
    ready: () => !!this.bill(),
    actions: {
      'submit': () => this.canSubmit() && this.submitForApproval(),
      'record-supplier-document': () => this.canRecordSupplierDocument() && this.recordSupplierDocument(),
      'void': () => this.canVoid() && this.voidBill(),
    },
  });

  protected readonly BackIcon = ChevronLeft;
  protected readonly EditIcon = Edit;
  protected readonly SubmitIcon = Send;
  protected readonly VoidIcon = Trash2;
  protected readonly PayIcon = Banknote;
  protected readonly DebitNoteIcon = FileMinus;

  private readonly dialog = inject(DialogService);
  /** What this company's market asks about a purchase (QA C-06): declared by the market, not here. */
  private readonly countryPack = inject(CountryPackService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly accountsPayable = inject(AccountsPayableService);
  private readonly notifications = inject(NotificationService);
  /** Optional: the page is also reachable through the router outlet, where there is no tab. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly bill = signal<VendorBill | null>(null);
  readonly payments = signal<VendorPayment[]>([]);
  readonly debitNotes = signal<VendorDebitNoteRow[]>([]);
  /** Payments still standing: a voided one gave back everything it settled. */
  readonly livePayments = computed(() => this.payments().filter((payment) => payment.paymentBatch?.status !== 'VOID'));
  /** What the bill still owes can be paid, or reduced by a note. */
  readonly isPayable = computed(() => {
    const bill = this.bill();
    return !!bill && (bill.status === 'OPEN' || bill.status === 'PARTIALLY_PAID') && bill.balance > 0;
  });
  readonly isLoading = signal(true);
  readonly errorKey = signal<string | null>(null);

  /** Only a draft can be edited or submitted; only an unpaid bill can be annulled. */
  readonly canEdit = computed(() => this.bill()?.status === 'DRAFT');
  readonly canSubmit = computed(() => this.bill()?.status === 'DRAFT');
  /** Held by the three-way match (CMP-01): released by someone other than the submitter. */
  readonly isOnHold = computed(() => this.bill()?.status === 'ON_HOLD');
  /**
   * A posted bill without the supplier's document number can still receive it — what a purchases
   * return asks for (QA R3-A04) — in whatever market the company is in.
   */
  readonly canRecordSupplierDocument = computed(() => {
    const bill = this.bill();
    return !!bill && !bill.supplierFiscalNumber && !['DRAFT', 'VOID', 'REJECTED'].includes(bill.status);
  });

  /**
   * What the market's authority asks about this purchase, answer by answer: the label it declares
   * and what the bill states, or nothing where it states nothing.
   *
   * A purchase the authority wants classified and that nobody classified cannot be filed, and the
   * return says so by name rather than filing a guess — so the answer is given here, at month end,
   * by whoever reconciles the return.
   */
  readonly fiscalAnswers = computed(() => {
    const recorded = this.bill()?.fiscalAttributes ?? {};
    return this.countryPack.purchaseFiscalFields().map((field) => {
      const code = recorded[field.key] ?? null;
      const option = field.options.find((entry) => entry.code === code);
      return {
        key: field.key,
        labelKey: field.labelKey,
        label: field.label,
        required: field.required,
        code,
        optionLabelKey: option?.labelKey ?? null,
        optionLabel: option?.label ?? code,
      };
    });
  });

  /** A purchase this market's authority wants classified, and nobody has. */
  readonly needsFiscalAnswer = computed(
    () => !!this.bill() && this.fiscalAnswers().some((answer) => answer.required && !answer.code),
  );

  /** The questions still unanswered, to put in front of whoever is reconciling the return. */
  readonly unansweredFields = computed(() => {
    const recorded = this.bill()?.fiscalAttributes ?? {};
    return this.countryPack.purchaseFiscalFields().filter((field) => field.type === 'select' && !recorded[field.key]);
  });
  readonly canVoid = computed(() => {
    const status = this.bill()?.status;
    return status !== undefined && status !== 'VOID' && this.livePayments().length === 0;
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

  /** Read-only: a payment or a debit note from another tab updates the bill on return (QA M-06). */
  private readonly refresh = refreshWhenStale(() => this.load());

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
            debitNotes: this.accountsPayable
              .debitNotes({ vendorBillId: id, limit: 200 })
              .pipe(catchError(() => of({ items: [] as VendorDebitNoteRow[] }))),
          });
        }),
        catchError(() => {
          this.handleError('accounts_payable.detail.supplier_bill_could_not_loaded');
          return EMPTY;
        }),
      )
      .subscribe(({ bill, payments, debitNotes }) => {
        this.debitNotes.set(debitNotes.items);
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

  async releaseMatchHold(): Promise<void> {
    const id = this.bill()?.id;
    if (!id) return;
    const reason = await this.dialog.prompt({
      title: 'accounts_payable.detail.release_hold_title',
      message: 'accounts_payable.detail.release_hold_message',
      placeholder: 'accounts_payable.detail.release_hold_placeholder',
      minLength: 5,
      tooShort: 'accounts_payable.detail.release_hold_too_short',
    });
    if (!reason) return;
    this.isLoading.set(true);
    this.accountsPayable.releaseMatchHold(id, reason.trim()).subscribe({
      next: () => {
        this.notifications.showSuccess('accounts_payable.detail.hold_released');
        this.load();
      },
      error: (error: unknown) => {
        this.notifications.showError(serverMessage(error) ?? 'accounts_payable.detail.hold_not_released');
        this.isLoading.set(false);
      },
    });
  }

  async recordSupplierDocument(): Promise<void> {
    const id = this.bill()?.id;
    if (!id) return;
    // No length is asked for here: how long the number is, and what shape it takes, is the
    // market's rule, and the server answers in that authority's name when it refuses one.
    const document = await this.dialog.prompt({
      title: 'accounts_payable.detail.record_document_title',
      message: 'accounts_payable.detail.record_document_message',
      // The shape to type is the market's own, so the example comes from the market's pack.
      messageParams: { example: this.countryPack.pack()?.documents.supplierDocumentExample ?? '' },
      placeholder: 'accounts_payable.detail.record_document_placeholder',
      minLength: 1,
      tooShort: 'accounts_payable.detail.record_document_too_short',
    });
    if (!document) return;
    this.accountsPayable.recordSupplierFiscalNumber(id, document.trim()).subscribe({
      next: () => {
        this.notifications.showSuccess('accounts_payable.detail.document_recorded');
        this.load();
      },
      error: (error: unknown) => {
        this.notifications.showError(serverMessage(error) ?? 'accounts_payable.detail.document_not_recorded');
      },
    });
  }

  /**
   * Answer one of the market's questions about this purchase, on a bill already posted.
   *
   * The answers travel as a whole — the server checks them against the market's own declaration and
   * refuses a key it does not ask for — so what is already recorded is sent with the new answer.
   */
  answerFiscalField(key: string, value: string): void {
    const bill = this.bill();
    if (!bill || !value) return;
    const answers = { ...(bill.fiscalAttributes ?? {}), [key]: value };
    this.accountsPayable.recordFiscalAttributes(bill.id, answers).subscribe({
      next: () => {
        this.notifications.showSuccess('accounts_payable.detail.fiscal_attributes_recorded');
        this.load();
      },
      error: (error: unknown) => {
        this.notifications.showError(serverMessage(error) ?? 'accounts_payable.detail.fiscal_attributes_not_recorded');
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
    const document = bill.supplierFiscalNumber || this.translate.instant('accounts_payable.list.no_fiscal_number');
    return `${this.translate.instant('accounts_payable.detail.supplier_bill')} ${document}`;
  }

  goToList(): void {
    void this.router.navigate(['/accounts-payable']);
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
