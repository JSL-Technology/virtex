import { Injectable } from '@nestjs/common';
import { hasPermission } from '@virtex/shared/util-auth';
import { SearchSourceRegistry } from '../contracts/search/search-source.contract';
import type { AuthenticatedUser } from '../security/principal';

const DEFAULT_LIMIT = 10;

/**
 * The global search: one query per registered source the caller may read.
 *
 * It used to call `InvoicesService`, `InventoryService` and `CustomersService` directly, which made
 * platform depend on three business modules (two module cycles), and meant that making anything
 * else searchable was a change to this file. Each domain now registers what it offers
 * (`contracts/search`), and this knows none of them.
 *
 * BUS-01: every group used to come back to every authenticated user — a role with nothing but
 * inventory read invoice numbers, amounts and customers' tax ids here, because the module
 * permissions live on the modules' controllers and this called their services directly. A group is
 * searched only for a principal holding the view permission the source itself declares.
 *
 * BUS-02: products and customers were loaded whole and filtered in memory, on every keystroke.
 * Each source limits and filters in the database.
 */
@Injectable()
export class SearchService {
  constructor(private readonly sources: SearchSourceRegistry) {}

  async search(
    query: string,
    user: Pick<AuthenticatedUser, 'id' | 'organizationId' | 'permissions'>,
    limit = DEFAULT_LIMIT,
  ) {
    const context = { organizationId: user.organizationId, actorUserId: user.id, limit };
    const allowed = this.sources
      .all()
      .filter((source) => hasPermission(user.permissions, [source.viewPermission]));

    const groups = await Promise.all(
      allowed.map(async (source) => ({ type: source.type, results: await source.find(query, context) })),
    );
    return groups.filter((group) => group.results.length > 0);
  }
}
