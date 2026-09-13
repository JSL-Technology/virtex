export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string; // This can be a translation key or a plain string
  /**
   * How long it stays, in milliseconds. `0` means it stays until the reader dismisses it.
   *
   * An error is not a notification, it is a thing that has to be dealt with, and several of this
   * product's errors ask the reader to go and do something on another screen — "configure a
   * fiscal sequence for E31 before issuing" is the clearest example. Those used to vanish on a
   * five-second timer, often while the reader was still looking at the field that caused them.
   */
  duration?: number;
}
