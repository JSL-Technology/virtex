import { createHash } from 'crypto';
import { AccountUnlockService } from './account-unlock.service';
import { UnauthorizedError } from '../../i18n/localized.exception';

/**
 * QA C-09: a locked-out owner got no email and had no way back in but to wait. These pin the
 * unlock link: it is e-mailed hashed-at-rest, it works once, and it does nothing else.
 */
describe('AccountUnlockService', () => {
  const securityRepository = { update: jest.fn(), query: jest.fn() };
  const mailService = { sendAccountLockedEmail: jest.fn() };
  const userCache = { clearUserSession: jest.fn() };
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
  };
  const service = new AccountUnlockService(
    securityRepository as never,
    mailService as never,
    userCache as never,
    cache as never,
  );

  const lockedUser = () => ({
    id: 'user-1',
    email: 'owner@example.com',
    firstName: 'Ana',
    security: { id: 'sec-1', lockoutUntil: new Date(Date.now() + 14 * 60_000 + 5_000) },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
  });

  it('stores only the hash of the token and mails the raw one, with the minutes left', async () => {
    await service.notifyLocked(lockedUser() as never, { force: true });

    const [, update] = securityRepository.update.mock.calls[0];
    const [, rawToken, minutes, hours] = mailService.sendAccountLockedEmail.mock.calls[0];
    expect(update.unlockToken).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(update.unlockToken).not.toBe(rawToken);
    expect(update.unlockTokenExpires.getTime()).toBeGreaterThan(Date.now());
    expect(minutes).toBe(15);
    expect(hours).toBe(24);
  });

  it('sends at most one notice per cooldown unless forced', async () => {
    await service.notifyLocked(lockedUser() as never);
    await service.notifyLocked(lockedUser() as never);
    expect(mailService.sendAccountLockedEmail).toHaveBeenCalledTimes(1);

    await service.notifyLocked(lockedUser() as never, { force: true });
    expect(mailService.sendAccountLockedEmail).toHaveBeenCalledTimes(2);
  });

  it('never lets a mail failure escape into the sign-in reply', async () => {
    mailService.sendAccountLockedEmail.mockRejectedValueOnce(new Error('queue down'));
    await expect(service.notifyLocked(lockedUser() as never, { force: true })).resolves.toBeUndefined();
  });

  it('lifts the lock with a valid token, by its hash, and drops the cached principal', async () => {
    securityRepository.query.mockResolvedValueOnce([[{ user_id: 'user-1' }], 1]);

    await service.unlock('raw-token');

    const [sql, params] = securityRepository.query.mock.calls[0];
    expect(sql).toContain('"lockout_until" = NULL');
    expect(sql).toContain('"unlock_token_expires" > now()');
    expect(params).toEqual([createHash('sha256').update('raw-token').digest('hex')]);
    expect(userCache.clearUserSession).toHaveBeenCalledWith('user-1');
  });

  it('refuses an unknown, expired or already-used token', async () => {
    securityRepository.query.mockResolvedValueOnce([[], 0]);
    await expect(service.unlock('used-token')).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(service.unlock('')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('counts the minutes left, rounding up and never below one while locked', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(AccountUnlockService.minutesRemaining(new Date('2026-10-12T10:00:30Z'), now)).toBe(1);
    expect(AccountUnlockService.minutesRemaining(new Date('2026-10-12T10:14:01Z'), now)).toBe(15);
    expect(AccountUnlockService.minutesRemaining(new Date('2026-10-12T09:59:00Z'), now)).toBe(0);
    expect(AccountUnlockService.minutesRemaining(null, now)).toBe(0);
  });
});
