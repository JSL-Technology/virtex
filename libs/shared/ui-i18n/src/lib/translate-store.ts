import { Injectable } from '@angular/core';
import { InterpolatableTranslation, TranslateStore } from '@ngx-translate/core';
import { normalizeKey } from '@virteex/shared/types';

/**
 * The one place a key is looked up, and therefore the one place it is normalised.
 *
 * ## Why this class exists
 *
 * Half of this product's lookups are not written out. They are composed from a value that came back
 * from the API:
 *
 *     {{ 'accounts_payable.status.' + bill.status | translate }}      <!-- 'PARTIALLY_PAID' -->
 *     {{ 'payroll.runs.type_label.' + run.runType | translate }}      <!-- 'CHRISTMAS_BONUS' -->
 *     {{ 'extensions.run_status.' + run.status | translate }}         <!-- 'execution_failed' -->
 *     {{ 'hcm.employees.form.frequency_label.' + pay.payFrequency }}  <!-- 'BIWEEKLY' -->
 *
 * Those values are spelled the way the database spells them, and not even consistently with each
 * other: a TypeORM enum is `SCREAMING_SNAKE`, the extension sandbox reports `snake_case`, a DTO
 * field arrives `camelCase`. The catalogue is `lower_snake` throughout. Sixty templates could each
 * remember to convert, and the one that forgot would put a literal
 * `accounts_payable.status.PARTIALLY_PAID` in a table cell — which is the precise failure the
 * naming convention exists to prevent, reintroduced by the call site.
 *
 * `TranslateStore.getValue` is the single funnel every lookup passes through — the pipe, the
 * directive, `instant`, `get`, `stream` and the fallback-language retry all reach it — so
 * normalising here covers every call site that exists and every one that will be written.
 *
 * Provided after `provideTranslateService(…)` so this subclass wins the `TranslateStore` token.
 */
@Injectable()
export class VirtexTranslateStore extends TranslateStore {
  /**
   * Keys repeat enormously — one grid redraw asks for the same status key on every row — and
   * normalising is a handful of regular expressions. The cache makes it a map read instead.
   */
  private readonly normalized = new Map<string, string>();

  override getValue(language: string, key: string): InterpolatableTranslation {
    let normal = this.normalized.get(key);
    if (normal === undefined) {
      normal = normalizeKey(key);
      this.normalized.set(key, normal);
    }
    const direct = super.getValue(language, normal);
    if (direct !== undefined) return direct;
    // A key that was already exactly right and is simply absent must not be looked up twice.
    return normal === key
      ? (undefined as unknown as InterpolatableTranslation)
      : super.getValue(language, key);
  }
}
