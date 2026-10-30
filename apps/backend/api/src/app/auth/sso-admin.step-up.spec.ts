import 'reflect-metadata';
import { STEP_UP_SCOPE_KEY } from './decorators/step-up.decorator';
import { StepUpScope } from './enums/step-up-scope.enum';
import { SsoAdminController } from './sso-admin.controller';

/** CG-18: opening SSO, or counting its providers, asked for the password. Changing it still does. */
describe('SsoAdminController — step-up on changes only', () => {
  const scopeOf = (method: keyof SsoAdminController) =>
    Reflect.getMetadata(STEP_UP_SCOPE_KEY, SsoAdminController.prototype[method]) ??
    Reflect.getMetadata(STEP_UP_SCOPE_KEY, SsoAdminController);

  it.each(['listProviders', 'listDomains'] as const)('reads without step-up: %s', (method) => {
    expect(scopeOf(method)).toBeUndefined();
  });

  it.each(['createProvider', 'updateProvider', 'deleteProvider', 'addDomain', 'verifyDomain', 'deleteDomain'] as const)(
    'asks for step-up to change: %s',
    (method) => {
      expect(scopeOf(method)).toBe(StepUpScope.MANAGE_SSO);
    },
  );
});
