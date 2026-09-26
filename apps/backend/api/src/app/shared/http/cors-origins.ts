/**
 * The origins this API answers, resolved in ONE place.
 *
 * ## Why this file exists
 *
 * There were two rules for the same session. `main.ts` derived the allowed origins from
 * `CORS_ORIGIN` for `app.enableCors` and for the `connect-src` of the CSP; `EventsGateway` carried
 * its own, written into the decorator:
 *
 *     @WebSocketGateway({ cors: { origin: 'http://localhost:4200', credentials: true } })
 *
 * That is the same shape of defect the gateway's own comments document having fixed one layer
 * down, for the cookie name: "two different contracts for one credential. One function now
 * decides." It had simply reappeared one layer up, for the origin.
 *
 * What it cost, in both directions: in a real deployment Socket.IO refused the legitimate
 * front-end, because the only origin it would accept was a developer's laptop; and the production
 * API kept `http://localhost:4200` on its allow-list with `credentials: true`, which is an origin
 * an attacker can serve from on a victim's own machine.
 *
 * Both callers now read this. A deployment that sets `CORS_ORIGIN` moves HTTP and WebSocket
 * together, and there is no second place to forget.
 */

/** The default a local checkout gets when nothing is configured. */
export const DEFAULT_CORS_ORIGIN = 'http://localhost:4200';

export interface CorsOrigins {
  /** Exactly what `CORS_ORIGIN` named, for `enableCors` and for Socket.IO. */
  readonly http: readonly string[];
  /**
   * The same origins with the `ws`/`wss` scheme, for the CSP's `connect-src`.
   *
   * A browser matches a WebSocket URL against `connect-src` by its own scheme, so listing only the
   * `http(s)` forms blocks the handshake even when the origin is identical.
   */
  readonly websocket: readonly string[];
}

/**
 * Parse the configured origin list.
 *
 * Empty entries are dropped rather than passed through: a trailing comma in an environment
 * variable would otherwise put `''` on the allow-list, and an empty string is a value some CORS
 * implementations treat as "match anything".
 */
export function parseCorsOrigins(raw?: string | null): CorsOrigins {
  const http = (raw ?? DEFAULT_CORS_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const effective = http.length ? http : [DEFAULT_CORS_ORIGIN];

  return {
    http: effective,
    websocket: effective.map((origin) => origin.replace(/^http/, 'ws')),
  };
}
