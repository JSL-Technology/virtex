import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft, Upload } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { BankAccount, TreasuryService } from '../../../../core/api/treasury.service';
import { ReconciliationApiService } from '../../../../core/api/reconciliation.service';
import { NotificationService } from '../../../../core/services/notification';

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
 */
@Component({
  selector: 'app-statement-import-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LucideAngularModule, TranslateModule],
  templateUrl: './statement-import.page.html',
  styleUrls: ['./statement-import.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatementImportPage implements OnInit {
  protected readonly BackIcon = ChevronLeft;
  protected readonly UploadIcon = Upload;

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
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
  protected readonly dateFormats = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy', 'dd.MM.yyyy'];

  /** The two ways the region writes a thousand and a bit. Samples, not translatable prose. */
  protected readonly numberFormats = [
    { separator: '.', sample: '1,234.56' },
    { separator: ',', sample: '1.234,56' },
  ];

  form!: FormGroup;
  readonly bankAccounts = signal<BankAccount[]>([]);
  readonly file = signal<File | null>(null);
  readonly uploading = signal(false);
  /** The server names the row it could not read; the user needs to see which one. */
  readonly importError = signal<string | null>(null);

  ngOnInit(): void {
    this.form = this.fb.group({
      bankAccountId: ['', [Validators.required]],
      startDate: ['', [Validators.required]],
      endDate: ['', [Validators.required]],
      startingBalance: [0, [Validators.required]],
      endingBalance: [0, [Validators.required]],
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
    this.file.set(input.files?.[0] ?? null);
    this.importError.set(null);
  }

  /** Either a debit/credit pair or a single signed amount column — never neither. */
  hasAmountMapping(): boolean {
    const { debitColumn, creditColumn, amountColumn } = this.form.value;
    return Boolean(amountColumn || debitColumn || creditColumn);
  }

  submit(): void {
    const file = this.file();
    if (!file) {
      this.notifications.showError('ACCOUNTING.RECONCILIATION.IMPORT.SELECCIONE_ARCHIVO');
      return;
    }
    if (this.form.invalid || !this.hasAmountMapping()) {
      this.form.markAllAsTouched();
      this.notifications.showError('ACCOUNTING.RECONCILIATION.IMPORT.COMPLETE_EL_MAPEO');
      return;
    }

    this.uploading.set(true);
    this.importError.set(null);

    this.api.importStatement(file, this.form.getRawValue()).subscribe({
      next: (statement) => {
        this.notifications.showSuccess('ACCOUNTING.RECONCILIATION.IMPORT.IMPORTADO', {
          count: statement.transactions?.length ?? 0,
        });
        this.router.navigate(['..'], { relativeTo: this.route });
      },
      error: (error: { error?: { message?: string; detail?: string } }) => {
        this.uploading.set(false);
        // The row the import stopped on is the useful part; a generic failure would hide it.
        this.importError.set(error?.error?.detail ?? error?.error?.message ?? null);
      },
    });
  }
}
