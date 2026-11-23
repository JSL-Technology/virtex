import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { Download, LucideAngularModule } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES, LocaleStore } from '@virtex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virtex/shared/ui-a11y';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxPagerComponent } from '../../../shared/components/pager';
import { NotificationService } from '../../../core/services/notification';
import { CsvValue, downloadCsv, reportFilename, toCsv } from '../../../core/export/csv-export';
import {
  FixedAssetsService,
  TaxCategoryCatalogue,
  TaxDepreciationReport,
  TaxDepreciationRow,
  asPercent,
} from '../data/fixed-assets.service';
import { previousMonth } from './depreciation-run.page';

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The rows one request brings when the whole report is exported. */
const EXPORT_PAGE = 500;

/** The months a report opens on: from January of the last month that ended, through it. */
export function defaultTaxPeriod(today = new Date()): { from: string; to: string } {
  const to = previousMonth(today);
  return { from: `${to.slice(0, 4)}-01`, to };
}

/**
 * The tax depreciation of a period (audit 2026-11-07, FINB-16): each asset's tax basis, what was
 * deducted before and in the period, what is left to deduct, and — against the books — the
 * temporary difference deferred tax is measured on (IAS 12). By the authority's categories, as a
 * tax return's depreciation schedule reads it.
 */
@Component({
  selector: 'app-tax-depreciation-page',
  standalone: true,
  imports: [FormsModule, ...VX_FORM_A11Y, RouterLink, TranslateModule, ...FORMAT_PIPES, LucideAngularModule, ListShellComponent, VxAmountComponent, VxPagerComponent],
  templateUrl: './tax-depreciation.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxDepreciationPage implements OnInit {
  private readonly assets = inject(FixedAssetsService);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  protected readonly locale = inject(LocaleStore);

  protected readonly ExportIcon = Download;
  protected readonly asPercent = asPercent;

  readonly from = signal(defaultTaxPeriod().from);
  readonly to = signal(defaultTaxPeriod().to);
  readonly taxCategory = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(100);
  readonly report = signal<TaxDepreciationReport | null>(null);
  readonly catalogue = signal<TaxCategoryCatalogue | null>(null);
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly error = signal<string | null>(null);

  readonly rows = computed(() => this.report()?.assets.rows ?? []);
  readonly total = computed(() => this.report()?.assets.total ?? 0);
  readonly empty = computed(() => !this.loading() && !this.error() && this.total() === 0);
  readonly periodValid = computed(() => ISO_MONTH.test(this.from()) && ISO_MONTH.test(this.to()) && this.from() <= this.to());
  /** The authority's name for each tax category, by code. */
  private readonly taxNames = computed(() => new Map((this.catalogue()?.categories ?? []).map((entry) => [entry.code, entry.nameKey])));

  ngOnInit(): void {
    this.assets.taxCategories().subscribe({ next: (catalogue) => this.catalogue.set(catalogue), error: () => this.catalogue.set(null) });
    this.load();
  }

  load(): void {
    if (!this.periodValid()) return;
    this.loading.set(true);
    this.error.set(null);
    this.assets
      .taxDepreciation({ from: this.from(), to: this.to(), taxCategoryCode: this.taxCategory() || null, page: this.page(), pageSize: this.pageSize() })
      .subscribe({
        next: (report) => {
          this.report.set(report);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.notifications.httpErrorMessage(error, 'fixed_assets.tax_report.load_failed'));
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
    this.pageSize.set(size);
    this.applyFilters();
  }

  /** The authority's name of a tax category, as a catalogue key; null for one it does not fix. */
  taxCategoryKey(code: string | null): string | null {
    return code ? (this.taxNames().get(code) ?? null) : null;
  }

  /** The whole report — every page — as a file an accountant opens in a spreadsheet. */
  async exportCsv(): Promise<void> {
    if (!this.periodValid()) return;
    this.exporting.set(true);
    try {
      const rows: TaxDepreciationRow[] = [];
      let first: TaxDepreciationReport | null = null;
      for (let page = 1; ; page++) {
        const chunk = await firstValueFrom(
          this.assets.taxDepreciation({ from: this.from(), to: this.to(), taxCategoryCode: this.taxCategory() || null, page, pageSize: EXPORT_PAGE }),
        );
        first ??= chunk;
        rows.push(...chunk.assets.rows);
        if (!chunk.assets.hasMore) break;
      }
      const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params) as string;
      const header = [
        'fixed_assets.page.number',
        'fixed_assets.page.name',
        'fixed_assets.form.category',
        'fixed_assets.tax_book.category',
        'fixed_assets.tax_book.method',
        'fixed_assets.tax_book.rate',
        'fixed_assets.form.in_service_date',
        'fixed_assets.tax_report.disposal_date',
        'fixed_assets.tax_book.basis',
        'fixed_assets.tax_report.opening',
        'fixed_assets.tax_book.deduction',
        'fixed_assets.tax_report.closing',
        'fixed_assets.tax_book.tax_value',
        'fixed_assets.tax_report.accounting_depreciation',
        'fixed_assets.tax_report.accounting_carrying',
        'fixed_assets.tax_report.difference',
      ].map((key) => t(key));
      const body: CsvValue[][] = rows.map((row) => [
        row.number,
        row.name,
        row.categoryCode ? `${row.categoryCode} · ${this.locale.nameOf(row.categoryName ?? "", row.categoryNameTranslations ?? null)}` : '',
        row.taxCategoryCode ?? '',
        t(`fixed_assets.tax_methods.${row.method}`),
        asPercent(row.annualRate),
        row.inServiceDate,
        row.disposalDate ?? '',
        row.basis,
        row.openingAccumulated,
        row.deduction,
        row.closingAccumulated,
        row.taxValue,
        row.accountingDepreciation,
        row.accountingCarrying,
        row.difference,
      ]);
      const totals = first?.totals;
      const footer: CsvValue[][] = totals
        ? [[t('fixed_assets.tax_report.totals'), '', '', '', '', '', '', '', totals.basis, totals.openingAccumulated, totals.deduction, totals.closingAccumulated, totals.taxValue, totals.accountingDepreciation, totals.accountingCarrying, totals.difference]]
        : [];
      const catalogue = this.catalogue();
      downloadCsv(
        reportFilename(t('fixed_assets.tax_report.file'), this.from(), this.to()),
        toCsv([header, ...body, ...footer], {
          locale: this.translate.getCurrentLang(),
          preamble: [
            [t('fixed_assets.tax_report.title')],
            [t('fixed_assets.tax_report.period', { from: this.from(), to: this.to() })],
            ...(catalogue ? [[t('fixed_assets.categories.authority_note', { authority: catalogue.authority })], [t(catalogue.caveatKey)]] : []),
            [],
          ],
        }),
      );
    } catch (error: unknown) {
      this.notifications.showHttpError(error, 'fixed_assets.tax_report.export_failed');
    } finally {
      this.exporting.set(false);
    }
  }
}
