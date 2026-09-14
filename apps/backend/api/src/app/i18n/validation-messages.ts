import { ValidationError } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { LanguageCode } from '@virteex/shared/types';
import { I18nService } from './i18n.service';
import { composeKey } from '@virteex/shared/types';

/**
 * Validation errors, in the reader's language.
 *
 * ## The two halves of the problem
 *
 * Roughly eleven hundred `class-validator` decorators guard the DTOs. About two hundred carry a
 * hand-written Spanish `message`; the rest carry none, which means `class-validator` renders its
 * own — in English. So the form errors were split between two languages, neither of which was
 * necessarily the reader's: a Brazilian customer filling in the signup form was told
 * "email must be an email", and a moment later, "La dirección fiscal es obligatoria."
 *
 * Rewriting eleven hundred call sites to add a message each would be eleven hundred chances to
 * write a different sentence for the same rule. Instead the message is resolved here, at the one
 * place every validation failure passes through, in this order:
 *
 *  1. The decorator's `message` names a catalogue key — the bespoke wording somebody wrote for
 *     this specific field, kept because "La dirección fiscal es obligatoria" says more than "this
 *     field is required".
 *  2. No key: the CONSTRAINT's own key, `validation.constraints.is_email`, with the field's
 *     translated name interpolated. One string per rule covers every field that uses it.
 *  3. Neither exists: `class-validator`'s English. Visible, and therefore fixable — a silent
 *     fallback is a defect that survives.
 *
 * ## A composed message is a list of keys, not a joined sentence
 *
 * "Datos fiscales incompletos: Régimen fiscal es obligatorio; CFDI no es una opción válida."
 * is four translatable fragments and one separator, and the separator is not a semicolon in every
 * language. So a constraint that reports several problems at once passes them as
 * `{"details":[{"key":"…","params":{…}}, …]}` and the list is translated and joined here, by
 * `Intl.ListFormat`, in the reader's locale.
 *
 * ## Bounds travel as parameters
 *
 * "must be shorter than 254 characters" loses its point without the 254, and a `ValidationError`
 * does not carry the constraint's arguments. So a bounded decorator writes them into the message
 * itself: `'validation.constraints.max_length|{"max":254}'`. The separator is a pipe because a
 * catalogue key never contains one, and the suffix is JSON because the alternative is inventing
 * a second escaping convention.
 */

const PARAM_SEPARATOR = '|';

/** One fragment of a composed message: a key and its own parameters. */
export interface MessageDetail {
  key: string;
  params?: Record<string, unknown>;
}

export interface ParsedValidationMessage {
  key: string;
  params: Record<string, unknown>;
}

/** `'KEY|{"max":254}'` → `{ key: 'KEY', params: { max: 254 } }`. Malformed JSON yields no params. */
export function parseValidationMessage(raw: string): ParsedValidationMessage {
  const separator = raw.indexOf(PARAM_SEPARATOR);
  if (separator === -1) return { key: raw.trim(), params: {} };

  const key = raw.slice(0, separator).trim();
  const suffix = raw.slice(separator + 1).trim();
  try {
    const parsed: unknown = JSON.parse(suffix);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { key, params: parsed as Record<string, unknown> };
    }
  } catch {
    // A message that looks like a key but carries an unparseable suffix is a typo in a decorator,
    // not a reason to fail the request differently. The key still resolves.
  }
  return { key, params: {} };
}

/** `maxLength` → `validation.constraints.max_length`. */
export function constraintKey(constraint: string): string {
  return composeKey('validation.constraints', constraint);
}

/** `taxId` → `validation.fields.tax_id`, falling back to the property name itself. */
export function fieldLabel(i18n: I18nService, property: string, language: LanguageCode): string {
  const key = composeKey('validation.fields', property);
  return i18n.has(key) ? i18n.translate(key, language) : property;
}

/**
 * Which rule actually explains the failure.
 *
 * ## The rules do not fail in the order they are written
 *
 * A property decorator is applied bottom-up, so `class-validator` registers a field's constraints
 * in REVERSE declaration order. With `stopAtFirstError` the one constraint that survived was
 * therefore the LAST one written — the opposite of what the pipe intended, and the opposite of
 * what every DTO in the product was written to produce. Measured, against the running server:
 *
 *   POST /pos/shifts {}                  → terminalId: "cannot be longer than 120 characters"
 *   POST /pos/shifts {"terminalId":"T1"} → openingBalance: "cannot be greater than {{max}}"
 *   RegisterUserDto with no organizationName → "must be at least 2 characters long"
 *
 * Every one of those fields was ABSENT. None was too long, too large, or too short. The field
 * named was right and the reason was nonsense, which is the worst of both: the reader trusts the
 * sentence enough to act on it and it tells them to shorten something they never typed. The last
 * line is the signup form, so this was the wording on the screen that takes a customer's money.
 *
 * ## Why this is decided here instead of by reordering the decorators
 *
 * Roughly eleven hundred decorators guard the DTOs. Reordering them is eleven hundred chances to
 * get it wrong again, and the next DTO written would restore the bug, because the order that reads
 * correctly on the page is the order that behaves incorrectly at runtime. So the pipe now reports
 * every failure and the choice is made once, here, from the value itself.
 *
 * ## The choice
 *
 * A value that is not there has exactly one thing wrong with it. Length, bounds and format cannot
 * be evaluated on `undefined` at all — `maxLength(undefined)` is false the way `minLength` is
 * false, and neither is a fact about what the user did. So an absent value reports presence and
 * nothing else: the DTO's own presence rule when it declares one, so its bespoke wording survives,
 * and `is_defined` — "{{property}} is required" — when it does not.
 *
 * A value that IS there is reported by the most fundamental rule it breaks: wrong kind before
 * wrong shape before wrong size. `terminalId: 12345` is not text; saying it is also too long is
 * noise about a rule that never got to run. An unfamiliar constraint — a custom validator — ranks
 * last on purpose: whatever it checks, it is a statement about the value, and "it is missing" or
 * "it is the wrong kind" outranks it.
 */

/** Rules that say the value is not there. */
const PRESENCE_CONSTRAINTS = new Set([
  'isDefined',
  'isNotEmpty',
  'isNotEmptyObject',
  'arrayNotEmpty',
]);

/**
 * Rules that say the value is of the wrong kind or shape, so nothing about its size can apply.
 *
 * `class-validator`'s own names, spelled as it reports them.
 */
const SHAPE_CONSTRAINTS = new Set([
  'isString', 'isNumber', 'isInt', 'isBoolean', 'isArray', 'isObject', 'isDate',
  'isDateString', 'isNumberString', 'isEnum', 'isIn', 'isUuid', 'isEmail', 'isUrl',
  'isIso8601', 'isDecimal', 'isJson', 'isPositive', 'isNegative', 'matches',
  'nestedValidation', 'whitelistValidation',
]);

/** The key used when a field is absent and its DTO declares no presence rule of its own. */
const REQUIRED_KEY = 'validation.constraints.is_defined';

function rank(constraint: string): number {
  if (PRESENCE_CONSTRAINTS.has(constraint)) return 0;
  if (SHAPE_CONSTRAINTS.has(constraint)) return 1;
  return 2;
}

/**
 * `true` for a value the request simply did not carry.
 *
 * `'value' in error` and not `error.value === undefined`: a `ValidationError` from
 * `class-validator` always carries the key, `undefined` included, so its presence is what
 * separates "the payload had nothing here" from "nobody recorded what was here". Errors assembled
 * by hand — every one in this file's other tests, and the composed fiscal-profile failures — carry
 * no `value` at all, and treating those as absent swallowed the very constraint they were built to
 * report: three of them turned into "es obligatorio" and lost the bound, the joined detail list,
 * and the library's own fallback text.
 *
 * An empty string is a value. It fails `isNotEmpty`, which says so precisely, and it does not
 * belong here.
 */
function isAbsent(error: ValidationError): boolean {
  return 'value' in error && (error.value === undefined || error.value === null);
}

/**
 * The failing constraints worth reporting for one field, in `[constraint, rawMessage]` pairs.
 *
 * Never empty for a failing field: when nothing can be chosen — an absent value whose DTO declares
 * no presence rule — a synthetic `isDefined` is returned, so a failure never travels as a blank.
 */
export function explanatoryConstraints(error: ValidationError): [string, string][] {
  const entries = Object.entries(error.constraints ?? {});
  if (entries.length === 0) return [];

  if (isAbsent(error)) {
    const presence = entries.filter(([constraint]) => PRESENCE_CONSTRAINTS.has(constraint));
    return presence.length > 0 ? [presence[0]] : [['isDefined', REQUIRED_KEY]];
  }

  const best = Math.min(...entries.map(([constraint]) => rank(constraint)));
  return entries.filter(([constraint]) => rank(constraint) === best).slice(0, 1);
}

/**
 * Flatten nested errors into `address.city`-style paths.
 *
 * `@ValidateNested()` produces a tree, and a tree reported as "address is invalid" tells the
 * reader nothing about which line of the address is wrong.
 */
function flatten(errors: readonly ValidationError[], prefix = ''): ValidationError[] {
  const out: ValidationError[] = [];
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) out.push({ ...error, property: path });
    if (error.children?.length) out.push(...flatten(error.children, path));
  }
  return out;
}

/**
 * Translate a `details` list into one locale-formatted enumeration.
 *
 * Returns the parameters unchanged when there is no list, so the common case costs one property
 * read. A fragment whose key is unknown contributes its key rather than disappearing: a message
 * that silently loses half its content is harder to notice than one that reads oddly.
 */
function expandDetails(
  i18n: I18nService,
  params: Record<string, unknown>,
  language: LanguageCode,
): Record<string, unknown> {
  const details = params['details'];
  if (!Array.isArray(details)) return params;

  const fragments = details.map((detail) => {
    if (detail === null || typeof detail !== 'object') return String(detail);
    const { key, params: detailParams } = detail as MessageDetail;
    return i18n.has(key) ? i18n.translate(key, language, detailParams ?? {}) : key;
  });

  return {
    ...params,
    details: new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(fragments),
  };
}

/** Every message for one error, already translated. */
export function translateValidationError(
  i18n: I18nService,
  error: ValidationError,
  language: LanguageCode,
): string[] {
  const label = fieldLabel(i18n, error.property, language);

  return explanatoryConstraints(error).map(([constraint, fallback]) => {
    const parsed = parseValidationMessage(fallback);
    const params = expandDetails(i18n, parsed.params, language);
    if (i18n.has(parsed.key)) {
      return i18n.translate(parsed.key, language, { property: label, ...params });
    }

    const generic = constraintKey(constraint);
    if (i18n.has(generic)) {
      return i18n.translate(generic, language, { property: label, ...params });
    }

    return fallback;
  });
}

/** One field's failure, named rather than worded. */
export interface FieldError {
  /** Dotted path to the field, `address.city` for a nested DTO. */
  property: string;
  /** Catalogue key for the message. */
  key: string;
  /** Interpolation parameters, including `property` — the field's own translated label's key. */
  params: Record<string, unknown>;
}

/**
 * Every failure for one field, as keys.
 *
 * The resolution order is the same one `translateValidationError` uses; only the last step differs,
 * because a key that resolves nowhere has to travel as something. `class-validator`'s own English
 * sentence is passed through under `validation.constraints.fallback`, which renders it verbatim —
 * visible, and therefore fixable, which a silent blank is not.
 */
export function describeValidationError(i18n: I18nService, error: ValidationError): FieldError[] {
  const propertyKey = composeKey('validation.fields', error.property);
  const property = i18n.has(propertyKey) ? propertyKey : error.property;

  return explanatoryConstraints(error).map(([constraint, fallback]) => {
    const parsed = parseValidationMessage(fallback);
    const params = { property, ...parsed.params };

    if (i18n.has(parsed.key)) return { property: error.property, key: parsed.key, params };

    const generic = constraintKey(constraint);
    if (i18n.has(generic)) return { property: error.property, key: generic, params };

    return {
      property: error.property,
      key: 'validation.constraints.fallback',
      params: { ...params, message: fallback },
    };
  });
}

/**
 * The `exceptionFactory` for the global `ValidationPipe`.
 *
 * ## Why this sends keys and not sentences
 *
 * It used to translate every message here and answer with `message: string[]`. That put prose for
 * the UI in an API response, which is the thing this codebase has decided the server does not do:
 * the reader's screen knows the context a sentence needs and the server does not. A form that
 * failed three rules also wants them per field, and a flat array of sentences cannot say which
 * field each belongs to — the client was matching them up by guessing.
 *
 * So the failure travels as `fieldErrors`, each entry naming its field, its key and its parameters,
 * and `ErrorHandlerService` renders them. The server keeps `translateValidationError` for the one
 * place that still needs a sentence with no browser in it: the e-CF submission log.
 */
export function localizedValidationExceptionFactory(i18n: I18nService) {
  return (errors: ValidationError[]): BadRequestException => {
    const fieldErrors = flatten(errors).flatMap((error) => describeValidationError(i18n, error));

    return new BadRequestException({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      messageKey: 'errors.validation_failed',
      params: {},
      fieldErrors,
    });
  };
}
