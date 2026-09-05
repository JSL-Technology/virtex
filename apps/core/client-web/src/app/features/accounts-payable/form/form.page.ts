import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft, Plus, Trash2 } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import {
  AccountsPayableService,
  CreateVendorBillDto,
  PAYMENT_FORMS,
  PURCHASE_CATEGORIES,
  UpdateVendorBillDto,
} from '../../../core/services/accounts-payable';
import { NotificationService } from '../../../core/services/notification';
import { SuppliersService } from '../../../core/api/suppliers.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { toIsoDate } from '../../reports/financial-statements/report-period';

/** The date pickers hand back `YYYY-MM-DD` already; this only normalises what the API returns. */
function isoOf(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : toIsoDate(value);
}

/** The document totals, recomputed as the user types. The server checks them again. */
interface BillTotals {
  subtotal: number;
  taxAmount: number;
  withheld: number;
  payable: number;
  total: number;
}

/**
 * Recording a supplier bill.
 *
 * ## Why this is a rewrite rather than a patch
 *
 * Every field name in the previous form was wrong. It posted `supplierId`, `billNumber`,
 * `issueDate` and `lineItems[{description, quantity, price}]`; the server's DTO requires
 * `vendorId`, `date`, `dueDate` and `lines[{product, quantity, unitPrice, total}]`. With the global
 * pipe running `whitelist` and `forbidNonWhitelisted`, the request failed on both counts — unknown
 * properties *and* three missing required ones — so **no bill could ever be created from this
 * screen**. The component reported it as a generic "could not save" and the real error never
 * reached the user.
 *
 * Supplier and expense account were `<input type="text">`, so the intended interaction was for
 * someone to type a uuid by hand. Both are pickers now, loaded from the endpoints that already
 * existed.
 *
 * ## The fiscal breakdown
 *
 * `VendorBill` models the whole DGII 606 breakdown — tax borne, tax withheld, income tax withheld,
 * tax carried to cost, the proportionality remainder, excise — and the posting service books a
 * ledger line for each. No client could send any of it, so every field was stored at its default of
 * zero: the 606 reported zeros and the withholdings never became a liability. They are on the form,
 * in a section that stays collapsed until a bill needs it.
 */
@Component({
  selector: 'app-vendor-bill-form-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
  ],
  templateUrl: './form.page.html',
  styleUrls: ['./form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorBillFormPage implements OnInit {
  protected readonly BackIcon = ChevronLeft;
  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;
  protected readonly purchaseCategories = PURCHASE_CATEGORIES;
  protected readonly paymentForms = PAYMENT_FORMS;

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountsPayable = inject(AccountsPayableService);
  private readonly suppliers = inject(SuppliersService);
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly notifications = inject(NotificationService);

  form!: FormGroup;
  readonly isEditMode = signal(false);
  readonly billId = signal<string | null>(null);
  readonly isLoading = signal(false);
  readonly showFiscalDetail = signal(false);

  readonly supplierOptions = signal<{ id: string; name: string }[]>([]);
  readonly expenseAccounts = signal<{ id: string; code: string; name: string }[]>([]);
  readonly totals = signal<BillTotals>({
    subtotal: 0,
    taxAmount: 0,
    withheld: 0,
    payable: 0,
    total: 0,
  });

  /** The document has to have at least one line with an amount before it can be saved. */
  readonly canSave = computed(() => !this.isLoading() && this.totals().total > 0);

  ngOnInit(): void {
    this.initForm();
    this.loadPickers();
    this.checkMode();
  }

  private initForm(): void {
    const today = toIsoDate(new Date());
    this.form = this.fb.group({
      vendorId: ['', [Validators.required]],
      ncf: [''],
      date: [today, [Validators.required]],
      dueDate: [today, [Validators.required]],
      currencyCode: [''],
      purchaseCategory: ['06'],
      paymentForm: ['01'],
      isrRetentionType: [''],
      taxAmount: [0, [Validators.min(0)]],
      taxWithheld: [0, [Validators.min(0)]],
      incomeTaxWithheld: [0, [Validators.min(0)]],
      taxToCost: [0, [Validators.min(0)]],
      taxProportional: [0, [Validators.min(0)]],
      exciseAmount: [0, [Validators.min(0)]],
      otherTaxes: [0, [Validators.min(0)]],
      serviceCharge: [0, [Validators.min(0)]],
      lines: this.fb.array([this.createLine()]),
    });

    this.form.valueChanges.subscribe(() => this.recomputeTotals());
    this.recomputeTotals();
  }

  private createLine(): FormGroup {
    return this.fb.group({
      product: ['', [Validators.required]],
      quantity: [1, [Validators.required, Validators.min(0.0001)]],
      unitPrice: [0, [Validators.required, Validators.min(0)]],
      expenseAccountId: ['', [Validators.required]],
    });
  }

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  addLine(): void {
    this.lines.push(this.createLine());
  }

  removeLine(index: number): void {
    if (this.lines.length === 1) return;
    this.lines.removeAt(index);
  }

  toggleFiscalDetail(): void {
    this.showFiscalDetail.update((open) => !open);
  }

  lineTotal(index: number): number {
    const line = this.lines.at(index).value;
    return round2(Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0));
  }

  private recomputeTotals(): void {
    const value = this.form.getRawValue();
    const subtotal = round2(
      (value.lines ?? []).reduce(
        (sum: number, line: { quantity: number; unitPrice: number }) =>
          sum + Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0),
        0,
      ),
    );
    const taxAmount = Number(value.taxAmount ?? 0);
    const excise = Number(value.exciseAmount ?? 0);
    const other = Number(value.otherTaxes ?? 0);
    const serviceCharge = Number(value.serviceCharge ?? 0);
    const withheld =
      Number(value.taxWithheld ?? 0) + Number(value.incomeTaxWithheld ?? 0);

    // The same arithmetic the server does, so the figure on screen is the figure it will accept:
    // total = subtotal + tax + excise + other + service charge, and the supplier is owed that less
    // whatever is withheld from them.
    const total = round2(subtotal + taxAmount + excise + other + serviceCharge);
    this.totals.set({
      subtotal,
      taxAmount,
      withheld: round2(withheld),
      payable: round2(total - withheld),
      total,
    });
  }

  private loadPickers(): void {
    this.suppliers.getSuppliers().subscribe({
      next: (list) =>
        this.supplierOptions.set(
          (list ?? []).map((supplier) => ({ id: supplier.id, name: supplier.name })),
        ),
      error: () => this.supplierOptions.set([]),
    });

    // Only postable expense and asset accounts: a bill line cannot be charged to a header account
    // or to one blocked for posting, and the server refuses both — better to not offer them.
    this.accounts.getAccounts().subscribe({
      next: (list) =>
        this.expenseAccounts.set(
          (list ?? [])
            .filter((account) => account.isPostable && !account.isBlockedForPosting)
            .filter((account) => account.type === 'EXPENSE' || account.type === 'ASSET')
            .map((account) => ({
              id: account.id,
              code: account.code,
              name: localizedName(account.name),
            }))
            .sort((a, b) => a.code.localeCompare(b.code)),
        ),
      error: () => this.expenseAccounts.set([]),
    });
  }

  private checkMode(): void {
    this.route.paramMap
      .pipe(
        switchMap((params) => {
          const id = params.get('id');
          if (!id) return of(null);
          this.isEditMode.set(true);
          this.billId.set(id);
          this.isLoading.set(true);
          return this.accountsPayable.getVendorBillById(id);
        }),
      )
      .subscribe({
        next: (bill) => {
          if (!bill) return;
          this.form.patchValue({
            vendorId: bill.vendorId,
            ncf: bill.ncf ?? '',
            date: isoOf(bill.date),
            dueDate: isoOf(bill.dueDate),
            currencyCode: bill.currencyCode,
            purchaseCategory: bill.purchaseCategory ?? '06',
            paymentForm: bill.paymentForm ?? '01',
            isrRetentionType: bill.isrRetentionType ?? '',
            taxAmount: bill.taxAmount,
            taxWithheld: bill.taxWithheld,
            incomeTaxWithheld: bill.incomeTaxWithheld,
            taxToCost: bill.taxToCost,
            taxProportional: bill.taxProportional,
            exciseAmount: bill.exciseAmount,
            otherTaxes: bill.otherTaxes,
            serviceCharge: bill.serviceCharge,
          });

          this.lines.clear();
          for (const line of bill.lines ?? []) {
            this.lines.push(
              this.fb.group({
                product: [line.product, [Validators.required]],
                quantity: [line.quantity, [Validators.required, Validators.min(0.0001)]],
                unitPrice: [line.unitPrice, [Validators.required, Validators.min(0)]],
                expenseAccountId: [line.expenseAccountId ?? '', [Validators.required]],
              }),
            );
          }
          if (this.lines.length === 0) this.addLine();

          // Lines are immutable once the bill exists: the server refuses a patch that carries them
          // and tells the caller to raise a debit or credit note instead. Disabling them says so
          // before the request rather than after it.
          this.lines.disable({ emitEvent: false });
          this.isLoading.set(false);
          this.recomputeTotals();
        },
        error: () => {
          this.notifications.showError('ACCOUNTS_PAYABLE.FORM.ERROR_CARGAR_FACTURA');
          this.isLoading.set(false);
        },
      });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.showError(
        'ACCOUNTS_PAYABLE.FORM.FAVOR_COMPLETA_TODOS_CAMPOS_REQUERIDOS',
      );
      return;
    }

    this.isLoading.set(true);
    const value = this.form.getRawValue();

    const dto: CreateVendorBillDto = {
      vendorId: value.vendorId,
      date: value.date,
      dueDate: value.dueDate,
      lines: (value.lines ?? []).map(
        (line: { product: string; quantity: number; unitPrice: number; expenseAccountId: string }) => ({
          product: line.product,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          total: round2(Number(line.quantity) * Number(line.unitPrice)),
          expenseAccountId: line.expenseAccountId || undefined,
        }),
      ),
      total: this.totals().total,
      ncf: value.ncf || undefined,
      currencyCode: value.currencyCode || undefined,
      purchaseCategory: value.purchaseCategory || undefined,
      paymentForm: value.paymentForm || undefined,
      isrRetentionType: value.isrRetentionType || undefined,
      taxAmount: Number(value.taxAmount ?? 0),
      taxWithheld: Number(value.taxWithheld ?? 0),
      incomeTaxWithheld: Number(value.incomeTaxWithheld ?? 0),
      taxToCost: Number(value.taxToCost ?? 0),
      taxProportional: Number(value.taxProportional ?? 0),
      exciseAmount: Number(value.exciseAmount ?? 0),
      otherTaxes: Number(value.otherTaxes ?? 0),
      serviceCharge: Number(value.serviceCharge ?? 0),
      servicesAmount: this.totals().subtotal,
    };

    const operation = this.isEditMode()
      ? this.accountsPayable.updateVendorBill(
          this.billId() as string,
          stripLines(dto) as UpdateVendorBillDto,
        )
      : this.accountsPayable.createVendorBill(dto);

    operation.subscribe({
      next: (bill) => {
        this.notifications.showSuccess(
          this.isEditMode()
            ? 'ACCOUNTS_PAYABLE.FORM.FACTURA_ACTUALIZADA_EXITO'
            : 'ACCOUNTS_PAYABLE.FORM.FACTURA_CREADA_EXITO',
        );
        this.isLoading.set(false);
        this.router.navigate(['/accounts-payable', bill.id]);
      },
      error: (error: unknown) => {
        // The server's own message, not a generic one. Every rejection this screen produced was
        // reported as "could not save the bill", which is why a DTO that could never validate went
        // unnoticed for as long as it did.
        this.notifications.showError(
          serverMessage(error) ?? 'ACCOUNTS_PAYABLE.FORM.ERROR_GUARDAR_FACTURA',
        );
        this.isLoading.set(false);
      },
    });
  }
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function stripLines(dto: CreateVendorBillDto): Omit<CreateVendorBillDto, 'lines'> {
  const { lines: _lines, ...rest } = dto;
  return rest;
}

function localizedName(name: Record<string, string> | string): string {
  if (typeof name === 'string') return name;
  return name?.['es'] ?? Object.values(name ?? {})[0] ?? '';
}

/** The API's message key or sentence, when it sent one. */
function serverMessage(error: unknown): string | null {
  const body = (error as { error?: { messageKey?: string; message?: string | string[] } })?.error;
  if (!body) return null;
  if (body.messageKey) return body.messageKey;
  if (Array.isArray(body.message)) return body.message.join(' · ');
  return body.message ?? null;
}
