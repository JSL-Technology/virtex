export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * The one thing a toast can ask the reader to do next.
 *
 * Many of this product's messages are not receipts, they are instructions — "you cannot invoice
 * yet, there is no active fiscal range" tells the reader to go to another screen and fix something.
 * A sentence naming a place ("Settings › Electronic invoicing") still leaves the reader to find
 * that place by hand. The action turns that sentence into a button that takes them there.
 *
 * A toast carries at most one action: a toast is a glance, not a menu, and a second button competes
 * with the first for the one decision the reader is being offered.
 */
export interface ToastAction {
  /** The button's text, already resolved for the reader's language. */
  label: string;
  /**
   * Router commands for a normal navigation, e.g. `['/invoices', id]`. Left unset when the action
   * only opens the settings overlay (see `fragment`) or only runs `handler`.
   */
  commands?: unknown[];
  /** Query params to carry on a `commands` navigation. */
  queryParams?: Record<string, unknown>;
  /**
   * The URL fragment to set on the current page, which is how the settings modal is opened
   * (`settings/fiscal` opens Settings › Electronic invoicing). Setting only the fragment keeps the
   * reader on their current screen, so closing the overlay returns them to where the toast found
   * them.
   */
  fragment?: string;
  /** An arbitrary callback, run before any navigation. For actions a route cannot express. */
  handler?: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string; // This can be a translation key or a plain string
  /**
   * How long it stays, in milliseconds. `0` means it stays until the reader dismisses it.
   *
   * Every toast now leaves on its own — an error included — because a message that has to be
   * closed by hand is a chore the reader repeats all day. What keeps an instruction from vanishing
   * before it is acted on is not an infinite timer but three things together: the countdown pauses
   * the moment the reader hovers or tabs onto the toast (see the service), a progress bar shows how
   * much time is left, and an instruction carries an `action` button that survives exactly as long
   * as the toast does. `0` remains available for the rare toast a caller wants pinned.
   */
  duration?: number;
  /** The one thing the reader can do next, rendered as a button. See {@link ToastAction}. */
  action?: ToastAction;
}
