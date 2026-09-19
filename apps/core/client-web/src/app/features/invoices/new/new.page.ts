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
import { Subject, debounceTime, merge, switchMap } from 'rxjs';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { translateOrLiteral } from '@virteex/shared/ui-i18n';
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
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { TranslateModule } from '@ngx-translate/core';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

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
  imports: [CommonModule, ReactiveFormsModule, RouterLink, InvoiceToolbarComponent, TranslateModule, ...FORMAT_PIPES, DraftShellComponent, ...VX_FORM_A11Y],
  templateUrl: './new.page.html',
  styleUrls: ['./new.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewInvoicePage implements OnInit {
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
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

  /**
   * One gap, worded for the reader.
   *
   * The banner printed these raw, so the gap this screen exists to explain appeared as
   * `invoices.gaps.fiscal_sequence`. `translateOrLiteral` because the list mixes catalogue keys
   * with prose the provisioner still writes out; prose is printed, keys are looked up.
   */
  blockerText(gap: string): string {
    return translateOrLiteral(this.translate, gap);
  }

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
    this.customersService.getCustomers().subscribe((data) => {
      this.customers.set(data);
      this.applyPaymentTerms();
    });
    this.inventoryService.getProducts().subscribe((data) => this.products.set(data));
    this.currenciesService.getCurrencies().subscribe((data) => this.currencies.set(data));
    this.checkCopyFrom();

    //  El vencimiento sale de las condiciones del cliente, no del día de hoy.
    //
    //  Nacía igual a la fecha de emisión —«al contado»— para todo el mundo, incluidos los clientes
    //  a los que el negocio da treinta días, y el informe de antigüedad los declaraba vencidos a la
    //  mañana siguiente. Se recalcula al elegir cliente y al mover la emisión; si alguien escribe
    //  un vencimiento a mano, se respeta (ver `dueDateTouched`).
    merge(
      this.invoiceForm.get('customerId')!.valueChanges,
      this.invoiceForm.get('issueDate')!.valueChanges,
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyPaymentTerms());

    this.invoiceForm
      .get('dueDate')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.settingDueDate) this.dueDateTouched = true;
      });

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
          // The catalogue words this, not a template literal in Spanish: the sentence a tenant
          // reads when the product tells them what to go and fix is the last place to hard-code
          // one language. Each gap is translated where it is a key and printed where the server
          // sent prose.
          //
          // The message names the place to fix this ("Settings › Electronic invoicing"); the action
          // takes the reader straight there rather than leaving them to find it. `fragment` opens
          // the settings overlay on top of this page, so closing it returns them to the invoice
          // they were trying to raise.
          this.notificationService.showError(
            'invoices.new.not_ready_missing',
            {
              missing: context.missing
                .map((gap) => translateOrLiteral(this.translate, gap))
                .join('; '),
            },
            {
              labelKey: 'invoices.new.not_ready_action',
              fragment: 'settings/fiscal',
            },
          );
        }
      },
      error: () =>
        this.notificationService.showError('invoices.new.invoicing_configuration_could_not_loaded'),
    });
  }

  /**
   * Set the due date from the chosen customer's credit terms.
   *
   * The customer's own days win; a customer with none falls back to the organization's default,
   * which the invoicing context carries. Zero days — due on receipt — is a real answer and is why
   * `null` and `0` are not treated alike.
   *
   * Never overrides a date the user typed: once they have set one by hand, this stops.
   */
  private applyPaymentTerms(): void {
    if (this.dueDateTouched) return;

    const value = this.invoiceForm.getRawValue();
    const issueDate = value.issueDate as string;
    if (!issueDate) return;

    const customer = this.customers().find((candidate) => candidate.id === value.customerId);
    const days = customer?.paymentTermDays ?? this.context()?.defaultPaymentTermDays ?? 0;

    this.settingDueDate = true;
    this.invoiceForm.get('dueDate')!.setValue(addDays(issueDate, days), { emitEvent: false });
    this.settingDueDate = false;
  }

  /** True once the user has set a due date themselves; the terms stop deciding for them. */
  private dueDateTouched = false;
  /** Guards the flag above while this page is the one writing the field. */
  private settingDueDate = false;

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
      this.notificationService.showInfo('invoices.new.data_loaded_from_invoice_number', { invoiceNumber: invoice.invoiceNumber });
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

    const treatment = (product as { taxTreatment?: TaxTreatment }).taxTreatment ?? 'TAXED';

    control.patchValue({
      description: product.name,
      unitPrice: product.price,
      taxTreatment: treatment,
      taxRate: this.rateForProduct(product as { taxRate?: number }, treatment),
    });
  }

  /**
   * The rate a catalogue line should carry.
   *
   * `products.tax_rate` defaults to 0 while `products.tax_treatment` defaults to `TAXED`, and the
   * product form has no control for either — so every product in the catalogue arrives as "taxed
   * at zero per cent", which is not a tax position, it is an unconfigured column. The line used to
   * take that 0 through `??`, which only falls back on null and undefined: picking any product
   * silently moved the line from the tenant's 18 % to 0 %, the document was stored with the whole
   * amount in `exemptTotal`, and the invoice went out under-declaring ITBIS while the line still
   * read "Taxed" on screen.
   *
   * Zero-rating is expressed by the TREATMENT (`ZERO_RATED`, `EXEMPT`), which is respected here
   * untouched. A rate of zero under `TAXED` means nobody set one, so the tenant's own first rate
   * applies — the same value the line carries before a product is chosen.
   */
  private rateForProduct(product: { taxRate?: number }, treatment: TaxTreatment): number {
    if (treatment !== 'TAXED') return 0;
    const configured = product.taxRate;
    return configured && configured > 0 ? configured : (this.taxRates()[0] ?? 0);
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
    // El servidor exige que cada línea lleve un producto o una descripción (y una cantidad > 0).
    // Sin esto, la línea vacía inicial disparaba un preview que respondía 400 en cada pulsación.
    return (
      lines.length > 0 &&
      lines.every((line) => {
        const hasConcept = !!line['productId'] || !!(line['description'] as string)?.trim();
        return Number(line['quantity']) > 0 && hasConcept;
      })
    );
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
      // El servidor valida `@Length(3,3)` y `@IsOptional` NO salta la cadena vacía: enviar
      // `currencyCode: ''` (antes de que el contexto del tenant cargue la moneda) devolvía 400
      // en cada preview. Vacío ⇒ undefined, y el backend resuelve la moneda por defecto.
      currencyCode: value.currencyCode || undefined,
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
      this.problems.set([{ message: 'invoices.new.insufficient_stock' }]);
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
            issue ? 'invoices.new.invoice_number_issued' : 'invoices.new.draft_number_saved',
            { number: issue ? (invoice.fiscalNumber ?? invoice.invoiceNumber) : invoice.invoiceNumber },
          ),
        );
        //  Esta ventana ya cumplió: el registro existe y la página se va a la lista. Si se dejara
        //  abierta seguiría anunciándose como «el formulario nuevo», y el siguiente clic en «Nuevo»
        //  la enfocaría con el documento ya guardado dentro. Ver `TabContext.close`.
        void this.router.navigate(['/invoices', invoice.id]).then(() => this.tab?.close());
      },
      error: (err) => {
        this.notificationService.showError(
          err?.error?.message || this.translate.instant('errors.save_document'),
        );
        this.isSaving.set(false);
      },
    });
  }
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * `YYYY-MM-DD` plus a number of days, as a calendar date.
 *
 * Built in UTC on purpose: an issue date has no time and no zone, and constructing it in local
 * time is what turns `2026-01-31` into the 30th for every tenant west of Greenwich.
 */
function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
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
  customerId: 'invoices.list.customer',
  issueDate: 'invoices.list.created',
  dueDate: 'invoices.list.due',
  currencyCode: 'treasury.currency',
  fiscalDocumentTypeId: 'invoices.detail.ncf',
  description: 'invoices.detail.description',
  quantity: 'invoices.detail.qty',
  price: 'invoices.detail.price',
  taxWithholdingRate: 'invoices.new.tax_withheld_fraction_tax',
  incomeTaxWithholdingRate: 'invoices.new.income_tax_withheld_fraction_base',
};
