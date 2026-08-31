import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../shared/services/toast.service';

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

  showSuccess(messageKey: string, params?: Record<string, unknown>): void {
    this.toastService.success(this.resolve(messageKey, params));
  }

  showError(messageKey: string, params?: Record<string, unknown>): void {
    this.toastService.error(this.resolve(messageKey, params));
  }

  showInfo(messageKey: string, params?: Record<string, unknown>): void {
    this.toastService.info(this.resolve(messageKey, params));
  }

  showWarning(messageKey: string, params?: Record<string, unknown>): void {
    this.toastService.warning(this.resolve(messageKey, params));
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

/** `SECTION.SUB.KEY` — screaming snake segments, at least two of them. */
const KEY_SHAPE = /^[A-Z][A-Z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
