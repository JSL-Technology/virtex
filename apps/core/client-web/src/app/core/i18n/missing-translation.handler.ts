import { Injectable, isDevMode } from '@angular/core';
import {
  MissingTranslationHandler,
  MissingTranslationHandlerParams,
} from '@ngx-translate/core';

/**
 * What the interface shows when a key has no entry.
 *
 * ## The default is the wrong failure mode for a product that is sold
 *
 * `@ngx-translate` renders a missing key as the key itself, so the failure surfaces as
 * `USER.STATUS.INACTIVE` sitting in a table cell, or `USER.ROLE.ADMINISTRATOR_DESC` in the roles
 * screen — which is exactly what this application shipped. It is not a crash, not a type error
 * and not a failing render, so nothing catches it and the customer is the one who finds it.
 *
 * Two behaviours, on purpose:
 *
 * - **In development** the key is shown, wrapped in markers, and logged. Loud is correct here:
 *   the person who can fix it is looking at the screen.
 * - **In production** the LAST segment of the key is humanised (`INACTIVE` becomes "Inactive").
 *   It is not a translation and it is not pretending to be one, but a reader gets a word in the
 *   right register instead of a dotted identifier, and the telemetry hook records the miss so it
 *   is fixed in the next release rather than discovered in a support ticket.
 *
 * The compile-time guard against this ever happening is `translation-coverage.spec.ts`; this is
 * what the runtime does when a key still slips through — a dynamically composed key, or a value
 * that arrived from the API.
 */

/** Keys already reported, so one missing key in a ten-thousand-row grid logs once, not ten thousand times. */
const reported = new Set<string>();

@Injectable({ providedIn: 'root' })
export class VirtexMissingTranslationHandler implements MissingTranslationHandler {
  handle(params: MissingTranslationHandlerParams): string {
    const key = params.key;

    if (!reported.has(key)) {
      reported.add(key);
      // One line, once, naming the key and the language, so a missing entry is greppable in a
      // production log aggregator instead of invisible.
      console.warn(`[i18n] Missing translation: "${key}" (${params.translateService.currentLang})`);
    }

    if (isDevMode()) return `[[${key}]]`;

    return humanise(key);
  }
}

/**
 * `SETTINGS.SECURITY.BACKUP_CODES` becomes "Backup codes".
 *
 * Deliberately crude. This is a legibility floor, not a translation: it produces English-shaped
 * text because the keys are English-shaped, and the only thing it guarantees is that a reader
 * sees words rather than an identifier.
 */
function humanise(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Test seam: the reported-once set is module-level state and has to be resettable. */
export function resetMissingTranslationLog(): void {
  reported.clear();
}
