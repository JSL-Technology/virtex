import { Component, ChangeDetectionStrategy, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  PlusCircle,
  Filter,
  MoreHorizontal,
  Search,
  Download,
  FileSpreadsheet,
  ArrowUp,
  ArrowDown,
} from 'lucide-angular';
import {
  InvoicesService,
  Invoice,
  InvoiceStatus,
  InvoiceQuery,
} from '../../../core/services/invoices';
import { NotificationService } from '../../../core/services/notification';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  CsvValue,
  downloadCsv,
  reportFilename,
  toCsv,
} from '../../../core/export/csv-export';

/**
 * The invoice list.
 *
 * ## What changed
 *
 * It used to request EVERY invoice of the tenant on every visit and then search, filter and sort the
 * result in memory — over a table whose only index was its primary key, so each visit was a
 * sequential scan of every tenant's invoices. Filtering and pagination now happen in the database,
 * and the page requests one page at a time.
 *
 * Sorting is deliberately server-ordered (newest first) rather than re-sorted client-side: sorting a
 * page of fifty rows by a column reorders that page only, which is worse than not offering it.
 */
@Component({
  selector: 'app-invoices-list-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, FormsModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoicesListPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly SearchIcon = Search;
  protected readonly DownloadIcon = Download;
  protected readonly SpreadsheetIcon = FileSpreadsheet;
  protected readonly ArrowUpIcon = ArrowUp;
  protected readonly ArrowDownIcon = ArrowDown;

  private invoicesService = inject(InvoicesService);
  private notificationService = inject(NotificationService);
  private readonly translate = inject(TranslateService);

  invoices = signal<Invoice[]>([]);
  isLoading = signal(true);
  error = signal<string | null>(null);
  today = new Date().toISOString().split('T')[0];

  searchTerm = signal('');
  statusFilter = signal<InvoiceStatus | 'All'>('All');
  page = signal(1);
  limit = signal(50);
  total = signal(0);
  pages = signal(1);

  /** The rows currently on screen; the server has already filtered and ordered them. */
  filteredInvoices = computed(() => this.invoices());

  hasPrevious = computed(() => this.page() > 1);
  hasNext = computed(() => this.page() < this.pages());
  rangeLabel = computed(() => {
    if (this.total() === 0) return 'Sin facturas';
    const from = (this.page() - 1) * this.limit() + 1;
    const to = Math.min(this.total(), from + this.invoices().length - 1);
    return `${from}–${to} de ${this.total()}`;
  });

  ngOnInit(): void {
    this.loadInvoices();
  }

  loadInvoices(): void {
    this.isLoading.set(true);
    this.error.set(null);

    const query: InvoiceQuery = {
      page: this.page(),
      limit: this.limit(),
      search: this.searchTerm() || undefined,
      status: this.statusFilter() === 'All' ? undefined : (this.statusFilter() as InvoiceStatus),
    };

    this.invoicesService.getInvoices(query).subscribe({
      next: (result) => {
        this.invoices.set(result.items);
        this.total.set(result.total);
        this.pages.set(result.pages);
        this.isLoading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar las facturas. Inténtalo de nuevo.');
        this.notificationService.showError(this.error()!);
        this.isLoading.set(false);
      },
    });
  }

  /** Any change to a filter returns to the first page: page 3 of a different result set is noise. */
  applyFilters(): void {
    this.page.set(1);
    this.loadInvoices();
  }

  goToPage(delta: number): void {
    const next = this.page() + delta;
    if (next < 1 || next > this.pages()) return;
    this.page.set(next);
    this.loadInvoices();
  }

  getStatusClass(status: Invoice['status']): string {
    switch (status) {
      case 'Paid':
        return 'status-paid';
      case 'Pending':
        return 'status-pending';
      case 'Partially Paid':
        return 'status-partial';
      case 'Void':
        return 'status-overdue';
      case 'Credit Note':
        return 'status-draft';
      case 'Draft':
        return 'status-draft';
      default:
        return 'status-pending';
    }
  }

  /**
   * Export what the current filter selects, not just the page on screen.
   *
   * The previous version exported the rows it happened to be holding, which silently produced a
   * partial file whenever the list was paginated.
   */
  /**
   * ## Why this is a CSV and not a workbook
   *
   * It used to build one with `xlsx@0.18.5`, which `npm audit` reports with two HIGH advisories —
   * prototype pollution (GHSA-4r6h-8v6p-xvw6) and a regular-expression denial of service
   * (GHSA-5pgg-2g8v-p4x9). The registry copy is frozen at that version, so there was nothing to
   * upgrade to, and it was being shipped in the browser bundle for one export.
   *
   * Every other export in the product already goes through `csv-export`, which writes the `sep=`
   * line and the byte-order mark Excel needs, and picks the delimiter from the reader's locale —
   * so the file opens in Excel with its columns split, which is what the button was for.
   */
  exportToCsv(): void {
    this.invoicesService
      .getInvoices({
        limit: 200,
        search: this.searchTerm() || undefined,
        status: this.statusFilter() === 'All' ? undefined : (this.statusFilter() as InvoiceStatus),
      })
      .subscribe({
        next: (result) => {
          // Translated, and named for what they are. The headers were hardcoded Spanish, and
          // `NCF` and `RNC/Cédula` are Dominican terms on a product sold across the region and the
          // United States: a reader in São Paulo or Miami got a column heading meaning nothing.
          const header = [
            'INVOICES.EXPORT.DOCUMENTO',
            'INVOICES.EXPORT.COMPROBANTE_FISCAL',
            'INVOICES.EXPORT.TIPO_DOCUMENTO',
            'INVOICES.EXPORT.CLIENTE',
            'INVOICES.EXPORT.IDENTIFICACION_FISCAL',
            'INVOICES.EXPORT.FECHA_EMISION',
            'INVOICES.EXPORT.FECHA_VENCIMIENTO',
            'INVOICES.EXPORT.GRAVADO',
            'INVOICES.EXPORT.EXENTO',
            'INVOICES.EXPORT.IMPUESTO',
            'INVOICES.EXPORT.TOTAL',
            'INVOICES.EXPORT.SALDO',
            'INVOICES.EXPORT.MONEDA',
            'INVOICES.EXPORT.ESTADO',
          ].map((key) => this.translate.instant(key) as string);

          const rows: CsvValue[][] = [
            header,
            ...result.items.map((invoice) => [
              invoice.invoiceNumber,
              invoice.ncfNumber ?? '',
              invoice.fiscalDocumentType ?? '',
              invoice.customerName,
              invoice.customerTaxId ?? '',
              invoice.issueDate,
              invoice.dueDate,
              // Raw numbers, never locale-formatted: a formatted amount is text, and text does
              // not add up in the spreadsheet the reader opens it in.
              invoice.taxedTotal,
              invoice.exemptTotal,
              invoice.tax,
              invoice.total,
              invoice.balance,
              invoice.currencyCode,
              invoice.status,
            ]),
          ];

          downloadCsv(
            reportFilename(this.translate.instant('INVOICES.EXPORT.NOMBRE_ARCHIVO'), this.today),
            toCsv(rows, { locale: this.translate.currentLang }),
          );

          this.notificationService.showSuccess(
            result.total > result.items.length
              ? this.translate.instant('INVOICES.EXPORT.PARCIAL', {
                  exported: result.items.length,
                  total: result.total,
                })
              : this.translate.instant('INVOICES.EXPORT.COMPLETADA'),
          );
        },
        error: () => this.notificationService.showError('INVOICES.LIST.PUDO_EXPORTAR_LISTADO'),
      });
  }
}
