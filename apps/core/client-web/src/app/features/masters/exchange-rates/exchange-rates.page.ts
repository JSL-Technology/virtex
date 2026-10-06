import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, PlusCircle, Trash2, Upload } from 'lucide-angular';
import { FORMAT_PIPES, LocaleStore } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { VxPagerComponent } from '../../../shared/components/pager';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { Currency, CurrenciesService } from '../data/currencies.service';
import {
  EXCHANGE_RATE_TYPES,
  ExchangeRateRow,
  ExchangeRateType,
  ExchangeRatesService,
  RateScope,
  ResolvedRate,
  parseRateTable,
} from '../data/exchange-rates.service';

const todayIso = (): string => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/**
 * Exchange rates (audit H-09): the rates the company's documents convert at.
 *
 * The server had them — a shared market table refreshed from a provider, a table of the
 * company's own rates that wins over it, and a resolver that explains which one a document used —
 * and no screen showed any of it. Settings › Currencies configured how old a rate may be, over
 * rates nobody could see or enter. Here: the history, recording a rate (the authority's official
 * one is often published where no API reaches), importing a month of them, removing a typo, and
 * asking which rate a document dated on a given day would use.
 */
@Component({
  selector: 'app-exchange-rates-page',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    TranslateModule,
    LucideAngularModule,
    ...FORMAT_PIPES,
    ...VX_FORM_A11Y,
    ListShellComponent,
    VxBadgeComponent,
    VxPagerComponent,
    VxDateFieldComponent,
    HasPermissionDirective,
  ],
  templateUrl: './exchange-rates.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', '../../../shared/styles/document-form.scss', './exchange-rates.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExchangeRatesPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly rates = inject(ExchangeRatesService);
  private readonly currenciesApi = inject(CurrenciesService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly locale = inject(LocaleStore);

  protected readonly AddIcon = PlusCircle;
  protected readonly ImportIcon = Upload;
  protected readonly DeleteIcon = Trash2;
  protected readonly rateTypes = EXCHANGE_RATE_TYPES;

  readonly rows = signal<ExchangeRateRow[]>([]);
  readonly currencies = signal<Currency[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(100);
  readonly currencyFilter = signal('');
  readonly typeFilter = signal<ExchangeRateType | ''>('');
  readonly scopeFilter = signal<RateScope>('ALL');
  readonly fromFilter = signal('');
  readonly toFilter = signal('');
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  readonly recording = signal(false);
  readonly saving = signal(false);
  readonly importing = signal(false);
  readonly importText = signal('');
  readonly importPreview = computed(() => parseRateTable(this.importText()));
  readonly resolved = signal<ResolvedRate | null>(null);
  readonly resolveError = signal<string | null>(null);

  /** The company's functional currency: what a rate is usually quoted into. */
  readonly baseCurrency = computed(() => this.locale.currency());

  readonly form = this.fb.group({
    fromCurrency: ['USD', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    toCurrency: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    date: [todayIso(), [Validators.required]],
    rate: [null as number | null, [Validators.required, Validators.min(0.000001)]],
    rateType: ['OFFICIAL' as ExchangeRateType, [Validators.required]],
    source: ['', [Validators.maxLength(32)]],
  });

  readonly lookup = this.fb.group({
    from: ['USD', [Validators.required]],
    to: ['', [Validators.required]],
    date: [todayIso(), [Validators.required]],
    rateType: ['' as ExchangeRateType | ''],
  });

  ngOnInit(): void {
    const base = this.baseCurrency() ?? '';
    this.form.patchValue({ toCurrency: base });
    this.lookup.patchValue({ to: base });
    this.currenciesApi.getCurrencies().subscribe({
      next: (list) => this.currencies.set([...(list ?? [])].sort((a, b) => a.code.localeCompare(b.code))),
      error: () => this.currencies.set([]),
    });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.rates
      .history({
        currency: this.currencyFilter() || null,
        rateType: this.typeFilter() || null,
        scope: this.scopeFilter(),
        from: this.fromFilter() || null,
        to: this.toFilter() || null,
        page: this.page(),
        limit: this.limit(),
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.notifications.httpErrorMessage(error, 'currencies.rates.load_failed'));
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
    this.limit.set(size);
    this.applyFilters();
  }

  save(): void {
    const raw = this.form.getRawValue();
    if (this.form.invalid || (raw.fromCurrency ?? '').toUpperCase() === (raw.toCurrency ?? '').toUpperCase()) {
      this.form.markAllAsTouched();
      this.notifications.showError('currencies.rates.form_invalid');
      return;
    }
    this.saving.set(true);
    this.rates
      .record({
        fromCurrency: (raw.fromCurrency ?? '').toUpperCase(),
        toCurrency: (raw.toCurrency ?? '').toUpperCase(),
        date: raw.date as string,
        rate: Number(raw.rate),
        rateType: raw.rateType as ExchangeRateType,
        source: (raw.source ?? '').trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.recording.set(false);
          this.form.patchValue({ rate: null, source: '' });
          this.notifications.showSuccess('currencies.rates.recorded');
          this.applyFilters();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'currencies.rates.save_failed');
        },
      });
  }

  onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    file.text().then((text) => this.importText.set(text));
  }

  confirmImport(): void {
    const { rates, invalidLines } = this.importPreview();
    if (invalidLines.length || rates.length === 0) {
      this.notifications.showError('currencies.rates.import_has_invalid_lines', { lines: invalidLines.join(', ') || '—' });
      return;
    }
    this.saving.set(true);
    this.rates.importRates(rates).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.importing.set(false);
        this.importText.set('');
        this.notifications.showSuccess('currencies.rates.imported', { count: result.imported });
        this.applyFilters();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'currencies.rates.import_failed');
      },
    });
  }

  async remove(row: ExchangeRateRow): Promise<void> {
    if (row.scope !== 'TENANT') return;
    const confirmed = await this.dialog.confirm({
      title: 'currencies.rates.delete_title',
      message: 'currencies.rates.delete_message',
      messageParams: { pair: `${row.fromCurrency}/${row.toCurrency}`, date: row.date },
      confirmText: 'currencies.rates.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.rates.remove(row.id).subscribe({
      next: () => {
        this.notifications.showSuccess('currencies.rates.deleted');
        this.load();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'currencies.rates.delete_failed'),
    });
  }

  resolve(): void {
    const raw = this.lookup.getRawValue();
    if (this.lookup.invalid) return;
    this.resolveError.set(null);
    this.resolved.set(null);
    this.rates
      .resolve((raw.from ?? '').toUpperCase(), (raw.to ?? '').toUpperCase(), raw.date as string, (raw.rateType || null) as ExchangeRateType | null)
      .subscribe({
        next: (result) => this.resolved.set(result),
        error: (error: unknown) => this.resolveError.set(this.notifications.httpErrorMessage(error, 'currencies.rates.no_rate')),
      });
  }
}
