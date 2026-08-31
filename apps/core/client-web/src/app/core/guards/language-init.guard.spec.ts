import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { languageInitGuard } from './language-init.guard';
import { LanguageService } from '../services/language';

/**
 * The guard adopts the language a URL names — and does NOT write it to the account.
 *
 * That distinction is the point. A language-prefixed link says what to render now; it is often a
 * link somebody was sent, or one a marketing campaign built. Treating it as a preference would let
 * a shared URL silently rewrite the account setting of whoever opened it.
 *
 * The guard used to carry a second branch that rebuilt the URL when the language was unsupported.
 * It could never run: `langCodeMatcher` only matches a first segment that IS a supported code, so
 * the route does not activate at all for `/fr/…`. The test that exercised it was testing an input
 * the router cannot produce.
 */
class LanguageServiceStub {
  applyRouteLanguage = jest.fn();
  setLanguage = jest.fn();
}

describe('languageInitGuard', () => {
  let language: LanguageServiceStub;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: LanguageService, useClass: LanguageServiceStub }],
    });
    language = TestBed.inject(LanguageService) as unknown as LanguageServiceStub;
  });

  const run = (params: Record<string, string>) =>
    TestBed.runInInjectionContext(() =>
      languageInitGuard({ params } as unknown as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

  it('adopts the language named in the URL', () => {
    expect(run({ lang: 'en' })).toBe(true);
    expect(language.applyRouteLanguage).toHaveBeenCalledWith('en');
  });

  it('does not persist it to the account', () => {
    run({ lang: 'pt' });
    // `setLanguage` is the entry point that writes to the profile. A link must not use it.
    expect(language.setLanguage).not.toHaveBeenCalled();
  });

  it('activates even when the route somehow carries no language', () => {
    // Defensive: the matcher guarantees a language, so there is nothing to redirect to and
    // blocking navigation would strand the visitor on a blank page.
    expect(run({})).toBe(true);
    expect(language.applyRouteLanguage).not.toHaveBeenCalled();
  });
});
