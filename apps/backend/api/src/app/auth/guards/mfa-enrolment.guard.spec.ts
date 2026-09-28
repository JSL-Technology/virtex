import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MfaEnrolmentGuard } from './mfa-enrolment.guard';
import { ALLOW_WITHOUT_MFA_ENROLMENT_KEY } from '../decorators/allow-without-mfa-enrolment.decorator';
import { MfaPolicyPort } from '../ports/mfa-policy.port';

/**
 * Una sesión retenida llega a activar el segundo factor, y a nada más.
 *
 * La retención ya no viaja en el token: se decide en CADA petición, con la política de la empresa
 * en la que actúa y con el estado real del segundo factor. Cuando viajaba en el token, cualquier
 * emisor que olvidara copiarla —el refresco, el cambio de empresa, el alta por invitación— la
 * levantaba, y un solo `POST /auth/refresh` bastaba para saltarse la obligación.
 */
describe('MfaEnrolmentGuard', () => {
  let policy: { requiresMfa: jest.Mock };
  let guard: MfaEnrolmentGuard;

  beforeEach(() => {
    policy = { requiresMfa: jest.fn().mockResolvedValue(false) };
    guard = new MfaEnrolmentGuard(new Reflector(), policy as unknown as MfaPolicyPort);
  });

  function contextFor(user: unknown, exemptionReason?: string) {
    const handler = () => undefined;
    if (exemptionReason) {
      Reflect.defineMetadata(ALLOW_WITHOUT_MFA_ENROLMENT_KEY, exemptionReason, handler);
    }
    return {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  it('deja pasar cuando la empresa no exige segundo factor', async () => {
    await expect(guard.canActivate(contextFor({ id: 'u1', organizationId: 'o1' }))).resolves.toBe(true);
    expect(policy.requiresMfa).toHaveBeenCalledWith('o1');
  });

  it('deja pasar una ruta pública, que no tiene principal', async () => {
    await expect(guard.canActivate(contextFor(undefined))).resolves.toBe(true);
    expect(policy.requiresMfa).not.toHaveBeenCalled();
  });

  it('retiene a quien no tiene el factor cuando la empresa lo exige', async () => {
    policy.requiresMfa.mockResolvedValue(true);
    await expect(guard.canActivate(contextFor({ id: 'u1', organizationId: 'o1' }))).rejects.toThrow();
  });

  it('no retiene a quien ya tiene el factor, lo diga o no el token', async () => {
    policy.requiresMfa.mockResolvedValue(true);
    const user = { id: 'u1', organizationId: 'o1', isTwoFactorEnabled: true };
    await expect(guard.canActivate(contextFor(user))).resolves.toBe(true);
  });

  it('ignora un claim viejo en el token: decide la política, no lo que diga la sesión', async () => {
    // Una sesión emitida antes con `mfaEnrolmentRequired: false` no escapa a la política actual.
    policy.requiresMfa.mockResolvedValue(true);
    const user = { id: 'u1', organizationId: 'o1', mfaEnrolmentRequired: false };
    await expect(guard.canActivate(contextFor(user))).rejects.toThrow();
  });

  it('aplica la política de la empresa en la que ACTÚA la petición, no la de origen', async () => {
    // `ActiveTenantGuard` ya reescribió `organizationId` con la empresa de la cabecera.
    policy.requiresMfa.mockImplementation(async (org: string) => org === 'empresa-b');
    await expect(guard.canActivate(contextFor({ id: 'u1', organizationId: 'empresa-b' }))).rejects.toThrow();
    await expect(guard.canActivate(contextFor({ id: 'u1', organizationId: 'empresa-a' }))).resolves.toBe(true);
  });

  it('falla cerrado: si la política no se puede leer, retiene', async () => {
    policy.requiresMfa.mockRejectedValue(new Error('db down'));
    await expect(guard.canActivate(contextFor({ id: 'u1', organizationId: 'o1' }))).rejects.toThrow();
  });

  it('deja pasar lo que está exento con su motivo, y marca la sesión como retenida', async () => {
    policy.requiresMfa.mockResolvedValue(true);
    const user: Record<string, unknown> = { id: 'u1', organizationId: 'o1' };
    await expect(
      guard.canActivate(contextFor(user, 'This controller IS the enrolment path.')),
    ).resolves.toBe(true);
    expect(user['mfaEnrolmentRequired']).toBe(true);
  });

  it('no retiene una sesión de suplantación: quien está al teclado ya se autenticó como sí mismo', async () => {
    policy.requiresMfa.mockResolvedValue(true);
    const user = { id: 'target', organizationId: 'o1', isImpersonating: true };
    await expect(guard.canActivate(contextFor(user))).resolves.toBe(true);
  });

  it('no toca lo que no es HTTP', async () => {
    const context = {
      getType: () => 'ws',
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('dice POR QUÉ, para que el cliente pueda llevar a la pantalla que lo resuelve', async () => {
    policy.requiresMfa.mockResolvedValue(true);
    try {
      await guard.canActivate(contextFor({ id: 'u1', organizationId: 'o1' }));
      throw new Error('debería haber lanzado');
    } catch (error) {
      expect(JSON.stringify(error)).toContain('auth.mfa_required_by_organization');
    }
  });
});
