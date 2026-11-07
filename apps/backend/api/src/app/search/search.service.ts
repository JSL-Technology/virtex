import { Injectable } from '@nestjs/common';
import { hasPermission } from '@virteex/shared/util-auth';
import { InvoicesService } from '../invoices/invoices.service';
import { InventoryService } from '../inventory/inventory.service';
import { CustomersService } from '../customers/customers.service';
import { PERMISSIONS } from '../shared/permissions';
import type { AuthenticatedUser } from '../security/principal';

const DEFAULT_LIMIT = 10;

@Injectable()
export class SearchService {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly inventoryService: InventoryService,
    private readonly customersService: CustomersService,
  ) {}

  /**
   * One query per module the caller may read, filtered and limited in the database.
   *
   * BUS-01: every group used to come back to every authenticated user — a role with nothing but
   * inventory read invoice numbers, amounts and customers' tax ids here, because the module
   * permissions live on the modules' controllers and this called their services directly. A group
   * is now searched only for a principal holding that module's view permission, and invoices are
   * narrowed to the caller's branches as the invoice list narrows them.
   *
   * BUS-02: products and customers were loaded whole and filtered in memory, on every keystroke.
   */
  async search(query: string, user: Pick<AuthenticatedUser, 'id' | 'organizationId' | 'permissions'>, limit = DEFAULT_LIMIT) {
    const organizationId = user.organizationId;
    const may = (permission: string) => hasPermission(user.permissions, [permission]);

    const [invoicePage, products, customers] = await Promise.all([
      may(PERMISSIONS.INVOICES_VIEW)
        ? this.invoicesService.findAll(organizationId, { search: query, limit, actorUserId: user.id })
        : Promise.resolve({ items: [] as never[] }),
      may(PERMISSIONS.PRODUCTS_VIEW)
        ? this.inventoryService.findAll(organizationId, { search: query, limit })
        : Promise.resolve([]),
      may(PERMISSIONS.CUSTOMERS_VIEW)
        ? this.customersService.findAll(organizationId, { search: query, limit })
        : Promise.resolve([]),
    ]);
    const invoices = invoicePage.items;

    // Titles and descriptions travel as KEYS and PARAMS, never as assembled sentences.
    //
    // They used to be built here with template literals — `Factura #…`, `Cliente: …`, `SKU: …`
    // and `RNC: ${c.taxId}` — so every result was Spanish for every reader, and the customer's
    // identifier was labelled with the Dominican term whatever country the tenant was in: a
    // Brazilian tenant read `RNC: 11.222.333/0001-81` over a CNPJ. Worse, a Dominican customer's
    // identifier may be an RNC or a cédula and nothing here knew which.
    //
    // `documentTypeCode` is the catalogue code the customer record actually carries, so the client
    // renders the document's own name — or, absent a type, the neutral "tax id" label.
    return [
      {
        type: 'Invoices',
        results: invoices.map((i) => ({
          id: i.id,
          titleKey: 'search.result.invoice_title',
          titleParams: { number: i.invoiceNumber },
          // The fiscal number, total and state, not only the customer (QA A-19): looking an invoice
          // up by its NCF is the commonest query at the till and in support, and the result has to
          // say which document it found.
          descriptionKey: i.fiscalNumber
            ? 'search.result.invoice_description_fiscal'
            : 'search.result.invoice_description',
          descriptionParams: { customer: i.customerName, fiscalNumber: i.fiscalNumber ?? null },
          amount: Number(i.total),
          currency: i.currencyCode,
          status: i.status,
          link: `/invoices/${i.id}`,
        })),
      },
      {
        type: 'Products',
        results: products.map((p) => ({
          id: p.id,
          title: p.name,
          descriptionKey: 'search.result.product_description',
          descriptionParams: { sku: p.sku },
          link: `/inventory/products/${p.id}/edit`,
        })),
      },
      {
        type: 'Customers',
        results: customers.map((c) => ({
          id: c.id,
          title: c.companyName,
          descriptionKey: 'search.result.customer_description',
          descriptionParams: { taxId: c.taxId },
          documentTypeCode: c.identityDocumentTypeCode ?? null,
          documentTypeCountry: c.identityDocumentCountry ?? null,
          link: `/contacts/customers/${c.id}/edit`,
        })),
      },
    ].filter((g) => g.results.length > 0);
  }
}