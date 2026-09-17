import { Injectable } from '@nestjs/common';
import { InvoicesService } from '../invoices/invoices.service';
import { InventoryService } from '../inventory/inventory.service';
import { CustomersService } from '../customers/customers.service';

@Injectable()
export class SearchService {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly inventoryService: InventoryService,
    private readonly customersService: CustomersService,
  ) {}

  async search(query: string, organizationId: string) {
    const lowerCaseQuery = query.toLowerCase();

    const [allInvoices, allProducts, allCustomers] = await Promise.all([
      // Search delegates the filter to the database instead of downloading every invoice of the
      // tenant and filtering in memory — which is what `findAll` used to return.
      this.invoicesService.findAll(organizationId, { search: query, limit: 20 }),
      this.inventoryService.findAll(organizationId),
      this.customersService.findAll(organizationId),
    ]);

    const invoices = allInvoices.items;

    const products = allProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerCaseQuery) ||
        p.sku?.toLowerCase().includes(lowerCaseQuery),
    );

    const customers = allCustomers.filter(
      (c) =>
        c.companyName.toLowerCase().includes(lowerCaseQuery) ||
        c.taxId?.toLowerCase().includes(lowerCaseQuery),
    );

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
          descriptionKey: 'search.result.invoice_description',
          descriptionParams: { customer: i.customerName },
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
          link: `/masters/customers/${c.id}/edit`,
        })),
      },
    ].filter((g) => g.results.length > 0);
  }
}