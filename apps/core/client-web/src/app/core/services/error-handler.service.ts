import { Injectable, inject, isDevMode } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import {
  VirtexTranslateStore,
  errorCodeOf,
  errorParamsOf,
  resolveErrorKey,
} from '@virteex/shared/ui-i18n';

/**
 * Turns any HTTP failure into a sentence in the reader's language.
 *
 * ## The contract this reads
 *
 * The API answers a failure with names, never prose:
 *
 *     { statusCode, code, messageKey, params, fieldErrors?, timestamp, path }
 *
 * `code` is a stable machine identifier the client may branch on — a two-factor challenge and a
 * blocked account are both 401 and lead to different screens. `messageKey` and `params` are the
 * catalogue entry for the wording. Nothing in the payload is a sentence, which is the point: the
 * screen knows the context a sentence needs and the server does not.
 *
 * ## What it replaces
 *
 * The server used to send `message` already translated, and this service forwarded it when it had
 * nothing better — so the API carried UI prose, and the same failure was worded in two places. 57
 * keys were defined in both catalogues, 23 of them differently, and which sentence a reader saw
 * depended on whether the lookup here found the key before falling through to the server's text.
 * There is now one definition per key in `libs/shared/locales`, and only the client renders it.
 *
 * ## Resolution order
 *
 *  1. `errors.<code>` — wording chosen for a code the product handles specially. Tried first
 *     because it is the deliberate one.
 *  2. `messageKey` — the specific domain message the server named.
 *  3. `errors.http_<status>` — the generic sentence for the status class.
 *  4. `errors.unexpected`.
 *
 * A raw string from the server is never rendered, and neither is anything from a 5xx: those
 * messages are written for an operator, and a stack fragment or a constraint name reaching the
 * browser is an information-disclosure defect (OWASP ASVS V7.4.1, CWE-209).
 */

/** One field's failure, as the API names it. */
export interface FieldError {
  property: string;
  key: string;
  params?: Record<string, unknown>;
}

/** What a caller catches: identifiers plus the sentence already resolved for display. */
export interface AppError {
  status: number;
  code: string | null;
  message: string;
  /** Per-field messages, already translated, keyed by the field's dotted path. */
  fieldErrors: Record<string, string[]>;
}

interface ErrorBody {
  code?: unknown;
  error?: unknown;
  messageKey?: unknown;
  params?: unknown;
  fieldErrors?: unknown;
}

@Injectable({ providedIn: 'root' })
export class ErrorHandlerService {
  private readonly translate = inject(TranslateService);
  private readonly store = inject(VirtexTranslateStore);

  handleError(operation: string, error: HttpErrorResponse): Observable<never> {
    const described = this.describe(error);

    if (isDevMode()) {
      // Status, code and key only. The body can carry a customer's data, and a console log is the
      // easiest place to leak it from.
      console.error(`[http] ${operation} failed`, {
        status: described.status,
        code: described.code,
      });
    }

    return throwError(() => described);
  }

  /** Everything a caller needs about a failure, for the call sites that catch it themselves. */
  describe(error: HttpErrorResponse): AppError {
    return {
      status: error?.status ?? 0,
      code: this.extractCode(error),
      message: this.resolveMessage(error),
      fieldErrors: this.resolveFieldErrors(error),
    };
  }

  /** The sentence alone, for a call site that only needs to show something. */
  messageFor(error: HttpErrorResponse): string {
    return this.resolveMessage(error);
  }

  /**
   * The catalogue KEY a failure resolves to, for a call site that stores it and lets the template
   * translate.
   *
   * Preferred over {@link messageFor} wherever the message is held in state: a key re-renders in
   * the new language when the reader switches, and a resolved sentence does not. Same order as
   * {@link resolveMessage}.
   */
  keyFor(error: HttpErrorResponse): string {
    return resolveErrorKey(error, (key) => this.has(key));
  }

  /**
   * Whether the loaded catalogue can actually render a key.
   *
   * This used to ask `instant(key) !== key`, which is the documented `@ngx-translate` behaviour —
   * and is wrong here, because this product replaces that behaviour. `VirtexMissingTranslationHandler`
   * returns `[[key]]` in development and a humanised last segment in production, and neither of
   * those equals the key. So the check answered "yes, I can render it" for every key that does not
   * exist, the resolution order below it never reached steps 2 to 4, and the first candidate won
   * whether or not the catalogue held it. A cashier shown `[[errors.internal_error]]` was seeing
   * exactly that: a key the catalogue does not define, accepted by a check that could not fail.
   *
   * `VirtexTranslateStore.hasKey` asks the funnel every lookup already passes through — the pipe,
   * the directive, `instant`, `get` and the fallback-language retry all reach it — so the check and
   * the later render walk the same normalisation and cannot disagree about what exists.
   */
  private has(key: string): boolean {
    for (const language of [this.translate.currentLang, this.translate.defaultLang]) {
      if (!language) continue;
      if (this.store.hasKey(language, key)) return true;
    }
    return false;
  }

  /**
   * The stable identifier the API sends alongside the message key.
   *
   * `code` is what the domain exceptions set; `error` is where a default NestJS filter puts its
   * own. Both are read because both are on the wire. A reason phrase ("Bad Request") is a status
   * name rather than a domain code, so requiring the screaming-snake shape keeps it out.
   */
  private extractCode(error: HttpErrorResponse): string | null {
    return errorCodeOf(error);
  }

  private resolveMessage(error: HttpErrorResponse): string {
    return this.translate.instant(this.keyFor(error), errorParamsOf(error));
  }

  /**
   * Per-field messages, grouped by the field they belong to.
   *
   * A form that failed three rules needs them per input, not concatenated: the old shape was a flat
   * array of sentences with nothing saying which field each described, and the forms were matching
   * them up by position.
   */
  private resolveFieldErrors(error: HttpErrorResponse): Record<string, string[]> {
    const raw = (error?.error as ErrorBody | null | undefined)?.fieldErrors;
    if (!Array.isArray(raw)) return {};

    const out: Record<string, string[]> = {};
    for (const entry of raw as FieldError[]) {
      if (!entry || typeof entry.key !== 'string') continue;
      const params = { ...(entry.params ?? {}) };
      // `property` carries the field's own label KEY, so it is translated before interpolation —
      // otherwise the sentence reads "validation.fields.tax_id is required".
      if (typeof params['property'] === 'string') {
        params['property'] = this.translate.instant(params['property'] as string);
      }
      const message = this.translate.instant(entry.key, params);
      const field = entry.property || '_';
      (out[field] ??= []).push(message);
    }
    return out;
  }

}
