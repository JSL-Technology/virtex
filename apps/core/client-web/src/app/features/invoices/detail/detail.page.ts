import { Component, ChangeDetectionStrategy, Input, signal, inject, OnInit, effect, computed } from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
// Se importa ActivatedRoute para acceder a los parámetros de la URL.
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Invoice, InvoicesService } from '../../../core/services/invoices';
import { EinvoicingService, EcfSubmissionView } from '../../../core/services/einvoicing';
import { NotificationService } from '../../../core/services/notification';
import { InvoiceToolbarComponent } from '../components/invoice-toolbar/invoice-toolbar.component';
import { QRCodeComponent } from 'angularx-qrcode';
import { asBlob } from 'html-docx-js-typescript';
import { saveAs } from 'file-saver';

@Component({
  selector: 'app-invoice-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    LucideAngularModule,
    DecimalPipe,
    DatePipe,
    InvoiceToolbarComponent,
    FormsModule,
    // The QR is the element the norm requires on the printed representation; the page used to show
    // a text link instead, while `angularx-qrcode` was already a dependency of the project.
    QRCodeComponent,
  ],
  templateUrl: './detail.page.html',
  styleUrls: ['./detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceDetailPage implements OnInit {
  private invoicesService = inject(InvoicesService);
  private einvoicingService = inject(EinvoicingService);
  private notificationService = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

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
            this.notificationService.showError('No se pudo cargar la factura.');
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
            this.notificationService.showSuccess('e-CF reenviado a la DGII.');
        },
        error: (err) => {
            this.ecfBusy.set(false);
            this.notificationService.showError(err?.error?.message || 'No se pudo reenviar el e-CF.');
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
        error: () => this.notificationService.showError('No hay XML firmado disponible.'),
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
        this.notificationService.showInfo(`Exportación a ${format.toUpperCase()} estará disponible próximamente.`);
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
        this.notificationService.showError('No se pudo descargar el PDF de la factura.');
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
        this.notificationService.showSuccess('Documento Word generado con éxito.');
    }
  }

  handleCopyFrom(): void {
    this.notificationService.showInfo('Función "Copiar de" abierta. Seleccione un documento base.');
  }

  handleCopyTo(): void {
    this.notificationService.showInfo('Copiando documento actual a nuevo borrador...');
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
        this.notificationService.showError(err?.error?.message || 'No se pudo emitir el documento.');
      },
    });
  }

  /** Discard a draft. It consumed no fiscal numbering, so nothing has to be declared. */
  discardDraft(): void {
    const invoice = this.invoice();
    if (!invoice) return;
    if (!confirm(`¿Eliminar el borrador ${invoice.invoiceNumber}? No se puede deshacer.`)) return;

    this.invoicesService.discardDraft(invoice.id).subscribe({
      next: () => {
        this.notificationService.showSuccess('Borrador eliminado.');
        this.router.navigate(['/invoices']);
      },
      error: (err) =>
        this.notificationService.showError(err?.error?.message || 'No se pudo eliminar el borrador.'),
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
            err?.error?.message || 'No se pudo emitir la nota de crédito.',
          ),
      });
  }
}