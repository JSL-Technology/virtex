import { VxFileInputComponent } from '../../../../shared/components/file-input/file-input.component';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft, Upload } from 'lucide-angular';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { BankAccount, TreasuryService } from '../../../../core/api/treasury.service';
import {
  BankFileFormat,
  ColumnMappingProposal,
  ImportStatementOptions,
  ReconciliationApiService,
} from '../../data/reconciliation.service';
import { NotificationService } from '../../../../core/services/notification';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxDateFieldComponent } from '../../../../shared/components/date';
import { VX_SELECT } from '../../../../shared/components/select';

/**
 * Importing a bank statement.
 *
 * ## Why the form asks so much
 *
 * The importer used to guess. `new Date(value)` for the date — which reads `03/04/2026` as 4 March
 * in the United States and 3 April across most of Latin America — and `parseFloat` for the amount,
 * so `1.234,56` became `1.23`. On a product sold in both regions those two guesses silently move
 * transactions by months and misstate them by three orders of magnitude, and a reconciliation built
 * on them balances against nothing.
 *
 * So the format is stated rather than inferred, and the server refuses a file it cannot read on
 * those terms, naming the row it stopped on. Asking four extra questions once is cheaper than a
 * statement that imports cleanly and is wrong.
 *
 * ## Why it now asks less
 *
 * Choosing the file asks the server what it is. OFX and camt.053 carry their dates, signed amounts
 * and balances in fixed elements, so none of the questions apply and the period and balances
 * default to what the file states. A CSV gets its mapping proposed — from the header names, the
 * sample values, or the assistant when the headers say nothing — and pre-filled for the person to
 * check. The proposal fills the form; it never imports, and the server still refuses what it cannot
 * read under the mapping it is sent.
 */
@Component({
  selector: 'app-statement-import-page',
  standalone: true,
  imports: [VxFileInputComponent, CommonModule, ReactiveFormsModule, LucideAngularModule, TranslateModule, DraftShellComponent, ...VX_FORM_A11Y, ...VX_SELECT, VxDateFieldComponent],
  templateUrl: './statement-import.page.html',
  styleUrls: ['./statement-import.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatementImportPage implements OnInit {

  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly treasury = inject(TreasuryService);
  private readonly api = inject(ReconciliationApiService);
  private readonly notifications = inject(NotificationService);

  /**
   * The date formats the importer accepts, in `date-fns` tokens.
   *
   * Held here rather than written into the template: they are the parser's contract, not prose,
   * and a token list scattered across markup drifts from the parser that has to honour it.
   */
  protected readonly dateFormats = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy', 'dd.MM.yyyy', 'd/M/yyyy', 'dd/MM/yy', 'yyyyMMdd', 'dd-MMM-yyyy'];

  /** The two ways the region writes a thousand and a bit. Samples, not translatable prose. */
  protected readonly numberFormats = [
    { separator: '.', sample: '1,234.56' },
    { separator: ',', sample: '1.234,56' },
  ];

  form!: FormGroup;
  readonly bankAccounts = signal<BankAccount[]>([]);

  /** «BHD Corriente (DOP)»: la moneda importa tanto como el nombre para elegir una cuenta. */
  protected readonly bankAccountLabel = (account: BankAccount): string =>
    `${account.name} (${account.currencyCode})`;
  protected readonly bankAccountId = (account: BankAccount): string => account.id;

  readonly file = signal<File | null>(null);
  readonly uploading = signal(false);
  /** Asking the server what the chosen file is. */
  readonly detecting = signal(false);
  readonly proposal = signal<ColumnMappingProposal | null>(null);
  readonly format = computed<BankFileFormat>(() => this.proposal()?.format ?? 'csv');
  /** OFX and camt.053 need no column mapping and state their own period and balances. */
  readonly structured = computed(() => this.format() !== 'csv');
  /** The file's header names, offered as choices instead of typed-in names. */
  readonly headers = computed(() => this.proposal()?.headers ?? []);
  readonly sampleRows = computed(() => (this.proposal()?.sample ?? []).slice(0, 3));

  /** The CSV-only fields, required only when the file is a CSV. */
  private static readonly CSV_REQUIRED = ['startDate', 'endDate', 'startingBalance', 'endingBalance', 'dateColumn', 'descriptionColumn', 'dateFormat'];

  /** The column fields, in the order the form shows them. */
  protected readonly columnFields = [
    { control: 'dateColumn', label: 'accounting.reconciliation.import.date_column', required: true },
    { control: 'descriptionColumn', label: 'accounting.reconciliation.import.description_column', required: true },
    { control: 'referenceColumn', label: 'accounting.reconciliation.import.reference_column', required: false },
    { control: 'debitColumn', label: 'accounting.reconciliation.import.money_column', required: false },
    { control: 'creditColumn', label: 'accounting.reconciliation.import.money_out_column', required: false },
    { control: 'amountColumn', label: 'accounting.reconciliation.import.signed_amount_column', required: false },
  ];
  /** The server names the row it could not read; the user needs to see which one. */
  readonly importError = signal<string | null>(null);

  ngOnInit(): void {
    this.form = this.fb.group({
      bankAccountId: ['', [Validators.required]],
      startDate: ['', [Validators.required]],
      endDate: ['', [Validators.required]],
      startingBalance: [0 as number | null, [Validators.required]],
      endingBalance: [0 as number | null, [Validators.required]],
      dateColumn: ['', [Validators.required]],
      descriptionColumn: ['', [Validators.required]],
      referenceColumn: [''],
      debitColumn: [''],
      creditColumn: [''],
      amountColumn: [''],
      dateFormat: ['dd/MM/yyyy', [Validators.required]],
      decimalSeparator: ['.'],
      positiveAmountIsMoneyIn: [true],
    });

    this.treasury.listBankAccounts().subscribe({
      next: (accounts) => {
        this.bankAccounts.set(accounts);
        const first = accounts[0];
        if (first) this.form.patchValue({ bankAccountId: first.id });
      },
      error: () => this.bankAccounts.set([]),
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.file.set(file);
    this.importError.set(null);
    this.proposal.set(null);
    this.applyFormat('csv');
    if (file) this.detect(file);
  }

  /** Ask the server what the file is and, for a CSV, which column is which. */
  detect(file: File): void {
    this.detecting.set(true);
    this.api.columnMapping(file).subscribe({
      next: (proposal) => {
        this.detecting.set(false);
        // A second file chosen while the first was being read: the first answer no longer applies.
        if (this.file() !== file) return;
        this.proposal.set(proposal);
        this.applyFormat(proposal.format);
        const mapping = proposal.mapping;
        if (proposal.format === 'csv' && mapping) {
          // Only what the person has not already typed: their choice outranks the proposal.
          const fill: Record<string, unknown> = {
            dateColumn: mapping.date,
            descriptionColumn: mapping.description,
            referenceColumn: mapping.reference,
            debitColumn: mapping.moneyIn,
            creditColumn: mapping.moneyOut,
            amountColumn: mapping.amount,
            dateFormat: mapping.dateFormat,
            decimalSeparator: mapping.decimalSeparator,
            positiveAmountIsMoneyIn: mapping.positiveAmountIsMoneyIn,
          };
          for (const [control, value] of Object.entries(fill)) {
            const field = this.form.get(control);
            if (field && !field.dirty && value !== null && value !== undefined) field.setValue(value);
          }
        }
      },
      error: () => {
        // Detection is a convenience: without it the person maps the CSV by hand, as before.
        this.detecting.set(false);
      },
    });
  }

  /** The mapping questions apply to a CSV only; a structured file answers them itself. */
  private applyFormat(format: BankFileFormat): void {
    for (const name of StatementImportPage.CSV_REQUIRED) {
      const control = this.form.get(name);
      if (!control) continue;
      control.setValidators(format === 'csv' ? [Validators.required] : []);
      if (format !== 'csv' && !control.dirty && ['startingBalance', 'endingBalance'].includes(name)) {
        // Blank, so the balances the file states are used rather than contradicted by a zero.
        control.setValue(null);
      }
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  /** Either a debit/credit pair or a single signed amount column — never neither. */
  hasAmountMapping(): boolean {
    if (this.structured()) return true;
    const { debitColumn, creditColumn, amountColumn } = this.form.value;
    return Boolean(amountColumn || debitColumn || creditColumn);
  }

  /** What is sent: for a structured file, only the account and whatever the person stated. */
  private options(): ImportStatementOptions {
    const value = this.form.getRawValue() as ImportStatementOptions;
    if (!this.structured()) return value;
    return {
      bankAccountId: value.bankAccountId,
      startDate: value.startDate || undefined,
      endDate: value.endDate || undefined,
      startingBalance: value.startingBalance ?? undefined,
      endingBalance: value.endingBalance ?? undefined,
    };
  }

  /** Qué falta antes de importar. Un fichero que falta y un mapeo incompleto son dos cosas. */
  readonly problems = signal<DraftProblem[]>([]);

  cancel(): void {
    void this.router.navigate(['/accounting/reconciliation']);
  }

  submit(): void {
    const file = this.file();
    if (!file) {
      this.problems.set([{ message: 'accounting.reconciliation.import.choose_statement_file' }]);
      return;
    }
    if (this.form.invalid || !this.hasAmountMapping()) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form),
        ...(this.hasAmountMapping()
          ? []
          : [{ message: 'accounting.reconciliation.import.complete_column_mapping_file_format' }]),
      ]);
      return;
    }

    this.problems.set([]);

    this.uploading.set(true);
    this.importError.set(null);

    this.api.importStatement(file, this.options()).subscribe({
      next: (statement) => {
        this.notifications.showSuccess('accounting.reconciliation.import.statement_imported_count_movements', {
          count: statement.transactions?.length ?? 0,
        });
        this.router.navigate(['/accounting/reconciliation']);
      },
      error: (error: { error?: { message?: string; detail?: string } }) => {
        this.uploading.set(false);
        // The row the import stopped on is the useful part; a generic failure would hide it.
        this.importError.set(error?.error?.detail ?? this.notifications.httpErrorMessage(error, 'errors.unexpected'));
      },
    });
  }
}
