import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, RotateCcw, TriangleAlert } from 'lucide-angular';

/**
 * It failed, and here is how to try again.
 *
 * ## Why this is a component and not a toast
 *
 * A toast fades. A panel that failed to load is still failed thirty seconds later, and the reader
 * who looked away has no way to find out what the message said. Anything that leaves a region of
 * the screen empty has to say so IN that region, and offer the retry there.
 *
 * The audit found the opposite everywhere: a failed request set a `loading` flag back to false and
 * the panel simply rendered as if the answer had been "nothing". "No data" and "we could not ask"
 * are different facts and a reader cannot tell them apart.
 */
@Component({
  selector: 'vx-error-state',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  template: `
    <lucide-icon [img]="AlertIcon" class="empty-icon" aria-hidden="true"></lucide-icon>
    <p class="empty-title">{{ titleKey() | translate }}</p>
    @if (detail(); as message) {
      <p class="empty-description">{{ message }}</p>
    }
    @if (retryable()) {
      <button type="button" class="vx-error-state__retry" (click)="retry.emit()">
        <lucide-icon [img]="RetryIcon" aria-hidden="true"></lucide-icon>
        {{ 'common.retry' | translate }}
      </button>
    }
  `,
  styleUrls: ['./error-state.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'vx-error-state', role: 'alert' },
})
export class VxErrorStateComponent {
  readonly titleKey = input('common.load_failed');
  /**
   * The server's own words, already translated.
   *
   * A message, not a key: what comes back from the API has been localised by the API, and a
   * client that looks it up in its own catalogue would print the key for anything the server
   * knows about and the client does not.
   */
  readonly detail = input<string | null>(null);
  readonly retryable = input(true);
  readonly retry = output<void>();

  protected readonly AlertIcon = TriangleAlert;
  protected readonly RetryIcon = RotateCcw;
}
