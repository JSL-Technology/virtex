import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * No error is thrown with a sentence (QA A-15/A-17).
 *
 * `throw new ConflictException('El rango … se solapa …')` puts a Spanish sentence where the error
 * contract expects a key. The filter cannot render it in the reader's language, so it falls back
 * to the status's generic message: the overlap of an NCF range reached the reader as "No se pudo
 * registrar el rango." A `*Error` from `i18n/localized.exception` names a key and its parameters.
 * Passing a catalogue key to a Nest exception is still allowed — the filter honours it.
 */
const APP = join(__dirname, '..');
const THROW_WITH_LITERAL = /throw new (\w+Exception)\(\s*([`'"])([\s\S]*?)\2/g;
const LOOKS_LIKE_A_KEY = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'migrations' ? [] : sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('error messages', () => {
  it('are catalogue keys, never sentences written at the throw', () => {
    const offenders: string[] = [];
    for (const path of sources(APP)) {
      if (path.endsWith('localized.exception.ts')) continue; // its doc comment quotes the old way
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(THROW_WITH_LITERAL)) {
        if (LOOKS_LIKE_A_KEY.test(match[3])) continue;
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${relative(APP, path)}:${line} ${match[1]}(${match[3].slice(0, 50)}…)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
