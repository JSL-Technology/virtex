import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FiscalSettingsService,
  TaxJurisdiction,
} from '../../../../core/api/fiscal-settings.service';
import { NotificationService } from '../../../../core/services/notification';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';

/**
 * Where the tenant is registered to collect sales tax, and at what rate.
 *
 * ## Why this screen is load-bearing
 *
 * In the markets with no national rate — the United States, Brazil — the rate is a property of
 * the delivery address, and the server determines it from these rows. With none of them a sale is
 * correctly untaxed for want of nexus, and the invoice says so; with the wrong ones it is taxed
 * wrongly every month. Until this screen existed the table was reachable only through the API,
 * which meant a tenant could not become able to invoice in the United States without a developer.
 *
 * The list is grouped by state because that is how a taxpayer thinks about their obligations: they
 * are registered in a state, and the county, city and district rates hang off it.
 */
@Component({
  selector: 'app-tax-jurisdictions-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './tax-jurisdictions.page.html',
  styleUrls: ['./tax-jurisdictions.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxJurisdictionsPage implements OnInit {
  private readonly api = inject(FiscalSettingsService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly jurisdictions = signal<TaxJurisdiction[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly showForm = signal(false);

  protected readonly levels = [
    { value: 'STATE', labelKey: 'SETTINGS.PAGES.TAX_JURISDICTIONS.LEVEL_STATE' },
    { value: 'COUNTY', labelKey: 'SETTINGS.PAGES.TAX_JURISDICTIONS.LEVEL_COUNTY' },
    { value: 'CITY', labelKey: 'SETTINGS.PAGES.TAX_JURISDICTIONS.LEVEL_CITY' },
    { value: 'SPECIAL', labelKey: 'SETTINGS.PAGES.TAX_JURISDICTIONS.LEVEL_SPECIAL' },
  ] as const;

  protected readonly sourcings = [
    { value: 'DESTINATION', labelKey: 'SETTINGS.PAGES.TAX_JURISDICTIONS.SOURCING_DESTINATION' },
    { value: 'ORIGIN', labelKey: 'SETTINGS.PAGES.TAX_JURISDICTIONS.SOURCING_ORIGIN' },
  ] as const;

  /**
   * The rate is entered as a percentage and stored as a fraction.
   *
   * A tenant reads their state's rate as `6.25`, and asking them to type `0.0625` is how a rate
   * ends up a hundred times too small in a filing.
   */
  readonly form = this.fb.group({
    countryCode: ['US', [Validators.required, Validators.minLength(2), Validators.maxLength(2)]],
    stateCode: ['', Validators.required],
    county: [''],
    city: [''],
    postalCode: [''],
    level: ['STATE', Validators.required],
    name: ['', Validators.required],
    ratePercent: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    isRegistered: [true],
    sourcing: ['DESTINATION'],
    effectiveFrom: [new Date().toISOString().slice(0, 10), Validators.required],
    effectiveTo: [''],
  });

  /** Grouped by state, which is how a taxpayer thinks about where they are registered. */
  readonly byState = computed(() => {
    const groups = new Map<string, TaxJurisdiction[]>();
    for (const row of this.jurisdictions()) {
      const key = `${row.countryCode} · ${row.stateCode}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()].map(([state, rows]) => ({ state, rows }));
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .jurisdictions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.jurisdictions.set(rows);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notifications.showError('SETTINGS.PAGES.TAX_JURISDICTIONS.LOAD_FAILED');
        },
      });
  }

  toggleForm(): void {
    this.showForm.update((open) => !open);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);

    this.api
      .createJurisdiction({
        countryCode: (value.countryCode ?? 'US').toUpperCase(),
        stateCode: (value.stateCode ?? '').toUpperCase(),
        county: value.county || null,
        city: value.city || null,
        postalCode: value.postalCode || null,
        level: value.level as TaxJurisdiction['level'],
        name: value.name ?? '',
        // Entered as a percentage, stored as a fraction.
        rate: Number(value.ratePercent ?? 0) / 100,
        isRegistered: Boolean(value.isRegistered),
        sourcing: value.sourcing as TaxJurisdiction['sourcing'],
        effectiveFrom: value.effectiveFrom ?? '',
        effectiveTo: value.effectiveTo || null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.showForm.set(false);
          this.form.reset({
            countryCode: 'US',
            level: 'STATE',
            sourcing: 'DESTINATION',
            isRegistered: true,
            ratePercent: 0,
            effectiveFrom: new Date().toISOString().slice(0, 10),
          });
          this.load();
        },
        error: (error) => {
          this.saving.set(false);
          this.notifications.showError(
            error?.error?.message ?? 'SETTINGS.PAGES.TAX_JURISDICTIONS.SAVE_FAILED',
          );
        },
      });
  }

  remove(row: TaxJurisdiction): void {
    this.api
      .deleteJurisdiction(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.load(),
        error: () =>
          this.notifications.showError('SETTINGS.PAGES.TAX_JURISDICTIONS.DELETE_FAILED'),
      });
  }

  /** Stored as a fraction, read as a percentage. */
  percent(rate: number): number {
    return rate * 100;
  }
}
