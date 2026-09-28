import { Injectable, NgZone, OnDestroy, effect, inject, signal, untracked } from '@angular/core';
import { Subscription, fromEvent, interval, merge } from 'rxjs';
import { throttleTime } from 'rxjs/operators';
import { AuthService } from './auth';
import { AuthQueueService } from './auth-queue.service';
import { ActivityTrackerService } from './activity-tracker.service';

/** Shared by every tab, so only one of them renews the session per interval. */
const LAST_KEEPALIVE_STORAGE_KEY = 'vx-last-keepalive';

/**
 * Signs an ordinary session out after a period without activity — the same period, and the same
 * sessions, the server enforces.
 *
 * ## The rules, and where each one lives
 *
 * The server decides what kind of session this is ("remember me" or not) and says so in
 * `AuthService.sessionPolicy()`:
 *
 *  - A remembered session has no inactivity timeout here (`inactivityTimeoutMs: null`), so this
 *    service does nothing. The person said this is their device.
 *  - An ordinary session is signed out after `inactivityTimeoutMs` without activity, with a
 *    warning and a countdown for the last minute, and a button to stay.
 *
 * ## What it fixes
 *
 * It used to run a fifteen-minute timer in each tab for EVERY session, and to sign out through a
 * request the server refused once the access token had expired (i.e. at fifteen minutes). So the
 * sign-in page appeared, the session was still alive, and a reload put the person back on the
 * dashboard. Now:
 *
 *  - activity is wall-clock time shared by every tab (`ActivityTrackerService`), so one tab in
 *    use keeps them all, a reload does not reset the count, and a laptop that slept past the
 *    timeout is signed out the moment it wakes;
 *  - the sign-out ends the session on the server whatever state the access token is in;
 *  - while the person IS active, the session is renewed periodically, so the server's own idle
 *    window (which only sees requests) never ends a session somebody is typing in.
 */
@Injectable({ providedIn: 'root' })
export class IdleService implements OnDestroy {
  /** How long before the sign-out the warning appears. */
  static readonly WARNING_MS = 60_000;
  /** How often the clock is checked. The countdown is shown in whole seconds. */
  static readonly TICK_MS = 1_000;
  /**
   * How often an active person's session is renewed. Well inside the server's idle window for an
   * ordinary session (thirty minutes), so activity that makes no requests — reading, typing a
   * long form — never lets it lapse.
   */
  static readonly KEEPALIVE_MS = 10 * 60_000;

  private readonly auth = inject(AuthService);
  private readonly authQueue = inject(AuthQueueService);
  private readonly activity = inject(ActivityTrackerService);
  private readonly zone = inject(NgZone);

  /** Seconds left before the sign-out while the warning is showing; null when it is not. */
  readonly warningSecondsLeft = signal<number | null>(null);

  private subscription: Subscription | null = null;
  private timeoutMs: number | null = null;

  constructor() {
    effect(() => {
      const timeout = this.auth.isAuthenticated()
        ? this.auth.sessionPolicy()?.inactivityTimeoutMs ?? null
        : null;
      untracked(() => (timeout ? this.start(timeout) : this.stop()));
    });
  }

  ngOnDestroy(): void {
    this.stop();
  }

  /** "Stay signed in" on the warning: counts as activity and renews the session now. */
  stayActive(): void {
    this.activity.touch(true);
    this.warningSecondsLeft.set(null);
    this.keepAlive(true);
  }

  /** "Sign out" on the warning. */
  signOutNow(): void {
    this.stop();
    this.auth.logout(true);
  }

  private start(timeoutMs: number): void {
    if (this.subscription && this.timeoutMs === timeoutMs) return;
    this.stop();
    this.timeoutMs = timeoutMs;
    if (this.activity.lastActivity() === null) this.activity.touch(true);
    // A session that was just established or restored is fresh on the server: the first renewal
    // is due one interval from now, not on the first tick.
    try {
      if (!localStorage.getItem(LAST_KEEPALIVE_STORAGE_KEY)) {
        localStorage.setItem(LAST_KEEPALIVE_STORAGE_KEY, String(Date.now()));
      }
    } catch {
      // No storage: `keepAlive` falls back to renewing on its own rhythm.
    }

    this.zone.runOutsideAngular(() => {
      const activity$ = merge(
        fromEvent(document, 'pointerdown'),
        fromEvent(document, 'pointermove'),
        fromEvent(document, 'keydown'),
        fromEvent(document, 'wheel', { passive: true }),
        fromEvent(document, 'touchstart', { passive: true }),
        fromEvent(document, 'scroll', { capture: true, passive: true }),
      ).pipe(throttleTime(1_000));

      this.subscription = activity$.subscribe(() => this.activity.touch());

      // A tab returning to the foreground — or a laptop waking up — is checked at once, rather
      // than on the next tick of a timer the browser may have throttled for hours.
      this.subscription.add(
        fromEvent(document, 'visibilitychange').subscribe(() => {
          if (document.visibilityState === 'visible') this.tick();
        }),
      );
      this.subscription.add(interval(IdleService.TICK_MS).subscribe(() => this.tick()));
    });
  }

  private stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.timeoutMs = null;
    if (this.warningSecondsLeft() !== null) {
      this.zone.run(() => this.warningSecondsLeft.set(null));
    }
  }

  private tick(): void {
    const timeout = this.timeoutMs;
    if (timeout === null) return;

    const idleFor = this.activity.idleForMs() ?? 0;
    const remaining = timeout - idleFor;

    if (remaining <= 0) {
      this.zone.run(() => {
        this.stop();
        if (this.auth.isAuthenticated()) {
          // The explanation goes on the sign-in page, in the reader's language (see
          // `login.notice.signed_out_idle`), not into a dialog over a page it is not about.
          this.auth.logout(true, 'idle');
        }
      });
      return;
    }

    const seconds = remaining <= IdleService.WARNING_MS ? Math.ceil(remaining / 1_000) : null;
    if (seconds !== this.warningSecondsLeft()) {
      this.zone.run(() => this.warningSecondsLeft.set(seconds));
    }

    // Renew only for someone who is actually here: within the last minute.
    if (idleFor < 60_000) this.keepAlive(false);
  }

  /**
   * Renew the session if no tab has done so for `KEEPALIVE_MS` (or at once when `force`).
   *
   * Goes through the same queue the HTTP interceptor uses for its refreshes, so the two can never
   * rotate the refresh token at the same moment — which the server would read as token reuse.
   */
  private keepAlive(force: boolean): void {
    const now = Date.now();
    let last = 0;
    try {
      last = Number(localStorage.getItem(LAST_KEEPALIVE_STORAGE_KEY)) || 0;
    } catch {
      // No storage: this tab keeps its own rhythm.
    }
    if (!force && now - last < IdleService.KEEPALIVE_MS) return;
    if (this.authQueue.isRefreshingToken) return;

    try {
      localStorage.setItem(LAST_KEEPALIVE_STORAGE_KEY, String(now));
    } catch {
      // As above.
    }

    this.authQueue.startRefresh();
    this.zone.run(() =>
      this.auth.refreshAccessToken().subscribe({
        next: () => this.authQueue.finishRefreshSuccess(),
        error: () => {
          this.authQueue.finishRefreshError();
          // The server has ended the session (a bound, a revocation). Agree, and say why.
          if (this.auth.isAuthenticated()) this.auth.logout(false, 'expired');
        },
      }),
    );
  }
}
