import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every request to the API goes through `environment.apiUrl`.
 *
 * A literal `'/api/…'` is resolved against the page, not against the API: in development that is
 * the Angular dev server on :4200, which answers any GET with `index.html` and 200 — so the call
 * "succeeds" with HTML — and any PUT with 404. That is how the workspace, the background-jobs
 * panel, the document lifecycles and the DataSheets import never reached the server at all while
 * nothing on screen said so (QA A-08).
 */

const CLIENT_SOURCE = join(__dirname, '..', '..', '..');
const RELATIVE_API = /(['"`])\/api\//;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('API URLs', () => {
  it('are built from environment.apiUrl, never as a path relative to the page', () => {
    const offenders = sourceFiles(CLIENT_SOURCE).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        // Comments may mention a path; interceptors may recognise one. Neither makes a request.
        .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*') && !line.includes('startsWith('))
        .filter(({ line }) => RELATIVE_API.test(line))
        .map(({ number }) => `${relative(CLIENT_SOURCE, path)}:${number}`),
    );
    expect(offenders).toEqual([]);
  });
});
