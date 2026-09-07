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
  FiscalRange,
  FiscalRegimeSettings,
  FiscalSettingsService,
  MarketCoverage,
} from '../../../../core/api/fiscal-settings.service';
import { NotificationService } from '../../../../core/services/notification';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';

/**
 * Which configuration fields a market's regime actually needs.
 *
 * Not a cosmetic filter. Asking a Chilean tenant for an IBGE municipality code, or an Ecuadorean
 * one for a comuna, produces a form nobody can complete correctly and a support conversation about
 * a field that does not apply to them. The server refuses on exactly what it is missing; this is
 * the same list, from the side that asks for it.
 */
const FIELDS_BY_COUNTRY: Record<string, readonly string[]> = {
  EC: ['establishment', 'emissionPoint', 'numericCode'],
  BR: ['stateCode', 'municipalityCode', 'numericCode'],
  CO: ['resolutionNumber'],
  CL: ['activityCode', 'originComuna', 'originCity'],
  // Peru, Mexico and Argentina need nothing beyond the environment: their operational data comes
  // from the series on the range, the PAC contract, and the punto de venta collected at signup.
  PE: [],
  MX: [],
  AR: [],
};

/** Markets whose ranges carry material the authority issued with them. */
const SECRET_BY_COUNTRY: Record<string, 'CAF_XML' | 'DIAN_TECHNICAL_KEY'> = {
  CL: 'CAF_XML',
  CO: 'DIAN_TECHNICAL_KEY',
};

/**
 * The tenant's e-invoicing configuration, and the number ranges their authority granted them.
 *
 * ## Why this screen decides whether six markets work
 *
 * The regimes are implemented and the documents are built and signed. But a Chilean tenant cannot
 * issue without a CAF, an Ecuadorean one without an emission point, a Brazilian one without their
 * IBGE codes — and until this page existed the only way to supply any of it was an `INSERT`. The
 * product refused to issue, which was right, and left the tenant with nowhere to go.
 *
 * ## The secret goes in and never comes back
 *
 * A CAF contains the RSA key that seals the taxpayer's folios; Colombia's ClaveTécnica is what
 * makes a CUFE theirs. Either one, readable through the API, lets whoever reads it issue fiscal
 * documents in that taxpayer's name. So the list shows only whether one is on file, and replacing
 * it means uploading a new one — which is also why the field is never pre-filled from the server.
 */
@Component({
  selector: 'app-einvoicing-regime-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './einvoicing-regime.page.html',
  styleUrls: ['./einvoicing-regime.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EinvoicingRegimePage implements OnInit {
  private readonly api = inject(FiscalSettingsService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly coverage = signal<MarketCoverage | null>(null);
  readonly ranges = signal<FiscalRange[]>([]);
  readonly loading = signal(true);
  readonly savingSettings = signal(false);
  readonly savingRange = signal(false);
  readonly showRangeForm = signal(false);

  protected readonly environments = [
    { value: 'CERTIFICATION', labelKey: 'SETTINGS.PAGES.EINVOICING.ENV_CERTIFICATION' },
    { value: 'PRODUCTION', labelKey: 'SETTINGS.PAGES.EINVOICING.ENV_PRODUCTION' },
  ] as const;

  /** The tenant's market, from the coverage statement the server sends. */
  readonly countryCode = computed(() => this.coverage()?.countryCode ?? '');

  /** Which settings fields this market needs. Empty for a market with no regime at all. */
  readonly fields = computed(() => FIELDS_BY_COUNTRY[this.countryCode()] ?? []);

  /** Whether this market's ranges carry authority-issued material. */
  readonly secretKind = computed(() => SECRET_BY_COUNTRY[this.countryCode()] ?? null);

  /** Whether the market has a regime at all — otherwise there is nothing on this page to fill. */
  readonly hasRegime = computed(() => this.countryCode() in FIELDS_BY_COUNTRY);

  readonly settingsForm = this.fb.group({
    environment: ['CERTIFICATION', Validators.required],
    establishment: [''],
    emissionPoint: [''],
    numericCode: [''],
    stateCode: [''],
    municipalityCode: [''],
    resolutionNumber: [''],
    activityCode: [''],
    originComuna: [''],
    originCity: [''],
  });

  readonly rangeForm = this.fb.group({
    documentType: ['', Validators.required],
    series: [''],
    startsAt: [1, [Validators.required, Validators.min(1)]],
    endsAt: [1, [Validators.required, Validators.min(1)]],
    validUntil: [''],
    authorizationCode: [''],
    secret: [''],
  });

  ngOnInit(): void {
    this.api
      .coverage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (coverage) => this.coverage.set(coverage),
        error: () => this.coverage.set(null),
      });

    this.loadSettings();
    this.loadRanges();
  }

  needs(field: string): boolean {
    return this.fields().includes(field);
  }

  private loadSettings(): void {
    this.api
      .regimeSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          if (settings) this.settingsForm.patchValue(this.formValueOf(settings));
        },
        error: () => this.notifications.showError('SETTINGS.PAGES.EINVOICING.LOAD_FAILED'),
      });
  }

  /** Nulls become empty strings: a form control holding null renders the string "null". */
  private formValueOf(settings: FiscalRegimeSettings): Record<string, string> {
    return {
      environment: settings.environment,
      establishment: settings.establishment ?? '',
      emissionPoint: settings.emissionPoint ?? '',
      numericCode: settings.numericCode ?? '',
      stateCode: settings.stateCode ?? '',
      municipalityCode: settings.municipalityCode ?? '',
      resolutionNumber: settings.resolutionNumber ?? '',
      activityCode: settings.activityCode ?? '',
      originComuna: settings.originComuna ?? '',
      originCity: settings.originCity ?? '',
    };
  }

  private loadRanges(): void {
    this.loading.set(true);
    this.api
      .ranges()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.ranges.set(rows);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notifications.showError('SETTINGS.PAGES.EINVOICING.LOAD_FAILED');
        },
      });
  }

  saveSettings(): void {
    if (this.settingsForm.invalid) {
      this.settingsForm.markAllAsTouched();
      return;
    }
    this.savingSettings.set(true);

    // Only the fields this market uses. Sending an empty `stateCode` from a Chilean tenant would
    // store a blank where the server expects two digits or nothing at all.
    const raw = this.settingsForm.getRawValue() as Record<string, string>;
    const payload: Record<string, string> = { environment: raw['environment'] };
    for (const field of this.fields()) {
      if (raw[field]?.trim()) payload[field] = raw[field].trim();
    }

    this.api
      .saveRegimeSettings(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savingSettings.set(false);
          this.notifications.showSuccess('SETTINGS.PAGES.EINVOICING.SAVED');
        },
        error: (error) => {
          this.savingSettings.set(false);
          this.notifications.showError(
            error?.error?.message ?? 'SETTINGS.PAGES.EINVOICING.SAVE_FAILED',
          );
        },
      });
  }

  toggleRangeForm(): void {
    this.showRangeForm.update((open) => !open);
  }

  registerRange(): void {
    if (this.rangeForm.invalid) {
      this.rangeForm.markAllAsTouched();
      return;
    }

    const value = this.rangeForm.getRawValue();
    if (Number(value.endsAt) < Number(value.startsAt)) {
      this.notifications.showError('SETTINGS.PAGES.EINVOICING.RANGE_BOUNDS');
      return;
    }

    const kind = this.secretKind();
    this.savingRange.set(true);

    this.api
      .registerRange({
        documentType: value.documentType ?? '',
        series: value.series?.trim() || undefined,
        startsAt: Number(value.startsAt),
        endsAt: Number(value.endsAt),
        validUntil: value.validUntil?.trim() || undefined,
        authorizationCode: value.authorizationCode?.trim() || undefined,
        secret: value.secret?.trim() || undefined,
        // The kind is derived from the market, not asked for: a tenant should not have to know
        // that their CAF is called `CAF_XML` in this product.
        secretKind: value.secret?.trim() && kind ? kind : undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savingRange.set(false);
          this.showRangeForm.set(false);
          this.rangeForm.reset({ startsAt: 1, endsAt: 1 });
          this.loadRanges();
        },
        error: (error) => {
          this.savingRange.set(false);
          this.notifications.showError(
            error?.error?.message ?? 'SETTINGS.PAGES.EINVOICING.SAVE_FAILED',
          );
        },
      });
  }

  retire(range: FiscalRange): void {
    this.api
      .deactivateRange(range.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadRanges(),
        error: () => this.notifications.showError('SETTINGS.PAGES.EINVOICING.DELETE_FAILED'),
      });
  }

  /**
   * Whether a range is close enough to exhaustion to warn about.
   *
   * Running out mid-morning stops the tenant invoicing until an authority grants another, and in
   * several of these markets that takes days. Fifty is the same threshold the server logs at.
   */
  runningOut(range: FiscalRange): boolean {
    return range.isActive && range.remaining <= 50;
  }

  /** Whether the authorisation has expired, which makes the range unusable however many remain. */
  expired(range: FiscalRange): boolean {
    return Boolean(range.validUntil && range.validUntil < new Date().toISOString().slice(0, 10));
  }
}
