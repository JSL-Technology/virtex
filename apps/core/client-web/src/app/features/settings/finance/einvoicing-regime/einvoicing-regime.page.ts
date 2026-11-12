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

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FiscalDocumentTypeView,
  FiscalRegimeSettings,
  FiscalSettingsService,
  MarketCoverage,
  TransmissionSettings,
  TransmissionSettingsInput,
} from '../../data/fiscal-settings.service';
import { FiscalEmissionMode, InvoicesService, InvoicingContext } from '../../../../core/services/invoices';
import {
  EmissionModeCardComponent,
  FiscalRangeSecretKind,
  FiscalRangesCardComponent,
  SigningCertificateCardComponent,
} from '../../fiscal/shared';
import { CountryPackService } from '../../../../core/api/country-pack.service';
import { NotificationService } from '../../../../core/services/notification';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { RouterLink } from '@angular/router';

/**
 * Which configuration fields a market's regime actually needs.
 *
 * Not a cosmetic filter. Asking a Chilean tenant for an IBGE municipality code, or an Ecuadorean
 * one for a comuna, produces a form nobody can complete correctly and a support conversation about
 * a field that does not apply to them. The server refuses on exactly what it is missing; this is
 * the same list, from the side that asks for it.
 */
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
  imports: [
    RouterLink,
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    ...VX_FORM_A11Y,
    EmissionModeCardComponent,
    FiscalRangesCardComponent,
    SigningCertificateCardComponent,
  ],
  templateUrl: './einvoicing-regime.page.html',
  styleUrls: ['./einvoicing-regime.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EinvoicingRegimePage implements OnInit {
  private readonly api = inject(FiscalSettingsService);
  private readonly invoices = inject(InvoicesService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly countryPack = inject(CountryPackService);

  readonly coverage = signal<MarketCoverage | null>(null);
  readonly savingSettings = signal(false);

  /**
   * What the invoice form will offer and what stands in the way, as the server computes it — the
   * same answer for this market as for the Dominican one: the emission-mode card and the
   * certificate card read it.
   */
  readonly invoicing = signal<InvoicingContext | null>(null);
  readonly emissionMode = signal<FiscalEmissionMode>('BOTH');

  /**
   * The market's comprobante types, from the catalogue: what a range can be registered for. It was
   * a free-text box, so a tenant had to know that a Chilean factura afecta is `33`.
   */
  readonly documentTypes = signal<FiscalDocumentTypeView[]>([]);
  protected readonly environments = [
    { value: 'CERTIFICATION', labelKey: 'settings.pages.einvoicing.env_certification' },
    { value: 'PRODUCTION', labelKey: 'settings.pages.einvoicing.env_production' },
  ] as const;

  /** The tenant's market, from the coverage statement the server sends. */
  readonly countryCode = computed(() => this.coverage()?.countryCode ?? '');

  /** What this market's regime is and what it asks for, from its own package. */
  private readonly regime = computed(() => this.countryPack.einvoicingRegime());

  /** Which settings fields this market needs. Empty for a market with no regime at all. */
  readonly fields = computed<readonly string[]>(() => this.regime()?.settingsFields ?? []);

  /** Whether this market's ranges carry authority-issued material. */
  readonly secretKind = computed<FiscalRangeSecretKind | null>(
    () => (this.regime()?.rangeSecret as FiscalRangeSecretKind | null) ?? null,
  );

  /** Whether the market has a regime whose channel this screen configures at all. */
  readonly hasRegime = computed(() => this.regime()?.channel === 'ENDPOINT');

  /**
   * The regime authenticates with the taxpayer's own signing certificate, so there is no endpoint
   * and no credential to configure here: the certificate and the authorised ranges live in the
   * fiscal section. The template asked `countryCode() === 'DO'`.
   */
  readonly configuredWithCertificate = computed(() => this.regime()?.channel === 'CERTIFICATE');

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

  /**
   * The tenant's own channel to its authority or PAC (FAC-EINV-04). The credential field is
   * write-only: it starts empty, a blank leaves the stored one in place, and the server never
   * sends it back — only whether one is stored.
   */
  readonly transmission = signal<TransmissionSettings | null>(null);
  readonly savingTransmission = signal(false);
  readonly transmissionForm = this.fb.group({
    transmissionEndpoint: ['', [Validators.pattern(/^https:\/\/\S+$/), Validators.maxLength(512)]],
    statusEndpoint: ['', [Validators.pattern(/^https:\/\/\S+$/), Validators.maxLength(512)]],
    soapAction: ['', Validators.maxLength(256)],
    credentialScheme: ['BEARER' as 'BEARER' | 'BASIC'],
    credential: ['', Validators.maxLength(4096)],
  });

  ngOnInit(): void {
    this.api
      .coverage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (coverage) => this.coverage.set(coverage),
        error: () => this.coverage.set(null),
      });

    this.api
      .documentTypes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (types) => this.documentTypes.set(types),
        error: () => this.notifications.showError('settings.fiscal.document_types_load_failed'),
      });

    this.loadSettings();
    this.loadTransmission();
    this.loadInvoicingState();
  }

  /** Something the issue readiness depends on changed — a range, the certificate, the mode. */
  loadInvoicingState(): void {
    this.invoices
      .context()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (context) => this.invoicing.set(context),
        error: () => this.invoicing.set(null),
      });
  }

  needs(field: string): boolean {
    return this.fields().includes(field);
  }

  private loadTransmission(): void {
    this.api
      .transmissionSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.transmission.set(settings);
          this.transmissionForm.patchValue({
            transmissionEndpoint: settings.transmissionEndpoint ?? '',
            statusEndpoint: settings.statusEndpoint ?? '',
            soapAction: settings.soapAction ?? '',
            credentialScheme: settings.credentialScheme ?? 'BEARER',
            credential: '',
          });
        },
        error: () => this.transmission.set(null),
      });
  }

  saveTransmission(removeCredential = false): void {
    if (this.transmissionForm.invalid) {
      this.transmissionForm.markAllAsTouched();
      return;
    }
    const raw = this.transmissionForm.getRawValue();
    const input: TransmissionSettingsInput = {
      transmissionEndpoint: raw.transmissionEndpoint?.trim() || null,
      statusEndpoint: raw.statusEndpoint?.trim() || null,
      soapAction: raw.soapAction?.trim() || null,
      credentialScheme: raw.credentialScheme,
      // A blank leaves the stored credential as it is.
      ...(removeCredential ? { credential: null } : raw.credential ? { credential: raw.credential } : {}),
    };
    this.savingTransmission.set(true);
    this.api
      .saveTransmissionSettings(input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.savingTransmission.set(false);
          this.transmission.set(settings);
          this.transmissionForm.patchValue({ credential: '' });
          this.notifications.showSuccess('settings.pages.einvoicing.transmission.saved');
          this.loadInvoicingState();
        },
        error: (error) => {
          this.savingTransmission.set(false);
          this.notifications.showHttpError(error, 'settings.pages.einvoicing.save_failed');
        },
      });
  }

  private loadSettings(): void {
    this.api
      .regimeSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          if (settings) this.settingsForm.patchValue(this.formValueOf(settings));
        },
        error: () => this.notifications.showError('settings.pages.einvoicing.load_failed'),
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
          this.notifications.showSuccess('settings.pages.einvoicing.saved');
        },
        error: (error) => {
          this.savingSettings.set(false);
          this.notifications.showHttpError(error, 'settings.pages.einvoicing.save_failed');
        },
      });
  }
}
