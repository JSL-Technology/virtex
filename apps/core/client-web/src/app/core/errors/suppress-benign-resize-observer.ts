/**
 * Silence the browser's benign ResizeObserver loop notification — and nothing else.
 *
 * «ResizeObserver loop completed with undelivered notifications» (and its older sibling «loop limit
 * exceeded») is not an error: it is the specification telling the page that some observations were
 * deferred to the next frame, which is exactly what is meant to happen when a chart or a grid
 * resizes its own container (Highcharts, angular-gridster2 and Handsontable all do). Chromium still
 * dispatches it as a window `error` event with no `error` object, and Angular's global error
 * listener (`provideBrowserGlobalErrorListeners`) faithfully logs it as
 * «An ErrorEvent with no error occurred», once per layout churn.
 *
 * This swallows ONLY that message, in the capture phase so it runs before Angular's listener, and
 * leaves every real error — anything carrying an actual `error`, or any other message — to reach the
 * handler untouched. Registered from `main.ts` before `bootstrapApplication`, so it is in place for
 * the first frame.
 */
const BENIGN = /^ResizeObserver loop (limit exceeded|completed with undelivered notifications)/;

export function suppressBenignResizeObserverErrors(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener(
    'error',
    (event: ErrorEvent) => {
      // Only the no-`error` ResizeObserver notification. A genuine exception whose message happens
      // to mention ResizeObserver carries an `error` object and is left alone.
      if (!event.error && typeof event.message === 'string' && BENIGN.test(event.message)) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true,
  );
}
