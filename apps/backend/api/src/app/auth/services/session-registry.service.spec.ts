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

  it('reports a revoked session as revoked', async () => {
    cache.get.mockResolvedValue(1);
    await expect(service.isRevoked('session-1')).resolves.toBe(true);
  });

  it('treats a cache miss as "not revoked"', async () => {
    // The denylist is exhaustive for the window it covers, so a miss is meaningful — and this is
    // the hot path for every authenticated request.
    cache.get.mockResolvedValue(null);
    await expect(service.isRevoked('session-1')).resolves.toBe(false);
    expect(repo.findOne).not.toHaveBeenCalled();
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
      repo.findOne.mockResolvedValue({
        id: 'session-1',
        isRevoked: true,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.isRevoked('session-1')).resolves.toBe(true);
      expect(repo.findOne).toHaveBeenCalled();
    });

    it('accepts a live session found in the database', async () => {
      repo.findOne.mockResolvedValue({
        id: 'session-1',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.isRevoked('session-1')).resolves.toBe(false);
    });

    it('treats an expired row as revoked', async () => {
      repo.findOne.mockResolvedValue({
        id: 'session-1',
        isRevoked: false,
        expiresAt: new Date(Date.now() - 1),
      });
      await expect(service.isRevoked('session-1')).resolves.toBe(true);
    });

    it('treats an unknown session id as revoked', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.isRevoked('session-1')).resolves.toBe(true);
    });

    it('fails CLOSED when the database is unreachable too', async () => {
      repo.findOne.mockRejectedValue(new Error('db down'));
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
