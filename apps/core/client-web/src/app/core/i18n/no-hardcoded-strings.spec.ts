import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * No template may carry text a reader can see.
 *
 * This is the check whose absence let the product reach 1,244 literal text nodes and 111 literal
 * attributes across 126 templates — in two languages at once, with whole pages of the accounting
 * module in English inside a Spanish-default product. None of it was a type error, a runtime
 * error or a failing render; every one of them was just a string, so nothing could have caught it
 * except a check written for the purpose.
 *
 * The scanner is the same one that did the extraction (`tools/i18n/`), run in report mode. Using
 * the tool rather than a second implementation means the rule the build enforces and the rule the
 * codemod applies cannot drift apart — a string the scanner would move is a string the build
 * refuses, by construction.
 *
 * An exemption exists and is deliberately awkward: a file must say `i18n-ignore-file` in a
 * comment. Exactly one file does — the wordmark, which is a brand and not a word.
 */

const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..', '..');

function scan(...args: string[]): string {
  return execFileSync(
    'node',
    [join(WORKSPACE_ROOT, 'tools', 'i18n', 'externalize-template-text.mjs'), '--dry', ...args],
    { cwd: WORKSPACE_ROOT, encoding: 'utf8' },
  );
}

function count(output: string, label: string): number {
  const line = output.split('\n').find((row) => row.startsWith(label));
  return line ? Number.parseInt(line.slice(label.length).trim(), 10) : Number.NaN;
}

describe('no hardcoded strings', () => {
  describe('the Angular templates', () => {
    const output = scan();

    it('carry no literal text', () => {
      expect({ literalTextNodes: count(output, 'text nodes externalised'), detail: output }).toEqual(
        expect.objectContaining({ literalTextNodes: 0 }),
      );
    });

    it('carry no literal placeholder, title, alt or aria-label', () => {
      expect({ literalAttributes: count(output, 'attributes externalised'), detail: output }).toEqual(
        expect.objectContaining({ literalAttributes: 0 }),
      );
    });

    /**
     * A sentence split across inline elements is reported rather than rewritten, because turning
     * each fragment into its own key produces text that only reads correctly in Spanish word
     * order. Zero is the requirement: the fix is one key with parameters.
     */
    it('contain no sentence split across inline elements', () => {
      expect({ splitSentences: count(output, 'mixed blocks for a human'), detail: output }).toEqual(
        expect.objectContaining({ splitSentences: 0 }),
      );
    });
  });

  describe('the e-mail templates', () => {
    const output = scan('--hbs');

    it('carry no literal text', () => {
      expect({ literalTextNodes: count(output, 'text nodes externalised'), detail: output }).toEqual(
        expect.objectContaining({ literalTextNodes: 0 }),
      );
    });

    it('contain no sentence split across inline elements', () => {
      expect({ splitSentences: count(output, 'mixed blocks for a human'), detail: output }).toEqual(
        expect.objectContaining({ splitSentences: 0 }),
      );
    });
  });
});
