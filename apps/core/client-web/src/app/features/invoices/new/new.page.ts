import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, switchMap } from 'rxjs';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  InvoicesService,
  CreateInvoiceDto,
  CreateInvoiceLine,
  InvoicePreview,
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
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { TranslateModule } from '@ngx-translate/core';

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
  imports: [CommonModule, ReactiveFormsModule, RouterLink, InvoiceToolbarComponent, TranslateModule, ...FORMAT_PIPES, DraftShellComponent],
  templateUrl: './new.page.html',
  styleUrls: ['./new.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewInvoicePage implements OnInit {
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  protected router = inject(Router);
  private route = inject(ActivatedRoute);
  private invoicesService = inject(InvoicesService);
  private customersService = inject(CustomersService);
  private inventoryService = inject(InventoryService);
  private currenciesService = inject(CurrenciesService);
  private notificationService = inject(NotificationService);

  invoiceForm: FormGroup;

  /** Debounces the preview requests; see `requestPreview`. */
  private readonly previewRequests = new Subject<CreateInvoiceDto>();
  customers = signal<Customer[]>([]);
  products = signal<Product[]>([]);
  currencies = signal<Currency[]>([]);
  context = signal<InvoicingContext | null>(null);
  isSaving = signal(false);
  activeTab = signal<'content' | 'logistics' | 'finance'>('content');

  /**
   * Document types the tenant may issue. Empty in a market with no stamping regime.
   *
   * The labels used to be a hardcoded record of the twelve Dominican comprobantes, in Spanish, in
   * this file — which is why no other market could present a type even after its adapter existed.
   * The server names each type with a translation key and the catalogue holds the wording.
   */
  fiscalTypes = computed(() => this.context()?.fiscalDocumentTypes ?? []);

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

    // `switchMap` drops the answer to a superseded question: a slow response to an older form
    // state must never overwrite the figures for a newer one.
    this.previewRequests
      .pipe(
        debounceTime(300),
        switchMap((payload) => this.invoicesService.preview(payload)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (preview) => {
          this.totals.set(preview);
          this.totalsPending.set(false);
        },
        error: () => {
          // A form the server will not price — an unknown product, a rate the market does not
          // levy — shows no figures rather than stale ones. The refusal itself surfaces on save,
          // with its own message.
          this.totals.set(EMPTY_TOTALS);
          this.totalsPending.set(false);
        },
      });

    this.invoiceForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.requestPreview());
    this.requestPreview();
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
  /**
   * What the server says the document comes to.
   *
   * ## Why this is no longer computed here
   *
   * It was, and it had already diverged. The page charged tax on each line's subtotal *before* the
   * document discount, which is the defect the server spent a release fixing; it knew nothing of
   * excise; and it applied whatever withholding rate the form carried, where the server resolves
   * it from the buyer's fiscal regime. So the operator watched one figure while composing and was
   * issued another — and the page was a second implementation of arithmetic that has one correct
   * home.
   *
   * The form now asks. `POST /invoices/preview` runs the same code that will issue the document
   * and writes nothing, so what is on screen is what will be on the comprobante.
   */
  readonly totals = signal<InvoicePreview>(EMPTY_TOTALS);

  /** True while a preview is in flight, so the panel can say the figures are being recomputed. */
  readonly totalsPending = signal(false);

  /**
   * The form is enough to price.
   *
   * A preview needs a customer (whose regime decides the withholding) and at least one line with a
   * quantity. Below that there is nothing to ask for, and asking would answer 400 on every
   * keystroke of an empty form.
   */
  private canPreview(): boolean {
    const value = this.invoiceForm.getRawValue();
    if (!value.customerId || !value.issueDate || !value.dueDate) return false;
    const lines = value.lineItems as Array<Record<string, unknown>>;
    return lines.length > 0 && lines.every((line) => Number(line['quantity']) > 0);
  }

  /**
   * Ask the server to price the document as it stands.
   *
   * Debounced through a subject rather than called per keystroke: the figures are worth a request,
   * a request per character is not. `switchMap` drops the answer to a superseded question, so a
   * slow response cannot overwrite a newer one.
   */
  private requestPreview(): void {
    if (!this.canPreview()) {
      this.totals.set(EMPTY_TOTALS);
      this.totalsPending.set(false);
      return;
    }
    this.totalsPending.set(true);
    this.previewRequests.next(this.buildPayload(false));
  }

  /** Save without issuing: no fiscal number is consumed and nothing is posted. */
  /** Qué falta antes de guardar o emitir. Entra en las líneas y nombra la que falla. */
  readonly problems = signal<DraftProblem[]>([]);

  saveDraft(): void {
    this.submit(false);
  }

  /** Issue: assigns the fiscal number, posts the ledger entry and transmits the e-CF. */
  issue(): void {
    this.submit(true);
  }

  /**
   * The request body, built once and used both to preview and to save.
   *
   * It carries quantities, prices and intent — never amounts. The totals come back from the
   * server, which is the only place the document arithmetic exists.
   */
  private buildPayload(issue: boolean): CreateInvoiceDto {
    const value = this.invoiceForm.getRawValue();
    return {
      customerId: value.customerId,
      issueDate: value.issueDate,
      dueDate: value.dueDate,
      currencyCode: value.currencyCode,
      notes: value.notes || undefined,
      paymentMethod: value.paymentMethod || undefined,
      fiscalDocumentType: value.fiscalDocumentType || undefined,
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
  }

  private submit(issue: boolean): void {
    if (this.invoiceForm.invalid) {
      this.invoiceForm.markAllAsTouched();
      //  «Revisa los campos marcados» obliga a buscarlos: en una factura de veinte líneas el campo
      //  marcado está fuera de la pantalla. El resumen nombra la línea concreta y lleva a ella.
      this.problems.set(draftProblems(this.invoiceForm, INVOICE_FIELD_LABELS));
      return;
    }
    if (issue && this.hasStockShortfall()) {
      //  No es un campo mal escrito: es que no hay existencias. Emitir lo rechazaría el servidor.
      this.problems.set([{ message: 'INVOICES.NEW.STOCK_INSUFICIENTE' }]);
      return;
    }

    this.problems.set([]);

    const payload = this.buildPayload(issue);

    this.isSaving.set(true);
    this.invoicesService.createInvoice(payload).subscribe({
      next: (invoice) => {
        //  Estaban compuestos con literales en español dentro del componente, donde ninguna
        //  revisión de plantillas los habría encontrado.
        this.notificationService.showSuccess(
          this.translate.instant(
            issue ? 'INVOICES.NEW.FACTURA_EMITIDA' : 'INVOICES.NEW.BORRADOR_GUARDADO',
            { number: issue ? (invoice.ncfNumber ?? invoice.invoiceNumber) : invoice.invoiceNumber },
          ),
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

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
}

/**
 * A document with nothing in it yet, or one the server declined to price.
 *
 * Zeroes rather than the last good figures: a total that lags the form is worse than no total,
 * because the operator cannot tell which one it belongs to.
 */
const EMPTY_TOTALS: InvoicePreview = {
  subtotal: 0,
  discountTotal: 0,
  taxedTotal: 0,
  exemptTotal: 0,
  goodsTotal: 0,
  servicesTotal: 0,
  tax: 0,
  excise: 0,
  serviceCharge: 0,
  taxWithheld: 0,
  incomeTaxWithheld: 0,
  total: 0,
  netReceivable: 0,
  lines: [],
};

/** Rótulo i18n de cada control, para el resumen de errores. El mismo que usa su `<label>`. */
const INVOICE_FIELD_LABELS: Record<string, string> = {
  customerId: 'INVOICES.LIST.CLIENTE',
  issueDate: 'INVOICES.LIST.CREACION',
  dueDate: 'INVOICES.LIST.VENCIMIENTO',
  currencyCode: 'TREASURY.MONEDA',
  fiscalDocumentTypeId: 'INVOICES.DETAIL.NCF',
  description: 'INVOICES.DETAIL.DESCRIPCION',
  quantity: 'INVOICES.DETAIL.CANT',
  price: 'INVOICES.DETAIL.PRECIO',
  taxWithholdingRate: 'INVOICES.NEW.ITBIS_RETENIDO_FRACCION_IMPUESTO',
  incomeTaxWithholdingRate: 'INVOICES.NEW.ISR_RETENIDO_FRACCION_BASE',
};
