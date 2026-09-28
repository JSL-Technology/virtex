import type { AuthenticatedUser } from '../../security/principal';

/**
 * Who a WebSocket handshake belongs to.
 *
 * The gateway is platform code and must not know how Identity issues, signs or revokes a token —
 * only that one answer exists and that it is the same one every HTTP request gets. Identity
 * implements this port; the gateway depends on nothing else from it.
 */
export abstract class SocketAuthenticatorPort {
  /**
   * The principal the handshake's `Cookie` header authenticates.
   *
   * Resolves `null` when there is no acceptable access token or its signature, issuer, audience or
   * expiry do not verify. Rejects when the token is genuine but the session, the account or the
   * organization membership behind it no longer is. Either way the caller must not admit the socket.
   */
  abstract authenticate(cookieHeader: string): Promise<AuthenticatedUser | null>;

  /**
   * Whether a socket admitted earlier may stay connected.
   *
   * The same checks as `authenticate` — the revocation denylist, the token version, the account
   * status and membership of the organization — applied NOW to the identity the handshake proved.
   * Only the handshake token's own expiry is not held against it: the access token lives fifteen
   * minutes and the socket longer, and what must end a socket is its session, account or
   * membership ending, not the clock. Resolves false (never rejects) when it may not stay.
   */
  abstract revalidate(cookieHeader: string): Promise<boolean>;
}
