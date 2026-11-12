import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule, FORMAT_PIPES, VxNumberInputDirective } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { FiscalEmissionMode } from '../../../../core/services/invoices';
import { NotificationService } from '../../../../core/services/notification';
import { FiscalDocumentTypeView, FiscalRange, FiscalSettingsService } from '../../data/fiscal-settings.service';
import { VxBadgeComponent } from '../../../../shared/components/badge';
import { VxDateFieldComponent } from '../../../../shared/components/date';
import { VX_SORT, sortable } from '../../../../shared/components/sort';

/** What the authority issues with a range, where it issues anything (the CAF, a technical key). */
export type FiscalRangeSecretKind = 'AUTHORISED_FOLIOS' | 'TECHNICAL_KEY';

/**
 * The number ranges the tenant's authority granted it, in any market that numbers from one: the
 * list, registering a new one, retiring one and putting it back in force.
 *
 * One card for every market. The Dominican page kept its own copy against an API of its own
 * (`compliance/ncf-sequences`), with its own rules and its own idea of when a range was running
 * out; both are now the server's (`einvoicing/regime/ranges`), and what differs between markets —
 * which types exist, whether their ranges expire, which series a type may carry — is the market's
 * catalogue, enforced where the range is registered.
 */
@Component({
  selector: 'vx-fiscal-ranges-card',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SORT, VxNumberInputDirective, VxBadgeComponent, VxDateFieldComponent],
  templateUrl: './fiscal-ranges-card.component.html',
  styleUrls: ['./fiscal-ranges-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiscalRangesCardComponent implements OnInit {
  private readonly api = inject(FiscalSettingsService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  /** The market's document types, from its catalogue (`GET localization/fiscal-document-types`). */
  readonly documentTypes = input<FiscalDocumentTypeView[]>([]);
  /** How the company issues, where the market has both kinds of document. */
  readonly emissionMode = input<FiscalEmissionMode>('BOTH');
  /** Whether the market has both kinds of document, so the mode narrows the types offered. */
  readonly emissionModeApplies = input(false);
  /** What the market's authority issues with a range, or null where it issues nothing. */
  readonly secretKind = input<FiscalRangeSecretKind | null>(null);
  /** Shown, not changeable: the reader may see the ranges without `taxes:edit`. */
  readonly readonly = input(false);
  /** A range was registered, retired or reactivated: whatever depends on it should be read again. */
  readonly changed = output<void>();

  readonly ranges = signal<FiscalRange[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly showForm = signal(false);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.ranges(), {
    documentType: (range) => range.documentType,
    remaining: (range) => range.remaining,
  });

  /** The types a range can be registered for under the current mode, in the catalogue's order. */
  readonly rangeDocumentTypes = computed(() => {
    const mode = this.emissionMode();
    return this.documentTypes().filter(
      (type) => !this.emissionModeApplies() || mode === 'BOTH' || (mode === 'ELECTRONIC') === type.isElectronic,
    );
  });

  readonly form = this.fb.group({
    documentType: ['', Validators.required],
    series: [''],
    startsAt: [1, [Validators.required, Validators.min(1)]],
    endsAt: [1, [Validators.required, Validators.min(1)]],
    validUntil: [''],
    authorizationCode: [''],
    secret: [''],
  });

  /** Whether the selected type's ranges expire, so the date is asked for before the server refuses. */
  readonly expiryRequired = signal(false);

  constructor() {
    // A type the mode no longer allows is not left selected.
    effect(() => {
      const allowed = this.rangeDocumentTypes().map((type) => type.code);
      const current = this.form.controls.documentType.value;
      if (current && !allowed.includes(current)) this.form.controls.documentType.setValue('');
    });
  }

  ngOnInit(): void {
    this.form.controls.documentType.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((code) => {
      const required = this.documentTypes().find((type) => type.code === code)?.expirationRequired === true;
      this.expiryRequired.set(required);
      const control = this.form.controls.validUntil;
      control.setValidators(required ? [Validators.required] : []);
      control.updateValueAndValidity({ emitEvent: false });
    });
    this.load();
  }

  /** The label of a document type: its catalogue key, or the authority's own name. */
  documentTypeLabel(code: string): string {
    const type = this.documentTypes().find((candidate) => candidate.code === code);
    return type?.labelKey ?? type?.name ?? code;
  }

  toggleForm(): void {
    this.showForm.update((open) => !open);
  }

  register(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.showError('settings.fiscal.range_form_required_fields');
      return;
    }
    const value = this.form.getRawValue();
    if (Number(value.endsAt) < Number(value.startsAt)) {
      this.notifications.showError('settings.pages.einvoicing.range_bounds');
      return;
    }
    const kind = this.secretKind();
    this.saving.set(true);
    this.api
      .registerRange({
        documentType: value.documentType ?? '',
        series: value.series?.trim() || undefined,
        startsAt: Number(value.startsAt),
        endsAt: Number(value.endsAt),
        validUntil: value.validUntil?.trim() || undefined,
        authorizationCode: value.authorizationCode?.trim() || undefined,
        secret: value.secret?.trim() || undefined,
        // The kind is the market's, not asked for: a tenant should not have to know that their CAF
        // is called `AUTHORISED_FOLIOS` in this product.
        secretKind: value.secret?.trim() && kind ? kind : undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.showForm.set(false);
          this.notifications.showSuccess('settings.fiscal.range_registered');
          // Emptied for the next one: keeping the values made a second click register the same
          // range again (QA U35).
          this.form.reset({ documentType: value.documentType, series: '', startsAt: 1, endsAt: 1, validUntil: '', authorizationCode: '', secret: '' });
          this.load();
          this.changed.emit();
        },
        error: (error) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'errors.register_range');
        },
      });
  }

  /** Retire a range, or put a superseded one back in force (which retires the one in force). */
  setActive(range: FiscalRange, isActive: boolean): void {
    this.api
      .setRangeActive(range.id, isActive)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.load();
          this.changed.emit();
        },
        error: (error) => this.notifications.showHttpError(error, 'settings.pages.einvoicing.save_failed'),
      });
  }

  /** What the status column says: the server's reading of the range, not one computed here. */
  statusKey(range: FiscalRange): { key: string; tone: 'ok' | 'warning' | 'danger' | 'neutral' } {
    if (!range.isActive) return { key: 'settings.fiscal.range_status_retired', tone: 'neutral' };
    if (range.expired) return { key: 'settings.fiscal.range_status_expired', tone: 'danger' };
    if (range.remaining === 0) return { key: 'settings.fiscal.range_status_exhausted', tone: 'danger' };
    if (range.runningLow) return { key: 'settings.fiscal.range_status_running_low', tone: 'warning' };
    return { key: 'settings.fiscal.range_status_active', tone: 'ok' };
  }

  private load(): void {
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
          this.notifications.showError('settings.pages.einvoicing.load_failed');
        },
      });
  }
}
