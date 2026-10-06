import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { CheckCircle, Download, File, Loader, LucideAngularModule, ShieldCheck, UploadCloud } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import {
  DataTransferDataset,
  DataTransferRun,
  DataTransferService,
  ImportReport,
  saveFile,
} from '../../core/api/data-transfer.service';
import { NotificationService } from '../../core/services/notification';
import { VxBadgeComponent } from '../../shared/components/badge';
import { transferStatusKey, transferStatusTone } from '../data-exports/transfer-status';

/** Above this the file is refused by the API anyway; said before uploading it. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Data import (QA A-10).
 *
 * «Importar datos» waited on a timer and uploaded nothing; the history was invented. Now:
 *
 * 1. the template is the API's — the exact columns the import reads, with an example row;
 * 2. «Validar» runs every check the import runs and writes nothing;
 * 3. «Importar» is all-or-nothing: if any row fails, none is written and every problem is listed by
 *    line and column, so correcting the file and uploading it again never duplicates a row.
 */
@Component({
  selector: 'app-data-imports-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ...FORMAT_PIPES, VxBadgeComponent],
  templateUrl: './data-imports.page.html',
  styleUrls: ['./data-imports.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataImportsPage implements OnInit {
  private readonly transfer = inject(DataTransferService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly UploadIcon = UploadCloud;
  protected readonly DownloadIcon = Download;
  protected readonly FileIcon = File;
  protected readonly ValidateIcon = ShieldCheck;
  protected readonly SuccessIcon = CheckCircle;
  protected readonly ProcessingIcon = Loader;
  protected readonly statusTone = transferStatusTone;
  protected readonly statusKey = transferStatusKey;

  readonly datasets = signal<DataTransferDataset[]>([]);
  readonly importable = computed(() => this.datasets().filter((dataset) => dataset.importable));
  readonly history = signal<DataTransferRun[]>([]);
  readonly selectedDatasetId = signal<string | null>(null);
  readonly selectedFile = signal<File | null>(null);
  readonly busy = signal<'validate' | 'commit' | null>(null);
  readonly report = signal<ImportReport | null>(null);

  readonly selectedDataset = computed(
    () => this.importable().find((dataset) => dataset.id === this.selectedDatasetId()) ?? null,
  );

  /**
   * The dataset to start on, from `?dataset=` — so «Importar» on a list opens this one engine
   * already pointed at that list's data instead of each list keeping an importer of its own.
   * Applied once the datasets arrive, and only if the user may import it.
   */
  readonly dataset = input<string | null>(null);
  private readonly preselect = effect(() => {
    const requested = this.dataset();
    if (!requested || this.selectedDatasetId()) return;
    if (this.importable().some((dataset) => dataset.id === requested)) {
      this.selectedDatasetId.set(requested);
    }
  });

  ngOnInit(): void {
    this.transfer
      .datasets()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (datasets) => this.datasets.set(datasets),
        error: (error: unknown) => this.notifications.showHttpError(error, 'data_imports.datasets_failed'),
      });
    this.loadHistory();
  }

  labelOf(datasetId: string): string {
    return this.datasets().find((dataset) => dataset.id === datasetId)?.labelKey ?? datasetId;
  }

  onDatasetChange(event: Event): void {
    this.selectedDatasetId.set((event.target as HTMLSelectElement).value || null);
    this.report.set(null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.report.set(null);
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      this.notifications.showError('data_transfer.unsupported_file_type');
      return;
    }
    if (file.size > MAX_BYTES) {
      this.notifications.showError('data_imports.file_too_large', { max: '5 MB' });
      return;
    }
    this.selectedFile.set(file);
  }

  downloadTemplate(): void {
    const dataset = this.selectedDataset();
    if (!dataset) return;
    this.transfer
      .template(dataset.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (file) => saveFile(file),
        error: (error: unknown) => this.notifications.showHttpError(error, 'data_imports.template_failed'),
      });
  }

  run(mode: 'validate' | 'commit'): void {
    const dataset = this.selectedDataset();
    const file = this.selectedFile();
    if (!dataset || !file || this.busy()) return;
    this.busy.set(mode);
    this.report.set(null);
    this.transfer
      .import(dataset.id, file, mode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.busy.set(null);
          this.report.set(report);
          if (report.status === 'COMPLETED') {
            this.notifications.showSuccess('data_imports.imported', { count: report.importedRows });
            this.selectedFile.set(null);
          } else if (report.status === 'VALIDATED') {
            this.notifications.showSuccess('data_imports.validated', { count: report.totalRows });
          }
          this.loadHistory();
        },
        error: (error: unknown) => {
          this.busy.set(null);
          this.notifications.showHttpError(error, 'data_imports.import_failed');
        },
      });
  }

  private loadHistory(): void {
    this.transfer
      .runs('IMPORT')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (runs) => this.history.set(runs),
        error: () => this.history.set([]),
      });
  }
}
