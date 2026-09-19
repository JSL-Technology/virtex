import { Observable } from 'rxjs';

/**
 * The contract `vx-select` is built on.
 *
 * Every function here takes an option of the caller's own type and returns something primitive.
 * That is the whole reason the component can be pointed at a customer, a product, a warehouse or a
 * chart-of-accounts node without knowing what any of them are: it never touches a field, only ever
 * a function the caller supplied.
 */

/** The text that identifies an option — in the closed field, in the list, and to a screen reader. */
export type VxSelectDisplayFn<TOption> = (option: TOption) => string;

/** A second, quieter line under the display text: a tax id, a SKU, an account code. */
export type VxSelectDescribeFn<TOption> = (option: TOption) => string | null | undefined;

/** What the form control holds once an option is chosen. Defaults to the option itself. */
export type VxSelectValueFn<TOption, TValue> = (option: TOption) => TValue;

/** Whether this particular option can be chosen. An inactive customer is listed, not selectable. */
export type VxSelectDisabledFn<TOption> = (option: TOption) => boolean;

/**
 * The text a client-side filter matches against.
 *
 * Defaults to the display text, which is right for most lists and wrong for the ones whose useful
 * search terms are not on screen — a customer found by tax id, a product found by barcode.
 */
export type VxSelectSearchTextFn<TOption> = (option: TOption) => string;

/**
 * Ask the server for the options matching `query`.
 *
 * Supplying this puts the component in SERVER mode: the query is debounced, every keystroke past
 * the debounce is a request, and a response to a superseded query is dropped. `limit` is the page
 * size the caller configured, passed through so the endpoint can cap the answer.
 *
 * An empty query is a real query — it means "show me the first page" — so it is sent rather than
 * being treated as "search nothing".
 */
export type VxSelectSearchFn<TOption> = (
  query: string,
  limit: number,
) => Observable<readonly TOption[]>;

/**
 * Turn a value that arrived from outside into the option it names.
 *
 * In server mode the component has no list to look a value up in, so a form that is patched with
 * an id — reopening a draft, copying a document, deep-linking — would show an empty field over a
 * control that is not empty. This is how the field learns what it is already holding.
 */
export type VxSelectResolveFn<TOption, TValue> = (
  value: TValue,
) => Observable<TOption | null | undefined>;

/**
 * Create a new option from what the user typed, without leaving the form.
 *
 * The caller decides what "create" means — a modal, a slide-over, a one-field prompt — and returns
 * a stream that emits the created option, or emits `null` if the user backed out. The component
 * does the rest: it selects what comes back and returns focus to the field, so the user never
 * loses the place they were at.
 */
export type VxSelectCreateFn<TOption> = (
  query: string,
) => Observable<TOption | null | undefined>;

/** Where a `vx-select` is in its life. Drives which of the four panel states is on screen. */
export type VxSelectStatus = 'idle' | 'loading' | 'ready' | 'error';
