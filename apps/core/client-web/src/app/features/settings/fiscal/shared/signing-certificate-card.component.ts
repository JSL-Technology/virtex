import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { EinvoicingService, EcfCertificateView } from '../../../../core/services/einvoicing';
import { InvoicingContext } from '../../../../core/services/invoices';
import { NotificationService } from '../../../../core/services/notification';
import { VxBadgeComponent } from '../../../../shared/components/badge';
import { VxFileButtonComponent } from '../../../../shared/components/file-button';
import { VxEmptyStateComponent, VxErrorStateComponent } from '../../../../shared/components/feedback';
import { DialogService } from '../../../../core/services/dialog.service';
import { VX_SORT, sortable } from '../../../../shared/components/sort';
import { FileKey } from 'lucide-angular';
import { SettingsGroupComponent } from '../../shared/settings-group.component';
import { SettingsChanges, SettingsShellService } from '../../shell';

import { VX_TABLE } from '../../../../shared/components/table';
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
  imports: [...VX_TABLE, 
    ...VX_SORT,
    ReactiveFormsModule,
    TranslateModule,
    ...FORMAT_PIPES,
    ...VX_FORM_A11Y,
    VxBadgeComponent,
    VxFileButtonComponent,
    VxEmptyStateComponent,
    VxErrorStateComponent,
    SettingsGroupComponent,
  ],
  templateUrl: './signing-certificate-card.component.html',
  styleUrls: ['./signing-certificate-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SigningCertificateCardComponent {
  private readonly fb = inject(FormBuilder);
  private readonly einvoicing = inject(EinvoicingService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly shell = inject(SettingsShellService, { optional: true });
  protected readonly CertificateIcon = FileKey;

  readonly context = input<InvoicingContext | null>(null);
  /** Shown, not changeable: the reader may see the fiscal set-up without `taxes:edit`. */
  readonly readonly = input(false);
  /** A certificate was loaded or switched off: readiness should be read again. */
  readonly changed = output<void>();

  readonly certificates = signal<EcfCertificateView[]>([]);
  /** The list could not be read: said in place, with a retry (EST-02). */
  readonly loadFailed = signal(false);
  readonly uploading = signal(false);
  readonly selectedFile = signal<File | null>(null);
  /** Something typed or chosen and not uploaded: closing the window asks before dropping it (GUA-01). */
  readonly formDirty = signal(false);
  private readonly changes: SettingsChanges = {
    dirty: this.formDirty,
    discard: () => this.resetForm(),
  };

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
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.refreshDirty());
    if (this.shell) {
      this.shell.register(this.changes);
      inject(DestroyRef).onDestroy(() => this.shell?.unregister(this.changes));
    }
  }

  load(): void {
    this.loadFailed.set(false);
    this.einvoicing.listCertificates().subscribe({
      next: (rows) => this.certificates.set(rows),
      error: () => this.loadFailed.set(true),
    });
  }

  onFile(file: File): void {
    this.selectedFile.set(file);
    this.refreshDirty();
  }

  private refreshDirty(): void {
    const { alias, password } = this.form.getRawValue();
    this.formDirty.set(Boolean(alias || password || this.selectedFile()));
  }

  private resetForm(): void {
    this.form.reset();
    this.selectedFile.set(null);
    this.formDirty.set(false);
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
        this.resetForm();
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

  /** Switching the certificate off stops electronic issuance until another is loaded: asked first (ACC-04). */
  async deactivate(certificate: EcfCertificateView): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'settings.fiscal.deactivate_certificate_title',
      message: 'settings.fiscal.deactivate_certificate_message',
      messageParams: { alias: certificate.alias },
      confirmText: 'settings.fiscal.turn_off',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.einvoicing.deactivateCertificate(certificate.id).subscribe({
      next: () => {
        this.notifications.showInfo('settings.fiscal.certificate_deactivated');
        this.load();
        this.changed.emit();
      },
      error: () => this.notifications.showError('settings.fiscal.certificate_could_not_deactivated'),
    });
  }
}
