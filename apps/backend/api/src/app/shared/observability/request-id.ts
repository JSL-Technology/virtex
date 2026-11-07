import { randomUUID } from 'crypto';

/**
 * One id per request, the same in the logs, in the response and in the support ticket
 * (audit 2026-10-31, OBS-01).
 *
 * Fastify numbered requests `req-1`, `req-2`… per process, so two replicas logged the same id for
 * different requests, and nothing returned it to the client. The id the caller sends in
 * `x-request-id` (a load balancer's, an upstream service's) is kept only when it looks like an id:
 * written verbatim into the logs, anything else is log injection.
 */
export const REQUEST_ID_HEADER = 'x-request-id';
const ACCEPTABLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;

export function requestIdFrom(headers: Record<string, string | string[] | undefined>): string {
  const sent = headers[REQUEST_ID_HEADER] ?? headers['x-correlation-id'];
  const value = Array.isArray(sent) ? sent[0] : sent;
  return value && ACCEPTABLE.test(value) ? value : randomUUID();
}

/** Who a logged request was for. Set by the tenant interceptor on the raw request. */
export interface RequestLogContext {
  organizationId?: string | null;
  userId?: string | null;
}
export const REQUEST_LOG_CONTEXT = Symbol.for('virtex.requestLogContext');
