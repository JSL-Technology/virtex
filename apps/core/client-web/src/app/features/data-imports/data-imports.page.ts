import { Component, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, UploadCloud, Download, File, CheckCircle, AlertCircle, Loader } from 'lucide-angular';

// Tipos de datos para la página
type ImportStatus = 'Completed' | 'Processing' | 'Failed';
interface ImportHistoryItem {
  id: string;
  dataType: string;
  fileName: string;
  date: string;
  user: string;
  status: ImportStatus;
  recordsProcessed: number;
  recordsFailed: number;
}
interface DataType {
  id: 'customers' | 'products' | 'suppliers';
  name: string;
  templateUrl: string;
}

@Component({
  selector: 'app-data-imports-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './data-imports.page.html',
  styleUrls: ['./data-imports.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataImportsPage {
  // Íconos
  protected readonly UploadIcon = UploadCloud;
  protected readonly DownloadIcon = Download;
  protected readonly FileIcon = File;
  protected readonly SuccessIcon = CheckCircle;
  protected readonly ErrorIcon = AlertCircle;
  protected readonly ProcessingIcon = Loader;

  // Estado
  selectedFile = signal<File | null>(null);
  selectedDataTypeId = signal<DataType['id'] | null>(null);
  isUploading = signal(false);

  // Datos
  dataTypes: DataType[] = [
    { id: 'customers', name: 'Customers', templateUrl: '/assets/templates/customers_template.csv' },
    { id: 'products', name: 'Products', templateUrl: '/assets/templates/products_template.csv' },
    { id: 'suppliers', name: 'Suppliers', templateUrl: '/assets/templates/suppliers_template.csv' },
  ];

  importHistory = signal<ImportHistoryItem[]>([
    { id: 'IMP-001', dataType: 'Customers', fileName: 'clientes_julio.csv', date: 'Jul 25, 2025', user: 'Admin Principal', status: 'Completed', recordsProcessed: 150, recordsFailed: 0 },
    { id: 'IMP-002', dataType: 'Products', fileName: 'catalogo_inicial.xlsx', date: 'Jul 22, 2025', user: 'Admin Principal', status: 'Failed', recordsProcessed: 80, recordsFailed: 15 },
    { id: 'IMP-003', dataType: 'Customers', fileName: 'nuevos_contactos.csv', date: 'Jul 20, 2025', user: 'Ana Pérez', status: 'Processing', recordsProcessed: 200, recordsFailed: 0 },
  ]);
  
  /**
   * ✅ SOLUCIÓN 1: Se crea una señal computada para encontrar el objeto DataType completo.
   * La plantilla ahora solo leerá esta señal, eliminando la lógica compleja del HTML.
   */
  selectedDataTypeInfo = computed(() => {
    const selectedId = this.selectedDataTypeId();
    if (!selectedId) {
      return null;
    }
    return this.dataTypes.find(t => t.id === selectedId) ?? null;
  });

  onDataTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as DataType['id'];
    this.selectedDataTypeId.set(value);
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.selectedFile.set(file);
    }
  }

  startImport(): void {
    if (!this.selectedFile() || !this.selectedDataTypeId()) return;
    this.isUploading.set(true);
    console.log(`Uploading ${this.selectedFile()!.name} for data type ${this.selectedDataTypeId()}`);

    setTimeout(() => {
      this.isUploading.set(false);
      this.selectedFile.set(null);
    }, 2500);
  }

  getStatusClass(status: ImportStatus): string {
    if (status === 'Completed') return 'status-completed';
    if (status === 'Processing') return 'status-processing';
    if (status === 'Failed') return 'status-failed';
    return '';
  }
}