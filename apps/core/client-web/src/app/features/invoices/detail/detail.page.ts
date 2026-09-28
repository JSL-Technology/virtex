import { Component, ChangeDetectionStrategy, HostListener, Input, signal, inject, OnInit, effect, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { DialogService } from '../../../core/services/dialog.service';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import {
  invoiceStatusClass,
  invoiceStatusKey,
  invoiceStatusTone,
} from '../../../core/services/invoice-status';
import { FormsModule } from '@angular/forms';
// Se importa ActivatedRoute para acceder a los parámetros de la URL.
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { CreditNoteRequest, Invoice, InvoicesService, InvoiceStatus, PaymentMethod } from '../../../core/services/invoices';
import { EinvoicingService, EcfSubmissionView } from '../../../core/services/einvoicing';
import { NotificationService } from '../../../core/services/notification';
import { translateOrLiteral } from '@virteex/shared/ui-i18n';
import { InvoiceToolbarComponent } from '../components/invoice-toolbar/invoice-toolbar.component';
import { QRCodeComponent } from 'angularx-qrcode';
import { asBlob } from 'html-docx-js-typescript';
import { saveAs } from 'file-saver';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth';
import { DocumentShellComponent, DocumentTone } from '../../../shared/components/gestures';
import { TransitionPreviewComponent } from '../../../shared/components/transition-preview/transition-preview.component';
import { TransitionPreview } from '../../../shared/components/transition-preview/transition-preview.model';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxTabsComponent, VxTab } from '../../../shared/components/tabs';

@Component({
  selector: 'app-invoice-detail-page',
  standalone: true,
  imports: [TransitionPreviewComponent, CommonModule, LucideAngularModule, InvoiceToolbarComponent, FormsModule, // The QR is the element the norm requires on the printed representation; the page used to show
    // a text link instead, while `angularx-qrcode` was already a dependency of the project.
    QRCodeComponent, TranslateModule, ...FORMAT_PIPES, DocumentShellComponent,
    ...VX_FORM_A11Y, VxBadgeComponent, VxAmountComponent, VxTabsComponent],
  templateUrl: './detail.page.html',
  styleUrls: ['./detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceDetailPage implements OnInit {
  private readonly translate = inject(TranslateService);

  /**
   * What the DGII said, in the reader's language.
   *
   * The status endpoint answers with catalogue KEYS, like the rest of the API — it names failures
   * and does not word them. This list printed them raw, so a tenant whose e-CF was rejected read
   * `einvoicing.do.organization_has_no_rnc_configured_fill` on the document, while the catalogue
   * held the sentence it stands for: "The organization has no RNC configured. Fill it in under
   * Settings → Company." The one thing that message had to do — say what to fix — was the one
   * thing it did not do.
   *
   * `translateOrLiteral` rather than the pipe because a message may also arrive as the tax
   * authority's own prose, and prose must be printed, not looked up.
   */
  protected dgiiMessage(message: string): string {
    return translateOrLiteral(this.translate, message);
  }
  private readonly dialog = inject(DialogService);

  /** The preview being shown, or null when the dialog is closed. */
  readonly issuePreview = signal<TransitionPreview | null>(null);
  readonly previewBusy = signal(false);
  private invoicesService = inject(InvoicesService);
  private einvoicingService = inject(EinvoicingService);
  private notificationService = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private readonly auth = inject(AuthService);
  /**
   * Optional: this page is also reachable through the router outlet, where there is no tab to
   * rename. `optional: true` is what lets one component serve both mounts.
   */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

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
   * The status, as a catalogue key, a badge class and a tone.
   *
   * `InvoiceStatus` is a set of English stored values — `'Partially Paid'`, `'Credit Note'` — and
   * the badge printed them straight through, so a Spanish screen said "Partially Paid" and the CSS
   * class was built by lowercasing and replacing spaces in the same string. The three maps this
   * page kept now live in `core/services/invoice-status`, shared with the register and the
   * dashboard, because three copies of one table is three chances for them to disagree — and they
   * already had.
   */
  statusKey(status: InvoiceStatus): string {
    return invoiceStatusKey(status);
  }

  statusClass(status: InvoiceStatus): string {
    return invoiceStatusClass(status);
  }

  /**
   * Cómo se pinta el estado en el encabezado del documento.
   *
   * Semántico, no decorativo: el tono dice si el documento todavía admite trabajo. Una factura
   * emitida no se edita y una anulada no se cobra, y eso es lo primero que hay que saber al abrirla
   * — hasta ahora estaba dentro de la pestaña «Finanzas», a dos clics de la pregunta.
   */
  statusTone(status: InvoiceStatus): DocumentTone {
    return invoiceStatusTone(status);
  }

  /** Nombre del documento, ya compuesto: es lo que el armazón pone junto al estado. */
  documentTitle(invoice: Invoice): string {
    const key =
      invoice.type === 'CREDIT_NOTE'
        ? 'invoices.detail.credit_note'
        : 'invoices.detail.sales_invoice';
    return `${this.translate.instant(key)} #${invoice.invoiceNumber}`;
  }

  paymentMethodKey(method: PaymentMethod | null | undefined): string {
    return method ? `invoices.payment_method.${method}` : 'common.not_recorded';
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

  /** Las secciones del documento, como datos: `vx-tabs` las dibuja. */
  protected readonly TABS: VxTab[] = [
    { id: 'content', labelKey: 'invoices.detail.content' },
    { id: 'logistics', labelKey: 'invoices.detail.logistics' },
    { id: 'finance', labelKey: 'invoices.detail.finance' },
  ];
  lineItemSearch = signal('');
  @ViewChild('lineSearch') private lineSearch?: ElementRef<HTMLInputElement>;

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
            //  La pestaña se abrió con el UUID en la URL y el título estático del manifiesto;
            //  ahora que se sabe el número del documento, se llama por su nombre.
            this.tab?.setTitle(this.documentTitle(data));
            this.ecf.set(null);
            // Electronic e-NCF (E-series) documents carry a DGII e-CF lifecycle.
            if (data.fiscalNumber?.startsWith('E')) {
                this.loadEcfStatus();
            }
        },
        error: (err) => {
            this.notificationService.showError('invoices.detail.invoice_could_not_loaded');
            console.error(err);
        }
    });
  }

  loadEcfStatus(): void {
    this.einvoicingService.getInvoiceStatus(this.id()).subscribe({
        // `null` means no e-CF has been generated for this document yet, which the endpoint now
        // says plainly instead of by answering 404.
        next: (status) => this.ecf.set(status),
        error: () => this.ecf.set(null),
    });
  }

  resubmitEcf(): void {
    this.ecfBusy.set(true);
    this.einvoicingService.submitInvoice(this.id()).subscribe({
        next: (status) => {
            this.ecf.set(status);
            this.ecfBusy.set(false);
            this.notificationService.showSuccess('invoices.detail.cf_resubmitted_dgii');
        },
        error: (err) => {
            this.ecfBusy.set(false);
            this.notificationService.showError(err?.error?.message || 'errors.resend_ecf');
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
        error: () => this.notificationService.showError('invoices.detail.no_signed_xml_available'),
    });
  }

  /**
   * What the authority's verdict on an e-CF MEANS.
   *
   * The badge used to take `e.status.toLowerCase()` as its CSS class — `accepted`, `rejected`,
   * `contingency` — none of which this page's stylesheet defined. So every e-CF state rendered
   * in the same default grey, including REJECTED: the one state on this screen that needs
   * somebody to do something showed the same as the one that needs nobody.
   */
  ecfStatusTone(status: string): VxTone {
    switch (status) {
      case 'ACCEPTED':
        return 'ok';
      case 'ACCEPTED_WITH_OBSERVATIONS':
      case 'CONTINGENCY':
        return 'warning';
      case 'REJECTED':
      case 'ERROR':
        return 'danger';
      case 'SIGNED':
      case 'SENT':
        return 'info';
      default:
        return 'draft';
    }
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
  
  /**
   * Print the fiscal representation, not the application.
   *
   * `window.print()` printed the whole shell — rail, tabs, toolbar — around the document. The server
   * renders the same representation the PDF uses (`/invoices/:id/print`); it is opened in a window
   * of its own and printed from there.
   */
  printInvoice(): void {
    const invoice = this.invoice();
    if (!invoice) return;
    this.invoicesService.printableHtml(invoice.id).subscribe({
      next: (html) => {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        const printable = window.open(url, '_blank', 'noopener=no');
        if (!printable) {
          // A pop-up blocker: the PDF is the same document and always downloads.
          this.notificationService.showWarning('invoices.detail.popup_blocked_pdf');
          this.downloadPdf();
          URL.revokeObjectURL(url);
          return;
        }
        printable.addEventListener('load', () => {
          printable.focus();
          printable.print();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        });
      },
      error: (err) => this.notificationService.showHttpError(err, 'invoices.detail.print_failed'),
    });
  }

  /** Send the document to the customer, with its PDF attached. */
  async emailInvoice(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) return;
    if (invoice.status === 'Draft') {
      this.notificationService.showError('invoices.draft_cannot_be_sent');
      return;
    }
    const to = await this.dialog.prompt({
      title: 'invoices.detail.email_title',
      message: 'invoices.detail.email_message',
      messageParams: { number: invoice.fiscalNumber ?? invoice.invoiceNumber, customer: invoice.customerName },
      placeholder: 'invoices.detail.email_placeholder',
      confirmText: 'invoices.detail.email_send',
      minLength: 0,
    });
    if (to === null || to === undefined) return;
    const address = String(to).trim();
    if (address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      this.notificationService.showError('invoices.detail.email_invalid');
      return;
    }
    this.invoicesService.sendInvoice(invoice.id, { to: address || undefined }).subscribe({
      next: (result) => this.notificationService.showSuccess('invoices.detail.email_queued', { to: result.to }),
      error: (err) => this.notificationService.showHttpError(err, 'invoices.detail.email_failed'),
    });
  }

  /** The search box over the lines — what the toolbar's magnifier means on a document. */
  focusLineSearch(): void {
    this.activeTab.set('content');
    queueMicrotask(() => this.lineSearch?.nativeElement.focus());
  }

  /** "Parametrizaciones": the fiscal and numbering settings this document follows. */
  openInvoicingSettings(): void {
    void this.router.navigate([], { fragment: 'settings/fiscal' });
  }

  async openHelp(): Promise<void> {
    await this.dialog.alert({
      title: 'invoices.detail.help_title',
      message: this.translate.instant('invoices.detail.help_body'),
    });
  }

  handleExport(format: 'pdf' | 'word' | 'excel'): void {
    if (format === 'pdf') {
        this.downloadPdf();
    } else if (format === 'word') {
        this.downloadWord();
    } else {
        void this.downloadExcel();
    }
  }

  /**
   * The document's lines as a spreadsheet — the export an accountant actually reconciles from.
   * It announced "coming soon" (QA A-09); `exceljs` was already a dependency.
   */
  private async downloadExcel(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) return;
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(invoice.fiscalNumber ?? invoice.invoiceNumber);
    const t = (key: string) => this.translate.instant(key);
    sheet.addRow([t('invoices.detail.description'), t('invoices.detail.qty'), t('invoices.detail.price'), t('invoices.detail.tax'), t('invoices.detail.total')]);
    for (const line of invoice.lineItems ?? []) {
      sheet.addRow([
        line.description,
        Number(line.quantity),
        Number(line.price),
        Number(line.taxAmount ?? 0),
        Number(line.lineSubtotal ?? 0) + Number(line.taxAmount ?? 0),
      ]);
    }
    sheet.addRow([]);
    sheet.addRow([t('invoices.detail.subtotal'), '', '', '', Number(invoice.subtotal)]);
    sheet.addRow([t('invoices.detail.tax'), '', '', '', Number(invoice.tax)]);
    sheet.addRow([t('invoices.detail.total'), '', '', '', Number(invoice.total)]);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column, index) => (column.width = index === 0 ? 48 : 16));
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(
      new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `${invoice.fiscalNumber ?? invoice.invoiceNumber}.xlsx`,
    );
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
        this.notificationService.showError('invoices.detail.invoice_pdf_could_not_downloaded');
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
        this.notificationService.showSuccess('invoices.detail.word_document_generated');
    }
  }

  /** "Copiar de" only makes sense on a draft: it pulls another document's lines into this one. */
  handleCopyFrom(): void {
    const invoice = this.invoice();
    if (!invoice || invoice.status !== 'Draft') return;
    void this.router.navigate(['/invoices/new'], { queryParams: { replaceDraft: invoice.id, pickSource: 1 } });
  }

  handleCopyTo(): void {
    this.notificationService.showInfo('invoices.detail.copying_current_document_into_new_draft');
    // Lógica para navegar a /new con el ID actual como base
    this.router.navigate(['/invoices/new'], { queryParams: { copyFrom: this.id() } });
  }

  goBack(): void {
    this.location.back();
  }

  goForward(): void {
    this.location.forward();
  }

  /**
   * Ask the server what issuing would do, and show it before doing it.
   *
   * The preview runs the real transition and rolls it back, so what appears here is not a guess:
   * it is the journal entry that will be posted, the fiscal number that will be consumed and the
   * stock that will move. An accountant who sees that before pressing the button is accepting
   * responsibility for numbers they have actually read.
   */
  previewIssue(): void {
    const invoice = this.invoice();
    if (!invoice) return;
    this.previewBusy.set(true);
    this.invoicesService.previewIssue(invoice.id).subscribe({
      next: (preview) => {
        this.previewBusy.set(false);
        this.issuePreview.set(preview);
      },
      error: (err) => {
        this.previewBusy.set(false);
        this.notificationService.showHttpError(err, 'errors.issue_document');
      },
    });
  }

  dismissPreview(): void {
    this.issuePreview.set(null);
  }

  /**
   * Escape closes the issue preview.
   *
   * The dialog could only be dismissed by clicking — the backdrop or the Cancel button — so a
   * keyboard user who opened it had no way out of it, on the screen that asks them to confirm
   * issuing a fiscal document.
   */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.issuePreview()) this.dismissPreview();
  }

  /** Issue a draft: assigns the e-NCF, posts the ledger entry and transmits the comprobante. */
  issue(): void {
    const invoice = this.invoice();
    if (!invoice) return;
    this.issuePreview.set(null);
    this.ecfBusy.set(true);
    this.invoicesService.issue(invoice.id).subscribe({
      next: (issued) => {
        this.ecfBusy.set(false);
        this.notificationService.showSuccess('invoices.detail.document_issued', {
          number: issued.fiscalNumber ?? issued.invoiceNumber,
        });
        this.loadInvoice();
      },
      error: (err) => {
        this.ecfBusy.set(false);
        this.notificationService.showHttpError(err, 'errors.issue_document');
      },
    });
  }

  /** Discard a draft. It consumed no fiscal numbering, so nothing has to be declared. */
  async discardDraft(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) return;
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_invoice_draft.title',
      message: 'dialog.delete_invoice_draft.message',
      messageParams: { number: invoice.invoiceNumber },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    this.invoicesService.discardDraft(invoice.id).subscribe({
      next: () => {
        this.notificationService.showSuccess('invoices.detail.draft_deleted');
        this.router.navigate(['/invoices']);
      },
      error: (err) =>
        this.notificationService.showHttpError(err, 'errors.delete_draft'),
    });
  }

  /** Whether the document can still be corrected: issued, not a note itself, not fully credited. */
  canCredit(invoice: Invoice): boolean {
    return (
      invoice.type === 'INVOICE' &&
      !['Draft', 'Void', 'Credit Note'].includes(invoice.status) &&
      Number(invoice.creditedTotal ?? 0) < Number(invoice.total ?? 0)
    );
  }

  /** The partial credit note being composed: line id → quantity to credit. */
  readonly crediting = signal(false);
  readonly creditQuantities = signal<Record<string, number>>({});
  readonly creditReason = signal('');

  /** What can still be credited on each line. */
  creditable(line: { quantity: number; creditedQuantity?: number }): number {
    return Math.max(Number(line.quantity) - Number(line.creditedQuantity ?? 0), 0);
  }

  /**
   * A partial correction: which lines, how much of each, and why.
   *
   * It used a native `prompt()` with a Spanish sentence written in the code, credited the whole
   * balance whatever was meant, and was not reachable from the screen at all (QA A-09).
   */
  createCreditNote(_invoiceId: string): void {
    this.creditQuantities.set({});
    this.creditReason.set('');
    this.crediting.set(true);
  }

  setCreditQuantity(lineId: string, value: string): void {
    this.creditQuantities.update((current) => ({ ...current, [lineId]: Math.max(Number(value) || 0, 0) }));
  }

  cancelCredit(): void {
    this.crediting.set(false);
  }

  confirmCredit(): void {
    const invoice = this.invoice();
    if (!invoice) return;
    const reason = this.creditReason().trim();
    if (reason.length < 5) {
      this.notificationService.showError('invoices.detail.credit_note_reason_too_short');
      return;
    }
    const items = Object.entries(this.creditQuantities())
      .filter(([, quantity]) => quantity > 0)
      .map(([lineId, quantity]) => ({ lineId, quantity }));
    if (items.length === 0) {
      this.notificationService.showError('invoices.detail.credit_note_no_lines');
      return;
    }
    for (const item of items) {
      const line = invoice.lineItems.find((candidate) => candidate.id === item.lineId);
      if (line && item.quantity - this.creditable(line) > 0.000001) {
        this.notificationService.showError('invoices.detail.credit_note_exceeds', { description: line.description });
        return;
      }
    }
    this.crediting.set(false);
    this.issueCredit(invoice.id, { reason, items, modificationCode: '3' });
  }

  /** Annul the whole document: a full credit note with the DGII "annulment" modification code. */
  async voidInvoice(invoice: Invoice): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'invoices.detail.void_title',
      message: 'invoices.detail.void_message',
      messageParams: { number: invoice.fiscalNumber ?? invoice.invoiceNumber },
      placeholder: 'invoices.detail.credit_note_reason',
      minLength: 5,
      tooShort: 'invoices.detail.credit_note_reason_too_short',
      confirmText: 'invoices.detail.void_invoice',
      variant: 'danger',
    });
    if (!reason) return;
    this.issueCredit(invoice.id, { reason, modificationCode: '1' });
  }

  private issueCredit(invoiceId: string, request: CreditNoteRequest): void {
    this.ecfBusy.set(true);
    this.invoicesService.createCreditNote(invoiceId, request).subscribe({
      next: (note) => {
        this.ecfBusy.set(false);
        this.notificationService.showSuccess('invoices.detail.credit_note_issued', {
          number: note.fiscalNumber ?? note.invoiceNumber,
        });
        this.loadInvoice();
      },
      error: (err) => {
        this.ecfBusy.set(false);
        this.notificationService.showHttpError(err, 'errors.issue_credit_note');
      },
    });
  }
}