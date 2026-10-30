import { Component, OnInit, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EinvoicingService, NcfSequenceView, NcfType } from '../../../core/services/einvoicing';
import { FiscalEmissionMode, InvoicesService, InvoicingContext } from '../../../core/services/invoices';
import { NotificationService } from '../../../core/services/notification';
import {
  FiscalDocumentTypeView,
  FiscalSettingsService,
  MarketCoverage,
} from '../../../core/api/fiscal-settings.service';
import { EmissionModeCardComponent, SigningCertificateCardComponent } from './shared';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { VxDateFieldComponent } from '../../../shared/components/date/date-field.component';
import { VX_SORT, sortable } from '../../../shared/components/sort';

/** A range type the form offers. */
interface RangeTypeChoice {
  value: string;
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
  imports: [
    ...VX_SORT,
    VxDateFieldComponent,
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    ...FORMAT_PIPES,
    ...VX_FORM_A11Y,
    VxBadgeComponent,
    EmissionModeCardComponent,
    SigningCertificateCardComponent,
  ],
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
  private readonly translate = inject(TranslateService);

  sequences = signal<NcfSequenceView[]>([]);
  /** Sortable by their headers (QA B-01). */
  readonly sequencesTable = sortable(() => this.sequences(), {
    type: (s) => this.translate.instant(this.ncfTypeLabel(s.type)),
    // Every column sorts, the numbers left included (QA U34).
    remaining: (s) => this.remaining(s),
  });
  provisioning = signal(false);

  // ── How the company issues (`vx-emission-mode-card` reads and saves it) ──────────
  readonly emissionMode = signal<FiscalEmissionMode>('BOTH');

  /** What the invoice form will offer, as the server computes it: the page's live summary. */
  readonly invoicing = signal<InvoicingContext | null>(null);

  /**
   * The range types, by kind, from the market's catalogue (`GET localization/fiscal-document-types`).
   * Notes and buyer-issued comprobantes are here too: a range is authorised for them as for any
   * other, even though they are not issued from the invoice form. The page used to carry its own
   * list of codes, so a type added to the catalogue never reached it.
   */
  readonly documentTypes = signal<FiscalDocumentTypeView[]>([]);
  readonly rangeTypeGroups = computed(() =>
    [
      { labelKey: 'settings.fiscal.range_group_electronic', electronic: true },
      { labelKey: 'settings.fiscal.range_group_traditional', electronic: false },
    ]
      .map((group) => ({
        ...group,
        types: this.documentTypes()
          .filter((type) => type.isElectronic === group.electronic)
          .map((type): RangeTypeChoice => ({ value: type.code, labelKey: type.labelKey ?? type.name })),
      }))
      .filter((group) => group.types.length > 0),
  );

  /** The groups the current mode allows a range for. */
  readonly visibleRangeTypeGroups = computed(() =>
    this.rangeTypeGroups().filter(
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

  private readonly defaultExpiry = (): string => `${new Date().getFullYear() + 1}-12-31`;

  sequenceForm = this.fb.group({
    type: ['', Validators.required],
    prefix: ['', [Validators.required, Validators.maxLength(3)]],
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
    this.loadSequences();
    this.loadInvoicingState();

    this.fiscalSettings.documentTypes().subscribe({
      next: (types) => {
        this.documentTypes.set(types);
        this.keepRangeTypeInMode();
      },
      error: () => this.notifications.showError('settings.fiscal.document_types_load_failed'),
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

  /** The emission-mode card read or changed the mode: the range form follows it. */
  onModeChange(mode: FiscalEmissionMode): void {
    this.emissionMode.set(mode);
    this.keepRangeTypeInMode();
  }

  /** Something the issue readiness depends on changed: read it again. */
  refreshInvoicingState(): void {
    this.loadInvoicingState();
  }

  /** The range form proposes a type of a kind the company issues: its first ordinary invoice type. */
  private keepRangeTypeInMode(): void {
    const current = this.sequenceForm.get('type')?.value;
    const allowed = this.visibleRangeTypeGroups().flatMap((group) => group.types.map((t) => t.value));
    if (!current || !allowed.includes(current)) {
      const sales = this.documentTypes().filter((t) => allowed.includes(t.code) && t.side === 'sales' && !t.isCreditNote);
      const first = sales[0]?.code ?? allowed[0];
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

  private loadSequences(): void {
    this.einvoicing.listSequences().subscribe({
      next: (s) => this.sequences.set(s),
      error: () => this.notifications.showError('settings.fiscal.do.ncf_sequences_load_failed'),
    });
  }

  provisionSequence(): void {
    if (this.sequenceForm.invalid) {
      this.sequenceForm.markAllAsTouched();
      // Marking the fields was all it did: an empty form answered «Registrar rango» with nothing at
      // all (QA R3-M15). It now says which fields are missing and puts the cursor in the first.
      const labels: Record<string, string> = {
        type: 'settings.fiscal.type',
        prefix: 'settings.fiscal.prefix',
        startsAt: 'settings.fiscal.from',
        endsAt: 'settings.fiscal.to',
        expiresAt: 'settings.fiscal.expires_on',
      };
      const missing = Object.keys(labels).filter((name) => this.sequenceForm.get(name)?.invalid);
      this.notifications.showError('settings.fiscal.range_form_incomplete', {
        fields: missing.map((name) => this.translate.instant(labels[name])).join(', '),
      });
      const ids: Record<string, string> = { type: 'range-type', prefix: 'range-prefix', startsAt: 'range-from', endsAt: 'range-to', expiresAt: 'range-expires-at' };
      if (missing[0]) (document.getElementById(ids[missing[0]]) as HTMLElement | null)?.focus();
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
