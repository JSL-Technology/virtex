import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ValidationError } from 'class-validator';
import { I18nService } from './i18n.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  constraintKey,
  describeValidationError,
  explanatoryConstraints,
  parseValidationMessage,
  translateValidationError,
} from './validation-messages';
import { OpenShiftDto } from '../pos/dto/open-shift.dto';
import { RegisterUserDto } from '../auth/dto/register-user.dto';

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
      expect(parseValidationMessage('validation.constraints.is_email')).toEqual({
        key: 'validation.constraints.is_email',
        params: {},
      });
    });

    it('reads the bound a length constraint carries', () => {
      expect(parseValidationMessage('validation.constraints.max_length|{"max":254}')).toEqual({
        key: 'validation.constraints.max_length',
        params: { max: 254 },
      });
    });

    it('still resolves the key when the parameters are malformed', () => {
      // A typo in a decorator must not change how the request fails.
      expect(parseValidationMessage('validation.constraints.min|{max:}')).toEqual({
        key: 'validation.constraints.min',
        params: {},
      });
    });
  });

  describe('constraint keys', () => {
    it.each([
      ['isEmail', 'validation.constraints.is_email'],
      ['maxLength', 'validation.constraints.max_length'],
      ['arrayMinSize', 'validation.constraints.array_min_size'],
      ['isE164PhoneNumber', 'validation.constraints.is_e164_phone_number'],
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
        error('email', { maxLength: 'validation.constraints.max_length|{"max":254}' }),
        'es',
      );
      expect(message).toContain('254');
    });

    it('joins a composed message with the reader’s own conjunction', () => {
      const details = [
        { key: 'validation.fiscal.field_required', params: { label: 'Régimen fiscal' } },
        { key: 'validation.fiscal.label_not_expected_format', params: { label: 'Inscrição Estadual' } },
      ];
      const [message] = translateValidationError(
        i18n,
        error('fiscalProfile', {
          isFiscalProfileValidForCountry: `validation.fiscal.profile_incomplete|${JSON.stringify({ details })}`,
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
   * The reason a request was refused has to be the reason it was refused.
   *
   * Measured against the running server before this: `POST /pos/shifts {}` answered that
   * `terminalId` "cannot be longer than 120 characters" and `openingBalance` "cannot be greater
   * than {{max}}" — for two fields the request did not carry at all. The signup form, with no
   * organization name, said it "must be at least 2 characters long". The field named was right
   * every time and the reason was nonsense, which is worse than a vague message: the reader
   * trusts the sentence enough to act on it, and it tells them to shorten something they never
   * typed.
   *
   * The cause was ordering. A property decorator is applied bottom-up, so `class-validator`
   * registers constraints in reverse declaration order, and `stopAtFirstError` kept the LAST rule
   * written — precisely the one a DTO puts last because it explains least.
   *
   * These run against the REAL DTOs, through `plainToInstance` and `validate`, because the defect
   * lived in the order the decorators register in. A `ValidationError` built by hand chooses that
   * order itself and would prove nothing about it.
   */
  describe('which rule is reported', () => {
    const constraintsOf = async (Dto: new () => object, payload: Record<string, unknown>) => {
      const errors = await validate(plainToInstance(Dto, payload) as object);
      const picked: Record<string, string[]> = {};
      for (const failure of errors) {
        picked[failure.property] = explanatoryConstraints(failure).map(([name]) => name);
      }
      return { errors, picked };
    };

    it('reports an absent field as required, not as too long or too large', async () => {
      const { errors, picked } = await constraintsOf(OpenShiftDto, {});

      // What the DTO really breaks, in the order class-validator registers it: last-declared
      // first. This is the ordering the old configuration reported verbatim.
      expect(errors.map((e) => [e.property, Object.keys(e.constraints ?? {})])).toEqual([
        ['terminalId', ['maxLength', 'isString']],
        ['openingBalance', ['max', 'min', 'isNumber']],
      ]);

      expect(picked).toEqual({ terminalId: ['isDefined'], openingBalance: ['isDefined'] });
    });

    it('answers a missing field with the required key and the field label', async () => {
      const { errors } = await constraintsOf(OpenShiftDto, {});

      expect(errors.flatMap((failure) => describeValidationError(i18n, failure))).toEqual([
        {
          property: 'terminalId',
          key: 'validation.constraints.is_defined',
          params: { property: 'validation.fields.terminal_id' },
        },
        {
          property: 'openingBalance',
          key: 'validation.constraints.is_defined',
          params: { property: 'validation.fields.opening_balance' },
        },
      ]);
    });

    it('keeps a DTO’s own wording for a presence rule it declares itself', async () => {
      const { picked } = await constraintsOf(RegisterUserDto, { email: 'ana@acme.do' });

      // `organizationName` declares @IsNotEmpty with bespoke copy. That is what a missing value
      // gets — not the generic required message, and not the @MinLength that used to win.
      expect(picked['organizationName']).toEqual(['isNotEmpty']);
    });

    it('reports a present value by the most fundamental rule it breaks', async () => {
      const { errors, picked } = await constraintsOf(OpenShiftDto, {
        terminalId: 12345,
        openingBalance: 5,
      });

      // A number is not text, and `maxLength` on a number is false for a reason that has nothing
      // to do with length. Only the first is worth saying.
      expect(Object.keys(errors[0].constraints ?? {})).toEqual(['maxLength', 'isString']);
      expect(picked).toEqual({ terminalId: ['isString'] });
    });

    it('still reports a genuine bound when the value is there and really is out of range', async () => {
      const { picked } = await constraintsOf(OpenShiftDto, {
        terminalId: 'T1',
        openingBalance: -5,
      });

      expect(picked).toEqual({ openingBalance: ['min'] });
    });

    it('says nothing for a field that has nothing wrong with it', () => {
      expect(explanatoryConstraints(error('x', {}))).toEqual([]);
    });

    it('never lets a failing field travel as a blank', async () => {
      const { errors } = await constraintsOf(OpenShiftDto, {});
      for (const failure of errors) {
        expect(explanatoryConstraints(failure).length).toBe(1);
      }
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
        // A catalogue key, optionally carrying its bounds as `|{"max":254}`. Keys are
        // `lower_snake` since the naming convention moved there; see `libs/shared/types`.
        if (/^[a-z0-9][a-z0-9_]*(\.[a-z0-9_]+)+(\|.*)?$/.test(text)) continue;
        // Response payloads are a different field (`messageKey`) and a different mechanism.
        if (!/[a-záéíóúñ]/i.test(text)) continue;
        offenders.push(`${file}: ${text}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
