import { Component, ChangeDetectionStrategy, Input, signal, inject, OnInit, effect, computed } from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe, Location } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { DialogService } from '../../../core/services/dialog.service';
import { FormsModule } from '@angular/forms';
// Se importa ActivatedRoute para acceder a los parámetros de la URL.
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Invoice, InvoicesService, InvoiceStatus, PaymentMethod } from '../../../core/services/invoices';
import { EinvoicingService, EcfSubmissionView } from '../../../core/services/einvoicing';
import { NotificationService } from '../../../core/services/notification';
import { InvoiceToolbarComponent } from '../components/invoice-toolbar/invoice-toolbar.component';
import { QRCodeComponent } from 'angularx-qrcode';
import { asBlob } from 'html-docx-js-typescript';
import { saveAs } from 'file-saver';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth';

@Component({
  selector: 'app-invoice-detail-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, DecimalPipe, DatePipe, InvoiceToolbarComponent, FormsModule, // The QR is the element the norm requires on the printed representation; the page used to show
    // a text link instead, while `angularx-qrcode` was already a dependency of the project.
    QRCodeComponent, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './detail.page.html',
  styleUrls: ['./detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceDetailPage implements OnInit {
  private readonly translate = inject(TranslateService);
  private readonly dialog = inject(DialogService);
  private invoicesService = inject(InvoicesService);
  private einvoicingService = inject(EinvoicingService);
  private notificationService = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private readonly auth = inject(AuthService);

  /**
   * The issuer shown on the printed preview: the signed-in tenant, not a constant.
   *
   * The header used to be four catalogue keys holding a made-up company — "VIRTEEX ERP", "Calle
   * Principal #123", "RNC: 1-31-12345-6" — which meant every customer's on-screen invoice named
   * somebody else's business, and those five lines of sample data were queued for translation into
   * three languages. The address and phone are not on `OrganizationContract`, so they are simply
   * not shown here; the server-rendered PDF, which is the fiscal representation, carries them.
   */
  readonly issuer = computed(() => this.auth.currentUser()?.organization ?? null);

  /**
   * The stored status becomes a catalogue key.
   *
   * `InvoiceStatus` is a set of English stored values — `'Partially Paid'`, `'Credit Note'` — and
   * the badge printed them straight through, so a Spanish screen said "Partially Paid" and the
   * CSS class was built by lowercasing and replacing spaces in the same string. Both now go
   * through a lookup, which also means a status the client has not been taught about is visible
   * rather than silently styled as something else.
   */
  statusKey(status: InvoiceStatus): string {
    const keys: Record<InvoiceStatus, string> = {
      Draft: 'INVOICES.STATUS.DRAFT',
      Pending: 'INVOICES.STATUS.PENDING',
      Paid: 'INVOICES.STATUS.PAID',
      'Partially Paid': 'INVOICES.STATUS.PARTIALLY_PAID',
      Void: 'INVOICES.STATUS.VOID',
      'Credit Note': 'INVOICES.STATUS.CREDIT_NOTE',
    };
    return keys[status] ?? status;
  }

  statusClass(status: InvoiceStatus): string {
    return status.toLowerCase().replace(/\s+/g, '-');
  }

  paymentMethodKey(method: PaymentMethod | null | undefined): string {
    return method ? `INVOICES.PAYMENT_METHOD.${method}` : 'COMMON.NOT_RECORDED';
  }

  /**
   * The rate the document actually carries, derived rather than assumed.
   *
   * The panel used to read "ITBIS (18%)" on every invoice — the Dominican general rate, printed
   * for a Mexican tenant at 16 %, for a zero-rated export, and for an exempt line alike. Tax over
   * the taxed base is the one figure that is true for whatever mix of rates the lines carry.
   */
  effectiveTaxRate(invoice: Invoice): number {
    const base = Number(invoice.taxedTotal ?? 0);
    if (!base) return 0;
    return Number(invoice.tax ?? 0) / base;
  }

  id = signal('');
  /**
   * Bound by the router's `withComponentInputBinding()`, which matches the route parameter name.
   * Renaming the input (`@Input('id') set idInput`) hid which parameter it came from at every use
   * site; naming the setter `id`… would collide with the signal, so the signal keeps the name and
   * the setter takes the route value.
   */
  @Input() set idParam(val: string) { this.id.set(val); }

  invoice = signal<Invoice | undefined>(undefined);
  ecf = signal<EcfSubmissionView | null>(null);
  ecfBusy = signal(false);
  navigationIds = signal<{ first: string, prev: string, next: string, last: string } | null>(null);
  activeTab = signal<'content' | 'logistics' | 'finance'>('content');
  lineItemSearch = signal('');

  filteredLineItems = computed(() => {
    const items = this.invoice()?.lineItems || [];
    const search = this.lineItemSearch().toLowerCase();
    if (!search) return items;
    return items.filter(item =>
      item.description.toLowerCase().includes(search) ||
      item.productId?.toLowerCase().includes(search)
    );
  });

  constructor() {
    effect(() => {
        const currentId = this.id();
        if (currentId) {
            this.loadInvoice();
            this.loadNavigation();
        }
    });
  }

  ngOnInit(): void {
    this.route.params.subscribe(params => {
        if (params['id']) {
            this.id.set(params['id']);
        }
    });
  }

  loadInvoice(): void {
    this.invoicesService.getInvoiceById(this.id()).subscribe({
        next: (data) => {
            this.invoice.set(data);
            this.ecf.set(null);
            // Electronic e-NCF (E-series) documents carry a DGII e-CF lifecycle.
            if (data.ncfNumber?.startsWith('E')) {
                this.loadEcfStatus();
            }
        },
        error: (err) => {
            this.notificationService.showError('INVOICES.DETAIL.PUDO_CARGAR_FACTURA');
            console.error(err);
        }
    });
  }

  loadEcfStatus(): void {
    this.einvoicingService.getInvoiceStatus(this.id()).subscribe({
        next: (status) => this.ecf.set(status),
        // 404 simply means no e-CF was generated for this document yet.
        error: () => this.ecf.set(null),
    });
  }

  resubmitEcf(): void {
    this.ecfBusy.set(true);
    this.einvoicingService.submitInvoice(this.id()).subscribe({
        next: (status) => {
            this.ecf.set(status);
            this.ecfBusy.set(false);
            this.notificationService.showSuccess('INVOICES.DETAIL.CF_REENVIADO_DGII');
        },
        error: (err) => {
            this.ecfBusy.set(false);
            this.notificationService.showError(err?.error?.message || 'ERRORS.RESEND_ECF');
        }
    });
  }

  downloadEcfXml(): void {
    this.einvoicingService.downloadXml(this.id()).subscribe({
        next: (blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.ecf()?.ncf || 'ecf'}.xml`;
            a.click();
            URL.revokeObjectURL(url);
        },
        error: () => this.notificationService.showError('INVOICES.DETAIL.HAY_XML_FIRMADO_DISPONIBLE'),
    });
  }

  ecfStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        PENDING: 'Pendiente',
        SIGNED: 'Firmado',
        SENT: 'Enviado (en proceso)',
        ACCEPTED: 'Aceptado',
        ACCEPTED_WITH_OBSERVATIONS: 'Aceptado condicional',
        REJECTED: 'Rechazado',
        CONTINGENCY: 'En contingencia',
        ERROR: 'Error',
    };
    return labels[status] || status;
  }

  /**
   * Previous / next across the tenant's documents.
   *
   * It used to download EVERY invoice of the tenant, sort them client-side and read the neighbours
   * out of the array — a full-table request on each document opened. One page of fifty, ordered by
   * the server, gives the same navigation for a fraction of the cost.
   */
  loadNavigation(): void {
    this.invoicesService.getInvoices({ limit: 50 }).subscribe((result) => {
      const ids = result.items.map((invoice) => invoice.id);
      const index = ids.indexOf(this.id());
      if (index < 0) {
        this.navigationIds.set(null);
        return;
      }
      this.navigationIds.set({
        first: ids[0],
        prev: ids[index - 1] ?? ids[0],
        next: ids[index + 1] ?? ids[ids.length - 1],
        last: ids[ids.length - 1],
      });
    });
  }

  handleNavigate(direction: 'first' | 'prev' | 'next' | 'last'): void {
    const nav = this.navigationIds();
    if (nav && nav[direction]) {
        this.router.navigate(['/invoices', nav[direction]]);
    }
  }
  
  printInvoice(): void {
    window.print();
  }

  handleExport(format: 'pdf' | 'word' | 'excel'): void {
    if (format === 'pdf') {
        this.downloadPdf();
    } else if (format === 'word') {
        this.downloadWord();
    } else {
        this.notificationService.showInfo('INVOICES.DETAIL.EXPORTACION_ESTARA_DISPONIBLE_PROXIMAMENTE', { toUpperCase: format.toUpperCase() });
    }
  }

  downloadPdf(): void {
    this.invoicesService.downloadInvoicePdf(this.id()).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `factura-${this.invoice()?.invoiceNumber}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      },
      error: () => {
        this.notificationService.showError('INVOICES.DETAIL.PUDO_DESCARGAR_PDF_FACTURA');
      }
    });
  }

  async downloadWord(): Promise<void> {
    const element = document.querySelector('.invoice-document');
    if (element) {
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <title>Factura</title>
              <style>
                body { font-family: sans-serif; }
                .invoice-header { display: flex; justify-content: space-between; margin-bottom: 20px; }
                .line-items-table { width: 100%; border-collapse: collapse; }
                .line-items-table th, .line-items-table td { border-bottom: 1px solid #ddd; padding: 8px; } /* Hoja de impresión: tinta sobre papel, independiente del tema */
                .text-right { text-align: right; }
                .summary-totals { margin-top: 20px; float: right; width: 250px; }
              </style>
            </head>
            <body>
              ${element.innerHTML}
            </body>
          </html>
        `;
        const blob = await asBlob(html);
        saveAs(blob as Blob, `factura-${this.invoice()?.invoiceNumber}.docx`);
        this.notificationService.showSuccess('INVOICES.DETAIL.DOCUMENTO_WORD_GENERADO_EXITO');
    }
  }

  handleCopyFrom(): void {
    this.notificationService.showInfo('INVOICES.DETAIL.FUNCION_COPIAR_ABIERTA_SELECCIONE_DOCUMENTO_BASE');
  }

  handleCopyTo(): void {
    this.notificationService.showInfo('INVOICES.DETAIL.COPIANDO_DOCUMENTO_ACTUAL_NUEVO_BORRADOR');
    // Lógica para navegar a /new con el ID actual como base
    this.router.navigate(['/invoices/new'], { queryParams: { copyFrom: this.id() } });
  }

  goBack(): void {
    this.location.back();
  }

  goForward(): void {
    this.location.forward();
  }

  /** Issue a draft: assigns the e-NCF, posts the ledger entry and transmits the comprobante. */
  issue(): void {
    const invoice = this.invoice();
    if (!invoice) return;
    this.ecfBusy.set(true);
    this.invoicesService.issue(invoice.id).subscribe({
      next: (issued) => {
        this.ecfBusy.set(false);
        this.notificationService.showSuccess(
          `Documento emitido con el comprobante ${issued.ncfNumber ?? issued.invoiceNumber}.`,
        );
        this.loadInvoice();
      },
      error: (err) => {
        this.ecfBusy.set(false);
        this.notificationService.showError(err?.error?.message || 'ERRORS.ISSUE_DOCUMENT');
      },
    });
  }

  /** Discard a draft. It consumed no fiscal numbering, so nothing has to be declared. */
  async discardDraft(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) return;
    const confirmed = await this.dialog.confirm({
      title: 'DIALOG.DELETE_INVOICE_DRAFT.TITLE',
      message: 'DIALOG.DELETE_INVOICE_DRAFT.MESSAGE',
      messageParams: { number: invoice.invoiceNumber },
      confirmText: 'COMMON.DELETE',
      variant: 'danger',
    });
    if (!confirmed) return;

    this.invoicesService.discardDraft(invoice.id).subscribe({
      next: () => {
        this.notificationService.showSuccess('INVOICES.DETAIL.BORRADOR_ELIMINADO');
        this.router.navigate(['/invoices']);
      },
      error: (err) =>
        this.notificationService.showError(err?.error?.message || 'ERRORS.DELETE_DRAFT'),
    });
  }

  createCreditNote(invoiceId: string): void {
      const reason = prompt(
        'Motivo de la nota de crédito (se imprime en el comprobante y determina el código de modificación):',
      );
      if (reason === null) return;

      this.invoicesService.createCreditNote(invoiceId, { reason: reason || undefined }).subscribe({
        next: (note) => {
          this.notificationService.showSuccess(
            `Nota de crédito ${note.ncfNumber ?? note.invoiceNumber} emitida.`,
          );
          this.loadInvoice();
        },
        error: (err) =>
          this.notificationService.showError(
            err?.error?.message || this.translate.instant('ERRORS.ISSUE_CREDIT_NOTE'),
          ),
      });
  }
}