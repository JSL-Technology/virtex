import { Injectable, signal } from '@angular/core';
import { Toast, ToastType } from '../interfaces/toast.interface';

/**
 * How long each kind of message stays on screen.
 *
 * ## Why an error stays until it is dismissed
 *
 * Everything used to auto-dismiss after five seconds, errors included — and several of this
 * product's errors are instructions: "configure a fiscal sequence for E31 before issuing" tells
 * the reader to go to another screen and do something. A message like that cannot be on a timer.
 * It disappeared while the reader was still looking at the field that produced it, and there was
 * no history to recover it from.
 *
 * A success is the opposite: the work is done, the toast is a receipt, and leaving it on screen
 * makes the reader dismiss something they have already acted on.
 */
const DURATION: Record<ToastType, number> = {
  success: 4_000,
  info: 5_000,
  // Long enough to read twice; a warning is usually about something the reader may want to note.
  warning: 10_000,
  /** Until dismissed. */
  error: 0,
};

/**
 * At most this many on screen at once, oldest dropped first.
 *
 * A failing batch operation raises one toast per row. Without a cap they stack past the top of
 * the viewport, and the close buttons of the ones that matter go with them.
 */
const MAX_VISIBLE = 4;

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  /**
   * List of active toasts managed as an Angular Signal.
   */
  public toasts = signal<Toast[]>([]);

  /** Pending dismissals, so a toast can be held while the reader is looking at it. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Adds a new toast to the list.
   * @param message Message or translation key.
   * @param type Type of the toast.
   * @param duration Optional duration in ms; `0` keeps it until dismissed.
   */
  public show(message: string, type: ToastType = 'info', duration?: number): void {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = {
      id,
      message,
      type,
      duration: duration ?? DURATION[type],
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

  public success(message: string, duration?: number): void {
    this.show(message, 'success', duration);
  }

  public error(message: string, duration?: number): void {
    this.show(message, 'error', duration);
  }

  public info(message: string, duration?: number): void {
    this.show(message, 'info', duration);
  }

  public warning(message: string, duration?: number): void {
    this.show(message, 'warning', duration);
  }

  /**
   * Stop the countdown on a toast the reader is engaged with.
   *
   * Hovering or tabbing to a toast is a reader saying "I am reading this". Letting it disappear
   * mid-sentence because a timer started before they got there is the single most common way a
   * message is lost.
   */
  public hold(id: string): void {
    this.clearTimer(id);
  }

  /** Restart the countdown once the reader moves away. */
  public release(id: string): void {
    const toast = this.toasts().find((candidate) => candidate.id === id);
    if (toast) this.arm(toast);
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
    this.toasts.set([]);
  }

  private arm(toast: Toast): void {
    this.clearTimer(toast.id);
    if (!toast.duration || toast.duration <= 0) return;
    this.timers.set(
      toast.id,
      setTimeout(() => this.remove(toast.id), toast.duration),
    );
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}
