import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * An error that names a message instead of writing one.
 *
 * ## Why the call site must not hold a sentence
 *
 * Every domain error in this application was thrown with a Spanish literal:
 *
 *     throw new BadRequestException('El asiento contable no está balanceado.');
 *
 * which the client displayed verbatim, so an English-speaking accountant in a Dominican tenant
 * got a Spanish sentence at the one moment they needed to understand what had gone wrong. Fixing
 * that by injecting a translation service into 511 call sites would mean each of them resolving a
 * language it has no business knowing about, deep inside a transaction.
 *
 * Instead the call site names a key and hands over the values:
 *
 *     throw new UnprocessableEntityError('JOURNAL_ENTRIES.UNBALANCED', { difference });
 *
 * and `I18nExceptionFilter` translates once, at the edge, in the language resolved for the
 * request. The message is built exactly where the language is known and nowhere else.
 *
 * ## Why each class extends its Nest counterpart
 *
 * `BadRequestError` **is** a 400. Anything that reasonably asks `err instanceof
 * BadRequestException` — Nest's own machinery, a caller catching selectively, a test — must keep
 * getting the right answer. A parallel hierarchy would have quietly broken every one of those
 * checks, which is a much worse outcome than the translation problem being solved.
 *
 * The localised payload is carried on a branded property rather than by class identity, so the
 * filter recognises these without the inheritance having to be single-rooted.
 *
 * ## The `code` is part of the contract
 *
 * The client keys its own copy off it (`ERRORS.<code>`), so a screen can phrase a failure in its
 * own context — "that account is locked" reads differently in a picker than in a form. The
 * translated `message` travels alongside for the cases the client has no specific wording for.
 */

/** Brand. A symbol so nothing can collide with it accidentally, and it never serialises. */
export const LOCALIZED_ERROR = Symbol.for('virtex.i18n.localizedError');

export interface LocalizedError {
  readonly [LOCALIZED_ERROR]: true;
  /** Catalogue key, e.g. `USERS.EMAIL_IN_USE`. */
  readonly messageKey: string;
  readonly params: Record<string, unknown>;
  /** Stable machine code. Defaults to the key. */
  readonly code: string;
}

export function isLocalizedError(value: unknown): value is LocalizedError & HttpException {
  return (
    value instanceof HttpException &&
    (value as unknown as Record<symbol, unknown>)[LOCALIZED_ERROR] === true
  );
}

/**
 * Attach the localised payload to an exception instance.
 *
 * A mixin rather than a base class because each subclass has to extend a DIFFERENT Nest
 * exception, and TypeScript has one `extends` per class.
 */
function localize<T extends HttpException>(
  exception: T,
  messageKey: string,
  params: Record<string, unknown>,
  code?: string,
): T & LocalizedError {
  return Object.assign(exception, {
    [LOCALIZED_ERROR]: true as const,
    messageKey,
    params,
    code: code ?? messageKey,
  });
}

/* -------------------------------------------------------------------------- */
/*  The status-shaped subclasses the call sites use.                           */
/*                                                                            */
/*  Named `…Error` rather than `…Exception` so that a literal-carrying throw   */
/*  and a key-carrying throw do not look the same in a diff.                   */
/* -------------------------------------------------------------------------- */

export class BadRequestError extends BadRequestException implements LocalizedError {
  declare readonly [LOCALIZED_ERROR]: true;
  declare readonly messageKey: string;
  declare readonly params: Record<string, unknown>;
  declare readonly code: string;

  constructor(messageKey: string, params: Record<string, unknown> = {}, code?: string) {
    super(messageKey);
    localize(this, messageKey, params, code);
  }
}

export class UnauthorizedError extends UnauthorizedException implements LocalizedError {
  declare readonly [LOCALIZED_ERROR]: true;
  declare readonly messageKey: string;
  declare readonly params: Record<string, unknown>;
  declare readonly code: string;

  constructor(messageKey: string, params: Record<string, unknown> = {}, code?: string) {
    super(messageKey);
    localize(this, messageKey, params, code);
  }
}

export class ForbiddenError extends ForbiddenException implements LocalizedError {
  declare readonly [LOCALIZED_ERROR]: true;
  declare readonly messageKey: string;
  declare readonly params: Record<string, unknown>;
  declare readonly code: string;

  constructor(messageKey: string, params: Record<string, unknown> = {}, code?: string) {
    super(messageKey);
    localize(this, messageKey, params, code);
  }
}

export class NotFoundError extends NotFoundException implements LocalizedError {
  declare readonly [LOCALIZED_ERROR]: true;
  declare readonly messageKey: string;
  declare readonly params: Record<string, unknown>;
  declare readonly code: string;

  constructor(messageKey: string, params: Record<string, unknown> = {}, code?: string) {
    super(messageKey);
    localize(this, messageKey, params, code);
  }
}

export class ConflictError extends ConflictException implements LocalizedError {
  declare readonly [LOCALIZED_ERROR]: true;
  declare readonly messageKey: string;
  declare readonly params: Record<string, unknown>;
  declare readonly code: string;

  constructor(messageKey: string, params: Record<string, unknown> = {}, code?: string) {
    super(messageKey);
    localize(this, messageKey, params, code);
  }
}

export class UnprocessableEntityError
  extends UnprocessableEntityException
  implements LocalizedError
{
  declare readonly [LOCALIZED_ERROR]: true;
  declare readonly messageKey: string;
  declare readonly params: Record<string, unknown>;
  declare readonly code: string;

  constructor(messageKey: string, params: Record<string, unknown> = {}, code?: string) {
    super(messageKey);
    localize(this, messageKey, params, code);
  }
}

export class InternalServerError extends InternalServerErrorException implements LocalizedError {
  declare readonly [LOCALIZED_ERROR]: true;
  declare readonly messageKey: string;
  declare readonly params: Record<string, unknown>;
  declare readonly code: string;

  constructor(messageKey: string, params: Record<string, unknown> = {}, code?: string) {
    super(messageKey);
    localize(this, messageKey, params, code);
  }
}
