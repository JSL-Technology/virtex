import { accessDenial, canAccess } from './route-access';
import { AUTHENTICATED_ONLY } from './module-manifest';

/** The one rule for offering and opening a window: the role, then the company's plan. */
describe('route access', () => {
  const holder = (permissions: string[], features: string[]) => ({
    hasPermissions: (required: string[]) => required.every((p) => permissions.includes(p)),
    hasFeature: (feature: string) => features.includes(feature),
  });

  it('a window with no feature needs only its permission', () => {
    expect(canAccess(holder(['invoices:view'], []), { permission: 'invoices:view' })).toBe(true);
    expect(accessDenial(holder([], []), { permission: 'invoices:view' })).toBe('permission');
    expect(canAccess(holder([], []), { permission: AUTHENTICATED_ONLY })).toBe(true);
  });

  it('a window behind a plan feature needs the permission and the feature', () => {
    const anomalies = { permission: 'ai_anomalies:view', feature: 'ai_anomalies' as const };
    expect(canAccess(holder(['ai_anomalies:view'], ['ai_anomalies']), anomalies)).toBe(true);
    expect(accessDenial(holder(['ai_anomalies:view'], []), anomalies)).toBe('plan');
  });

  it('the permission is said first: who may not open it learns nothing about the plan', () => {
    expect(accessDenial(holder([], []), { permission: 'ai_anomalies:view', feature: 'ai_anomalies' })).toBe('permission');
  });
});
