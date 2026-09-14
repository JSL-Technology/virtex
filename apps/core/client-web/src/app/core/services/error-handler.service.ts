import { Injectable, inject, isDevMode } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { composeKey } from '@virteex/shared/types';

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
    if (error?.error instanceof ProgressEvent || error?.status === 0) return 'errors.network';

    const body = error?.error as ErrorBody | null | undefined;
    const code = this.extractCode(error);
    if (code) {
      const byCode = composeKey('errors', code);
      if (this.translate.instant(byCode) !== byCode) return byCode;
    }
    if (error.status < 500 && typeof body?.messageKey === 'string' && body.messageKey.trim()) {
      if (this.translate.instant(body.messageKey) !== body.messageKey) return body.messageKey;
    }
    const byStatus = `errors.http_${error?.status}`;
    if (this.translate.instant(byStatus) !== byStatus) return byStatus;
    return 'errors.unexpected';
  }

  /**
   * The stable identifier the API sends alongside the message key.
   *
   * `code` is what the domain exceptions set; `error` is where a default NestJS filter puts its
   * own. Both are read because both are on the wire. A reason phrase ("Bad Request") is a status
   * name rather than a domain code, so requiring the screaming-snake shape keeps it out.
   */
  private extractCode(error: HttpErrorResponse): string | null {
    const body = error?.error as ErrorBody | null | undefined;
    for (const candidate of [body?.code, body?.error]) {
      if (typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{2,}$/.test(candidate)) return candidate;
    }
    return null;
  }

  private resolveMessage(error: HttpErrorResponse): string {
    // A browser-level failure: DNS, TLS, or the device being offline. There is no server answer to
    // read, and the browser's own message is neither translated nor meaningful to a reader.
    if (error?.error instanceof ProgressEvent || error?.status === 0) {
      return this.translate.instant('errors.network');
    }

    const body = error?.error as ErrorBody | null | undefined;
    const params = this.paramsOf(body);
    const code = this.extractCode(error);

    if (code) {
      const byCode = composeKey('errors', code);
      const translated = this.translate.instant(byCode, params);
      if (translated !== byCode) return translated;
    }

    // A 5xx says nothing specific: the key it names describes an operator's problem.
    if (error.status < 500 && typeof body?.messageKey === 'string' && body.messageKey.trim()) {
      const translated = this.translate.instant(body.messageKey, params);
      if (translated !== body.messageKey) return translated;
    }

    const byStatus = `errors.http_${error?.status}`;
    const translated = this.translate.instant(byStatus);
    if (translated !== byStatus) return translated;

    return this.translate.instant('errors.unexpected');
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

  private paramsOf(body: ErrorBody | null | undefined): Record<string, unknown> {
    const params = body?.params;
    return params !== null && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  }
}
