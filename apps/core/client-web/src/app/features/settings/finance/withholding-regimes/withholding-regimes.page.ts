import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FiscalSettingsService,
  MarketCoverage,
  WithholdingRegime,
} from '../../../../core/api/fiscal-settings.service';
import { NotificationService } from '../../../../core/services/notification';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';

/**
 * The withholding regimes the tenant maintains, and what the product covers in their market.
 *
 * ## Why the two are on one screen
 *
 * They answer the same question from opposite sides. The coverage says what this product does for
 * you here; the regimes are what you supply when the answer is "the rate depends on something only
 * you know". Most of this product's markets are ones where the built-in catalogue deliberately
 * holds nothing — Colombia's ReteICA is municipal, Peru's detracciones depend on the good — so for
 * those tenants this table is the whole of their withholding configuration.
 *
 * `legalBasis` is a required field on the form for the same reason it is required on the entity:
 * the point of moving withholding off the request was to stop the rate being a number somebody
 * typed.
 */
@Component({
  selector: 'app-withholding-regimes-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './withholding-regimes.page.html',
  styleUrls: ['./withholding-regimes.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WithholdingRegimesPage implements OnInit {
  private readonly api = inject(FiscalSettingsService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly regimes = signal<WithholdingRegime[]>([]);
  readonly coverage = signal<MarketCoverage | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly showForm = signal(false);

  protected readonly kinds = [
    { value: 'VAT', labelKey: 'SETTINGS.PAGES.WITHHOLDING.KIND_VAT' },
    { value: 'INCOME', labelKey: 'SETTINGS.PAGES.WITHHOLDING.KIND_INCOME' },
  ] as const;

  protected readonly scopes = [
    { value: 'ANY', labelKey: 'SETTINGS.PAGES.WITHHOLDING.SCOPE_ANY' },
    { value: 'SERVICES', labelKey: 'SETTINGS.PAGES.WITHHOLDING.SCOPE_SERVICES' },
    { value: 'GOODS', labelKey: 'SETTINGS.PAGES.WITHHOLDING.SCOPE_GOODS' },
  ] as const;

  protected readonly payerTypes = [
    { value: 'COMPANY', labelKey: 'SETTINGS.PAGES.WITHHOLDING.PAYER_COMPANY' },
    { value: 'WITHHOLDING_AGENT', labelKey: 'SETTINGS.PAGES.WITHHOLDING.PAYER_AGENT' },
    { value: 'GOVERNMENT', labelKey: 'SETTINGS.PAGES.WITHHOLDING.PAYER_GOVERNMENT' },
    { value: 'INDIVIDUAL', labelKey: 'SETTINGS.PAGES.WITHHOLDING.PAYER_INDIVIDUAL' },
  ] as const;

  readonly form = this.fb.group({
    code: ['', Validators.required],
    label: ['', Validators.required],
    kind: ['VAT', Validators.required],
    ratePercent: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    payers: [[] as string[], Validators.required],
    scope: ['ANY'],
    legalBasis: ['', [Validators.required, Validators.minLength(3)]],
  });

  ngOnInit(): void {
    this.load();
    this.api
      .coverage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (coverage) => this.coverage.set(coverage),
        // The coverage statement is context, not the point of the page: failing to load it must
        // not stop a tenant configuring the regimes they came here for.
        error: () => this.coverage.set(null),
      });
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .withholdingRegimes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.regimes.set(rows);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notifications.showError('SETTINGS.PAGES.WITHHOLDING.LOAD_FAILED');
        },
      });
  }

  toggleForm(): void {
    this.showForm.update((open) => !open);
  }

  togglePayer(value: string): void {
    const current = this.form.controls.payers.value ?? [];
    this.form.controls.payers.setValue(
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  isPayerSelected(value: string): boolean {
    return (this.form.controls.payers.value ?? []).includes(value);
  }

  save(): void {
    if (this.form.invalid || (this.form.controls.payers.value ?? []).length === 0) {
      this.form.markAllAsTouched();
      this.notifications.showError('SETTINGS.PAGES.WITHHOLDING.NEEDS_PAYER');
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);

    this.api
      .createWithholdingRegime({
        code: value.code ?? '',
        label: value.label ?? '',
        kind: value.kind as WithholdingRegime['kind'],
        // Entered as a percentage, stored as a fraction, like every other rate in the product.
        rate: Number(value.ratePercent ?? 0) / 100,
        payers: value.payers ?? [],
        payees: [],
        scope: value.scope as WithholdingRegime['scope'],
        legalBasis: value.legalBasis ?? '',
        isActive: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.showForm.set(false);
          this.form.reset({ kind: 'VAT', scope: 'ANY', ratePercent: 0, payers: [] });
          this.load();
        },
        error: (error) => {
          this.saving.set(false);
          this.notifications.showError(
            error?.error?.message ?? 'SETTINGS.PAGES.WITHHOLDING.SAVE_FAILED',
          );
        },
      });
  }

  remove(row: WithholdingRegime): void {
    this.api
      .deleteWithholdingRegime(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.load(),
        error: () => this.notifications.showError('SETTINGS.PAGES.WITHHOLDING.DELETE_FAILED'),
      });
  }

  percent(rate: number): number {
    return rate * 100;
  }

  /** The catalogue key for a coverage level, so the reader's language decides how it is worded. */
  levelKey(level: string): string {
    return `SETTINGS.PAGES.WITHHOLDING.COVERAGE_${level.toUpperCase().replace(/-/g, '_')}`;
  }

  capabilityKey(capability: string): string {
    return `SETTINGS.PAGES.WITHHOLDING.CAPABILITY_${capability
      .replace(/([A-Z])/g, '_$1')
      .toUpperCase()}`;
  }
}
