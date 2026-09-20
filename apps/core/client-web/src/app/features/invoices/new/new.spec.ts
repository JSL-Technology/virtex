import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NewInvoicePage } from './new.page';
import { InvoicesService, InvoicingContext } from '../../../core/services/invoices';
import { CustomersService } from '../../../core/api/customers.service';
import { InventoryService } from '../../../core/api/inventory.service';
import { CurrenciesService } from '../../../core/api/currencies.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';

/**
 * The form takes its defaults from the tenant's market, not from a constant.
 *
 * It used to open with `USD` and an 18 % rate on every line, for every market — so a Mexican tenant
 * saw the Dominican rate and a Dominican one invoiced in dollars by default. Neither is something a
 * client can know.
 */
const catalogue = [
  { id: 'p-1', name: 'Servicio', price: 500, stock: 0, taxTreatment: 'TAXED', taxRate: 0.18 },
  { id: 'p-2', name: 'Mercancía', price: 100, stock: 3, taxTreatment: 'TAXED', taxRate: 0.18 },
];

describe('NewInvoicePage', () => {
  let component: NewInvoicePage;
  let fixture: ComponentFixture<NewInvoicePage>;
  let invoicesService: {
    context: jest.Mock;
    createInvoice: jest.Mock;
    getInvoiceById: jest.Mock;
    preview: jest.Mock;
  };
  let notifications: { showError: jest.Mock; showSuccess: jest.Mock; showInfo: jest.Mock };

  /** One customer on thirty days, one due on receipt, one with no terms of their own. */
  const customers = [
    { id: 'c-30', companyName: 'Constructora del Este', paymentTermDays: 30 },
    { id: 'c-0', companyName: 'Colmado La Esquina', paymentTermDays: 0 },
    { id: 'c-none', companyName: 'Sin condiciones', paymentTermDays: null },
  ];

  /**
   * The customer field no longer downloads the book.
   *
   * It searches server-side and names a single id when the form is patched with one — which is
   * what "copy from invoice" does — so the double is the two calls that replaced `getCustomers()`.
   * An unknown id answers the way the server does, with a rejection rather than an empty record.
   */
  let customersService: {
    searchCustomers: jest.Mock;
    getCustomerById: jest.Mock;
    createCustomer: jest.Mock;
  };

  const context = (overrides: Partial<InvoicingContext> = {}): InvoicingContext => ({
    ready: true,
    missing: [],
    countryCode: 'DO',
    baseCurrency: 'DOP',
    taxRates: [0.18, 0.16, 0],
    taxRequiresConfiguration: false,
    // The server describes each type it will accept, rather than sending bare codes the client
    // has to know the vocabulary for. It used to send `['E31', 'E32', 'E46']` and the page looked
    // the Spanish labels up in a hardcoded record of the twelve Dominican comprobantes — which is
    // why no other market could present a document type even once its adapter existed.
    fiscalDocumentTypes: [
      { code: 'E31', labelKey: 'fiscal.do.e31', requiresBuyerTaxId: true },
      { code: 'E32', labelKey: 'fiscal.do.e32', requiresBuyerTaxId: false },
      { code: 'E46', labelKey: 'fiscal.do.e46', requiresBuyerTaxId: false },
    ],
    serviceChargeRate: 0.1,
    defaultPaymentTermDays: 0,
    ...overrides,
  });

  async function build(ctx: InvoicingContext = context()): Promise<void> {
    invoicesService = {
      context: jest.fn().mockReturnValue(of(ctx)),
      createInvoice: jest.fn().mockReturnValue(of({ id: 'inv-1', invoiceNumber: 'FAC-1', fiscalNumber: 'E310000000001' })),
      getInvoiceById: jest.fn(),
      // The totals are the server's now. The page used to derive them and had already diverged
      // from the server on the document discount, so the operator watched one figure and was
      // issued another.
      preview: jest.fn().mockReturnValue(
        of({
          subtotal: 1_800,
          discountTotal: 200,
          taxedTotal: 1_800,
          exemptTotal: 0,
          goodsTotal: 1_800,
          servicesTotal: 0,
          tax: 324,
          excise: 0,
          serviceCharge: 180,
          taxWithheld: 0,
          incomeTaxWithheld: 0,
          total: 2_304,
          netReceivable: 2_304,
          lines: [],
        }),
      ),
    };
    notifications = { showError: jest.fn(), showSuccess: jest.fn(), showInfo: jest.fn() };
    customersService = {
      searchCustomers: jest.fn((query: string) =>
        of(
          customers.filter((customer) =>
            customer.companyName.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          ),
        ),
      ),
      getCustomerById: jest.fn((id: string) => {
        const found = customers.find((customer) => customer.id === id);
        return found ? of(found) : throwError(() => new Error('404'));
      }),
      createCustomer: jest.fn(),
    };

    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [NewInvoicePage, NoopAnimationsModule, TranslateModule.forRoot()],
        providers: [
          { provide: InvoicesService, useValue: invoicesService },
          { provide: CustomersService, useValue: customersService },
          {
            provide: InventoryService,
            //  El catálogo ya no se descarga entero: el campo de producto busca en el servidor y
            //  pide por id el registro de una línea que llega puesta (una factura copiada).
            useValue: {
              getProducts: () => of(catalogue),
              searchProducts: () => of(catalogue),
              getProductById: (id: string) => of(catalogue.find((p) => p.id === id)!),
            },
          },
          { provide: CurrenciesService, useValue: { getCurrencies: () => of([{ code: 'DOP', name: 'Peso', symbol: 'RD$' }]) } },
          { provide: NotificationService, useValue: notifications },
          provideRouter([]),
        ],
      })
      .compileComponents();

    fixture = TestBed.createComponent(NewInvoicePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => build());

  /**
   * The due date follows the customer's credit terms.
   *
   * It used to open equal to the issue date — "due on receipt" — for everyone, including customers
   * the business gives thirty days, and the ageing report then called those invoices overdue the
   * next morning.
   */
  describe('el vencimiento', () => {
    it('sale de los días de crédito del cliente', () => {
      component.invoiceForm.patchValue({ issueDate: '2026-03-05' });
      component.invoiceForm.patchValue({ customerId: 'c-30' });

      expect(component.invoiceForm.get('dueDate')?.value).toBe('2026-04-04');
    });

    it('distingue «al contado» de «sin condiciones»', async () => {
      // Zero days is a real answer; null means "use the organization's default", and the two must
      // not collapse into each other.
      component.invoiceForm.patchValue({ issueDate: '2026-03-05', customerId: 'c-0' });
      expect(component.invoiceForm.get('dueDate')?.value).toBe('2026-03-05');

      await build(context({ defaultPaymentTermDays: 15 }));
      component.invoiceForm.patchValue({ issueDate: '2026-03-05', customerId: 'c-none' });
      expect(component.invoiceForm.get('dueDate')?.value).toBe('2026-03-20');
    });

    it('cruza el fin de mes sin inventar un día', () => {
      component.invoiceForm.patchValue({ issueDate: '2026-01-31', customerId: 'c-30' });
      expect(component.invoiceForm.get('dueDate')?.value).toBe('2026-03-02');
    });

    it('no pisa una fecha que el usuario escribió', () => {
      component.invoiceForm.patchValue({ issueDate: '2026-03-05' });
      component.invoiceForm.get('dueDate')!.setValue('2026-12-31');
      component.invoiceForm.patchValue({ customerId: 'c-30' });

      expect(component.invoiceForm.get('dueDate')?.value).toBe('2026-12-31');
    });
  });

  it('takes its currency from the tenant, not from a hardcoded USD', () => {
    expect(component.invoiceForm.get('currencyCode')?.value).toBe('DOP');
  });

  it("offers the market's own rates, not a fixed 18 %", async () => {
    await build(context({ countryCode: 'MX', baseCurrency: 'MXN', taxRates: [0.16, 0.08, 0] }));
    expect(component.taxRates()).toEqual([0.16, 0.08, 0]);
    expect(component.invoiceForm.get('currencyCode')?.value).toBe('MXN');
  });

  it('offers the fiscal document types the market allows', () => {
    expect(component.fiscalTypes().map((t) => t.code)).toEqual(['E31', 'E32', 'E46']);
    // The label travels as a translation key, so a Chilean or Brazilian type is presentable
    // without the client carrying any market's vocabulary of its own.
    expect(component.fiscalTypes().map((t) => t.labelKey)).toEqual([
      'fiscal.do.e31',
      'fiscal.do.e32',
      'fiscal.do.e46',
    ]);
  });

  it('offers a market whose types are not Dominican at all', async () => {
    await build(
      context({
        countryCode: 'CL',
        baseCurrency: 'CLP',
        fiscalDocumentTypes: [
          { code: '33', labelKey: 'fiscal.cl.33', requiresBuyerTaxId: true },
          { code: '34', labelKey: 'fiscal.cl.34', requiresBuyerTaxId: true },
        ],
      }),
    );

    // `33` and `34` are not values of `NcfType`, and before the interface widened neither the
    // server's type nor the client's could express them.
    expect(component.fiscalTypes().map((t) => t.code)).toEqual(['33', '34']);
  });

  it('offers no document type in a market with no stamping regime', async () => {
    await build(context({ countryCode: 'US', baseCurrency: 'USD', fiscalDocumentTypes: [], taxRates: [], taxRequiresConfiguration: true }));
    expect(component.fiscalTypes()).toEqual([]);
  });

  it('warns instead of pretending the tenant can issue', async () => {
    await build(context({ ready: false, missing: ['la cuenta de Cuentas por Cobrar'] }));
    expect(component.blockers()).toEqual(['la cuenta de Cuentas por Cobrar']);
    expect(notifications.showError).toHaveBeenCalled();
  });

  it('fills a line from the catalogue, including its tax treatment', () => {
    //  El campo entrega el registro elegido, no un id que la página tenga que buscar en una lista
    //  descargada de antemano.
    component.onProductSelect(0, catalogue[1] as never);

    expect(component.lineItems.at(0).get('unitPrice')?.value).toBe(100);
    expect(component.lineItems.at(0).get('taxTreatment')?.value).toBe('TAXED');
    expect(component.lineItems.at(0).get('taxRate')?.value).toBe(0.18);
  });

  it('accepts a fractional quantity', () => {
    component.lineItems.at(0).patchValue({ quantity: 1.5, unitPrice: 100, taxRate: 0.18 });
    expect(component.lineItems.at(0).valid).toBe(true);
  });

  it('shows the totals the server computed, and computes none of its own', fakeAsync(() => {
    component.invoiceForm.patchValue({ customerId: 'c-1' });
    // A line needs a concept as well as a quantity: the server rejects a line that names nothing,
    // so the page does not ask it to price one. Without the description this asserts a request the
    // page is right not to make.
    component.lineItems.at(0).patchValue({
      description: 'Consultoría',
      quantity: 2,
      unitPrice: 1000,
      discountRate: 0.1,
      taxRate: 0.18,
    });
    component.invoiceForm.patchValue({ serviceChargeRate: 0.1 });
    // Debounced: the figures are worth a request, a request per keystroke is not.
    tick(300);

    expect(invoicesService.preview).toHaveBeenCalled();
    const totals = component.totals();
    expect(totals.subtotal).toBe(1800);
    expect(totals.tax).toBe(324);
    expect(totals.serviceCharge).toBe(180);
    expect(totals.total).toBe(2304);

    // The request carries quantities, prices and intent — never amounts.
    const [payload] = invoicesService.preview.mock.calls.at(-1) as [Record<string, unknown>];
    expect(payload['lineItems']).toBeDefined();
    expect(payload).not.toHaveProperty('total');
    expect(payload).not.toHaveProperty('subtotal');
    discardPeriodicTasks();
  }));

  it('asks for nothing while the form cannot be priced', fakeAsync(() => {
    // No customer: the buyer's regime decides the withholding, so there is nothing to ask for and
    // asking would answer 400 on every keystroke of an empty form.
    component.invoiceForm.patchValue({ customerId: '' });
    component.lineItems.at(0).patchValue({ quantity: 1, unitPrice: 100 });
    tick(300);

    expect(invoicesService.preview).not.toHaveBeenCalled();
    expect(component.totals().total).toBe(0);
    discardPeriodicTasks();
  }));

  it('reports a line that exceeds the stock on hand', () => {
    component.lineItems.at(0).patchValue({ productId: 'p-2', quantity: 5 });
    expect(component.stockShortfall(0)).toBe(2);
    expect(component.hasStockShortfall()).toBe(true);
  });

  it('refuses to issue while a line exceeds the stock', () => {
    component.invoiceForm.patchValue({ customerId: 'c-1' });
    component.lineItems.at(0).patchValue({ productId: 'p-2', quantity: 5, unitPrice: 100 });

    component.issue();

    // El motivo va al resumen del armazón y no a un aviso que se desvanece: es una precondición
    // que hay que corregir, y un mensaje que desaparece solo obliga a adivinar qué decía.
    expect(invoicesService.createInvoice).not.toHaveBeenCalled();
    expect(component.problems()).toEqual([{ message: 'invoices.new.insufficient_stock' }]);
  });

  it('saves a draft without issuing', () => {
    component.invoiceForm.patchValue({ customerId: 'c-1' });
    component.lineItems.at(0).patchValue({ quantity: 1, unitPrice: 100 });

    component.saveDraft();

    expect(invoicesService.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ issue: false }),
    );
  });

  it('sends quantities and intent, never amounts', () => {
    component.invoiceForm.patchValue({ customerId: 'c-1' });
    component.lineItems.at(0).patchValue({ quantity: 2, unitPrice: 100, taxRate: 0.18 });

    component.issue();

    const payload = invoicesService.createInvoice.mock.calls[0][0];
    expect(payload.issue).toBe(true);
    expect(payload.lineItems[0]).toEqual(
      expect.objectContaining({ quantity: 2, unitPrice: 100, taxRate: 0.18 }),
    );
    // No total, subtotal or tax amount is ever sent: the server derives them.
    expect(payload).not.toHaveProperty('total');
    expect(payload.lineItems[0]).not.toHaveProperty('taxAmount');
  });
});
