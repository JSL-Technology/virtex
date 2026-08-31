import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  EinvoicingService,
  EcfCertificateView,
  NcfSequenceView,
  NcfType,
} from '../../../core/services/einvoicing';
import { NotificationService } from '../../../core/services/notification';

/**
 * Dominican Republic fiscal configuration: DGII signing certificate, authorized e-NCF ranges, and
 * the 606/607 report downloads. This is what makes electronic invoicing usable — without a
 * certificate and at least one active e-NCF range no e-CF can be issued.
 */
@Component({
  selector: 'app-fiscal-settings-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './fiscal.page.html',
  styleUrls: ['./fiscal.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiscalSettingsPage implements OnInit {
  private fb = inject(FormBuilder);
  private einvoicing = inject(EinvoicingService);
  private notifications = inject(NotificationService);

  certificates = signal<EcfCertificateView[]>([]);
  sequences = signal<NcfSequenceView[]>([]);
  uploading = signal(false);
  provisioning = signal(false);
  downloading = signal(false);
  selectedFile = signal<File | null>(null);

  readonly ncfTypes: { value: NcfType; label: string }[] = [
    { value: 'E31', label: 'E31 · Crédito Fiscal Electrónico' },
    { value: 'E32', label: 'E32 · Consumo Electrónico' },
    { value: 'E33', label: 'E33 · Nota de Débito Electrónica' },
    { value: 'E34', label: 'E34 · Nota de Crédito Electrónica' },
    { value: 'E41', label: 'E41 · Compras Electrónico' },
    { value: 'E43', label: 'E43 · Gastos Menores Electrónico' },
    { value: 'E44', label: 'E44 · Regímenes Especiales Electrónico' },
    { value: 'E45', label: 'E45 · Gubernamental Electrónico' },
    { value: 'E46', label: 'E46 · Exportaciones Electrónico' },
    { value: 'E47', label: 'E47 · Pagos al Exterior Electrónico' },
  ];

  certForm = this.fb.group({
    alias: ['', Validators.required],
    password: ['', Validators.required],
  });

  sequenceForm = this.fb.group({
    type: ['E31' as NcfType, Validators.required],
    prefix: ['E31', [Validators.required, Validators.pattern(/^[BE]\d{2}$/)]],
    startsAt: [1, [Validators.required, Validators.min(1)]],
    endsAt: [1000, [Validators.required, Validators.min(1)]],
  });

  reportForm = this.fb.group({
    kind: ['607' as '606' | '607', Validators.required],
    year: [new Date().getFullYear(), [Validators.required, Validators.min(2000)]],
    month: [new Date().getMonth() + 1, [Validators.required, Validators.min(1), Validators.max(12)]],
  });

  ngOnInit(): void {
    this.loadCertificates();
    this.loadSequences();
    // Keep the prefix in step with the selected type by default.
    this.sequenceForm.get('type')!.valueChanges.subscribe((t) => {
      if (t) this.sequenceForm.patchValue({ prefix: t }, { emitEvent: false });
    });
  }

  private loadCertificates(): void {
    this.einvoicing.listCertificates().subscribe({
      next: (c) => this.certificates.set(c),
      error: () => this.notifications.showError('No se pudieron cargar los certificados.'),
    });
  }

  private loadSequences(): void {
    this.einvoicing.listSequences().subscribe({
      next: (s) => this.sequences.set(s),
      error: () => this.notifications.showError('No se pudieron cargar las secuencias NCF.'),
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  uploadCertificate(): void {
    const file = this.selectedFile();
    if (!file) {
      this.notifications.showError('Seleccione el archivo del certificado (.p12 / .pfx).');
      return;
    }
    if (this.certForm.invalid) {
      this.certForm.markAllAsTouched();
      return;
    }
    this.uploading.set(true);
    const { alias, password } = this.certForm.getRawValue();
    this.einvoicing.uploadCertificate(file, password!, alias!).subscribe({
      next: () => {
        this.notifications.showSuccess('Certificado cargado y validado correctamente.');
        this.certForm.reset();
        this.selectedFile.set(null);
        this.uploading.set(false);
        this.loadCertificates();
      },
      error: (err) => {
        this.notifications.showError(err?.error?.message || 'No se pudo cargar el certificado.');
        this.uploading.set(false);
      },
    });
  }

  deactivateCertificate(id: string): void {
    this.einvoicing.deactivateCertificate(id).subscribe({
      next: () => {
        this.notifications.showInfo('Certificado desactivado.');
        this.loadCertificates();
      },
      error: () => this.notifications.showError('No se pudo desactivar el certificado.'),
    });
  }

  provisionSequence(): void {
    if (this.sequenceForm.invalid) {
      this.sequenceForm.markAllAsTouched();
      return;
    }
    const value = this.sequenceForm.getRawValue();
    if (value.endsAt! < value.startsAt!) {
      this.notifications.showError('El número final no puede ser menor que el inicial.');
      return;
    }
    this.provisioning.set(true);
    this.einvoicing
      .provisionSequence({
        type: value.type!,
        prefix: value.prefix!,
        startsAt: value.startsAt!,
        endsAt: value.endsAt!,
      })
      .subscribe({
        next: () => {
          this.notifications.showSuccess('Rango de e-NCF registrado.');
          this.provisioning.set(false);
          this.loadSequences();
        },
        error: (err) => {
          this.notifications.showError(err?.error?.message || 'No se pudo registrar el rango.');
          this.provisioning.set(false);
        },
      });
  }

  downloadReport(): void {
    if (this.reportForm.invalid) {
      this.reportForm.markAllAsTouched();
      return;
    }
    const { kind, year, month } = this.reportForm.getRawValue();
    this.downloading.set(true);
    this.einvoicing.downloadReport(kind!, year!, month!).subscribe({
      next: (blob) => {
        this.triggerDownload(blob, `DGII_${kind}_${year}${String(month).padStart(2, '0')}.txt`);
        this.downloading.set(false);
      },
      error: (err) => {
        this.notifications.showError(err?.error?.message || 'No se pudo generar el reporte.');
        this.downloading.set(false);
      },
    });
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
