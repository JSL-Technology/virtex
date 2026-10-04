import { ArgumentsHost } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { I18nExceptionFilter } from './i18n-exception.filter';
import { I18nService } from './i18n.service';

/** What a database refusal tells the reader (QA A-17). */
describe('I18nExceptionFilter: duplicates', () => {
  function reply(driverError: Record<string, unknown>) {
    const sent: Array<{ body: Record<string, unknown>; status: number }> = [];
    const adapter = {
      reply: (_res: unknown, body: Record<string, unknown>, status: number) => sent.push({ body, status }),
      getRequestUrl: () => '/api/v1/inventory',
    };
    const filter = new I18nExceptionFilter({ httpAdapter: adapter } as unknown as HttpAdapterHost, new I18nService());
    const host = {
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST' }), getResponse: () => ({}) }),
    } as unknown as ArgumentsHost;
    filter.catch(new QueryFailedError('INSERT …', [], Object.assign(new Error('duplicate key'), driverError)), host);
    return sent[0];
  }

  it('names the field and the value already taken, without the tenant column', () => {
    const { body, status } = reply({
      code: '23505',
      detail: 'Key (organization_id, sku)=(02c26dba-611f-4a7e-a30b-bb9ff8033270, QA-DUP-1) already exists.',
    });
    expect(status).toBe(409);
    expect(body['messageKey']).toBe('errors.duplicate_value');
    expect(body['params']).toEqual({ field: expect.any(String), value: 'QA-DUP-1' });
    expect(body['fieldErrors']).toEqual([expect.objectContaining({ property: 'sku' })]);
  });

  it('keeps the generic message for a column it has no label for (nothing about the schema leaks)', () => {
    const { body } = reply({ code: '23505', detail: 'Key (organization_id, zz_internal_hash)=(x, y) already exists.' });
    expect(body['messageKey']).toBe('errors.record_with_data_already_exists');
    expect(body['params']).toEqual({});
  });

  it('keeps the generic message for a composite key', () => {
    const { body } = reply({ code: '23505', detail: 'Key (organization_id, code, name)=(x, A, "B, C") already exists.' });
    expect(body['messageKey']).toBe('errors.record_with_data_already_exists');
  });
});
