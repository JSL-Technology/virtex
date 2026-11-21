import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  SearchContext,
  SearchResult,
  SearchSource,
  SearchSourceRegistry,
} from '../contracts/search/search-source.contract';
import { PERMISSIONS } from '../shared/permissions';
import { InventoryService } from './inventory.service';

/** Products in the global search (`contracts/search`). */
@Injectable()
export class ProductsSearchSource implements SearchSource, OnModuleInit {
  readonly type = 'Products';
  readonly viewPermission = PERMISSIONS.PRODUCTS_VIEW;
  readonly sortOrder = 20;

  constructor(
    private readonly registry: SearchSourceRegistry,
    private readonly inventory: InventoryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async find(query: string, context: SearchContext): Promise<SearchResult[]> {
    const products = await this.inventory.findAll(context.organizationId, { search: query, limit: context.limit });
    return products.map((product) => ({
      id: product.id,
      // Its own name: a product is called what the company calls it, in no particular language.
      title: product.name,
      descriptionKey: 'search.result.product_description',
      descriptionParams: { sku: product.sku },
      link: `/inventory/products/${product.id}/edit`,
    }));
  }
}
