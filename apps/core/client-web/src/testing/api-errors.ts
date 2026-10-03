import { HttpErrorResponse } from '@angular/common/http';
import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService, TranslateStore } from '@ngx-translate/core';
import { VirtexTranslateStore } from '@virteex/shared/ui-i18n';

/**
 * API errors as the API actually sends them.
 *
 * The error contract is `{ statusCode, code, messageKey, params }` (I18nExceptionFilter) — there is
 * no `message`. Twenty screens read `error.error.message`, and their specs fed them
 * `{ error: { message: '…' } }`: the specs passed while every one of those screens, in the running
 * product, always showed its generic fallback and never the reason the server gave. Build errors
 * here and a spec can only describe a response the server can produce.
 */
export function apiError(
  status: number,
  messageKey: string,
  params: Record<string, unknown> = {},
  code = status === 409 ? 'CONFLICT' : status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST',
): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    statusText: 'Error',
    url: 'https://api.example.test/v1/test',
    error: { statusCode: status, code, messageKey, params, timestamp: new Date(0).toISOString() },
  });
}

/** The body of {@link apiError}, for `HttpTestingController.flush`. */
export function apiErrorBody(
  status: number,
  messageKey: string,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return apiError(status, messageKey, params).error as Record<string, unknown>;
}

/**
 * The store the applications use, reachable under both tokens, so "does the catalogue have this
 * key?" — which decides whether the server's message or the screen's fallback is shown — can be
 * answered in a test the way it is answered in the product.
 */
export const TRANSLATE_STORE_PROVIDERS: Provider[] = [
  VirtexTranslateStore,
  { provide: TranslateStore, useExisting: VirtexTranslateStore },
];

/** Loads a small Spanish catalogue and makes it current. Call after `configureTestingModule`. */
export function useCatalogue(entries: Record<string, string>): TranslateService {
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('es', entries, true);
  translate.setDefaultLang('es');
  translate.use('es');
  return translate;
}
