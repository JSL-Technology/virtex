import { PasswordRecoveryService } from './password-recovery.service';

/**
 * Requesting a reset link.
 *
 * The audit of 2026-10-31 (AUTH-01) found every request for an EXISTING account answered 500
 * (`ms is not a function`: a namespace import of a CommonJS function under `esModuleInterop`),
 * while an unknown address got 200. Recovery was unusable, and the difference in status codes told
 * anyone which addresses had accounts. These tests pin both halves: the token is actually issued,
 * and the answer is identical whatever happens.
 */
describe('PasswordRecoveryService.sendPasswordResetLink', () => {
  function build(overrides: { user?: unknown; sendMail?: jest.Mock } = {}) {
    const save = jest.fn().mockImplementation(async (entity: unknown) => entity);
    const manager = { save, getRepository: jest.fn() };
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(overrides.user ?? null),
      manager,
    };
    const mailService = {
      sendPasswordResetEmail: overrides.sendMail ?? jest.fn().mockResolvedValue(undefined),
    };
    const service = new PasswordRecoveryService(
      userRepository as never,
      mailService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    // The simulated delay protects timing parity in production; it only slows the suite here.
    (service as unknown as { simulateDelay: () => Promise<void> }).simulateDelay = async () => undefined;
    return { service, userRepository, mailService };
  }

  it('issues a token with a real expiry for an existing account', async () => {
    const user = { id: 'u-1', email: 'ana@example.com', security: null as null | Record<string, unknown> };
    const { service, mailService } = build({ user });

    const before = Date.now();
    const result = await service.sendPasswordResetLink({ email: 'Ana@Example.com ' } as never);

    expect(result.message).toContain('Si existe una cuenta');
    expect(mailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const security = user.security as unknown as { passwordResetToken: string; passwordResetExpires: Date };
    expect(security.passwordResetToken).toMatch(/^[0-9a-f]{64}$/);
    expect(security.passwordResetExpires.getTime()).toBeGreaterThan(before);
  });

  it('looks the address up normalised', async () => {
    const { service, userRepository } = build();
    await service.sendPasswordResetLink({ email: '  Ana@Example.COM ' } as never);
    expect(userRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ana@example.com' } }),
    );
  });

  it('answers an existing and an unknown address identically, even when issuing fails', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('smtp down'));
    const existing = build({ user: { id: 'u-2', email: 'x@example.com', security: null }, sendMail: failing });
    const unknown = build();

    const a = await existing.service.sendPasswordResetLink({ email: 'x@example.com' } as never);
    const b = await unknown.service.sendPasswordResetLink({ email: 'nobody@example.com' } as never);

    expect(a).toEqual(b);
  });
});
