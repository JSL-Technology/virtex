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
import { asBlob } from 'html-docx-js-typescript';
import { saveAs } from 'file-saver';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';

@Component({
  selector: 'app-invoice-detail-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, DecimalPipe, DatePipe, InvoiceToolbarComponent, FormsModule, TranslateModule, ...FORMAT_PIPES],
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

  loadNavigation(): void {
    this.invoicesService.getInvoiceNavigation(this.id()).subscribe(nav => {
        this.navigationIds.set(nav);
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

  createCreditNote(invoiceId: string): void {
      if(confirm('¿Estás seguro de que quieres anular esta factura con una nota de crédito? Esta acción no se puede deshacer.')) {
          this.invoicesService.createCreditNote(invoiceId).subscribe({
              next: () => {
                  this.notificationService.showSuccess('INVOICES.DETAIL.FACTURA_ANULADA_NOTA_CREDITO_CREADA');
                  this.loadInvoice();
              },
              error: (err) => this.notificationService.showError(err.message)
          });
      }
  }
}