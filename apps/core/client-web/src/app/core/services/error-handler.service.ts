import { Injectable, inject, isDevMode } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

/**
 * Turns any HTTP failure into a sentence the reader's language can hold.
 *
 * ## What was wrong
 *
 * This service already injected `TranslateService` and still carried six hard-coded Spanish
 * fallbacks — `'Ocurrió un error inesperado…'`, `'Error interno del servidor.'`, `'No tienes
 * permiso…'`, `'El recurso solicitado no fue encontrado.'` — so an English-speaking user hit
 * Spanish the moment anything failed. Worse, the unrecognised branch did this:
 *
 *     customErrorMessage = serverError?.message || errorCode;
 *
 * which forwarded the backend's message verbatim, and the backend's messages are 197 Spanish
 * literals (`'El asiento contable no está balanceado.'`). The interface was translated; its
 * error states were not.
 *
 * ## What replaces it
 *
 * The server now answers with a stable, machine-readable `code`, translated by
 * `ERRORS.<CODE>` on this side — and, because the backend has its own catalogue and negotiates
 * the language, its `message` arrives already in the reader's language as a second line of
 * defence. Order of preference:
 *
 *   1. `ERRORS.<code>` from the client catalogue — the client knows the screen context.
 *   2. The server's `message`, which is now localised server-side.
 *   3. `ERRORS.HTTP_<status>` — a generic, translated sentence for the status class.
 *   4. `ERRORS.UNEXPECTED`.
 *
 * A raw backend string is never shown without one of the first three having had its chance, and
 * a stack trace or SQL fragment is never shown at all.
 */
@Injectable({ providedIn: 'root' })
export class ErrorHandlerService {
  private readonly translate = inject(TranslateService);

  handleError(operation: string, error: HttpErrorResponse): Observable<never> {
    const code = this.extractCode(error);
    const message = this.resolveMessage(error, code);

    if (isDevMode()) {
      // Status and code only. The body can carry a customer's data, and a console log is the
      // easiest place to leak it from.
      console.error(`[http] ${operation} failed`, { status: error.status, code });
    }

    return throwError(() => ({ status: error.status, code, message }));
  }

  /**
   * Translate a message for a failure without re-throwing it.
   *
   * For call sites that already catch the error and only need the sentence.
   */
  messageFor(error: HttpErrorResponse): string {
    return this.resolveMessage(error, this.extractCode(error));
  }

  /**
   * The stable identifier the server sends alongside the human sentence.
   *
   * `error` is the field NestJS exception filters use for the code; `code` is what the domain
   * exceptions add. Both are read because both are in the wire format today, and a response that
   * carries neither yields null rather than a guess.
   */
  private extractCode(error: HttpErrorResponse): string | null {
    const body = error?.error as { code?: unknown; error?: unknown } | null | undefined;
    for (const candidate of [body?.code, body?.error]) {
      // A NestJS default filter puts the reason phrase ("Bad Request") in `error`. That is a
      // status name, not a domain code, and translating `ERRORS.BAD REQUEST` finds nothing —
      // requiring the screaming-snake shape keeps it out.
      if (typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{2,}$/.test(candidate)) return candidate;
    }
    return null;
  }

  private resolveMessage(error: HttpErrorResponse, code: string | null): string {
    // A browser-level failure: DNS, TLS, or the device being offline. There is no server answer
    // to read, and the browser's own message is neither translated nor meaningful to a reader.
    if (error?.error instanceof ProgressEvent || error?.status === 0) {
      return this.translate.instant('ERRORS.NETWORK');
    }

    if (code) {
      const translated = this.translate.instant(`ERRORS.${code}`);
      if (translated !== `ERRORS.${code}`) return translated;
    }

    const serverMessage = this.serverMessage(error);
    if (serverMessage) return serverMessage;

    const statusKey = `ERRORS.HTTP_${error?.status}`;
    const byStatus = this.translate.instant(statusKey);
    if (byStatus !== statusKey) return byStatus;

    return this.translate.instant('ERRORS.UNEXPECTED');
  }

  /**
   * The server's own sentence, when it is one.
   *
   * `class-validator` answers with an array of messages; the first is shown, because a form that
   * failed three rules is still one thing the reader has to fix and a wall of text is not help.
   * Anything that looks like a stack trace, a SQL statement or an internal identifier is refused:
   * a 500 must not put the database schema on the screen.
   */
  private serverMessage(error: HttpErrorResponse): string | null {
    const raw = (error?.error as { message?: unknown } | null | undefined)?.message;
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    if (typeof candidate !== 'string' || !candidate.trim()) return null;

    // Server faults are never forwarded: their messages are written for an operator.
    if (error.status >= 500) return null;
    if (/(\bat\s+\w+\.|SELECT\s|INSERT\s|relation ".*"|ECONNREFUSED|\bstack\b)/i.test(candidate)) {
      return null;
    }
    return candidate;
  }
}
