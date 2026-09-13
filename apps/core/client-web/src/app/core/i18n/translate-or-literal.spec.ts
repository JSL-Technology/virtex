import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService, TranslateLoader } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { translateOrLiteral } from './translate-or-literal';

class FakeLoader implements TranslateLoader {
  getTranslation(): Observable<Record<string, unknown>> {
    return of({ BILLING: { PLANS: { PRO: { DESCRIPTION: 'For growing companies' } } } });
  }
}

/**
 * Values that MAY be a key.
 *
 * A plan description, a Stripe status, a fiscal document type from a tenant's own localisation
 * pack: the server sends a string and the client cannot know in advance whether the catalogue
 * carries it. What must never happen is a raw key reaching the screen.
 */
describe('translateOrLiteral', () => {
  let translate: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: FakeLoader } }),
      ],
    });
    translate = TestBed.inject(TranslateService);
    translate.use('en');
  });

  it('translates a key the catalogue carries', () => {
    expect(translateOrLiteral(translate, 'BILLING.PLANS.PRO.DESCRIPTION')).toBe(
      'For growing companies',
    );
  });

  it('prints a sentence that is not a key as it stands', () => {
    // A plan row seeded before descriptions became keys.
    expect(translateOrLiteral(translate, 'Para empresas en crecimiento')).toBe(
      'Para empresas en crecimiento',
    );
  });

  /**
   * The reason this helper exists rather than a bare `instant`.
   *
   * `VirtexMissingTranslationHandler` answers a missing key with the key in production and
   * `[[KEY]]` in development, so `result === key` misses the development case and the screen shows
   * `[[BILLING.PLANS.STARTER.DESCRIPTION]]`.
   */
  it('treats the development marker as a miss, not as a translation', () => {
    jest
      .spyOn(translate, 'instant')
      .mockReturnValue('[[BILLING.PLANS.STARTER.DESCRIPTION]]' as never);

    expect(translateOrLiteral(translate, 'BILLING.PLANS.STARTER.DESCRIPTION')).toBe(
      'BILLING.PLANS.STARTER.DESCRIPTION',
    );
  });

  it('shows the caller’s fallback instead of the key when one is given', () => {
    expect(
      translateOrLiteral(translate, 'BILLING.SUBSCRIPTION_STATUS.PAST_DUE', undefined, 'past_due'),
    ).toBe('past_due');
  });

  it('is empty for an absent value, and takes the fallback when there is one', () => {
    expect(translateOrLiteral(translate, null)).toBe('');
    expect(translateOrLiteral(translate, undefined, undefined, '—')).toBe('—');
  });
});
