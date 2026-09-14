import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { composeKey } from '@virteex/shared/types';
import { I18nService } from '../../i18n/i18n.service';

/**
 * A route parameter that must be a UUID, refused the way every other bad input is refused.
 *
 * `UuidParamPipe` answers `{"code":"BAD_REQUEST","messageKey":"errors.http_400"}` — the generic
 * sentence for the status class. It does not name the parameter, does not say what was wrong with
 * it, carries no `fieldErrors`, and is not logged, so the reason existed nowhere: not on the
 * screen, not in the response, not on the server. `GET /inventory/not-a-uuid` and a genuinely
 * malformed link are indistinguishable to everyone involved.
 *
 * That also left the API answering bad input in two different shapes. A rejected BODY names the
 * field, the rule and its parameters, and `ErrorHandlerService` renders it under the input it
 * belongs to. A rejected PARAMETER said nothing at all. Both are "the request carried a value this
 * endpoint cannot accept", and a client should not need two ways to read that.
 *
 * So this raises exactly what `ValidationPipe` raises: `VALIDATION_FAILED`, with one `fieldErrors`
 * entry naming the parameter. The filter already forwards `fieldErrors` untouched, and the client
 * already translates the label key, so nothing downstream needed changing.
 *
 * The wording is its own key and not `is_uuid`, which reads "{{property}} is not a valid
 * identifier": 181 of these parameters are called `id`, so that sentence would have come out as
 * "the identifier is not a valid identifier". And it would be telling the reader the wrong thing.
 * A bad field in a payload is something they can correct; a bad parameter means the ADDRESS is
 * wrong — a stale bookmark, a mangled link — and nothing they retype into the page will help.
 *
 * Used as a class rather than an instance so Nest resolves `I18nService` for it; the catalogue is
 * what decides whether the parameter has a name of its own to show or travels as it is spelled in
 * the route.
 */
@Injectable()
export class UuidParamPipe implements PipeTransform<unknown, string> {
  /** RFC 4122, any version — the same breadth `UuidParamPipe` allows when no version is named. */
  private static readonly UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(private readonly i18n: I18nService) {}

  transform(value: unknown, metadata: ArgumentMetadata): string {
    if (typeof value === 'string' && UuidParamPipe.UUID.test(value)) return value;

    // `metadata.data` is the parameter's name as the route declares it — `id`, `invoiceId`,
    // `lineId`. Without it the message could only say "the identifier", which on a route with
    // two of them is no help at all.
    const name = metadata.data ?? 'id';
    const labelKey = composeKey('validation.fields', name);

    throw new BadRequestException({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      messageKey: 'errors.validation_failed',
      params: {},
      fieldErrors: [
        {
          property: name,
          key: 'validation.constraints.malformed_identifier',
          params: { property: this.i18n.has(labelKey) ? labelKey : name },
        },
      ],
    });
  }
}
