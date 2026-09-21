import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MfaEnrolmentGuard } from './mfa-enrolment.guard';
import { ALLOW_WITHOUT_MFA_ENROLMENT_KEY } from '../decorators/allow-without-mfa-enrolment.decorator';

/**
 * Una sesión retenida llega a activar el segundo factor, y a nada más.
 *
 * Que alguien tenga un segundo factor era una decisión suya y solo suya: no había forma de que una
 * empresa lo exigiera a su propio personal. Para un producto que guarda nóminas, tesorería y el
 * libro mayor, «nos gustaría que todos lo activaran» no es un control.
 *
 * La sesión se emite y luego se acota, en vez de rechazar el inicio de sesión, porque activar el
 * factor requiere estar dentro: negarlo sería mandar a la persona a hacer algo que no puede
 * alcanzar — el mismo callejón sin salida que documenta el camino de step-up por SSO, donde a las
 * cuentas federadas se les pedía activar la verificación en dos pasos para una acción que a su vez
 * exigía la verificación en dos pasos.
 */
describe('MfaEnrolmentGuard', () => {
  const guard = new MfaEnrolmentGuard(new Reflector());

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

  it('deja pasar una sesión que no está retenida', () => {
    expect(guard.canActivate(contextFor({ id: 'u1', organizationId: 'o1' }))).toBe(true);
  });

  it('deja pasar una ruta pública, que no tiene principal', () => {
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('retiene todo lo demás mientras falte el factor', () => {
    const held = { id: 'u1', organizationId: 'o1', mfaEnrolmentRequired: true };
    expect(() => guard.canActivate(contextFor(held))).toThrow();
  });

  it('deja pasar lo que está exento con su motivo', () => {
    const held = { id: 'u1', organizationId: 'o1', mfaEnrolmentRequired: true };
    const reason = 'This controller IS the enrolment path.';
    expect(guard.canActivate(contextFor(held, reason))).toBe(true);
  });

  it('no toca lo que no es HTTP', () => {
    const context = {
      getType: () => 'ws',
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    expect(guard.canActivate(context)).toBe(true);
  });

  it('dice POR QUÉ, para que el cliente pueda llevar a la pantalla que lo resuelve', () => {
    // El interceptor del cliente ramifica sobre esta clave: un 403 sin explicación es un panel
    // lleno de errores y ninguna indicación de la única acción que lo arregla.
    const held = { id: 'u1', organizationId: 'o1', mfaEnrolmentRequired: true };
    try {
      guard.canActivate(contextFor(held));
      throw new Error('debería haber lanzado');
    } catch (error) {
      expect(JSON.stringify(error)).toContain('auth.mfa_required_by_organization');
    }
  });
});
