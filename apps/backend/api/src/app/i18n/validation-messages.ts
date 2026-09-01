import { ValidationError } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { LanguageCode } from '@virteex/shared/types';
import { I18nService } from './i18n.service';
import { currentLanguage } from './request-locale';

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
 *  2. No key: the CONSTRAINT's own key, `VALIDATION.CONSTRAINTS.IS_EMAIL`, with the field's
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
 * itself: `'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":254}'`. The separator is a pipe because a
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

/** `maxLength` → `VALIDATION.CONSTRAINTS.MAX_LENGTH`. */
export function constraintKey(constraint: string): string {
  return `VALIDATION.CONSTRAINTS.${constraint
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase()}`;
}

/** `taxId` → `VALIDATION.FIELDS.TAX_ID`, falling back to the property name itself. */
export function fieldLabel(i18n: I18nService, property: string, language: LanguageCode): string {
  const key = `VALIDATION.FIELDS.${property
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase()}`;
  return i18n.has(key) ? i18n.translate(key, language) : property;
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

  return Object.entries(error.constraints ?? {}).map(([constraint, fallback]) => {
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

/**
 * The `exceptionFactory` for the global `ValidationPipe`.
 *
 * Keeps Nest's own response shape — `{ statusCode, message: string[], error }` — because the
 * client already renders it and changing it here would be an unrelated breaking change.
 */
export function localizedValidationExceptionFactory(i18n: I18nService) {
  return (errors: ValidationError[]): BadRequestException => {
    const language = currentLanguage();
    const messages = flatten(errors).flatMap((error) =>
      translateValidationError(i18n, error, language),
    );

    return new BadRequestException({
      statusCode: 400,
      message: messages.length > 0 ? messages : [i18n.translate('ERRORS.HTTP_400', language)],
      error: 'Bad Request',
    });
  };
}
