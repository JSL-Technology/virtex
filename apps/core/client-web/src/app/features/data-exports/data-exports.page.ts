import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { LucideAngularModule, DownloadCloud, File, CheckCircle, AlertCircle, Loader } from 'lucide-angular';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../shared/components/gestures';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxBadgeComponent, VxTone } from '../../shared/components/badge';

// Tipos de datos para la página
type ExportStatus = 'Completed' | 'Generating' | 'Failed';
interface ExportHistoryItem {
  id: string;
  dataType: string;
  format: 'CSV' | 'XLSX';
  date: string;
  user: string;
  status: ExportStatus;
  downloadUrl?: string;
}
interface DataType {
  id: 'customers' | 'products' | 'suppliers' | 'invoices' | 'sales';
  name: string;
}

@Component({
  selector: 'app-data-exports-page',
  standalone: true,
  imports: [ReactiveFormsModule, LucideAngularModule, TranslateModule, ListShellComponent, ...VX_FORM_A11Y, VxBadgeComponent],
  templateUrl: './data-exports.page.html',
  styleUrls: ['./data-exports.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataExportsPage {
  private fb = inject(FormBuilder);

  // Íconos
  protected readonly DownloadIcon = DownloadCloud;
  protected readonly FileIcon = File;
  protected readonly SuccessIcon = CheckCircle;
  protected readonly ErrorIcon = AlertCircle;
  protected readonly ProcessingIcon = Loader;

  // Formulario y Estado
  exportForm: FormGroup;
  isGenerating = signal(false);

  // Datos simulados
  dataTypes: DataType[] = [
    { id: 'customers', name: 'Customers' },
    { id: 'products', name: 'Products' },
    { id: 'suppliers', name: 'Suppliers' },
    { id: 'invoices', name: 'Invoices' },
    { id: 'sales', name: 'Sales' },
  ];

  exportHistory = signal<ExportHistoryItem[]>([
    { id: 'EXP-001', dataType: 'Customers', format: 'CSV', date: 'Jul 26, 2025', user: 'Admin Principal', status: 'Completed', downloadUrl: '#' },
    { id: 'EXP-002', dataType: 'Invoices', format: 'XLSX', date: 'Jul 25, 2025', user: 'Admin Principal', status: 'Completed', downloadUrl: '#' },
    { id: 'EXP-003', dataType: 'Sales', format: 'CSV', date: 'Jul 24, 2025', user: 'Ana Pérez', status: 'Failed' },
  ]);

  constructor() {
    this.exportForm = this.fb.group({
      dataType: [null, [Validators.required]],
      format: ['csv', [Validators.required]],
    });
  }

  startExport(): void {
    if (this.exportForm.invalid) return;
    this.isGenerating.set(true);
    console.log('Generating export with options:', this.exportForm.value);

    // Simulación de la generación del archivo
    setTimeout(() => {
      this.isGenerating.set(false);
      // En una app real, se añadiría el nuevo item al historial
    }, 2500);
  }

  statusTone(status: ExportStatus): VxTone {
    if (status === 'Completed') return 'ok';
    if (status === 'Generating') return 'info';
    if (status === 'Failed') return 'danger';
    //  Antes devolvía '' y la insignia salía sin color: un estado desconocido se veía igual que
    //  uno neutro deliberado. Ahora se ve como lo que es.
    return 'neutral';
  }
}