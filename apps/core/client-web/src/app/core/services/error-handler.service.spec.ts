import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';

import { ErrorHandlerService } from './error-handler.service';
import { VirtexMissingTranslationHandler, VirtexTranslateStore } from '@virteex/shared/ui-i18n';

/**
 * The resolution order only works if "can the catalogue render this key?" can answer no.
 *
 * This product replaces `@ngx-translate`'s missing-key behaviour: instead of echoing the key, the
 * handler returns `[[key]]` in development and a humanised last segment in production. The service
 * asked `instant(key) !== key`, which is true for BOTH of those, so the check answered yes for
 * every key — including ones the catalogue does not define. The consequence was visible at a till:
 * a 500 with `code: INTERNAL_ERROR` resolved to `errors.internal_error`, a key that does not
 * exist, and the cashier was shown the literal text `[[errors.internal_error]]` instead of the
 * sentence written for that failure.
 *
 * These tests pin the behaviour that makes the documented order real: an undefined key must be
 * rejected so resolution falls through to one that exists.
 */
describe('ErrorHandlerService key resolution', () => {
  let service: ErrorHandlerService;
  let translate: TranslateService;

  /** A catalogue shaped like the real one: flat keys that contain dots. */
  const CATALOGUE: Record<string, string> = {
    'errors.unexpected': 'Something went wrong.',
    'errors.network': 'There is no connection to the server.',
    'errors.http_500': 'The server could not complete the request.',
    'errors.http_400': 'That request was not valid.',
    'errors.account_locked': 'This account is locked.',
    'pos.sale_error': 'We could not complete the sale.',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot({
          missingTranslationHandler: {
            provide: VirtexMissingTranslationHandler,
            useClass: VirtexMissingTranslationHandler,
          },
        }),
      ],
      providers: [
        // The same wiring the applications use: one store, reachable under both tokens.
        VirtexTranslateStore,
        { provide: TranslateStore, useExisting: VirtexTranslateStore },
        ErrorHandlerService,
      ],
    });

    service = TestBed.inject(ErrorHandlerService);
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', CATALOGUE);
    translate.setDefaultLang('en');
    translate.use('en');
  });

  const failure = (status: number, body: unknown): HttpErrorResponse =>
    new HttpErrorResponse({ status, error: body, url: '/api/v1/test' });

  it('falls through to the status sentence when the code has no catalogue entry', () => {
    // `errors.INTERNAL_ERROR` is not defined; `errors.http_500` is.
    const key = service.keyFor(failure(500, { statusCode: 500, code: 'INTERNAL_ERROR' }));

    expect(key).toBe('errors.http_500');
    expect(translate.instant(key)).toBe('The server could not complete the request.');
  });

  it('prefers the code entry when the catalogue actually defines it', () => {
    // `composeKey` normalises `ACCOUNT_LOCKED` to the catalogue's own casing.
    const key = service.keyFor(failure(401, { statusCode: 401, code: 'ACCOUNT_LOCKED' }));

    expect(key).toBe('errors.account_locked');
  });

  it('uses the server messageKey only when the catalogue can render it', () => {
    const known = service.keyFor(
      failure(400, { statusCode: 400, code: 'NOPE', messageKey: 'pos.sale_error' }),
    );
    expect(known).toBe('pos.sale_error');

    const unknown = service.keyFor(
      failure(400, { statusCode: 400, code: 'NOPE', messageKey: 'pos.not_in_catalogue' }),
    );
    expect(unknown).toBe('errors.http_400');
  });

  it('never resolves to a key the catalogue cannot render', () => {
    const cases: HttpErrorResponse[] = [
      failure(500, { statusCode: 500, code: 'INTERNAL_ERROR' }),
      failure(503, { statusCode: 503, code: 'UPSTREAM_GONE', messageKey: 'a.b.c' }),
      failure(418, { statusCode: 418 }),  // no errors.http_418 anywhere: must reach errors.unexpected
      failure(0, null),  // offline: resolves to errors.network, which the contract requires
    ];

    for (const error of cases) {
      const key = service.keyFor(error);
      expect(Object.prototype.hasOwnProperty.call(CATALOGUE, key)).toBe(true);
      // And therefore never the marker the missing-key handler would have produced.
      expect(translate.instant(key)).not.toContain('[[');
    }
  });

  it('never renders a sentence the server wrote', () => {
    const key = service.keyFor(
      failure(500, {
        statusCode: 500,
        message: 'QueryFailedError: null value in column "salesTotal"',
      }),
    );

    expect(translate.instant(key)).not.toContain('salesTotal');
    expect(translate.instant(key)).not.toContain('QueryFailedError');
  });
});
