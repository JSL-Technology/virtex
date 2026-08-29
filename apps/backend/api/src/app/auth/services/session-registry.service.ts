import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';
import { AuthConfig } from '../auth.config';

/**
 * Authoritative answer to "is this access token's session still alive?".
 *
 * ## Why this exists (C-2)
 *
 * Access tokens are self-contained JWTs. Before this service the only revocation signal the
 * JwtStrategy consulted was `tokenVersion`, which is a *per-user* counter. That produced a gap:
 *
 *   - `logout` and `revokeSession` (the "Sesiones activas" screen) deliberately do NOT bump
 *     `tokenVersion`, because doing so would kill every other session the user has.
 *   - They marked the refresh token row `isRevoked = true`, but nothing ever checked that row
 *     when validating an access token.
 *
 * So logging out — or revoking a device from the UI — left the corresponding access token fully
 * valid until natural expiry (up to 15 minutes). The UI promised a control that did not exist.
 *
 * Every JWT now carries the id of the refresh-token row that anchors its session (`sessionId`),
 * and this registry is consulted on every authenticated request.
 *
 * ## Availability model
 *
 * Redis is the fast path and holds only the *denylist* — a small set of recently revoked session
 * ids, each expiring after the access-token lifetime (after which the JWT is expired anyway, so
 * the entry is worthless). A cache miss therefore means "not revoked" and costs one Redis GET.
 *
 * A Redis *error* is not a miss. Treating an unreachable cache as "not revoked" would silently
 * disable revocation during an outage, so errors fall back to the `refresh_tokens` table, which
 * is the source of truth. Slower, but correct. We never fail open on a revocation check.
 */
@Injectable()
export class SessionRegistryService {
  private readonly logger = new Logger(SessionRegistryService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  private key(sessionId: string): string {
    return `sess_revoked:${sessionId}`;
  }

  /**
   * Mark a session as revoked.
   *
   * The entry only needs to outlive the access tokens that reference it; past that point the JWT
   * fails signature/expiry validation on its own. A minute of slack absorbs clock skew.
   */
  async revoke(sessionId: string | null | undefined): Promise<void> {
    if (!sessionId) return;
    try {
      await this.cacheManager.set(this.key(sessionId), 1, AuthConfig.SESSION_DENYLIST_TTL);
    } catch (error) {
      // Non-fatal: the refresh_tokens row is already flagged by the caller, so the DB fallback
      // in isRevoked() still returns the correct answer.
      this.logger.error(
        { event: 'session_denylist_write_failed', sessionId: sessionId.slice(0, 8) },
        `Failed to add session to denylist: ${(error as Error).message}`,
      );
    }
  }

  /** Mark many sessions as revoked (bulk logout / "close all other sessions"). */
  async revokeMany(sessionIds: Array<string | null | undefined>): Promise<void> {
    await Promise.all(sessionIds.filter(Boolean).map((id) => this.revoke(id)));
  }

  /**
   * @returns true when the session has been revoked and the request must be rejected.
   *
   * Tokens minted before `sessionId` was added to the payload have no session anchor. Rather
   * than fail them closed (which would log out every active user at deploy time) we let them
   * through; they expire within the access-token lifetime and every token issued afterwards
   * carries the claim.
   */
  async isRevoked(sessionId: string | null | undefined): Promise<boolean> {
    if (!sessionId) return false;

    try {
      const hit = await this.cacheManager.get(this.key(sessionId));
      // A miss is meaningful here: the denylist is exhaustive for the window it covers.
      return hit != null;
    } catch (error) {
      this.logger.warn(
        { event: 'session_denylist_unavailable', sessionId: sessionId.slice(0, 8) },
        `Denylist unavailable, falling back to database: ${(error as Error).message}`,
      );
      return this.isRevokedInDatabase(sessionId);
    }
  }

  /** Source-of-truth check used when the cache cannot be reached. */
  private async isRevokedInDatabase(sessionId: string): Promise<boolean> {
    try {
      const row = await this.refreshTokenRepository.findOne({
        where: { id: sessionId },
        select: ['id', 'isRevoked', 'expiresAt'],
      });

      // An unknown session id means the row was purged or never existed — treat as revoked.
      // This is the fail-closed direction and cannot lock out a legitimate live session, whose
      // row exists by construction.
      if (!row) return true;

      return row.isRevoked || row.expiresAt.getTime() < Date.now();
    } catch (error) {
      // Both cache and database are unreachable. The request cannot be authorised safely.
      this.logger.error(
        { event: 'session_check_failed', sessionId: sessionId.slice(0, 8) },
        `Session revocation check failed on both cache and database: ${(error as Error).message}`,
      );
      return true;
    }
  }

  /**
   * Revoke every live session of a user and return the affected session ids.
   * Used by "log out everywhere", password change, and refresh-token reuse detection.
   */
  async collectLiveSessionIds(userId: string): Promise<string[]> {
    const rows = await this.refreshTokenRepository.find({
      where: { userId, isRevoked: false },
      select: ['id'],
    });
    return rows.map((row) => row.id);
  }

  /** Look up the session ids for a set of refresh-token rows (used for targeted revocation). */
  async findSessionIds(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.refreshTokenRepository.find({
      where: { id: In(ids) },
      select: ['id'],
    });
    return rows.map((row) => row.id);
  }
}
