/**
 * =====================================================================================
 * ARCHIVO: ../app/features/accounting/bulk-operations/bulk-operations.component.ts
 * =====================================================================================
 * DESCRIPCIÓN:
 * Este componente gestiona la página de "Operaciones Masivas", permitiendo a los
 * usuarios importar y exportar el Plan de Cuentas.
 *
 * FUNCIONALIDADES:
 * - Importación de cuentas desde un archivo (CSV/XLSX).
 * - Muestra de resultados detallados de la importación (éxitos y errores).
 * - Exportación del Plan de Cuentas actual (filtrado por versión y jerarquía)
 * a formatos CSV o JSON.
 * - Gestión de estados de carga para una mejor experiencia de usuario.
 * =====================================================================================
 */

import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
// import { ChartOfAccountsService, BulkOperationResult } from '../../../core/services/chart-of-accounts.service';
import { ChartOfAccountsStateService } from '../../../core/state/chart-of-accounts.state';
import { finalize } from 'rxjs/operators';
import { BulkOperationResult, ChartOfAccountsService } from '../../../core/services/chart-of-accounts';

@Component({
  selector: 'app-bulk-operations',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './bulk-operations.html',
  styleUrls: ['./bulk-operations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BulkOperationsComponent {
  // --- INYECCIÓN DE DEPENDENCIAS ---
  private readonly coaService = inject(ChartOfAccountsService);
  public readonly state = inject(ChartOfAccountsStateService);

  // --- ESTADO DEL COMPONENTE CON SIGNALS ---
  public selectedFile = signal<File | null>(null);
  public uploadResult = signal<BulkOperationResult | null>(null);
  public isUploading = signal<boolean>(false);
  public isExporting = signal<boolean>(false);

  /**
   * Se activa cuando el usuario selecciona un archivo en el input.
   * Almacena el archivo seleccionado en el estado del componente.
   * @param event El evento del input de archivo.
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedFile.set(file);
    this.uploadResult.set(null); // Limpiar resultados anteriores al seleccionar un nuevo archivo
  }

  /**
   * Inicia el proceso de subida y procesamiento del archivo seleccionado.
   */
  onUpload(): void {
    const file = this.selectedFile();
    if (!file) {
      // Opcional: mostrar notificación de que no hay archivo seleccionado.
      return;
    }

    this.isUploading.set(true);
    this.uploadResult.set(null);

    this.coaService.bulkCreateOrUpdate(file).pipe(
      finalize(() => this.isUploading.set(false)) // Asegura que el estado de carga se desactive siempre
    ).subscribe({
      next: (result) => {
        this.uploadResult.set(result);
        if (result.successCount > 0) {
          // Si hubo éxito, refrescar la lista de cuentas en el estado global
          this.state.refreshAccounts();
        }
      },
      error: (err) => {
        // console.error('Error en la subida masiva', err);
        // // Mostrar un error genérico en la UI
        // this.uploadResult.set({
        //   successCount: 0,
        //   errorCount: 1,
        //   errors: [{ rowIndex: 0, accountCode: 'N/A', message: 'Error de conexión o del servidor. Intente de nuevo.' }]
        // });
      }
    });
  }

  /**
   * Inicia el proceso de exportación del plan de cuentas.
   * @param format El formato deseado para la exportación ('csv' o 'json').
   */
  // onExport(format: 'csv' | 'json'): void {
  //   if (this.isExporting()) return;

  //   this.isExporting.set(true);
  //   const version = this.state.selectedVersion();
  //   const hierarchy = this.state.selectedHierarchy();

  //   this.coaService.exportAccounts(version, hierarchy, format).pipe(
  //     finalize(() => this.isExporting.set(false))
  //   ).subscribe({
  //     next: (blob) => {
  //       // Lógica para descargar el archivo en el navegador
  //       const url = window.URL.createObjectURL(blob);
  //       const a = document.createElement('a');
  //       a.href = url;
  //       a.download = `plan_de_cuentas-v${version}-${hierarchy}.${format}`;
  //       document.body.appendChild(a);
  //       a.click();
  //       document.body.removeChild(a);
  //       window.URL.revokeObjectURL(url);
  //     },
  //     error: (err) => {
  //       console.error('Error al exportar el plan de cuentas', err);
  //       // Aquí podrías mostrar una notificación de error al usuario.
  //     }
  //   });
  // }

  /**
   * Simula la descarga de una plantilla de importación.
   * En una aplicación real, este método podría apuntar a un archivo estático
   * o a un endpoint de la API que genere la plantilla.
   */
  downloadTemplate(): void {
    // Lógica de ejemplo para crear y descargar un CSV de plantilla
    const header = "code,name,parentId,type,nature,description,isPostable\n";
    const exampleRow = "1101-02,Caja Chica B,1101,ASSET,DEBIT,Fondo para gastos menores,true\n";
    const blob = new Blob([header, exampleRow], { type: 'text/csv;charset=utf-8;' });
    
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_importacion_cuentas.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  }
}
