import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';

/** Where the moment of the last activity is kept, so it survives a reload and is shared by tabs. */
export const LAST_ACTIVITY_STORAGE_KEY = 'vx-last-activity';

/** The channel every tab of this application uses to tell the others about the session. */
export const SESSION_CHANNEL_NAME = 'vx-session';

/** What one tab tells the others. */
export type SessionBroadcast =
  | { type: 'activity'; at: number }
  | { type: 'signed-out'; reason?: 'expired' | 'idle' };

/**
 * When the person last did something, across every tab of the application.
 *
 * ## Why this is its own service
 *
 * The inactivity sign-out used to keep this moment in a timer inside one tab. Three things went
 * wrong with that, and each is why the interface and the server disagreed:
 *
 *  - Two tabs, one in use: the idle one signed the person out of both.
 *  - A reload started the count again from zero, so reloading after being signed out for
 *    inactivity — or after coming back to a laptop that had slept through the timer — simply
 *    restored the session.
 *  - A laptop's timers stop while it sleeps, so a fifteen-minute timer could fire hours late.
 *
 * The moment is now wall-clock time, kept in `localStorage` (so a reload and a new tab both see
 * it) and announced over a `BroadcastChannel` (so every open tab counts activity in any of them).
 * It has no dependencies, which is what lets both `AuthService` and `IdleService` use it.
 */
@Injectable({ providedIn: 'root' })
export class ActivityTrackerService implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly channel: BroadcastChannel | null =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel(SESSION_CHANNEL_NAME) : null;
  private readonly listeners = new Set<(message: SessionBroadcast) => void>();

  /** Activity is written at most this often: a mouse move fires dozens of times a second. */
  private static readonly WRITE_INTERVAL_MS = 5_000;
  private lastWritten = 0;
  private memoryFallback = 0;

  constructor() {
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<SessionBroadcast>) => {
        const message = event.data;
        if (message?.type === 'activity' && typeof message.at === 'number') {
          this.store(Math.max(message.at, this.lastActivity() ?? 0));
        }
        this.zone.run(() => this.listeners.forEach((listener) => listener(message)));
      };
    }
  }

  ngOnDestroy(): void {
    this.channel?.close();
  }

  /** The last recorded activity, in epoch milliseconds, or null when none was ever recorded. */
  lastActivity(): number | null {
    try {
      const raw = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
      const value = raw === null ? NaN : Number(raw);
      if (Number.isFinite(value)) return value;
    } catch {
      // Storage unavailable (privacy mode, a sandboxed frame): the in-memory copy still works
      // for this tab.
    }
    return this.memoryFallback || null;
  }

  /** How long ago the last activity was, or null when there is no record. */
  idleForMs(now = Date.now()): number | null {
    const last = this.lastActivity();
    return last === null ? null : Math.max(0, now - last);
  }

  /**
   * Record activity now. Throttled unless `force` — a sign-in must be recorded immediately, or a
   * record left over from an earlier session could sign the new one out at once.
   */
  touch(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastWritten < ActivityTrackerService.WRITE_INTERVAL_MS) return;
    this.lastWritten = now;
    this.store(now);
    this.broadcast({ type: 'activity', at: now });
  }

  /** Forget the record: nobody is signed in, so there is no activity to measure. */
  clear(): void {
    this.memoryFallback = 0;
    this.lastWritten = 0;
    try {
      localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
    } catch {
      // See lastActivity().
    }
  }

  broadcast(message: SessionBroadcast): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed channel (the tab is unloading) has nobody left to tell.
    }
  }

  /** Listen to what the other tabs say. Returns the function that stops listening. */
  onBroadcast(listener: (message: SessionBroadcast) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private store(at: number): void {
    this.memoryFallback = at;
    try {
      localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(at));
    } catch {
      // See lastActivity().
    }
  }
}
