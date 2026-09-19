import { Injectable, signal } from '@angular/core';
import { Toast, ToastAction, ToastType } from '../interfaces/toast.interface';

/**
 * How long each kind of message stays on screen.
 *
 * ## Why everything auto-dismisses now, errors included
 *
 * Errors used to stay until the reader closed them, on the argument that several of this product's
 * errors are instructions — "configure a fiscal sequence for E31 before issuing" — and an
 * instruction cannot be on a timer. The argument was right about the danger and wrong about the
 * cure. A message that must be closed by hand is a chore the reader does dozens of times a day, and
 * the ones that pile up unread are exactly the ones that mattered.
 *
 * So an instruction is protected three other ways instead. The countdown pauses the instant the
 * reader hovers or tabs onto the toast (see {@link hold}/{@link release}), so it never vanishes
 * mid-read. A toast that tells the reader to go somewhere carries an {@link ToastAction} button
 * that lives as long as the toast — and an actionable toast is given {@link ACTION_MIN_DURATION} so
 * there is time to reach for it. And the reader sees the time draining, via the progress bar the
 * component renders from this duration.
 *
 * A success is the opposite of an instruction: the work is done, the toast is a receipt, and
 * leaving it on screen makes the reader dismiss something they have already acted on.
 */
const DURATION: Record<ToastType, number> = {
  success: 4_000,
  info: 6_000,
  // Long enough to read twice; a warning is usually about something the reader may want to note.
  warning: 8_000,
  // An error is now on a timer like the rest, but the longest one — it is the message most likely
  // to be an instruction, and the reader who ignores it should have had every chance to read it.
  error: 10_000,
};

/**
 * The floor for a toast that carries an action button.
 *
 * The button is the whole point of the toast, and the reader has to read the message, decide, and
 * move the pointer to it before the toast leaves. Hovering pauses the countdown, but only once the
 * pointer has arrived — this is the budget for getting there.
 */
const ACTION_MIN_DURATION = 12_000;

/**
 * At most this many on screen at once, oldest dropped first.
 *
 * A failing batch operation raises one toast per row. Without a cap they stack past the top of
 * the viewport, and the close buttons of the ones that matter go with them.
 */
const MAX_VISIBLE = 4;

/** A live countdown, tracked so it can be paused and resumed without losing the time already spent. */
interface Countdown {
  handle: ReturnType<typeof setTimeout>;
  /** How much time was left when this handle was armed. */
  remaining: number;
  /** When this handle was armed, so the elapsed slice can be subtracted on pause. */
  startedAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  /**
   * List of active toasts managed as an Angular Signal.
   */
  public toasts = signal<Toast[]>([]);

  /** Pending dismissals, so a toast can be held while the reader is looking at it. */
  private readonly timers = new Map<string, Countdown>();

  /**
   * Adds a new toast to the list.
   * @param message Message or translation key.
   * @param type Type of the toast.
   * @param duration Optional duration in ms; `0` keeps it until dismissed.
   * @param action Optional call-to-action button that takes the reader where the message points.
   */
  public show(message: string, type: ToastType = 'info', duration?: number, action?: ToastAction): void {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = {
      id,
      message,
      type,
      // An actionable toast is never shorter than the time it takes to reach its button, unless the
      // caller pinned it deliberately with `0`.
      duration: this.resolveDuration(type, duration, action),
      action,
    };

    this.toasts.update((current) => {
      const next = [...current, newToast];
      // Drop from the front: the oldest has been readable the longest, and a reader chasing a
      // message that is scrolling off the top is worse than losing the one they have already seen.
      const overflow = next.length - MAX_VISIBLE;
      if (overflow > 0) {
        for (const dropped of next.slice(0, overflow)) this.clearTimer(dropped.id);
        return next.slice(overflow);
      }
      return next;
    });

    this.arm(newToast);
  }

  public success(message: string, duration?: number, action?: ToastAction): void {
    this.show(message, 'success', duration, action);
  }

  public error(message: string, duration?: number, action?: ToastAction): void {
    this.show(message, 'error', duration, action);
  }

  public info(message: string, duration?: number, action?: ToastAction): void {
    this.show(message, 'info', duration, action);
  }

  public warning(message: string, duration?: number, action?: ToastAction): void {
    this.show(message, 'warning', duration, action);
  }

  /**
   * Stop the countdown on a toast the reader is engaged with.
   *
   * Hovering or tabbing to a toast is a reader saying "I am reading this". The elapsed slice is
   * banked so that resuming continues from where it stopped rather than restarting the full timer —
   * which is also what keeps the progress bar honest, since it pauses on the same hover.
   */
  public hold(id: string): void {
    const countdown = this.timers.get(id);
    if (!countdown) return;
    clearTimeout(countdown.handle);
    const spent = Date.now() - countdown.startedAt;
    const remaining = Math.max(0, countdown.remaining - spent);
    this.timers.delete(id);
    // Stash the remaining time on a paused entry so release() can pick it up.
    this.paused.set(id, remaining);
  }

  /** Restart the countdown from where it was paused once the reader moves away. */
  public release(id: string): void {
    const remaining = this.paused.get(id);
    if (remaining === undefined) return;
    this.paused.delete(id);
    const toast = this.toasts().find((candidate) => candidate.id === id);
    if (toast) this.startCountdown(id, remaining);
  }

  /**
   * Removes a toast by its ID.
   * @param id The ID of the toast to remove.
   */
  public remove(id: string): void {
    this.clearTimer(id);
    this.toasts.update(currentToasts => currentToasts.filter(t => t.id !== id));
  }

  /** Dismiss everything. Used when a screen is replaced and its messages no longer apply. */
  public clear(): void {
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
    this.paused.clear();
    this.toasts.set([]);
  }

  /** Time banked on toasts the reader is currently engaged with. */
  private readonly paused = new Map<string, number>();

  private resolveDuration(type: ToastType, duration: number | undefined, action?: ToastAction): number {
    // An explicit duration always wins — including `0`, the caller's way of pinning a toast.
    if (duration !== undefined) return duration;
    const base = DURATION[type];
    return action ? Math.max(base, ACTION_MIN_DURATION) : base;
  }

  private arm(toast: Toast): void {
    this.startCountdown(toast.id, toast.duration ?? 0);
  }

  private startCountdown(id: string, remaining: number): void {
    this.clearTimer(id);
    if (remaining <= 0) return;
    this.timers.set(id, {
      handle: setTimeout(() => this.remove(id), remaining),
      remaining,
      startedAt: Date.now(),
    });
  }

  private clearTimer(id: string): void {
    const countdown = this.timers.get(id);
    if (countdown) {
      clearTimeout(countdown.handle);
      this.timers.delete(id);
    }
    this.paused.delete(id);
  }
}
