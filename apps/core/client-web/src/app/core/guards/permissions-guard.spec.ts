import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { AuthService } from '../services/auth';
import { permissionsGuard } from './permissions-guard';

/** The router's half of the access rule: an address does not open what the menu does not offer. */
describe('permissionsGuard', () => {
  const run = async (data: Record<string, unknown>, permissions: string[], features: string[]) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            resolveSession: () => of(true),
            hasPermissions: (required: string[]) => required.every((p) => permissions.includes(p)),
            hasFeature: (feature: string) => features.includes(feature),
          },
        },
      ],
    });
    const route = { data } as unknown as ActivatedRouteSnapshot;
    const state = { url: '/e/qa/reports/anomalies' } as RouterStateSnapshot;
    const result = TestBed.runInInjectionContext(() => permissionsGuard(route, state)) as Observable<boolean | UrlTree>;
    const outcome = await firstValueFrom(result);
    const router = TestBed.inject(Router);
    return outcome instanceof UrlTree ? router.serializeUrl(outcome) : outcome;
  };

  afterEach(() => TestBed.resetTestingModule());

  it('opens when the role and the plan both allow it', async () => {
    await expect(run({ permissions: ['ai_anomalies:view'], feature: 'ai_anomalies' }, ['ai_anomalies:view'], ['ai_anomalies'])).resolves.toBe(true);
  });

  it('sends a plan that lacks the feature to the page that says so, naming the feature (IA-02)', async () => {
    await expect(run({ permissions: ['ai_anomalies:view'], feature: 'ai_anomalies' }, ['ai_anomalies:view'], [])).resolves.toBe(
      '/unauthorized?url=%2Fe%2Fqa%2Freports%2Fanomalies&feature=ai_anomalies',
    );
  });

  it('a missing permission says nothing about the plan', async () => {
    await expect(run({ permissions: ['ai_anomalies:view'], feature: 'ai_anomalies' }, [], [])).resolves.toBe(
      '/unauthorized?url=%2Fe%2Fqa%2Freports%2Fanomalies',
    );
  });
});
