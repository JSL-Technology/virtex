/**
 * The shape a handler returns when its answer includes prose.
 *
 * A service names the message; `LocaleInterceptor` turns it into `message` in the reader's
 * language on the way out. Declaring it as a type rather than leaving each handler to write an
 * object literal is what makes the compiler reject `{ message: 'El período ha sido cerrado.' }`
 * creeping back in — which is how the 197 Spanish literals got there in the first place.
 *
 * `message` is absent by construction: nothing inside the application is allowed to produce the
 * final string, because nothing inside the application knows who is reading it.
 */
export interface LocalizedMessage {
  /** A key in the server catalogue, e.g. `ACCOUNTING.PERIOD_CLOSED`. */
  messageKey: string;
  /** Interpolation values for the key. Data, never prose. */
  messageParams?: Record<string, unknown>;
}

/** A command's answer: the localized confirmation plus whatever the caller needs back. */
export type LocalizedResult<T> = LocalizedMessage & T;
