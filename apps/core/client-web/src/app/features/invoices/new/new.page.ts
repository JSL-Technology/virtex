import { Component, OnInit, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { CommonModule, DecimalPipe } from '@angular/common';
import {
  InvoicesService,
  CreateInvoiceDto,
  CreateInvoiceLine,
  FiscalDocumentType,
  InvoicingContext,
  TaxTreatment,
} from '../../../core/services/invoices';
import { CustomersService } from '../../../core/api/customers.service';
import { InventoryService } from '../../../core/api/inventory.service';
import { CurrenciesService, Currency } from '../../../core/api/currencies.service';
import { Customer } from '../../../core/models/customer.model';
import { Product } from '../../../core/models/product.model';
import { NotificationService } from '../../../core/services/notification';
import { InvoiceToolbarComponent } from '../components/invoice-toolbar/invoice-toolbar.component';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { TranslateModule } from '@ngx-translate/core';

/** How the tenant's fiscal document types are presented, in the market's own vocabulary. */
const FISCAL_TYPE_LABELS: Record<string, string> = {
  E31: 'E31 · Crédito Fiscal',
  E32: 'E32 · Consumo',
  E33: 'E33 · Nota de Débito',
  E34: 'E34 · Nota de Crédito',
  E44: 'E44 · Régimen Especial',
  E45: 'E45 · Gubernamental',
  E46: 'E46 · Exportación',
  B01: 'B01 · Crédito Fiscal (preimpreso)',
  B02: 'B02 · Consumo (preimpreso)',
  B04: 'B04 · Nota de Crédito (preimpreso)',
  B11: 'B11 · Proveedor Informal',
  B15: 'B15 · Gubernamental (preimpreso)',
};

/**
 * Issuing a sales document.
 *
 * ## What changed and why
 *
 * The form used to open with `USD` and an 18 % rate on every line, for every market — so a Mexican
 * tenant saw the Dominican rate and a Dominican one invoiced in dollars by default. Neither is
 * something a client can know, so both now come from `GET /invoices/context`, together with the
 * fiscal document types the tenant may actually issue and whether its market's tax base needs
 * configuring at all.
 *
 * The totals shown here are an ESTIMATE, computed only so the operator sees the shape of the
 * document as they type. The figures that end up on the comprobante are the server's: the request
 * carries quantities, prices and intent, never amounts.
 */
@Component({
  selector: 'app-new-invoice-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, DecimalPipe, InvoiceToolbarComponent, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './new.page.html',
  styleUrls: ['./new.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewInvoicePage implements OnInit {
  private readonly translate = inject(TranslateService);
  private fb = inject(FormBuilder);
  protected router = inject(Router);
  private route = inject(ActivatedRoute);
  private invoicesService = inject(InvoicesService);
  private customersService = inject(CustomersService);
  private inventoryService = inject(InventoryService);
  private currenciesService = inject(CurrenciesService);
  private notificationService = inject(NotificationService);

  invoiceForm: FormGroup;
  customers = signal<Customer[]>([]);
  products = signal<Product[]>([]);
  currencies = signal<Currency[]>([]);
  context = signal<InvoicingContext | null>(null);
  isSaving = signal(false);
  activeTab = signal<'content' | 'logistics' | 'finance'>('content');

  /** Document types the tenant may issue, labelled. Empty in a market with no stamping regime. */
  fiscalTypes = computed(() =>
    (this.context()?.fiscalDocumentTypes ?? []).map((code) => ({
      code,
      label: FISCAL_TYPE_LABELS[code] ?? code,
    })),
  );

  /** Tax rates the market levies, for the per-line selector. */
  taxRates = computed(() => this.context()?.taxRates ?? []);

  /** Whether the tenant can issue at all, and what is missing when it cannot. */
  blockers = computed(() => this.context()?.missing ?? []);

  constructor() {
    this.invoiceForm = this.fb.group({
      customerId: ['', Validators.required],
      issueDate: [today(), Validators.required],
      dueDate: [today(), Validators.required],
      // Filled from the tenant's context once it loads; never assumed.
      currencyCode: ['', Validators.required],
      fiscalDocumentType: [''],
      paymentMethod: ['CASH'],
      documentDiscountRate: [0, [Validators.min(0), Validators.max(0.99)]],
      serviceChargeRate: [0, [Validators.min(0), Validators.max(0.5)]],
      taxWithholdingRate: [0, [Validators.min(0), Validators.max(1)]],
      incomeTaxWithholdingRate: [0, [Validators.min(0), Validators.max(1)]],
      notes: [''],
      lineItems: this.fb.array([this.createLineItem()]),
    });
  }

  ngOnInit(): void {
    this.loadContext();
    this.customersService.getCustomers().subscribe((data) => this.customers.set(data));
    this.inventoryService.getProducts().subscribe((data) => this.products.set(data));
    this.currenciesService.getCurrencies().subscribe((data) => this.currencies.set(data));
    this.checkCopyFrom();
  }

  private loadContext(): void {
    this.invoicesService.context().subscribe({
      next: (context) => {
        this.context.set(context);
        this.invoiceForm.patchValue(
          {
            currencyCode: context.baseCurrency,
            fiscalDocumentType: '',
            // The legal service charge is opt-in per document; it defaults to off, and the market's
            // rate is offered rather than a number the client invented.
            serviceChargeRate: 0,
          },
          { emitEvent: false },
        );
        // Line defaults follow the market's standard rate.
        this.lineItems.controls.forEach((control) =>
          control.patchValue({ taxRate: context.taxRates[0] ?? 0 }, { emitEvent: false }),
        );
        if (!context.ready) {
          this.notificationService.showError(
            `Todavía no puedes facturar. Falta: ${context.missing.join('; ')}.`,
          );
        }
      },
      error: () =>
        this.notificationService.showError('INVOICES.NEW.PUDO_CARGAR_CONFIGURACION_FACTURACION'),
    });
  }

  private checkCopyFrom(): void {
    const copyFromId = this.route.snapshot.queryParamMap.get('copyFrom');
    if (!copyFromId) return;

    this.invoicesService.getInvoiceById(copyFromId).subscribe((invoice) => {
      this.invoiceForm.patchValue({
        customerId: invoice.customerId,
        currencyCode: invoice.currencyCode,
        paymentMethod: invoice.paymentMethod,
        notes: `Copiada de ${invoice.invoiceNumber}. ${invoice.notes ?? ''}`.trim(),
      });

      this.lineItems.clear();
      for (const item of invoice.lineItems) {
        const group = this.createLineItem();
        group.patchValue({
          productId: item.productId ?? '',
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.price,
          discountRate: item.discountRate,
          taxTreatment: item.taxTreatment,
          taxRate: item.taxRate,
        });
        this.lineItems.push(group);
      }
      this.notificationService.showInfo('INVOICES.NEW.DATOS_CARGADOS_DESDE', { invoiceNumber: invoice.invoiceNumber });
    });
  }

  get lineItems(): FormArray {
    return this.invoiceForm.get('lineItems') as FormArray;
  }

  createLineItem(): FormGroup {
    return this.fb.group({
      productId: [''],
      description: [''],
      // Fractional quantities: hours, kilos, litres, partial packs.
      quantity: [1, [Validators.required, Validators.min(0.000001)]],
      unitPrice: [0, [Validators.required, Validators.min(0)]],
      discountRate: [0, [Validators.min(0), Validators.max(0.99)]],
      taxTreatment: ['TAXED' as TaxTreatment],
      taxRate: [this.context()?.taxRates[0] ?? 0, [Validators.min(0), Validators.max(1)]],
    });
  }

  addLineItem(): void {
    this.lineItems.push(this.createLineItem());
  }

  removeLineItem(index: number): void {
    if (this.lineItems.length > 1) this.lineItems.removeAt(index);
  }

  /** Selecting a catalogue item fills the line from the catalogue, including its tax treatment. */
  onProductSelect(index: number): void {
    const control = this.lineItems.at(index);
    const product = this.products().find((p) => p.id === control.get('productId')?.value);
    if (!product) return;

    control.patchValue({
      description: product.name,
      unitPrice: product.price,
      taxTreatment: (product as { taxTreatment?: TaxTreatment }).taxTreatment ?? 'TAXED',
      taxRate: (product as { taxRate?: number }).taxRate ?? this.taxRates()[0] ?? 0,
    });
  }

  /** A line billing a stocked good beyond what is on hand. Shown, never silently accepted. */
  stockShortfall(index: number): number {
    const control = this.lineItems.at(index);
    const product = this.products().find((p) => p.id === control.get('productId')?.value);
    if (!product) return 0;
    const quantity = Number(control.get('quantity')?.value) || 0;
    const available = Number((product as { stock?: number }).stock ?? 0);
    return quantity > available ? quantity - available : 0;
  }

  hasStockShortfall(): boolean {
    return this.lineItems.controls.some((_, index) => this.stockShortfall(index) > 0);
  }

  /**
   * A live preview of the document, using the same rules the server applies.
   *
   * It is deliberately labelled an estimate in the template: the authoritative figures are the ones
   * the server returns, and the request never carries an amount.
   */
  get totals(): {
    subtotal: number;
    discount: number;
    tax: number;
    serviceCharge: number;
    total: number;
    withheld: number;
    net: number;
  } {
    let subtotal = 0;
    let tax = 0;

    for (const control of this.lineItems.controls) {
      const quantity = Number(control.get('quantity')?.value) || 0;
      const price = Number(control.get('unitPrice')?.value) || 0;
      const discountRate = Number(control.get('discountRate')?.value) || 0;
      const treatment = control.get('taxTreatment')?.value as TaxTreatment;
      const rate = treatment === 'TAXED' ? Number(control.get('taxRate')?.value) || 0 : 0;

      const gross = round2(quantity * price);
      const lineSubtotal = round2(gross - round2(gross * discountRate));
      subtotal = round2(subtotal + lineSubtotal);
      tax = round2(tax + round2(lineSubtotal * rate));
    }

    const value = this.invoiceForm.getRawValue();
    const discount = round2(subtotal * (Number(value.documentDiscountRate) || 0));
    const serviceCharge = round2((subtotal - discount) * (Number(value.serviceChargeRate) || 0));
    const total = round2(subtotal - discount + tax + serviceCharge);
    const withheld = round2(
      tax * (Number(value.taxWithholdingRate) || 0) +
        (subtotal - discount) * (Number(value.incomeTaxWithholdingRate) || 0),
    );

    return { subtotal, discount, tax, serviceCharge, total, withheld, net: round2(total - withheld) };
  }

  /** Save without issuing: no fiscal number is consumed and nothing is posted. */
  saveDraft(): void {
    this.submit(false);
  }

  /** Issue: assigns the fiscal number, posts the ledger entry and transmits the e-CF. */
  issue(): void {
    this.submit(true);
  }

  private submit(issue: boolean): void {
    if (this.invoiceForm.invalid) {
      this.invoiceForm.markAllAsTouched();
      this.notificationService.showError('INVOICES.NEW.REVISA_CAMPOS_MARCADOS_ANTES_CONTINUAR');
      return;
    }
    if (issue && this.hasStockShortfall()) {
      this.notificationService.showError('INVOICES.NEW.MAS_LINEAS_SUPERAN_EXISTENCIAS_DISPONIBLES_AJUSTA');
      return;
    }

    const value = this.invoiceForm.getRawValue();
    const payload: CreateInvoiceDto = {
      customerId: value.customerId,
      issueDate: value.issueDate,
      dueDate: value.dueDate,
      currencyCode: value.currencyCode,
      notes: value.notes || undefined,
      paymentMethod: value.paymentMethod || undefined,
      fiscalDocumentType: (value.fiscalDocumentType || undefined) as FiscalDocumentType | undefined,
      documentDiscountRate: numberOrUndefined(value.documentDiscountRate),
      serviceChargeRate: numberOrUndefined(value.serviceChargeRate),
      taxWithholdingRate: numberOrUndefined(value.taxWithholdingRate),
      incomeTaxWithholdingRate: numberOrUndefined(value.incomeTaxWithholdingRate),
      issue,
      lineItems: (value.lineItems as Array<Record<string, unknown>>).map(
        (line): CreateInvoiceLine => ({
          productId: (line['productId'] as string) || undefined,
          description: (line['description'] as string) || undefined,
          quantity: Number(line['quantity']),
          unitPrice: numberOrUndefined(line['unitPrice']),
          discountRate: numberOrUndefined(line['discountRate']),
          taxTreatment: line['taxTreatment'] as TaxTreatment,
          taxRate: numberOrUndefined(line['taxRate']),
        }),
      ),
    };

    this.isSaving.set(true);
    this.invoicesService.createInvoice(payload).subscribe({
      next: (invoice) => {
        this.notificationService.showSuccess(
          issue
            ? `Factura ${invoice.ncfNumber ?? invoice.invoiceNumber} emitida.`
            : `Borrador ${invoice.invoiceNumber} guardado.`,
        );
        this.router.navigate(['/invoices', invoice.id]);
      },
      error: (err) => {
        this.notificationService.showError(
          err?.error?.message || this.translate.instant('ERRORS.SAVE_DOCUMENT'),
        );
        this.isSaving.set(false);
      },
    });
  }
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
}
