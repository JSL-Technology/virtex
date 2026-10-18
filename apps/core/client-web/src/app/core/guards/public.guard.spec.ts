import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { Observable, firstValueFrom, isObservable, of } from 'rxjs';
import { publicGuard } from './public.guard';
import { AuthService } from '../services/auth';

/** A snapshot chain `levels[0] → levels[1] → …`, each level carrying its own `data`. */
function chain(...levels: Record<string, unknown>[]): ActivatedRouteSnapshot {
  const snapshots = levels.map((data) => ({ data, firstChild: null }) as unknown as ActivatedRouteSnapshot);
  snapshots.forEach((snapshot, i) => {
    (snapshot as { firstChild: ActivatedRouteSnapshot | null }).firstChild = snapshots[i + 1] ?? null;
  });
  return snapshots[0];
}

describe('publicGuard', () => {
  let signedIn: boolean;

  beforeEach(() => {
    signedIn = true;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { resolveSession: () => of(signedIn) } },
      ],
    });
  });

  const run = async (route: ActivatedRouteSnapshot): Promise<boolean | UrlTree> => {
    const result = TestBed.runInInjectionContext(() => publicGuard(route, {} as RouterStateSnapshot)) as
      | boolean
      | UrlTree
      | Observable<boolean | UrlTree>;
    return isObservable(result) ? firstValueFrom(result) : result;
  };

  it('sends a signed-in visitor away from the sign-in screens', async () => {
    const result = await run(chain({}, {}));
    expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/overview']));
  });

  it('lets a signed-out visitor through', async () => {
    signedIn = false;
    expect(await run(chain({}))).toBe(true);
  });

  it('honours allowSignedIn on the route itself', async () => {
    expect(await run(chain({ allowSignedIn: true }))).toBe(true);
  });

  it('honours allowSignedIn on the target below the pathless shell (the unlock link, QA C-09)', async () => {
    // As `canActivateChild` the guard first runs for the shell, whose data is empty; the unlock
    // page below it is the one that admits a signed-in person.
    expect(await run(chain({}, { allowSignedIn: true }))).toBe(true);
  });
});
