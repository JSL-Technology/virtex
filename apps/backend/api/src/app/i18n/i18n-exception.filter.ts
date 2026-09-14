import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { I18nService } from './i18n.service';
import { isLocalizedError } from './localized.exception';
import { composeKey } from '@virteex/shared/types';

/**
 * The single place an error becomes a sentence.
 *
 * Runs last in the filter chain (registered first — Nest applies global filters in reverse), so
 * everything that has not been handled more specifically passes through here and comes out with:
 *
 *     { statusCode, code, message, timestamp, path }
 *
 * — `code` stable and machine-readable, `message` in the reader's language.
 *
 * ## Three kinds of thing arrive here
 *
 * 1. **`LocalizedException`** — a key and its parameters. Translated. The intended path.
 * 2. **A plain `HttpException`** — Nest's own (`ValidationPipe`, `ThrottlerGuard`,
 *    `JwtAuthGuard`) plus the exception classes not yet migrated. Its message is passed through
 *    when it is a sentence, and translated when it happens to name a key the catalogue has;
 *    a generic per-status message is used when it is a bare reason phrase such as
 *    "Unauthorized", which is not something to show anybody.
 * 3. **A TypeORM error** — a unique or foreign-key violation, or a missing entity. Mapped to the
 *    right status and a translated sentence, never to the driver's own text.
 * 4. **Anything else** — a bug. Logged with its stack, answered with a translated generic
 *    message and NOTHING from the original. A stack trace, a SQL fragment or an internal path
 *    reaching the browser is an information-disclosure defect (OWASP ASVS V7.4.1; CWE-209),
 *    and the previous filter shipped `'Error interno del servidor'` as a Spanish literal anyway.
 *
 * ## Why the TypeORM handling lives here rather than in its own filter
 *
 * It had its own, `TypeOrmExceptionFilter`, applied with `@UseFilters` on exactly two of the
 * sixty controllers — so a unique-constraint violation anywhere else came back as a raw 500 with
 * the driver's message in it. Two filters also raise a question about which one wins that has to
 * be re-answered every time either changes. One `@Catch()` filter that branches internally has
 * neither problem.
 */
/**
 * What every failure is reduced to before it is serialised.
 *
 * `messageKey` and `params`, never a sentence: the reader's screen knows the context a sentence
 * needs and the server does not. `code` stays a machine identifier, SCREAMING_SNAKE, because the
 * client branches on it — a two-factor challenge and a blocked account both come back 401 and lead
 * to different screens.
 */
interface Described {
  status: number;
  code: string;
  messageKey: string;
  params: Record<string, unknown>;
  extra: Record<string, unknown>;
}

@Catch()
export class I18nExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(I18nExceptionFilter.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly i18n: I18nService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();

    const { status, code, messageKey, params, extra } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request?.method ?? '?'} ${httpAdapter.getRequestUrl(request) ?? '?'} -> ${status} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    httpAdapter.reply(
      ctx.getResponse(),
      {
        statusCode: status,
        code,
        messageKey,
        params,
        ...extra,
        timestamp: new Date().toISOString(),
        path: httpAdapter.getRequestUrl(request),
      },
      status,
    );
  }

  private describe(exception: unknown): Described {
    if (isLocalizedError(exception)) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        messageKey: exception.messageKey,
        params: exception.params,
        extra: {},
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: unknown })?.message;
      // Some exceptions already carry a machine code as their message — the whole `AuthError`
      // enum does (`new UnauthorizedException(AuthError.USER_NOT_FOUND)`), and the client has
      // switched on those codes since before any of this existed. Recognising the shape means
      // that contract keeps working, and the sentence comes from `errors.auth_user_not_found`
      // instead of the code being shown to a reader as if it were prose.
      const messageIsCode =
        typeof raw === 'string' && /^[A-Z][A-Z0-9_]{2,}$/.test(raw) && !REASON_PHRASES.has(raw);

      const code =
        (typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
          ? (body as { code: string }).code
          : null) ??
        (messageIsCode ? (raw as string) : null) ??
        this.codeForStatus(status);

      // `ValidationPipe` answers with one entry per failed field, each naming its key. They travel
      // as their own field rather than folded into the message: a form needs them per field, and a
      // wall of concatenated rules is not something to show a reader.
      const fieldErrors = (body as { fieldErrors?: unknown })?.fieldErrors;
      const extra = Array.isArray(fieldErrors) ? { fieldErrors } : {};

      return {
        status,
        code,
        messageKey: this.keyFor(messageIsCode ? undefined : raw, status, code, body),
        params: (body as { params?: Record<string, unknown> })?.params ?? {},
        extra,
      };
    }

    if (exception instanceof QueryFailedError) {
      const driverCode = (exception.driverError as { code?: string } | undefined)?.code;
      const mapped = POSTGRES_CODES[driverCode ?? ''];
      if (mapped) {
        return {
          status: mapped.status,
          code: mapped.code,
          messageKey: composeKey('errors', mapped.code),
          params: {},
          extra: {},
        };
      }
      // An unmapped database failure is a bug in a query, not something a reader can act on.
      // Falling through deliberately: the generic branch logs the stack and says nothing more.
    }

    if (exception instanceof EntityNotFoundError) {
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        messageKey: 'errors.not_found',
        params: {},
        extra: {},
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      messageKey: 'errors.internal',
      params: {},
      extra: {},
    };
  }

  /**
   * The catalogue key for a failure that did not arrive as one.
   *
   * Nest's own exceptions, and the handful of throws not yet migrated, carry a message rather than
   * a key. This maps what they carry onto something the client can resolve, in the order that
   * loses the least:
   *
   *  1. The message IS a key the catalogue knows — several throws already name one.
   *  2. `errors.<code>`, for a code the catalogue words specifically.
   *  3. `errors.http_<status>`, the generic sentence for the status class.
   *  4. `errors.unexpected`.
   *
   * A raw sentence is never forwarded. It used to be, and the sentences were 197 Spanish literals,
   * so an English-speaking reader hit Spanish the moment anything failed. A 5xx message is not
   * forwarded either, under any circumstance: those are written for an operator, and a stack
   * fragment or a constraint name reaching the browser is an information-disclosure defect
   * (OWASP ASVS V7.4.1, CWE-209).
   */
  private keyFor(raw: unknown, status: number, code: string, body: unknown): string {
    const declared = (body as { messageKey?: unknown })?.messageKey;
    if (typeof declared === 'string' && declared.trim()) return declared;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) return 'errors.internal';

    const candidate = Array.isArray(raw) ? raw[0] : raw;
    if (typeof candidate === 'string' && candidate.trim() && this.i18n.has(candidate)) {
      return candidate;
    }

    const byCode = composeKey('errors', code);
    if (this.i18n.has(byCode)) return byCode;

    const byStatus = `errors.http_${status}`;
    if (this.i18n.has(byStatus)) return byStatus;

    return 'errors.unexpected';
  }

  private codeForStatus(status: number): string {
    return STATUS_CODES[status] ?? `HTTP_${status}`;
  }
}

/** Reason phrases Nest uses as a default message. Never shown to a reader. */
const REASON_PHRASES = new Set([
  'Bad Request',
  'Unauthorized',
  'Payment Required',
  'Forbidden',
  'Not Found',
  'Method Not Allowed',
  'Not Acceptable',
  'Request Timeout',
  'Conflict',
  'Gone',
  'Payload Too Large',
  'Unsupported Media Type',
  'Unprocessable Entity',
  'Too Many Requests',
  'Internal Server Error',
  'Not Implemented',
  'Bad Gateway',
  'Service Unavailable',
  'Gateway Timeout',
]);

/**
 * The PostgreSQL failures a customer can actually do something about.
 *
 * Everything else stays a 500 with no detail: a constraint name or a column name in an error
 * message tells an attacker about the schema and tells the reader nothing.
 */
const POSTGRES_CODES: Readonly<Record<string, { status: number; code: string }>> = {
  '23505': { status: HttpStatus.CONFLICT, code: 'UNIQUE_VIOLATION' },
  '23503': { status: HttpStatus.BAD_REQUEST, code: 'FOREIGN_KEY_VIOLATION' },
};

const STATUS_CODES: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};
