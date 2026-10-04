import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StepUpGuard } from './step-up.guard';
import { StepUp } from '../decorators/step-up.decorator';
import { StepUpScope } from '../enums/step-up-scope.enum';
import { AuthConfig } from '../auth.config';
import { SetMetadata } from '@nestjs/common';
import { PLATFORM_PERMISSIONS_KEY } from '../../security/decorators/platform-permission.decorator';
import { PLATFORM_PERMISSIONS } from '../../security/platform-permissions';

/**
 * What StepUpGuard answers, and what the browser needs from the answer.
 */
describe('StepUpGuard', () => {
  const jwt = new JwtService({});
  const claim = { claimOnce: jest.fn().mockResolvedValue(true) };
  const guard = new StepUpGuard(new Reflector(), jwt, claim as never);

  function contextFor(handler: () => void, request: Record<string, unknown>): ExecutionContext {
    return {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  const tokenFor = (userId: string, scope: StepUpScope) =>
    jwt.sign(
      { sub: userId, stepup: true, scope, jti: `jti-${Math.random()}` },
      {
        secret: AuthConfig.JWT_STEP_UP_SECRET,
        expiresIn: '5m',
        issuer: 'virteex-api',
        audience: 'virteex-step-up',
      },
    );

  it('names the scope it wanted, so the client can prompt for exactly that proof', async () => {
    class Controller {
      @StepUp(StepUpScope.MOVE_FUNDS)
      pay(): string {
        return 'paid';
      }
    }
    const context = contextFor(Controller.prototype.pay, { user: { id: 'u1' }, cookies: {} });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      messageKey: 'auth.step_up_authentication_required',
      params: { scope: StepUpScope.MOVE_FUNDS },
    });
  });

  /**
   * QA M-13: a tenant administrator registering an extension re-entered their password and then
   * got 403 — the platform right was checked after the proof was asked for.
   */
  it('asks no proof of someone the platform route will refuse anyway', async () => {
    class Controller {
      @SetMetadata(PLATFORM_PERMISSIONS_KEY, [PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH])
      @StepUp(StepUpScope.PUBLISH_EXTENSION)
      register(): string {
        return 'registered';
      }
    }
    const tenantAdmin = contextFor(Controller.prototype.register, { user: { id: 'u1', permissions: ['*'] }, cookies: {} });
    await expect(guard.canActivate(tenantAdmin)).resolves.toBe(true);

    const operator = contextFor(Controller.prototype.register, {
      user: { id: 'u2', permissions: [PLATFORM_PERMISSIONS.EXTENSIONS_PUBLISH] },
      cookies: {},
    });
    await expect(guard.canActivate(operator)).rejects.toMatchObject({ messageKey: 'auth.step_up_authentication_required' });
  });

  it('asks only when the declared condition holds', async () => {
    class Controller {
      @StepUp(StepUpScope.MANAGE_COMPENSATION, {
        when: (req) => 'bankAccountNumber' in ((req.body ?? {}) as object),
      })
      update(): string {
        return 'updated';
      }
    }
    const handler = Controller.prototype.update;

    await expect(
      guard.canActivate(contextFor(handler, { user: { id: 'u1' }, cookies: {}, body: { firstName: 'Ana' } })),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        contextFor(handler, { user: { id: 'u1' }, cookies: {}, body: { bankAccountNumber: '123' } }),
      ),
    ).rejects.toMatchObject({ params: { scope: StepUpScope.MANAGE_COMPENSATION } });

    const token = tokenFor('u1', StepUpScope.MANAGE_COMPENSATION);
    await expect(
      guard.canActivate(
        contextFor(handler, {
          user: { id: 'u1' },
          cookies: { step_up: token },
          body: { bankAccountNumber: '123' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('refuses a proof minted for another scope, and says which one it wanted', async () => {
    class Controller {
      @StepUp(StepUpScope.MOVE_FUNDS)
      pay(): string {
        return 'paid';
      }
    }
    const token = tokenFor('u1', StepUpScope.VIEW_PAYROLL_DATA);
    await expect(
      guard.canActivate(contextFor(Controller.prototype.pay, { user: { id: 'u1' }, cookies: { step_up: token } })),
    ).rejects.toMatchObject({
      messageKey: 'auth.invalid_step_up_token_scope',
      params: { scope: StepUpScope.MOVE_FUNDS },
    });
  });
});

/**
 * The browser's copy of the scopes must be the server's. A scope the client does not know is a
 * challenge it cannot answer, and the screen behind it fails with a 401 nobody can do anything
 * about — which is exactly how payroll approval was broken.
 */
describe('StepUpScope parity with the web client', () => {
  it('lists the same scopes on both sides', () => {
    const client = readFileSync(
      join(__dirname, '../../../../../../core/client-web/src/app/core/services/step-up.service.ts'),
      'utf8',
    );
    const block = client.slice(client.indexOf('export enum StepUpScope'), client.indexOf('}', client.indexOf('export enum StepUpScope')));
    const clientValues = [...block.matchAll(/=\s*'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    expect(clientValues).toEqual(Object.values(StepUpScope).sort());
  });
});
