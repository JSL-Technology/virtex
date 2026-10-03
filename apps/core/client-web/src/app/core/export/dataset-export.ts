import { Injectable, inject, signal } from '@angular/core';
import { DataTransferFormat, DataTransferService, saveFile } from '../api/data-transfer.service';
import { NotificationService } from '../services/notification';

/**
 * The «Exportar» button of a list, backed by the server's export of the whole dataset (QA A-13).
 *
 * The buttons in the daybook, the chart of accounts, the general ledger and the sales history had
 * no handler. Exporting what a page shows would export one page of fifty; the server exports
 * every row the reader may see, defuses spreadsheet formulas, records the run in the export
 * history, and refuses what the reader has no permission for — the same path as «Exportar datos».
 */
@Injectable({ providedIn: 'root' })
export class DatasetExportService {
  private readonly api = inject(DataTransferService);
  private readonly notifications = inject(NotificationService);

  /** The dataset being exported right now, to disable its button; one at a time is enough. */
  readonly exporting = signal<string | null>(null);

  export(dataset: string, format: DataTransferFormat = 'csv'): void {
    if (this.exporting()) return;
    this.exporting.set(dataset);
    this.api.export(dataset, format).subscribe({
      next: (file) => {
        saveFile(file);
        this.exporting.set(null);
      },
      error: (error: unknown) => {
        this.notifications.showHttpError(error, 'data_exports.export_failed');
        this.exporting.set(null);
      },
    });
  }
}
