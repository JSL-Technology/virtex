import { Injectable } from '@nestjs/common';

/**
 * What a module contributes to the global search, without the search knowing the module.
 *
 * `SearchService` imported `InvoicesService`, `InventoryService` and `CustomersService`, and
 * `SearchModule` imported their three modules. `search/` is PLATFORM, and platform may not depend
 * on a business module — that is its whole definition (`module-boundaries.config.mjs`) — so those
 * imports were two of the module cycles the boundary check reports: plataforma ↔ ventas and
 * plataforma ↔ inventario. They also meant that making anything else searchable — a supplier, a
 * journal entry, a fixed asset — was a change to the search service, to its module, and to a union
 * type on the client.
 *
 * Inverted the way this codebase inverts everything else (`DataTransferRegistry`,
 * `LedgerPostingRegistry`, `ClosingBlockerRegistry`): the domain registers what it can be searched
 * for, and the search reads the registry.
 *
 * The permission stays part of the declaration, because the defect it prevents was real: every
 * group used to come back to every authenticated user, so a role with nothing but inventory read
 * invoice numbers, amounts and customers' tax ids here (BUS-01). A source that does not name the
 * permission its own module requires cannot be registered.
 */

/** Who is asking, and how much to answer. */
export interface SearchContext {
  organizationId: string;
  actorUserId: string;
  /** The most results this group may return. Applied in the database, never in memory (BUS-02). */
  limit: number;
}

/**
 * One result.
 *
 * Titles and descriptions travel as KEYS and PARAMS, never as assembled sentences: they used to be
 * built with template literals, so every result was Spanish for every reader and a Brazilian
 * tenant's customer was labelled with a Dominican term over its CNPJ.
 */
export interface SearchResult {
  id: string;
  /** A record's own name, which is not translated: a product is called what it is called. */
  title?: string;
  titleKey?: string;
  titleParams?: Record<string, unknown>;
  descriptionKey?: string;
  descriptionParams?: Record<string, unknown>;
  amount?: number;
  currency?: string;
  status?: string;
  /** The identity document the record carries, so the client names it as that market does. */
  documentTypeCode?: string | null;
  documentTypeCountry?: string | null;
  /** Where the result opens. */
  link: string;
}

export interface SearchSource {
  /** The group's name, as the client keys its heading off: `Invoices`, `Products`, `Customers`. */
  readonly type: string;
  /** The view permission a principal must hold for this group to be searched at all. */
  readonly viewPermission: string;
  /**
   * Where the group sits among the others.
   *
   * Declared rather than left to module-initialisation order, which is not something to build a
   * reader's screen on: the groups used to be a literal array in the service and their order was
   * stable by accident.
   */
  readonly sortOrder: number;
  /** The module's own query, already scoped and limited in the database. */
  find(query: string, context: SearchContext): Promise<SearchResult[]>;
}

/** Everything that can be searched. Filled by the modules at startup. */
@Injectable()
export class SearchSourceRegistry {
  private readonly sources = new Map<string, SearchSource>();

  register(source: SearchSource): void {
    this.sources.set(source.type, source);
  }

  /** In declared order, so the screen reads the same on every boot. */
  all(): readonly SearchSource[] {
    return [...this.sources.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }
}
