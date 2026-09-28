import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SessionRegistryService } from './session-registry.service';
import { RefreshToken } from '../entities/refresh-token.entity';

/**
 * C-2 regression suite.
 *
 * Before this registry existed, the only revocation signal consulted when validating an access
 * token was the per-user `tokenVersion`. Single-session operations — logout and the "revoke this
 * device" button — deliberately do not bump it (that would kill every other session), so they
 * flagged the refresh-token row and nothing ever read that flag. The access token stayed valid
 * for its full remaining lifetime and the UI advertised a control that did nothing.
 */
describe('SessionRegistryService', () => {
  let service: SessionRegistryService;
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let repo: { findOne: jest.Mock; find: jest.Mock };

  beforeEach(async () => {
    cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    repo = { findOne: jest.fn(), find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionRegistryService,
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: getRepositoryToken(RefreshToken), useValue: repo },
      ],
    }).compile();

    service = module.get(SessionRegistryService);
  });

  /** A cache whose denylist has been complete for longer than any access token lives. */
  const settledCache = (revoked: Record<string, unknown> = {}) =>
    cache.get.mockImplementation(async (key: string) =>
      key === SessionRegistryService.EPOCH_KEY ? Date.now() - 24 * 60 * 60 * 1000 : revoked[key] ?? null,
    );

  it('reports a revoked session as revoked', async () => {
    settledCache({ 'sess_revoked:session-1': 1 });
    await expect(service.isRevoked('session-1')).resolves.toBe(true);
  });

  it('treats a cache miss as "not revoked"', async () => {
    // The denylist is exhaustive for the window it covers, so a miss is meaningful — and this is
    // the hot path for every authenticated request.
    settledCache();
    await expect(service.isRevoked('session-1')).resolves.toBe(false);
    expect(repo.find).not.toHaveBeenCalled();
  });

  describe('when the denylist may have forgotten revocations', () => {
    const revokedFamily = [{ id: 'row-1', isRevoked: true, expiresAt: new Date(Date.now() + 60_000) }];

    /**
     * Redis restarted without persistence, was flushed, or evicted keys. Nothing errors; the
     * revocations made before are simply gone, and a miss would let their tokens back in.
     */
    it('checks the database, and re-arms the epoch, when the epoch is missing', async () => {
      cache.get.mockResolvedValue(null);
      repo.find.mockResolvedValue(revokedFamily);

      await expect(service.isRevoked('session-1')).resolves.toBe(true);
      expect(cache.set).toHaveBeenCalledWith(SessionRegistryService.EPOCH_KEY, expect.any(Number), expect.any(Number));
    });

    it('keeps checking the database until a whole access-token lifetime has passed', async () => {
      cache.get.mockImplementation(async (key: string) =>
        key === SessionRegistryService.EPOCH_KEY ? Date.now() - 1_000 : null,
      );
      repo.find.mockResolvedValue(revokedFamily);
      await expect(service.isRevoked('session-1')).resolves.toBe(true);
    });

    it('stops trusting a miss on this instance after its own denylist write failed', async () => {
      cache.set.mockRejectedValueOnce(new Error('redis down'));
      await service.revoke('session-1');

      settledCache();
      repo.find.mockResolvedValue(revokedFamily);
      await expect(service.isRevoked('session-1')).resolves.toBe(true);
    });

    it('re-arms an old epoch keeping its value, so staying up is not a loss of state', async () => {
      const since = Date.now() - 20 * 60 * 60 * 1000;
      cache.get.mockImplementation(async (key: string) => (key === SessionRegistryService.EPOCH_KEY ? since : null));
      await expect(service.isRevoked('session-1')).resolves.toBe(false);
      expect(cache.set).toHaveBeenCalledWith(SessionRegistryService.EPOCH_KEY, since, expect.any(Number));
    });
  });

  it('ignores a token with no session anchor instead of failing it closed', async () => {
    // Tokens minted before the sessionId claim existed must not all 401 at deploy time; they
    // expire within the access-token lifetime anyway.
    await expect(service.isRevoked(undefined)).resolves.toBe(false);
    expect(cache.get).not.toHaveBeenCalled();
  });

  describe('when the cache is unreachable', () => {
    beforeEach(() => {
      cache.get.mockRejectedValue(new Error('ECONNREFUSED'));
    });

    /**
     * A Redis error is NOT a cache miss. Treating it as one would silently disable revocation for
     * the duration of an outage, so we fall back to the source of truth.
     */
    it('falls back to the database', async () => {
      repo.find.mockResolvedValue([
        { id: 'row-1', isRevoked: true, expiresAt: new Date(Date.now() + 60_000) },
      ]);
      await expect(service.isRevoked('session-1')).resolves.toBe(true);
      expect(repo.find).toHaveBeenCalled();
    });

    /**
     * The query is over the FAMILY, not over one row, and this is the case that proves why.
     *
     * `sessionId` is the family id, which equals the id of the family's FIRST row. Every rotation
     * writes a new row with the same `sessionId` and revokes the previous one — so after fifteen
     * minutes the first row is revoked while the session is perfectly alive. The previous
     * implementation looked up `where: { id: sessionId }`, found that revoked first row, and
     * answered "revoked" for every live session in the system whenever Redis was down.
     */
    it('reads the whole family: one live row means a live session', async () => {
      repo.find.mockResolvedValue([
        // The original row, superseded by rotation.
        { id: 'session-1', isRevoked: true, expiresAt: new Date(Date.now() + 60_000) },
        // The row the browser actually holds.
        { id: 'row-2', isRevoked: false, expiresAt: new Date(Date.now() + 60_000) },
      ]);
      await expect(service.isRevoked('session-1')).resolves.toBe(false);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sessionId: 'session-1' } }),
      );
    });

    it('accepts a live session found in the database', async () => {
      repo.find.mockResolvedValue([
        { id: 'row-1', isRevoked: false, expiresAt: new Date(Date.now() + 60_000) },
      ]);
      await expect(service.isRevoked('session-1')).resolves.toBe(false);
    });

    it('treats a family whose every row is expired as revoked', async () => {
      repo.find.mockResolvedValue([
        { id: 'row-1', isRevoked: false, expiresAt: new Date(Date.now() - 1) },
        { id: 'row-2', isRevoked: false, expiresAt: new Date(Date.now() - 1) },
      ]);
      await expect(service.isRevoked('session-1')).resolves.toBe(true);
    });

    it('treats an unknown session id as revoked', async () => {
      repo.find.mockResolvedValue([]);
      await expect(service.isRevoked('session-1')).resolves.toBe(true);
    });

    it('fails CLOSED when the database is unreachable too', async () => {
      repo.find.mockRejectedValue(new Error('db down'));
      await expect(service.isRevoked('session-1')).resolves.toBe(true);
    });
  });

  it('does not throw when the denylist write fails', async () => {
    // The caller has already flagged the refresh_tokens row, so the DB fallback still returns the
    // correct answer; a cache outage must not turn logout into a 500.
    cache.set.mockRejectedValue(new Error('redis down'));
    await expect(service.revoke('session-1')).resolves.toBeUndefined();
  });

  it('ignores empty ids when revoking in bulk', async () => {
    await service.revokeMany(['a', null, undefined, 'b']);
    expect(cache.set).toHaveBeenCalledTimes(2);
  });
});
