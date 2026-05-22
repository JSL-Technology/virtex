import { Component, ChangeDetectionStrategy, Input, signal, inject, OnInit, effect, computed } from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
// Se importa ActivatedRoute para acceder a los parámetros de la URL.
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Invoice, InvoicesService } from '../../../core/services/invoices';
import { NotificationService } from '../../../core/services/notification';
import { InvoiceToolbarComponent } from '../components/invoice-toolbar/invoice-toolbar.component';
import { asBlob } from 'html-docx-js-typescript';
import { saveAs } from 'file-saver';

@Component({
  selector: 'app-invoice-detail-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink, DecimalPipe, DatePipe, InvoiceToolbarComponent, FormsModule],
  templateUrl: './detail.page.html',
  styleUrls: ['./detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceDetailPage implements OnInit {
  private invoicesService = inject(InvoicesService);
  private notificationService = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  id = signal('');
  @Input('id') set idInput(val: string) { this.id.set(val); }

  invoice = signal<Invoice | undefined>(undefined);
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
        },
        error: (err) => {
            this.notificationService.showError('No se pudo cargar la factura.');
            console.error(err);
        }
    });
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
                .line-items-table th, .line-items-table td { border-bottom: 1px solid #ddd; padding: 8px; }
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

  createCreditNote(invoiceId: string): void {
      if(confirm('¿Estás seguro de que quieres anular esta factura con una nota de crédito? Esta acción no se puede deshacer.')) {
          this.invoicesService.createCreditNote(invoiceId).subscribe({
              next: () => {
                  this.notificationService.showSuccess('Factura anulada y nota de crédito creada.');
                  this.loadInvoice();
              },
              error: (err) => this.notificationService.showError(err.message)
          });
      }
  }
}