import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { CheckCircle, Download, File, Loader, LucideAngularModule, ShieldCheck, UploadCloud } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES, translateOrLiteral } from '@virteex/shared/ui-i18n';
import { TranslateService } from '@ngx-translate/core';
import {
  ColumnMappingProposal,
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
 *
 * A file that was not made from the template (an export from another system, a spreadsheet kept
 * by hand) is not refused for its headers: choosing it asks the server which header is which
 * field — by name, and with the assistant's help when the names say nothing — and the proposal is
 * shown for the person to correct before anything is validated.
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
  private readonly translate = inject(TranslateService);

  /**
   * A row problem's parameters with the field named in the reader's language. The server sends the
   * field as a catalogue key, as every validation answer does; interpolated untranslated it read
   * «validation.fields.email no es un correo electrónico válido» (QA R3-M05).
   */
  requiredColumns<T extends { required?: boolean }>(dataset: { columns: T[] }): T[] {
    return dataset.columns.filter((column) => column.required);
  }

  problemParams(params: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!params) return {};
    const property = params['property'];
    return typeof property === 'string' ? { ...params, property: translateOrLiteral(this.translate, property) } : params;
  }

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
  readonly proposal = signal<ColumnMappingProposal | null>(null);
  /** The header → key choice, as the person leaves it. */
  readonly mapping = signal<Record<string, string | null>>({});
  readonly detecting = signal(false);
  /** Whether the file needs a mapping at all (it is not the template). */
  readonly needsMapping = computed(() => !!this.proposal() && this.proposal()!.source !== 'template');
  readonly missingRequired = computed(() => {
    const proposal = this.proposal();
    if (!proposal) return [];
    const mapped = new Set(Object.values(this.mapping()).filter(Boolean));
    return proposal.columns.filter((column) => column.required && !mapped.has(column.key)).map((column) => column.key);
  });

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
    // Another dataset has other fields: the file's columns are matched again.
    const file = this.selectedFile();
    if (file) this.detectColumns(file);
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
    this.detectColumns(file);
  }

  /** Ask which header is which field; a template file needs nothing, any other gets a proposal. */
  private detectColumns(file: File): void {
    const dataset = this.selectedDataset();
    this.proposal.set(null);
    this.mapping.set({});
    if (!dataset) return;
    this.detecting.set(true);
    this.transfer
      .columnMapping(dataset.id, file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (proposal) => {
          this.detecting.set(false);
          if (this.selectedFile() !== file) return;
          this.proposal.set(proposal);
          this.mapping.set({ ...proposal.mapping });
        },
        // Without a proposal the file is imported as it is, and the import names any column it does not know.
        error: () => this.detecting.set(false),
      });
  }

  setMapping(header: string, key: string): void {
    const next = { ...this.mapping() };
    // One header per field: choosing a field another header had frees that one.
    for (const [other, value] of Object.entries(next)) if (key && value === key) next[other] = null;
    next[header] = key || null;
    this.mapping.set(next);
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
      .import(dataset.id, file, mode, this.needsMapping() ? this.mapping() : null)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.busy.set(null);
          this.report.set(report);
          if (report.status === 'COMPLETED') {
            this.notifications.showSuccess('data_imports.imported', { count: report.importedRows });
            this.selectedFile.set(null);
            this.proposal.set(null);
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
