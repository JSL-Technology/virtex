import { of, throwError, lastValueFrom, NEVER } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyRecord } from './idempotency-record.entity';

/**
 * A retried transition must not post twice.
 *
 * The scenarios below are the ones that actually happen in a warehouse or a shop: a double click, a
 * proxy that retries after a timeout, a mobile connection that drops between the commit and the
 * response. In each, the client cannot tell whether the server acted, so it retries — and the whole
 * point of the interceptor is that retrying is the right thing to do.
 */
describe('IdempotencyInterceptor', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';

  /** Minimal in-memory stand-in for the repository, with the unique index it depends on. */
  function repo() {
    const rows: IdempotencyRecord[] = [];
    let nextId = 1;

    const insert = (values: Partial<IdempotencyRecord>) => {
      const clash = rows.find(
        (r) => r.organizationId === values.organizationId && r.key === values.key,
      );
      if (clash) return { raw: [] };
      const row = { id: `rec-${nextId++}`, createdAt: new Date(), ...values } as IdempotencyRecord;
      rows.push(row);
      return { raw: [row] };
    };

    return {
      rows,
      createQueryBuilder: () => ({
        insert: () => ({
          into: () => ({
            values: (v: Partial<IdempotencyRecord>) => ({
              orIgnore: () => ({
                returning: () => ({ execute: async () => insert(v) }),
              }),
            }),
          }),
        }),
      }),
      findOne: async ({ where }: { where: { organizationId: string; key: string } }) =>
        rows.find((r) => r.organizationId === where.organizationId && r.key === where.key) ?? null,
      update: async ({ id }: { id: string }, patch: Partial<IdempotencyRecord>) => {
        const row = rows.find((r) => r.id === id);
        if (row) Object.assign(row, patch);
      },
      delete: async ({ id }: { id: string }) => {
        const i = rows.findIndex((r) => r.id === id);
        if (i >= 0) rows.splice(i, 1);
      },
    };
  }

  function context(key: string | undefined, body: unknown, path = '/invoices/:id/issue') {
    const response = { statusCode: 201, status: jest.fn() };
    return {
      ctx: {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: key === undefined ? {} : { 'idempotency-key': key },
            body,
            method: 'POST',
            route: { path },
            url: path,
            user: { organizationId: ORG },
          }),
          getResponse: () => response,
        }),
      },
      response,
    };
  }

  it('ejecuta la primera vez y recuerda la respuesta', async () => {
    const r = repo();
    const interceptor = new IdempotencyInterceptor(r as never);
    const handler = { handle: () => of({ id: 'inv-1', status: 'ISSUED' }) };
    const { ctx } = context('k-1', { note: 'x' });

    const result = await lastValueFrom(interceptor.intercept(ctx as never, handler as never));

    expect(result).toEqual({ id: 'inv-1', status: 'ISSUED' });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].status).toBe('completed');
    expect(r.rows[0].responseStatus).toBe(201);
  });

  it('el reintento devuelve la respuesta original sin volver a ejecutar', async () => {
    const r = repo();
    const interceptor = new IdempotencyInterceptor(r as never);
    const handler = jest.fn(() => of({ id: 'inv-1', number: 'B0100000247' }));

    const first = context('k-1', { amount: 100 });
    await lastValueFrom(interceptor.intercept(first.ctx as never, { handle: handler } as never));

    const second = context('k-1', { amount: 100 });
    const replay = await lastValueFrom(
      interceptor.intercept(second.ctx as never, { handle: handler } as never),
    );

    // The handler ran once. The sale posted once. The second caller cannot tell.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(replay).toEqual({ id: 'inv-1', number: 'B0100000247' });
    expect(second.response.status).toHaveBeenCalledWith(201);
  });

  it('rechaza la misma clave con un cuerpo distinto', async () => {
    const r = repo();
    const interceptor = new IdempotencyInterceptor(r as never);
    const handler = { handle: () => of({ ok: true }) };

    await lastValueFrom(
      interceptor.intercept(context('k-1', { amount: 100 }).ctx as never, handler as never),
    );

    // Same name, different request. Replaying would answer the wrong question; executing would
    // defeat the key. Neither happens.
    await expect(
      lastValueFrom(
        interceptor.intercept(context('k-1', { amount: 999 }).ctx as never, handler as never),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rechaza una segunda petición mientras la primera sigue en curso', async () => {
    const r = repo();
    const interceptor = new IdempotencyInterceptor(r as never);

    // An operation that has claimed the key and has not answered yet: the exact state a double
    // click lands in. `NEVER` models it without any timing games — the first call is still open
    // when the second arrives.
    const inFlight = interceptor
      .intercept(context('k-1', { amount: 100 }).ctx as never, { handle: () => NEVER } as never)
      .subscribe();

    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].status).toBe('in_progress');

    await expect(
      lastValueFrom(
        interceptor.intercept(
          context('k-1', { amount: 100 }).ctx as never,
          { handle: () => of({ ok: true }) } as never,
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });

    // Still one row, still one posting: the second request never reached the handler.
    expect(r.rows).toHaveLength(1);
    inFlight.unsubscribe();
  });

  it('libera la clave cuando la operación falla, para que se pueda reintentar', async () => {
    const r = repo();
    const interceptor = new IdempotencyInterceptor(r as never);
    const failing = { handle: () => throwError(() => new Error('periodo cerrado')) };

    await expect(
      lastValueFrom(
        interceptor.intercept(context('k-1', { amount: 100 }).ctx as never, failing as never),
      ),
    ).rejects.toThrow('periodo cerrado');

    // A failed attempt is not an executed one. Holding the key would leave the caller unable to
    // retry the same logical operation after fixing the cause.
    await new Promise((r2) => setTimeout(r2, 0));
    expect(r.rows).toHaveLength(0);
  });

  it('exige la cabecera', async () => {
    const r = repo();
    const interceptor = new IdempotencyInterceptor(r as never);
    expect(() =>
      interceptor.intercept(
        context(undefined, {}).ctx as never,
        { handle: () => of({}) } as never,
      ),
    ).toThrow();
  });

  it('la clave es por organización: dos tenants pueden usar la misma', async () => {
    const r = repo();
    const interceptor = new IdempotencyInterceptor(r as never);
    const handler = jest.fn(() => of({ ok: true }));

    await lastValueFrom(
      interceptor.intercept(context('k-1', {}).ctx as never, { handle: handler } as never),
    );

    const otherTenant = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'idempotency-key': 'k-1' },
          body: {},
          method: 'POST',
          route: { path: '/invoices/:id/issue' },
          url: '/invoices/:id/issue',
          user: { organizationId: '22222222-2222-4222-8222-222222222222' },
        }),
        getResponse: () => ({ statusCode: 201, status: jest.fn() }),
      }),
    };

    await lastValueFrom(
      interceptor.intercept(otherTenant as never, { handle: handler } as never),
    );

    expect(handler).toHaveBeenCalledTimes(2);
    expect(r.rows).toHaveLength(2);
  });
});
