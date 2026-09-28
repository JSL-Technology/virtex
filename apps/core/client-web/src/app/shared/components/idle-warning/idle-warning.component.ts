import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { IdleService } from '../../../core/services/idle.service';
import { VxDialogComponent } from '../dialog';

/**
 * The last minute before an inactivity sign-out: says what is about to happen and lets the
 * person stay.
 *
 * Signing out without warning cost whatever was on screen — a half-typed entry, an unsent form —
 * for someone who had only looked away. Only ordinary sessions ever see this; a remembered one
 * is not signed out for inactivity (see `IdleService`).
 *
 * Escape and the scrim count as "stay", because both are the person answering; the only way to
 * be signed out from here is the explicit button, or saying nothing at all.
 */
@Component({
  selector: 'app-idle-warning',
  standalone: true,
  imports: [TranslateModule, VxDialogComponent],
  templateUrl: './idle-warning.component.html',
  styleUrl: './idle-warning.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IdleWarningComponent {
  readonly idle = inject(IdleService);
}
