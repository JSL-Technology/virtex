import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The application never asks with `window.confirm` or `window.alert`.
 *
 * Not a style rule. A native dialog takes a string, so its text is written at the call site and
 * cannot be translated — that is how eighteen of them ended up asking, in Spanish, whether to
 * delete a customer or block a user, one of them in English instead. They are also unstyled,
 * ignore the theme, block the whole tab, and some browsers suppress them outright, so the answer
 * a caller gets back may be one nobody gave.
 *
 * `DialogService` is the replacement: it takes translation keys, resolves them in the reader's
 * language, and renders through the product's own dialog.
 */

const CLIENT_SOURCE = join(__dirname, '..', '..', '..');

/**
 * `window.confirm(x)` and a bare `confirm('…')` both count.
 *
 * The first version only matched a quoted first argument, and so missed
 * `window.prompt(question)` — a call that had merely moved its Spanish sentence into a variable
 * one line above. The dialog is the problem, not where its text is written.
 */
const NATIVE_CALL = /(?:window\s*\.\s*(?:confirm|alert|prompt)\s*\(|(?<![.\w])(?:confirm|alert|prompt)\s*\(\s*[`'"])/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('the application', () => {
  it('asks through DialogService, never through a native browser dialog', () => {
    const offenders = sourceFiles(CLIENT_SOURCE)
      .flatMap((path) => {
        const lines = readFileSync(path, 'utf8').split('\n');
        return lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => NATIVE_CALL.test(line) && !line.trimStart().startsWith('//'))
          .map(({ index }) => `${relative(CLIENT_SOURCE, path)}:${index + 1}`);
      });
    expect(offenders).toEqual([]);
  });
});
