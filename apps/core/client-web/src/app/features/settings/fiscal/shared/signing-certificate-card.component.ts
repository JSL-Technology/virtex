import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { EinvoicingService, EcfCertificateView } from '../../../../core/services/einvoicing';
import { InvoicingContext } from '../../../../core/services/invoices';
import { NotificationService } from '../../../../core/services/notification';
import { VxBadgeComponent } from '../../../../shared/components/badge';
import { VxFileInputComponent } from '../../../../shared/components/file-input/file-input.component';
import { VX_SORT, sortable } from '../../../../shared/components/sort';

/**
 * The certificate that signs the company's electronic documents — in any market whose regime signs
 * with one (`InvoicingContext.certificateRequired`): a DGII certificate, a Mexican CSD, a DIAN,
 * SUNAT, SRI, SII, AFIP or e-CNPJ certificate.
 *
 * The server files it under the regime of the company's market and checks that it is the
 * company's — or, where the market allows it, its representative's — so the card names the
 * holder with its market's own identifier (`RNC`, `RFC`, `NIT`…) and never assumes one country.
 * Where the company issues traditional documents only, it says no certificate is needed.
 */
@Component({
  selector: 'vx-signing-certificate-card',
  standalone: true,
  imports: [
    ...VX_SORT,
    ReactiveFormsModule,
    TranslatePipe,
    ...FORMAT_PIPES,
    ...VX_FORM_A11Y,
    VxBadgeComponent,
    VxFileInputComponent,
  ],
  templateUrl: './signing-certificate-card.component.html',
  styleUrls: ['./signing-certificate-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SigningCertificateCardComponent {
  private readonly fb = inject(FormBuilder);
  private readonly einvoicing = inject(EinvoicingService);
  private readonly notifications = inject(NotificationService);

  readonly context = input<InvoicingContext | null>(null);
  /** A certificate was loaded or switched off: readiness should be read again. */
  readonly changed = output<void>();

  readonly certificates = signal<EcfCertificateView[]>([]);
  readonly uploading = signal(false);
  readonly selectedFile = signal<File | null>(null);

  /** A certificate's state sorts expired last, then inactive, then active. */
  readonly table = sortable(() => this.certificates(), {
    status: (c) => (c.expired ? 2 : c.isActive ? 0 : 1),
  });

  readonly authority = computed(() => this.context()?.fiscalAuthority ?? '—');
  readonly taxIdLabel = computed(() => this.context()?.taxIdLabel ?? '');
  /** The market signs its electronic documents with a certificate the company uploads. */
  readonly required = computed(() => this.context()?.certificateRequired === true);
  /** The company issues electronic documents at all: in traditional mode it needs no certificate. */
  readonly relevant = computed(() => {
    const state = this.context();
    if (!state) return true;
    return !(state.emissionModeApplies && state.emissionMode === 'TRADITIONAL');
  });
  readonly exampleName = computed(() => ({ authority: this.authority(), year: new Date().getFullYear() }));

  readonly form = this.fb.group({
    alias: ['', Validators.required],
    password: ['', Validators.required],
  });

  /** Listed once the market is known to sign with a certificate: elsewhere there is none to list. */
  private loaded = false;
  constructor() {
    effect(() => {
      if (!this.required() || this.loaded) return;
      this.loaded = true;
      untracked(() => this.load());
    });
  }

  private load(): void {
    this.einvoicing.listCertificates().subscribe({
      next: (rows) => this.certificates.set(rows),
      error: () => this.notifications.showError('settings.fiscal.certificates_could_not_loaded'),
    });
  }

  onFileSelected(event: Event): void {
    const element = event.target as HTMLInputElement;
    this.selectedFile.set(element.files?.[0] ?? null);
  }

  upload(): void {
    const file = this.selectedFile();
    if (!file) {
      this.notifications.showError('settings.fiscal.select_certificate_file_p12_pfx');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.uploading.set(true);
    const { alias, password } = this.form.getRawValue();
    this.einvoicing.uploadCertificate(file, password ?? '', alias ?? '').subscribe({
      next: () => {
        this.notifications.showSuccess('settings.fiscal.certificate_uploaded_validated_successfully');
        this.form.reset();
        this.selectedFile.set(null);
        this.uploading.set(false);
        this.load();
        this.changed.emit();
      },
      error: (err) => {
        this.notifications.showHttpError(err, 'errors.load_certificate');
        this.uploading.set(false);
      },
    });
  }

  deactivate(id: string): void {
    this.einvoicing.deactivateCertificate(id).subscribe({
      next: () => {
        this.notifications.showInfo('settings.fiscal.certificate_deactivated');
        this.load();
        this.changed.emit();
      },
      error: () => this.notifications.showError('settings.fiscal.certificate_could_not_deactivated'),
    });
  }
}
