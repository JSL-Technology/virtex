import { SetMetadata } from '@nestjs/common';

export const SHORT_LIVED_CONNECTIONS = 'tenancy:short-lived-connections';

/**
 * The route does NOT get a connection pinned for its whole life; it opens one per unit of
 * database work instead (`runAsTenantJob`), with the tenant set on it, and gives it back at once.
 *
 * For routes that spend most of their time waiting on something that is not the database — a
 * language model answering over a stream for a minute or two. A pinned connection there is a pool
 * slot held idle for the whole wait: twenty such requests and the API stops answering every tenant
 * (`DB_POOL_SIZE` is the limit). Everything else keeps the default, which is the safer one: a
 * handler under this decorator that touches the database outside a `runAsTenantJob` sees no rows,
 * by the row-level policies, rather than another tenant's.
 */
export const ShortLivedConnections = () => SetMetadata(SHORT_LIVED_CONNECTIONS, true);
