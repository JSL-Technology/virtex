import { Component, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, UploadCloud, ChevronLeft, AlertTriangle, Check } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import {
  ImportColumnMapping,
  ImportPreview,
  JournalEntries,
} from '../../../../core/services/journal-entries';
import { NotificationService } from '../../../../core/services/notification';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';

/**
 * The fields a file has to supply, and whether it may leave one out.
 *
 * Each carries its own label key rather than the template composing one from `key`:
 * `translation-coverage.spec.ts` sweeps templates for literal keys, and a key assembled in the
 * markup is invisible to it — which is how `USER.STATUS.INACTIVE` reached the screen as itself.
 */
const MAPPED_FIELDS = [
  { key: 'entryId', label: 'ACCOUNTING.IMPORT.CAMPO_ENTRYID', required: true },
  { key: 'date', label: 'ACCOUNTING.IMPORT.CAMPO_DATE', required: true },
  { key: 'description', label: 'ACCOUNTING.IMPORT.CAMPO_DESCRIPTION', required: true },
  { key: 'accountCode', label: 'ACCOUNTING.IMPORT.CAMPO_ACCOUNTCODE', required: true },
  { key: 'debit', label: 'ACCOUNTING.IMPORT.CAMPO_DEBIT', required: true },
  { key: 'credit', label: 'ACCOUNTING.IMPORT.CAMPO_CREDIT', required: true },
  { key: 'lineDescription', label: 'ACCOUNTING.IMPORT.CAMPO_LINEDESCRIPTION', required: false },
] as const;

type MappedField = (typeof MAPPED_FIELDS)[number]['key'];

/**
 * The date formats worth offering, and what each reads `03/04/2026` as.
 *
 * `new Date('03/04/2026')` — what the importer used — is 4 March in the United States and 3 April
 * almost everywhere else, and the file says which it meant nowhere. Making the reader choose is
 * the only honest answer.
 */
const DATE_FORMATS = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy', 'dd/MM/yy'] as const;

/**
 * Importing a journal from a file.
 *
 * ## What this screen was
 *
 * A file picker, a button, and `<pre>{{ previewData() | json }}</pre>`. `previewImport` posted the
 * file with the comment *"The DTO for mapping might be sent as part of the form data as well. For
 * now, we just send the file."* — and the server requires `columnMapping`, so **every** preview
 * came back 400 and the screen answered with its own hardcoded Spanish sentence about the format
 * being wrong. There was no way to import anything, and nothing said so.
 */
@Component({
  selector: 'app-journal-entry-import-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './import.page.html',
  styleUrls: ['./import.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalEntryImportPage {
  protected readonly BackIcon = ChevronLeft;
  protected readonly UploadIcon = UploadCloud;
  protected readonly WarningIcon = AlertTriangle;
  protected readonly CheckIcon = Check;

  protected readonly fields = MAPPED_FIELDS;
  protected readonly dateFormats = DATE_FORMATS;

  private readonly journalEntriesService = inject(JournalEntries);
  private readonly notificationService = inject(NotificationService);
  private readonly router = inject(Router);

  readonly selectedFile = signal<File | null>(null);
  readonly headers = signal<string[]>([]);
  readonly mapping = signal<Partial<Record<MappedField, string>>>({});
  readonly dateFormat = signal<string>('dd/MM/yyyy');
  readonly decimalSeparator = signal<'.' | ','>(',');
  readonly preview = signal<ImportPreview | null>(null);
  readonly isLoading = signal(false);
  readonly failed = signal(false);

  /** Every required field answered. Until then the preview button does nothing useful. */
  readonly isMappingComplete = computed(() => {
    const current = this.mapping();
    return MAPPED_FIELDS.filter((field) => field.required).every((field) => !!current[field.key]);
  });

  readonly hasPostableEntries = computed(() => (this.preview()?.validEntriesCount ?? 0) > 0);

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.selectedFile.set(file);
    this.preview.set(null);
    this.failed.set(false);
    this.headers.set([]);
    this.mapping.set({});

    this.isLoading.set(true);
    this.journalEntriesService.importHeaders(file).subscribe({
      next: (headers) => {
        this.headers.set(headers);
        this.mapping.set(this.guessMapping(headers));
        this.isLoading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.isLoading.set(false);
      },
    });
  }

  /**
   * A first guess at the mapping, from the column names themselves.
   *
   * A convenience, never a substitute: the user sees and can change every choice, because a wrong
   * guess here posts real money to the wrong account.
   */
  private guessMapping(headers: string[]): Partial<Record<MappedField, string>> {
    const candidates: Record<MappedField, string[]> = {
      entryId: ['asiento', 'entry', 'entryid', 'comprobante', 'doc', 'lancamento'],
      date: ['fecha', 'date', 'data'],
      description: ['concepto', 'descripcion', 'description', 'glosa', 'historico'],
      accountCode: ['cuenta', 'account', 'codigo', 'conta'],
      debit: ['debe', 'debit', 'debito'],
      credit: ['haber', 'credit', 'credito'],
      lineDescription: ['detalle', 'detail', 'linea', 'line', 'detalhe'],
    };

    const normalise = (value: string) =>
      value
        .toLocaleLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z]/g, '');

    const guessed: Partial<Record<MappedField, string>> = {};
    for (const field of MAPPED_FIELDS) {
      const match = headers.find((header) =>
        candidates[field.key].includes(normalise(header)),
      );
      if (match) guessed[field.key] = match;
    }
    return guessed;
  }

  setMapping(field: MappedField, column: string): void {
    this.mapping.update((current) => ({ ...current, [field]: column || undefined }));
  }

  previewImport(): void {
    const file = this.selectedFile();
    if (!file || !this.isMappingComplete()) return;

    this.isLoading.set(true);
    this.failed.set(false);

    this.journalEntriesService
      .previewImport(file, {
        columnMapping: this.mapping() as ImportColumnMapping,
        dateFormat: this.dateFormat(),
        decimalSeparator: this.decimalSeparator(),
      })
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.isLoading.set(false);
        },
        error: () => {
          this.failed.set(true);
          this.isLoading.set(false);
        },
      });
  }

  confirmImport(): void {
    const preview = this.preview();
    if (!preview || preview.validEntriesCount === 0) return;

    this.isLoading.set(true);
    this.journalEntriesService.confirmImport(preview.batchId).subscribe({
      next: (result) => {
        this.notificationService.showSuccess(result.messageKey);
        this.router.navigate(['/accounting/journal-entries']);
      },
      error: () => {
        this.failed.set(true);
        this.isLoading.set(false);
      },
    });
  }
}
