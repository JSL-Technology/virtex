import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../shared/services/toast.service';
import { ToastAction } from '../../shared/interfaces/toast.interface';
import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandlerService } from './error-handler.service';

/**
 * A call-to-action a caller attaches to a toast, named the way the rest of this service is: the
 * button's text is a catalogue key, not a sentence, so a call site never writes prose. The label is
 * resolved here, in the one place the reader's language is consulted, and handed to the toast as
 * ready text.
 */
export interface NotificationAction {
  /** Translation key (or literal) for the button's text. */
  labelKey: string;
  /** Interpolation params for the label. */
  labelParams?: Record<string, unknown>;
  /** Router commands for a normal navigation, e.g. `['/invoices', id]`. */
  commands?: unknown[];
  /** Query params to carry on a `commands` navigation. */
  queryParams?: Record<string, unknown>;
  /** URL fragment to set on the current page — how the settings overlay is opened. */
  fragment?: string;
  /** An arbitrary callback, run before any navigation. */
  handler?: () => void;
}

/**
 * Every toast the application raises.
 *
 * ## Why translation belongs here and not at the call sites
 *
 * There were 131 calls passing a Spanish sentence written in place — `showSuccess('Factura
 * anulada con éxito.')`, `showError('No se pudieron cargar los clientes.')` — and a handful in
 * English (`'Could not load customer receipts.'`), so the product's feedback was not merely
 * untranslated, it was not even consistently one language.
 *
 * Putting `translate.instant()` at each of those 131 sites would mean 131 places that can forget.
 * Translating here means a call site names a key and nothing else, and there is exactly one place
 * where the reader's language is consulted.
 *
 * ## Text that is not a key still works
 *
 * A message that does not resolve is shown as-is. That is deliberate rather than lax: a value
 * that arrived from the API — a validation message the server already localised — is a legitimate
 * thing to show, and the alternative would be to render a sentence as if it were a missing key.
 * `no-hardcoded-strings.spec.ts` is what stops a NEW literal from being written here; this
 * fallback is for values that were never keys to begin with.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly toastService = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly errors = inject(ErrorHandlerService);

  showSuccess(messageKey: string, params?: Record<string, unknown>, action?: NotificationAction): void {
    this.toastService.success(this.resolve(messageKey, params), undefined, this.toAction(action));
  }

  showError(messageKey: string, params?: Record<string, unknown>, action?: NotificationAction): void {
    this.toastService.error(this.resolve(messageKey, params), undefined, this.toAction(action));
  }

  /**
   * Show a failed request, saying WHY it failed whenever the server said so.
   *
   * The pattern across the product was `error: () => showError('x.could_not_create')`: the server
   * answered a precise, translated reason — duplicate SKU, overlapping NCF range, a name over 255
   * characters, a period that cannot be closed yet — and the screen threw it away for a sentence
   * that could only be read as "something went wrong" (QA A-15, A-17). Some call sites showed
   * nothing at all.
   *
   * The specific reason wins; `fallbackKey` is used only when the server gave nothing more precise
   * than the status class (a network drop, a 5xx), where the caller's own sentence at least names
   * the operation. A field-level validation message is appended, since "Revisa los datos" with no
   * field is the other half of the same problem.
   *
   * Accepts a raw `HttpErrorResponse` or an `AppError` already described by `ErrorHandlerService`.
   */
  showHttpError(error: unknown, fallbackKey: string, params?: Record<string, unknown>): void {
    this.toastService.error(this.httpErrorMessage(error, fallbackKey, params));
  }

  /** The sentence {@link showHttpError} would show, for a caller that renders it inline. */
  httpErrorMessage(error: unknown, fallbackKey: string, params?: Record<string, unknown>): string {
    const fallback = this.resolve(fallbackKey, params);
    const described =
      error instanceof HttpErrorResponse
        ? this.errors.describe(error)
        : isAppErrorLike(error)
          ? error
          : null;
    if (!described) return fallback;

    const generic = GENERIC_ERROR_KEYS.test(described.messageKey ?? '');
    const fieldMessages = Object.values(described.fieldErrors ?? {}).flat().filter(Boolean);
    if (fieldMessages.length) {
      return generic ? fieldMessages.join(' ') : `${described.message} ${fieldMessages.join(' ')}`;
    }
    return generic || !described.message ? fallback : described.message;
  }

  showInfo(messageKey: string, params?: Record<string, unknown>, action?: NotificationAction): void {
    this.toastService.info(this.resolve(messageKey, params), undefined, this.toAction(action));
  }

  showWarning(messageKey: string, params?: Record<string, unknown>, action?: NotificationAction): void {
    this.toastService.warning(this.resolve(messageKey, params), undefined, this.toAction(action));
  }

  /** Turn a caller's action into one the toast can render, resolving the label here as everywhere. */
  private toAction(action?: NotificationAction): ToastAction | undefined {
    if (!action) return undefined;
    return {
      label: this.resolve(action.labelKey, action.labelParams),
      commands: action.commands,
      queryParams: action.queryParams,
      fragment: action.fragment,
      handler: action.handler,
    };
  }

  /**
   * Translate when the string is a key, pass it through when it is not.
   *
   * `instant` returns the key itself when there is no entry, which is how a dotted identifier
   * ends up on screen. Comparing the result against the input is the only way to tell "translated
   * to itself" from "not found", and the shape test keeps a real sentence from being probed as if
   * it were a key.
   */
  private resolve(message: string, params?: Record<string, unknown>): string {
    if (typeof message !== 'string' || !KEY_SHAPE.test(message)) return message;
    const translated = this.translate.instant(message, params);
    return translated === message ? message : translated;
  }
}

/** Keys that say only "it failed", with nothing a reader can act on. */
const GENERIC_ERROR_KEYS =
  /^errors\.(http_\d{3}|unexpected|internal|validation_failed|request_not_valid_check_data_try)$/;

interface AppErrorLike {
  message: string;
  messageKey: string;
  fieldErrors?: Record<string, string[]>;
}

function isAppErrorLike(value: unknown): value is AppErrorLike {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as AppErrorLike).message === 'string' &&
    typeof (value as AppErrorLike).messageKey === 'string'
  );
}

/**
 * `section.sub.key` — at least two dotted segments and no spaces.
 *
 * The test exists to keep a real sentence from being probed as if it were a key. It deliberately
 * accepts an upper-case segment as well, because a key composed from an API enum arrives as
 * `invoices.status.PARTIALLY_PAID` and `VirtexTranslateStore` is what reconciles the case.
 */
const KEY_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
