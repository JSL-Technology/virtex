import { ArgumentMetadata, BadRequestException } from '@nestjs/common';

import { UuidParamPipe } from './uuid-param.pipe';
import { I18nService } from '../../i18n/i18n.service';

/**
 * A malformed identifier in the URL, refused in the shape the rest of the API refuses bad input.
 *
 * Observed before this: `GET /api/v1/inventory/not-a-uuid` answered
 * `{"code":"BAD_REQUEST","messageKey":"errors.http_400"}` — the generic sentence for the status
 * class. No parameter named, no reason, no `fieldErrors`, and nothing in the server log either, so
 * the reason existed in no place at all. Meanwhile a rejected BODY on the same API named the
 * field, the rule and its parameters. Two shapes for "the request carried a value this endpoint
 * cannot accept" is one more than a client should have to read.
 */
describe('UuidParamPipe', () => {
  const pipe = new UuidParamPipe(new I18nService());
  const meta = (data: string): ArgumentMetadata => ({ type: 'param', data, metatype: String });

  it('passes a well-formed identifier through untouched', () => {
    const id = '3c217a71-3f2f-46f8-8351-d7e2fbd820ab';
    expect(pipe.transform(id, meta('id'))).toBe(id);
  });

  it('accepts the upper-case spelling of the same identifier', () => {
    const id = '3C217A71-3F2F-46F8-8351-D7E2FBD820AB';
    expect(pipe.transform(id, meta('id'))).toBe(id);
  });

  it('names the parameter and the reason, in the same shape a rejected body uses', () => {
    let thrown: BadRequestException | undefined;
    try {
      pipe.transform('not-a-uuid', meta('id'));
    } catch (error) {
      thrown = error as BadRequestException;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect(thrown?.getResponse()).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      messageKey: 'errors.validation_failed',
      params: {},
      fieldErrors: [
        {
          property: 'id',
          key: 'validation.constraints.malformed_identifier',
          params: { property: 'id' },
        },
      ],
    });
  });

  it('names the right one of two identifiers on the same route', () => {
    let thrown: BadRequestException | undefined;
    try {
      pipe.transform('42', meta('requestId'));
    } catch (error) {
      thrown = error as BadRequestException;
    }

    const body = thrown?.getResponse() as { fieldErrors: { property: string }[] };
    expect(body.fieldErrors[0].property).toBe('requestId');
  });

  it('uses the catalogue label when the parameter has one', () => {
    let thrown: BadRequestException | undefined;
    try {
      pipe.transform('x', meta('customerId'));
    } catch (error) {
      thrown = error as BadRequestException;
    }

    const body = thrown?.getResponse() as { fieldErrors: { params: { property: string } }[] };
    expect(body.fieldErrors[0].params.property).toBe('validation.fields.customer_id');
  });

  it.each([
    ['a value of the wrong type', 42],
    ['nothing at all', undefined],
    ['null', null],
    ['a uuid with a character too many', '3c217a71-3f2f-46f8-8351-d7e2fbd820abc'],
    ['a uuid with its hyphens removed', '3c217a713f2f46f883510d7e2fbd820ab'],
  ])('refuses %s', (_label, value) => {
    expect(() => pipe.transform(value, meta('id'))).toThrow(BadRequestException);
  });
});
