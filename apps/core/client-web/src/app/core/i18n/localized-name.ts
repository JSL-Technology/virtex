/**
 * An account's own name as a plain string, for code rather than templates.
 *
 * `VxLocalizedNamePipe` covers the template side. This is the same fallback chain for the places
 * that need the value in TypeScript — a search filter, a sort comparator, a value written into a
 * form control — and those places are where the bug actually bit: the chart-of-accounts search box
 * and the account merge tool both called `account.name.toLowerCase()`, and the server sends
 * `{ es: 'Efectivo' }`, so typing into either search field threw
 * `account.name.toLowerCase is not a function` and the screen stopped responding.
 *
 * Deliberately not locale-aware: a comparator that changes with the reader's language would sort
 * one list two ways. Callers that need the reader's language use the pipe, which does.
 */
export function accountNameOf(
  value: Record<string, string> | string | null | undefined,
  preferred: readonly string[] = ['es', 'en'],
): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;

  for (const language of preferred) {
    const candidate = value[language];
    if (candidate) return candidate;
  }
  return Object.values(value).find((candidate) => Boolean(candidate)) ?? '';
}

/** `accountNameOf`, lowercased, for case-insensitive matching. */
export function accountNameFor(
  value: Record<string, string> | string | null | undefined,
): string {
  return accountNameOf(value).toLocaleLowerCase();
}
