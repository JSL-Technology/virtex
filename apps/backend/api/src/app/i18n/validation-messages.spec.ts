import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ValidationError } from 'class-validator';
import { I18nService } from './i18n.service';
import {
  constraintKey,
  parseValidationMessage,
  translateValidationError,
} from './validation-messages';

/**
 * Eleven hundred validation rules answered in two languages, neither necessarily the reader's:
 * about two hundred carried a hand-written Spanish sentence, and the rest fell through to
 * `class-validator`'s English. This is the seam that fixes both, so it is the seam that is tested.
 */
describe('validation messages', () => {
  const i18n = new I18nService();

  const error = (property: string, constraints: Record<string, string>): ValidationError =>
    ({ property, constraints }) as ValidationError;

  describe('parsing', () => {
    it('reads a bare key', () => {
      expect(parseValidationMessage('VALIDATION.CONSTRAINTS.IS_EMAIL')).toEqual({
        key: 'VALIDATION.CONSTRAINTS.IS_EMAIL',
        params: {},
      });
    });

    it('reads the bound a length constraint carries', () => {
      expect(parseValidationMessage('VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":254}')).toEqual({
        key: 'VALIDATION.CONSTRAINTS.MAX_LENGTH',
        params: { max: 254 },
      });
    });

    it('still resolves the key when the parameters are malformed', () => {
      // A typo in a decorator must not change how the request fails.
      expect(parseValidationMessage('VALIDATION.CONSTRAINTS.MIN|{max:}')).toEqual({
        key: 'VALIDATION.CONSTRAINTS.MIN',
        params: {},
      });
    });
  });

  describe('constraint keys', () => {
    it.each([
      ['isEmail', 'VALIDATION.CONSTRAINTS.IS_EMAIL'],
      ['maxLength', 'VALIDATION.CONSTRAINTS.MAX_LENGTH'],
      ['arrayMinSize', 'VALIDATION.CONSTRAINTS.ARRAY_MIN_SIZE'],
      ['isE164PhoneNumber', 'VALIDATION.CONSTRAINTS.IS_E164_PHONE_NUMBER'],
    ])('%s → %s', (constraint, expected) => {
      expect(constraintKey(constraint)).toBe(expected);
    });
  });

  describe('translation', () => {
    it('uses the constraint catalogue when the decorator carries no message', () => {
      const [message] = translateValidationError(
        i18n,
        error('email', { isEmail: 'email must be an email' }),
        'es',
      );
      expect(message).not.toContain('must be an email');
      expect(message).toContain('correo');
    });

    it('names the bound a length constraint was given', () => {
      const [message] = translateValidationError(
        i18n,
        error('email', { maxLength: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":254}' }),
        'es',
      );
      expect(message).toContain('254');
    });

    it('joins a composed message with the reader’s own conjunction', () => {
      const details = [
        { key: 'VALIDATION.FISCAL.FIELD_REQUIRED', params: { label: 'Régimen fiscal' } },
        { key: 'VALIDATION.FISCAL.FIELD_BAD_FORMAT', params: { label: 'Inscrição Estadual' } },
      ];
      const [message] = translateValidationError(
        i18n,
        error('fiscalProfile', {
          isFiscalProfileValidForCountry: `VALIDATION.FISCAL.PROFILE_INCOMPLETE|${JSON.stringify({ details })}`,
        }),
        'es',
      );
      expect(message).toContain('Régimen fiscal');
      expect(message).toContain('Inscrição Estadual');
      // The conjunction is CLDR's, not a hardcoded separator — and CLDR knows that Spanish uses
      // "e" rather than "y" before a word beginning with an i- sound, which is exactly the kind of
      // rule a joined string gets wrong: "Régimen fiscal es obligatorio e Inscrição Estadual…".
      expect(message).toMatch(/ (y|e) /);
    });

    it('falls back to the library’s own text rather than dropping the error', () => {
      const [message] = translateValidationError(
        i18n,
        error('mystery', { somethingNobodyCatalogued: 'raw text' }),
        'es',
      );
      expect(message).toBe('raw text');
    });
  });

  /**
   * The guard that keeps this from regressing.
   *
   * A `message:` written as a sentence inside a decorator is invisible until a customer reads it
   * in the wrong language, which is exactly the class of defect that has to be caught by a build
   * rather than by a report.
   */
  it('leaves no prose inside a validator decorator', () => {
    const files = execSync(
      "find apps/backend/api/src -name '*.ts' -not -name '*.spec.ts'",
      { encoding: 'utf8', cwd: process.cwd().replace(/\/apps\/backend\/api$/, '') },
    )
      .split('\n')
      .filter(Boolean);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(
        file.startsWith('/') ? file : `${process.cwd().replace(/\/apps\/backend\/api$/, '')}/${file}`,
        'utf8',
      )
        // Comments are documentation, and this file's own documentation quotes the sentence it
        // exists to abolish. Blanked rather than removed so nothing else shifts.
        .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => ' '.repeat(comment.length));

      for (const match of source.matchAll(/\bmessage:\s*'([^']+)'/g)) {
        const text = match[1];
        if (/^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+(\|.*)?$/.test(text)) continue;
        // Response payloads are a different field (`messageKey`) and a different mechanism.
        if (!/[a-záéíóúñ]/i.test(text)) continue;
        offenders.push(`${file}: ${text}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
