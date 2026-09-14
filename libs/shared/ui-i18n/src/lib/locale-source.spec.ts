import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * The locale source, checked from the test suite as well as from CI.
 *
 * ## Why this is one spec that shells out, and not four that read the catalogues
 *
 * It replaces `translation-parity.spec.ts`, `translation-coverage.spec.ts`,
 * `no-hardcoded-strings.spec.ts` and `messages.parity.spec.ts`. Each of those read the catalogues its
 * own way and encoded its own idea of what a key is, and between them they still passed while 1.883
 * keys were in Spanish, 23 values sat in the wrong language, four composed families resolved to
 * nothing, and two keys used in production were defined nowhere.
 *
 * Splitting one set of invariants across four readers is how they disagreed. `verify-catalogues.mjs`
 * is the single implementation; this spec exists so `nx test` fails on a broken catalogue too,
 * rather than only the dedicated CI step — a developer running the tests locally should not have to
 * know about a separate command to find out they have broken a translation.
 *
 * The output is attached to the failure, because "exit code 1" tells whoever broke it nothing.
 */
const ROOT = path.resolve(__dirname, '../../../../..');

function run(script: string, args: string[] = []): string {
  try {
    return execFileSync('node', [path.join(ROOT, 'tools', 'i18n', script), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      // A few thousand keys of diagnostics fit comfortably; the default 1 MB does not.
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    throw new Error(
      `${script} ${args.join(' ')} failed:\n\n${failure.stdout ?? ''}\n${failure.stderr ?? failure.message}`,
    );
  }
}

describe('the locale source', () => {
  // Generous: each of these walks every source file in the workspace.
  jest.setTimeout(120_000);

  it('holds every invariant', () => {
    expect(run('verify-catalogues.mjs')).toContain('All checks passed');
  });

  it('is what the generated catalogues were built from', () => {
    expect(() => run('build-catalogues.mjs', ['--check'])).not.toThrow();
  });

  it('is where every string a reader sees comes from', () => {
    expect(run('scan-hardcoded-strings.mjs', ['--list'])).toContain('No untranslated interface text');
  });
});
