import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  SearchContext,
  SearchResult,
  SearchSource,
  SearchSourceRegistry,
} from '../contracts/search/search-source.contract';
import { PERMISSIONS } from '../shared/permissions';
import { CustomersService } from './customers.service';

/**
 * Customers in the global search (`contracts/search`).
 *
 * `documentTypeCode` is the catalogue code the customer record actually carries, so the client
 * renders the document's own name — or, absent a type, the neutral «tax id» label. The description
 * used to be assembled here as `RNC: ${taxId}`, which labelled a Brazilian customer's CNPJ with a
 * Dominican term, and could not tell an RNC from a cédula even in the Dominican Republic.
 */
@Injectable()
export class CustomersSearchSource implements SearchSource, OnModuleInit {
  readonly type = 'Customers';
  readonly viewPermission = PERMISSIONS.CUSTOMERS_VIEW;
  readonly sortOrder = 30;

  constructor(
    private readonly registry: SearchSourceRegistry,
    private readonly customers: CustomersService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async find(query: string, context: SearchContext): Promise<SearchResult[]> {
    const found = await this.customers.findAll(context.organizationId, { search: query, limit: context.limit });
    return found.map((customer) => ({
      id: customer.id,
      title: customer.companyName,
      descriptionKey: 'search.result.customer_description',
      descriptionParams: { taxId: customer.taxId },
      documentTypeCode: customer.identityDocumentTypeCode ?? null,
      documentTypeCountry: customer.identityDocumentCountry ?? null,
      link: `/contacts/customers/${customer.id}/edit`,
    }));
  }
}
