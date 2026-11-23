import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  SearchContext,
  SearchResult,
  SearchSource,
  SearchSourceRegistry,
} from '../contracts/search/search-source.contract';
import { PERMISSIONS } from '../shared/permissions';
import { InvoicesService } from './invoices.service';

/**
 * Invoices in the global search (`contracts/search`).
 *
 * The search service used to call `InvoicesService` itself, which made platform depend on sales.
 * The query is the invoice list's own, so a result is narrowed to the caller's branches exactly as
 * the list narrows them.
 */
@Injectable()
export class InvoicesSearchSource implements SearchSource, OnModuleInit {
  readonly type = 'Invoices';
  readonly viewPermission = PERMISSIONS.INVOICES_VIEW;
  readonly sortOrder = 10;

  constructor(
    private readonly registry: SearchSourceRegistry,
    private readonly invoices: InvoicesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async find(query: string, context: SearchContext): Promise<SearchResult[]> {
    const page = await this.invoices.findAll(context.organizationId, {
      search: query,
      limit: context.limit,
      actorUserId: context.actorUserId,
    });
    return page.items.map((invoice) => ({
      id: invoice.id,
      titleKey: 'search.result.invoice_title',
      titleParams: { number: invoice.invoiceNumber },
      // The fiscal number, total and state, not only the customer (QA A-19): looking an invoice up
      // by its authority-issued number is the commonest query at the till and in support, and the
      // result has to say which document it found.
      descriptionKey: invoice.fiscalNumber
        ? 'search.result.invoice_description_fiscal'
        : 'search.result.invoice_description',
      descriptionParams: { customer: invoice.customerName, fiscalNumber: invoice.fiscalNumber ?? null },
      amount: Number(invoice.total),
      currency: invoice.currencyCode,
      status: invoice.status,
      link: `/invoices/${invoice.id}`,
    }));
  }
}
