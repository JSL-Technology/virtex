import { lastValueFrom, of } from 'rxjs';
import { plainToInstance } from 'class-transformer';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { SAAS_FEATURE_KEYS } from '@virtex/shared/types';
import { SAAS_PLANS } from './saas.config';
import { SaasService } from './saas.service';
import { FeatureFlagGuard, FEATURE_FLAG_KEY } from './guards/feature-flag.guard';
import { PlanFeaturesInterceptor } from '../auth/plan-features.interceptor';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import type { EntitlementsPort } from './contracts/entitlements.contract';

/**
 * What a plan includes, told to the client (IA-01, IA-02) and to every check, from one place.
 */
describe('plan features', () => {
  describe.each(SAAS_PLANS)('the $slug plan', (plan) => {
    it('declares every feature, once — none is enabled by being forgotten', () => {
      const declared = plan.features.map((feature) => feature.featureKey);
      expect([...declared].sort()).toEqual([...SAAS_FEATURE_KEYS].sort());
      expect(new Set(declared).size).toBe(declared.length);
    });
  });

  describe('SaasService.features', () => {
    /** A service with only what `features` reads: the cache and the organization repository. */
    const service = (planFeatures: Array<{ featureKey: string; isEnabled: boolean }>) => {
      const store = new Map<string, unknown>();
      const cacheManager = {
        get: jest.fn(async (key: string) => store.get(key)),
        set: jest.fn(async (key: string, value: unknown) => void store.set(key, value)),
      };
      const orgRepository = { findOne: jest.fn(async () => ({ id: 'org-1', plan: { features: planFeatures } })) };
      // Its private collaborators, set on a bare instance: the rest of its constructor is not read.
      const instance = Object.create(SaasService.prototype) as SaasService;
      Object.assign(instance as unknown as Record<string, unknown>, { cacheManager, orgRepository });
      return { instance, store, orgRepository };
    };

    it('the enabled ones, in catalogue order, and checkFeature answers from the same list', async () => {
      const { instance } = service([
        { featureKey: 'ai_cashflow', isEnabled: true },
        { featureKey: 'ai_vision', isEnabled: true },
        { featureKey: 'ai_assistant', isEnabled: false },
      ]);
      await expect(instance.features('org-1')).resolves.toEqual(['ai_vision', 'ai_cashflow']);
      await expect(instance.checkFeature('org-1', 'ai_cashflow')).resolves.toBe(true);
      await expect(instance.checkFeature('org-1', 'ai_assistant')).resolves.toBe(false);
      await expect(instance.checkFeature('org-1', 'not_a_feature')).resolves.toBe(false);
    });

    it('read once per billing generation: a plan change shows at once', async () => {
      const { instance, store, orgRepository } = service([{ featureKey: 'ai_vision', isEnabled: true }]);
      await instance.features('org-1');
      await instance.checkFeature('org-1', 'ai_vision');
      expect(orgRepository.findOne).toHaveBeenCalledTimes(1);

      // `clearOrganizationCache` bumps the generation after a plan change commits.
      store.set('org_limit_version:org-1', 1);
      orgRepository.findOne.mockResolvedValueOnce({ id: 'org-1', plan: { features: [{ featureKey: 'ai_agents', isEnabled: true }] } } as never);
      await expect(instance.features('org-1')).resolves.toEqual(['ai_agents']);
      expect(orgRepository.findOne).toHaveBeenCalledTimes(2);
    });

    it('no plan, no features', async () => {
      const { instance, orgRepository } = service([]);
      orgRepository.findOne.mockResolvedValueOnce(null as never);
      await expect(instance.features('org-1')).resolves.toEqual([]);
    });
  });

  describe('the session', () => {
    const context = { getType: () => 'http' } as unknown as ExecutionContext;
    const handler = (body: unknown): CallHandler => ({ handle: () => of(body) });
    const user = (organizationId: string) =>
      plainToInstance(
        UserResponseDto,
        { id: `u-${organizationId}`, organization: { id: organizationId, legalName: 'QA', slug: 'qa' }, organizations: [] },
        { excludeExtraneousValues: true },
      );

    it('every serialised user’s company carries its plan’s features, one lookup per company', async () => {
      const entitlements = { features: jest.fn(async (id: string) => (id === 'pro' ? ['ai_assistant'] : [])) };
      const interceptor = new PlanFeaturesInterceptor(entitlements as unknown as EntitlementsPort);
      const body = { data: [user('pro'), user('pro'), user('starter')] };

      const out = (await lastValueFrom(interceptor.intercept(context, handler(body)))) as typeof body;

      expect(out.data.map((member) => member.organization?.features)).toEqual([['ai_assistant'], ['ai_assistant'], []]);
      expect(entitlements.features).toHaveBeenCalledTimes(2);
    });

    it('serialised: the field survives `excludeExtraneousValues`', async () => {
      const entitlements = { features: jest.fn(async () => ['ai_vision']) };
      const interceptor = new PlanFeaturesInterceptor(entitlements as unknown as EntitlementsPort);
      const out = (await lastValueFrom(interceptor.intercept(context, handler({ user: user('org-1') })))) as { user: UserResponseDto };
      expect(JSON.parse(JSON.stringify(out.user)).organization.features).toEqual(['ai_vision']);
    });

    it('a failed lookup offers nothing gated, and the session is still served', async () => {
      const entitlements = { features: jest.fn(async () => Promise.reject(new Error('redis down'))) };
      const interceptor = new PlanFeaturesInterceptor(entitlements as unknown as EntitlementsPort);
      const out = (await lastValueFrom(interceptor.intercept(context, handler({ user: user('org-1') })))) as { user: UserResponseDto };
      expect(out.user.organization?.features).toEqual([]);
    });
  });

  describe('a refusal names the feature in words (IA-02)', () => {
    it('as its catalogue key, in the list the client renders, not as the identifier', async () => {
      const guard = new FeatureFlagGuard(
        { getAllAndOverride: (key: string) => (key === FEATURE_FLAG_KEY ? 'ai_anomalies' : undefined) } as never,
        { checkFeature: async () => false } as never,
      );
      const context = {
        getHandler: () => null,
        getClass: () => null,
        switchToHttp: () => ({ getRequest: () => ({ user: { organizationId: 'org-1' } }) }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        messageKey: 'saas.feature_disabled',
        params: { feature: ['saas.features.ai_anomalies'], featureKey: 'ai_anomalies' },
      });
    });
  });
});
