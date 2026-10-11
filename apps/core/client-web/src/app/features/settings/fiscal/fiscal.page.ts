import { VxFileInputComponent } from '../../../shared/components/file-input/file-input.component';
import { Component, OnInit, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  EinvoicingService,
  EcfCertificateView,
  NcfSequenceView,
  NcfType,
} from '../../../core/services/einvoicing';
import { FiscalEmissionMode, InvoicesService, InvoicingContext } from '../../../core/services/invoices';
import { NotificationService } from '../../../core/services/notification';
import { FiscalSettingsService, MarketCoverage } from '../../../core/api/fiscal-settings.service';
import { OrganizationSettingsService } from '../data/organization-settings.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { VxDateFieldComponent } from '../../../shared/components/date/date-field.component';
import { VX_SORT, sortable } from '../../../shared/components/sort';

/** One choice of the emission mode, as the page presents it. */
interface EmissionModeChoice {
  value: FiscalEmissionMode;
  titleKey: string;
  descriptionKey: string;
}

/** A range type the form offers, with the kind it belongs to. */
interface RangeTypeChoice {
  value: NcfType;
  labelKey: string;
}

/**
 * Dominican comprobantes: how the company issues them, the ranges the DGII authorised, and the
 * certificate that signs the electronic ones.
 *
 * A company may issue traditional NCF (serie B: numbered from an authorised range and printed,
 * nothing transmitted), electronic e-CF (serie E: signed with a certificate and sent to the DGII),
 * or both while it moves from one to the other. This page used to configure e-CF only — its range
 * types were E-only and it presented the certificate as mandatory — so a company issuing serie B
 * could not register its ranges, and was told it could not invoice without a certificate it does
 * not need.
 */
@Component({
  selector: 'app-fiscal-settings-page',
  standalone: true,
  imports: [...VX_SORT, VxFileInputComponent, VxDateFieldComponent, CommonModule, ReactiveFormsModule, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, VxBadgeComponent],
  templateUrl: './fiscal.page.html',
  styleUrls: ['./fiscal.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiscalSettingsPage implements OnInit {
  private fb = inject(FormBuilder);
  private einvoicing = inject(EinvoicingService);
  private invoices = inject(InvoicesService);
  private notifications = inject(NotificationService);
  private fiscalSettings = inject(FiscalSettingsService);
  private organizationSettings = inject(OrganizationSettingsService);
  private readonly translate = inject(TranslateService);

  certificates = signal<EcfCertificateView[]>([]);
  sequences = signal<NcfSequenceView[]>([]);
  /** Sortable by their headers (QA B-01). A certificate's state: expired, then inactive, then active. */
  readonly certificatesTable = sortable(() => this.certificates(), {
    status: (c) => (c.expired ? 2 : c.isActive ? 0 : 1),
  });
  readonly sequencesTable = sortable(() => this.sequences(), {
    type: (s) => this.translate.instant(this.ncfTypeLabel(s.type)),
    // Every column sorts, the numbers left included (QA U34).
    remaining: (s) => this.remaining(s),
  });
  uploading = signal(false);
  provisioning = signal(false);
  selectedFile = signal<File | null>(null);

  // ── How the company issues ──────────────────────────────────────────────────
  readonly emissionMode = signal<FiscalEmissionMode>('BOTH');
  readonly savingMode = signal(false);
  readonly modeChoices: EmissionModeChoice[] = [
    {
      value: 'BOTH',
      titleKey: 'settings.fiscal.mode.both_title',
      descriptionKey: 'settings.fiscal.mode.both_description',
    },
    {
      value: 'ELECTRONIC',
      titleKey: 'settings.fiscal.mode.electronic_title',
      descriptionKey: 'settings.fiscal.mode.electronic_description',
    },
    {
      value: 'TRADITIONAL',
      titleKey: 'settings.fiscal.mode.traditional_title',
      descriptionKey: 'settings.fiscal.mode.traditional_description',
    },
  ];

  /** What the invoice form will offer, as the server computes it: the page's live summary. */
  readonly invoicing = signal<InvoicingContext | null>(null);
  readonly issuableNow = computed(() =>
    (this.invoicing()?.fiscalDocumentTypes ?? []).filter((t) => t.issuable),
  );
  /** The certificate matters only when the company may issue electronic comprobantes. */
  readonly certificateRelevant = computed(() => this.emissionMode() !== 'TRADITIONAL');

  /**
   * The range types, by kind. Notes and buyer-issued comprobantes are here too: a range is
   * authorised for them as for any other, even though they are not issued from the invoice form.
   */
  readonly rangeTypeGroups: { labelKey: string; electronic: boolean; types: RangeTypeChoice[] }[] = [
    {
      labelKey: 'settings.fiscal.range_group_electronic',
      electronic: true,
      types: (['E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47'] as NcfType[]).map(choice),
    },
    {
      labelKey: 'settings.fiscal.range_group_traditional',
      electronic: false,
      types: (['B01', 'B02', 'B03', 'B04', 'B11', 'B13', 'B14', 'B15', 'B16', 'B17'] as NcfType[]).map(choice),
    },
  ];

  /** The groups the current mode allows a range for. */
  readonly visibleRangeTypeGroups = computed(() =>
    this.rangeTypeGroups.filter(
      (group) =>
        this.emissionMode() === 'BOTH' || (this.emissionMode() === 'ELECTRONIC') === group.electronic,
    ),
  );

  /** The name of a comprobante type (`E31` → «E31 · Factura de Crédito Fiscal Electrónica»). */
  ncfTypeLabel(type: string): string {
    return `fiscal.do.${type.toLowerCase()}`;
  }

  /**
   * What the product does and does not do in the tenant's market.
   *
   * This page is the Dominican one, and a tenant in any other market who lands here needs to know
   * that before reading a form that does not apply to them.
   */
  readonly coverage = signal<MarketCoverage | null>(null);

  /** Whether the tenant's own market is the Dominican one this page configures. */
  readonly isDominican = signal(true);

  /** `needs-credentials` → `settings.fiscal.level_needs_credentials`. */
  levelKey(level: string): string {
    return composeKey('settings.fiscal.level', level);
  }

  /** The badge tone of a coverage level: a state, not a sentence (QA U31). */
  levelTone(level: string): 'ok' | 'warning' | 'danger' | 'neutral' {
    switch (level) {
      case 'implemented':
        return 'ok';
      case 'needs-credentials':
        return 'warning';
      case 'not-implemented':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  /** `taxDetermination` → `settings.fiscal.tax_determination`. */
  capabilityKey(capability: string): string {
    return composeKey('settings.fiscal.capability', capability);
  }

  certForm = this.fb.group({
    alias: ['', Validators.required],
    password: ['', Validators.required],
  });

  private readonly defaultExpiry = (): string => `${new Date().getFullYear() + 1}-12-31`;

  sequenceForm = this.fb.group({
    type: ['E31' as NcfType, Validators.required],
    prefix: ['E31', [Validators.required, Validators.pattern(/^[BE]\d{2}$/)]],
    startsAt: [1, [Validators.required, Validators.min(1)]],
    endsAt: [1000, [Validators.required, Validators.min(1)]],
    // Every range the DGII authorizes carries an end date, and a document numbered from an expired
    // range is rejected. The DGII's usual horizon — 31 December of the following year — is
    // proposed, not imposed.
    expiresAt: [this.defaultExpiry(), Validators.required],
    authorizationCode: [''],
  });

  /** Ranges at or below this share of their numbers left, or this close to expiry, are flagged. */
  private static readonly LOW_RANGE_SHARE = 0.1;
  private static readonly EXPIRY_WARNING_DAYS = 30;

  /** Numbers still available in a range. */
  remaining(s: NcfSequenceView): number {
    const used = Math.max(s.currentSequence, s.startsAt - 1);
    return Math.max(0, s.endsAt - used);
  }

  /** What the status column warns about, if anything. */
  rangeWarningKey(s: NcfSequenceView): string | null {
    if (!s.isActive) return null;
    if (s.expiresAt) {
      const days = (Date.parse(s.expiresAt.slice(0, 10)) - Date.now()) / 86_400_000;
      if (days < 0) return 'settings.fiscal.range_expired';
      if (days <= FiscalSettingsPage.EXPIRY_WARNING_DAYS) return 'settings.fiscal.range_expiring';
    }
    const size = s.endsAt - s.startsAt + 1;
    if (size > 0 && this.remaining(s) / size <= FiscalSettingsPage.LOW_RANGE_SHARE) return 'settings.fiscal.range_running_low';
    return null;
  }

  ngOnInit(): void {
    this.loadCertificates();
    this.loadSequences();
    this.loadInvoicingState();

    this.organizationSettings.get('fiscal').subscribe({
      next: (view) => {
        const mode = view.fields['fiscalEmissionMode'];
        if (mode === 'BOTH' || mode === 'ELECTRONIC' || mode === 'TRADITIONAL') {
          this.emissionMode.set(mode);
          this.keepRangeTypeInMode();
        }
      },
      error: () => this.notifications.showError('settings.fiscal.mode.load_failed'),
    });

    this.fiscalSettings.coverage().subscribe({
      next: (market) => {
        this.coverage.set(market);
        this.isDominican.set(market.countryCode === 'DO');
      },
      // Context, not the point of the page.
      error: () => this.coverage.set(null),
    });

    // Keep the prefix in step with the selected type by default.
    this.sequenceForm.get('type')?.valueChanges.subscribe((t) => {
      if (t) this.sequenceForm.patchValue({ prefix: t }, { emitEvent: false });
    });
  }

  /** Change how the company issues. Saved at once: it is one choice, not a form. */
  setEmissionMode(mode: FiscalEmissionMode): void {
    if (mode === this.emissionMode() || this.savingMode()) return;
    const previous = this.emissionMode();
    this.emissionMode.set(mode);
    this.savingMode.set(true);
    this.organizationSettings.update('fiscal', { fields: { fiscalEmissionMode: mode } }).subscribe({
      next: () => {
        this.savingMode.set(false);
        this.keepRangeTypeInMode();
        this.loadInvoicingState();
        this.notifications.showSuccess('settings.fiscal.mode.saved');
      },
      error: (err) => {
        this.emissionMode.set(previous);
        this.savingMode.set(false);
        this.notifications.showHttpError(err, 'settings.fiscal.mode.save_failed');
      },
    });
  }

  /** The range form proposes a type of a kind the company issues. */
  private keepRangeTypeInMode(): void {
    const current = this.sequenceForm.get('type')?.value;
    const allowed = this.visibleRangeTypeGroups().flatMap((group) => group.types.map((t) => t.value));
    if (current && !allowed.includes(current)) {
      const first = allowed.find((t) => t.endsWith('01') || t.endsWith('31')) ?? allowed[0];
      if (first) this.sequenceForm.patchValue({ type: first, prefix: first });
    }
  }

  private loadInvoicingState(): void {
    this.invoices.context().subscribe({
      next: (context) => this.invoicing.set(context),
      // A summary, not the point of the page.
      error: () => this.invoicing.set(null),
    });
  }

  private loadCertificates(): void {
    this.einvoicing.listCertificates().subscribe({
      next: (c) => this.certificates.set(c),
      error: () => this.notifications.showError('settings.fiscal.certificates_could_not_loaded'),
    });
  }

  private loadSequences(): void {
    this.einvoicing.listSequences().subscribe({
      next: (s) => this.sequences.set(s),
      error: () => this.notifications.showError('settings.fiscal.do.ncf_sequences_load_failed'),
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  uploadCertificate(): void {
    const file = this.selectedFile();
    if (!file) {
      this.notifications.showError('settings.fiscal.select_certificate_file_p12_pfx');
      return;
    }
    if (this.certForm.invalid) {
      this.certForm.markAllAsTouched();
      return;
    }
    this.uploading.set(true);
    const { alias, password } = this.certForm.getRawValue();
    this.einvoicing.uploadCertificate(file, password ?? '', alias ?? '').subscribe({
      next: () => {
        this.notifications.showSuccess('settings.fiscal.certificate_uploaded_validated_successfully');
        this.certForm.reset();
        this.selectedFile.set(null);
        this.uploading.set(false);
        this.loadCertificates();
        this.loadInvoicingState();
      },
      error: (err) => {
        this.notifications.showHttpError(err, 'errors.load_certificate');
        this.uploading.set(false);
      },
    });
  }

  deactivateCertificate(id: string): void {
    this.einvoicing.deactivateCertificate(id).subscribe({
      next: () => {
        this.notifications.showInfo('settings.fiscal.certificate_deactivated');
        this.loadCertificates();
        this.loadInvoicingState();
      },
      error: () => this.notifications.showError('settings.fiscal.certificate_could_not_deactivated'),
    });
  }

  provisionSequence(): void {
    if (this.sequenceForm.invalid) {
      this.sequenceForm.markAllAsTouched();
      return;
    }
    const value = this.sequenceForm.getRawValue();
    const startsAt = Number(value.startsAt);
    const endsAt = Number(value.endsAt);
    if (endsAt < startsAt) {
      this.notifications.showError('settings.fiscal.ending_number_cannot_lower_than_starting');
      return;
    }
    this.provisioning.set(true);
    this.einvoicing
      .provisionSequence({
        type: value.type as NcfType,
        prefix: value.prefix ?? '',
        startsAt,
        endsAt,
        expiresAt: value.expiresAt || undefined,
        authorizationCode: value.authorizationCode?.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.notifications.showSuccess('settings.fiscal.do.ncf_range_registered');
          this.provisioning.set(false);
          // The range is registered: the form is emptied for the next one. It used to keep the
          // values, so a second click tried to register the same range again (QA U35).
          this.sequenceForm.reset({
            type: value.type,
            prefix: value.type,
            startsAt: 1,
            endsAt: 1000,
            expiresAt: this.defaultExpiry(),
            authorizationCode: '',
          });
          this.loadSequences();
          this.loadInvoicingState();
        },
        error: (err) => {
          this.notifications.showHttpError(err, 'errors.register_range');
          this.provisioning.set(false);
        },
      });
  }
}

function choice(value: NcfType): RangeTypeChoice {
  return { value, labelKey: `fiscal.do.${value.toLowerCase()}` };
}
