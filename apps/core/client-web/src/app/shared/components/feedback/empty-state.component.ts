import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Inbox } from 'lucide-angular';

/**
 * There is nothing here, and this says what to do about it.
 *
 * ## What this replaces
 *
 * Twelve hand-written empty states, and the `ds.empty-state()` mixin that exists in the design
 * system with **zero** consumers. That zero is the argument: a mixin is a rule somebody has to
 * remember, and for twelve screens in a row nobody did.
 *
 * The list gesture (`vx-list-shell`) already solved this for lists, and the result was that no
 * list in the product goes mute when it has no rows. This is the same thing for the screens that
 * are not lists — a panel, a tab, a section of a form.
 *
 * ## Why the action is projected and not an input
 *
 * The whole point of an empty state is the way out of it, and the way out is different every
 * time: a link, a button that opens a dialog, an upload field. `<ng-content select="[action]">`
 * takes whatever the caller already has rather than reinventing a button API.
 */
@Component({
  selector: 'vx-empty-state',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  template: `
    <lucide-icon [img]="icon()" class="empty-icon" aria-hidden="true"></lucide-icon>
    <p class="empty-title">{{ titleKey() | translate: params() }}</p>
    @if (descriptionKey(); as description) {
      <p class="empty-description">{{ description | translate: params() }}</p>
    }
    <ng-content select="[action]" />
  `,
  styleUrls: ['./empty-state.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'vx-empty-state' },
})
export class VxEmptyStateComponent {
  /** What is missing, as a catalogue key. Not "no data": say what would be here. */
  readonly titleKey = input('common.empty_title');
  /** Why it is missing, or what to do. Optional, and worth writing. */
  readonly descriptionKey = input<string | null>(null);
  /** Interpolation for both, so an empty search can name the term that found nothing. */
  readonly params = input<Record<string, unknown>>({});
  readonly icon = input<unknown>(Inbox);
}
