import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The tones an indicator can carry, for the whole product.
 *
 * ## Why this list and not another
 *
 * It is the vocabulary the document shell already used (`DocumentTone`), extended with the two
 * the rest of the product needed. The point is that there is exactly ONE list: twenty screens had
 * invented their own — `.paid`/`.pending`, `.status-open`/`.status-closed`,
 * `.status-completed`/`.status-failed`/`.status-processing` — which are three vocabularies for the
 * same four ideas, maintained in parallel and already drifted apart in colour.
 *
 * A tone is SEMANTIC, never decorative. `draft` is not "grey", it is "this document still admits
 * work"; `danger` is not "red", it is "this needs attention or is void". A screen that wants a
 * colour rather than a meaning is asking the wrong question.
 */
export type VxTone = 'neutral' | 'draft' | 'ok' | 'warning' | 'danger' | 'info' | 'accent';

/**
 * A status pill.
 *
 * ## What this replaces
 *
 * `.status-badge` was defined ten times — `features/invoices/list/list.page.scss:38`,
 * `features/accounting/periods/periods.page.scss:7`, `features/data-exports/data-exports.page.scss:71`
 * and seven more — on top of a base in `assets/styles/_list-page.scss:29`, and each definition
 * invented its own modifier names for the same four tones. Twenty `statusClass()` /
 * `getStatusClass()` functions fed them. The `ds.badge()` mixin that would have prevented all of
 * it existed the whole time and had zero consumers, which is the argument for a component rather
 * than a mixin: a mixin is a rule somebody has to remember.
 *
 * ## What stays outside
 *
 * The mapping from a domain status to a tone. `Paid → ok` is knowledge about invoices, and this
 * component knows nothing about invoices. Those twenty functions become twenty
 * `Record<Status, VxTone>` tables next to the entity they describe — which is what they always
 * were, written as `if` chains.
 */
@Component({
  selector: 'vx-badge',
  standalone: true,
  template: `<ng-content />`,
  styleUrls: ['./badge.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vx-badge',
    '[class]': 'classes()',
    '[attr.title]': 'title() || null',
  },
})
export class VxBadgeComponent {
  readonly tone = input<VxTone>('neutral');

  /**
   * A document that no longer admits work: voided, superseded, replaced by a credit note.
   *
   * Struck through rather than merely greyed, because "cancelled" and "not started" are different
   * facts and the invoice register showed them in the same grey.
   */
  readonly struck = input(false);

  /** Dimmer and smaller, for a pill sitting inside a dense table cell. */
  readonly size = input<'sm' | 'md'>('md');

  /** Hover text, for a status whose full wording does not fit the pill. */
  readonly title = input<string | null>(null);

  protected readonly classes = computed(
    () =>
      `vx-badge vx-badge--${this.tone()} vx-badge--${this.size()}` +
      (this.struck() ? ' vx-badge--struck' : ''),
  );
}
