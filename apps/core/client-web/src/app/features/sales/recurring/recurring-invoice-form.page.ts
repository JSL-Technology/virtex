import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VX_SELECT } from '../../../shared/components/select';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { CustomersService } from '../../../core/api/customers.service';
import { InventoryService } from '../../../core/api/inventory.service';
import { Customer } from '../../../core/models/customer.model';
import { Product } from '../../../core/models/product.model';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { RecurringFrequency, RecurringInput, RecurringInvoicesService } from './recurring-invoices.service';

export const FREQUENCIES: RecurringFrequency[] = ['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'];

/** Create or change what is billed on a schedule. Prices default to the catalogue's at issue time. */
@Component({
  selector: 'app-recurring-invoice-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SELECT, VxDateFieldComponent],
  templateUrl: './recurring-invoice-form.page.html',
  styleUrls: ['./recurring-invoice-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecurringInvoiceFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly recurring = inject(RecurringInvoicesService);
  private readonly customersApi = inject(CustomersService);
  private readonly inventory = inject(InventoryService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly organization = inject(ActiveOrganizationService);

  @Input() id?: string;

  readonly frequencies = FREQUENCIES;
  readonly saving = signal(false);

  readonly form = this.fb.group({
    name: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]),
    customerId: this.fb.nonNullable.control('', Validators.required),
    frequency: this.fb.nonNullable.control<RecurringFrequency>('MONTHLY', Validators.required),
    startDate: this.fb.nonNullable.control(new Date().toISOString().slice(0, 10), Validators.required),
    endDate: this.fb.control<string | null>(null),
    paymentTermDays: this.fb.nonNullable.control(0, [Validators.min(0), Validators.max(365)]),
    autoIssue: this.fb.nonNullable.control(true),
    notes: this.fb.control<string | null>(null),
    lines: this.fb.array([this.newLine()]),
  });

  get lines(): FormArray {
    return this.form.controls.lines as FormArray;
  }

  protected readonly searchCustomers = (query: string, limit: number): Observable<Customer[]> => this.customersApi.searchCustomers(query, limit);
  protected readonly resolveCustomer = (id: string): Observable<Customer> => this.customersApi.getCustomerById(id);
  protected readonly customerName = (customer: Customer): string => customer.companyName;
  protected readonly customerId = (customer: Customer): string => customer.id;
  protected readonly searchProducts = (query: string, limit: number): Observable<Product[]> => this.inventory.searchProducts(query, limit);
  protected readonly resolveProduct = (id: string): Observable<Product> => this.inventory.getProductById(id);
  protected readonly productName = (product: Product): string => product.name;
  protected readonly productId = (product: Product): string => product.id;

  ngOnInit(): void {
    if (!this.id) return;
    this.recurring.get(this.id).subscribe({
      next: (template) => {
        this.lines.clear();
        for (const line of template.lines) this.lines.push(this.newLine(line));
        this.form.patchValue({
          name: template.name,
          customerId: template.customerId,
          frequency: template.frequency,
          startDate: template.startDate,
          endDate: template.endDate,
          paymentTermDays: template.paymentTermDays,
          autoIssue: template.autoIssue,
          notes: template.notes,
        });
        this.form.controls.customerId.disable();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'invoices.recurring_ui.load_failed'),
    });
  }

  newLine(line?: { productId?: string | null; description?: string | null; quantity?: number; unitPrice?: number | null }) {
    return this.fb.group({
      productId: this.fb.control<string | null>(line?.productId ?? null),
      description: this.fb.control<string | null>(line?.description ?? null),
      quantity: this.fb.nonNullable.control(line?.quantity ?? 1, [Validators.required, Validators.min(0.000001)]),
      unitPrice: this.fb.control<number | null>(line?.unitPrice ?? null),
    });
  }

  addLine(): void {
    this.lines.push(this.newLine());
  }

  removeLine(index: number): void {
    if (this.lines.length > 1) this.lines.removeAt(index);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const value = this.form.getRawValue();
    const input: RecurringInput = {
      customerId: value.customerId,
      name: value.name,
      frequency: value.frequency,
      startDate: value.startDate,
      endDate: value.endDate || undefined,
      paymentTermDays: Number(value.paymentTermDays) || 0,
      autoIssue: value.autoIssue,
      notes: value.notes || undefined,
      lines: value.lines.map((l: { productId: string | null; description: string | null; quantity: number; unitPrice: number | null }) => ({
        productId: l.productId || undefined,
        description: l.description || undefined,
        quantity: Number(l.quantity),
        unitPrice: l.unitPrice === null || (l.unitPrice as unknown) === '' ? undefined : Number(l.unitPrice),
      })),
    };
    this.saving.set(true);
    const request = this.id
      ? this.recurring.update(this.id, { ...input, customerId: undefined } as Partial<RecurringInput>)
      : this.recurring.create(input);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.notifications.showSuccess('invoices.recurring_ui.saved');
        void this.router.navigateByUrl(this.organization.urlFor('/invoices/recurring'));
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'invoices.recurring_ui.save_failed');
      },
    });
  }
}
