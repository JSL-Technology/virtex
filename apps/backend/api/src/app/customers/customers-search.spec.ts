import { CustomersService } from './customers.service';

/**
 * The customer list, narrowed by the server.
 *
 * Every picker in the client used to fetch this endpoint whole and filter the array in the
 * browser, which works for the tenant with forty customers and fails silently for the one with
 * twenty thousand. What is checked here is the part that cannot be checked from the client: that
 * the tenant filter is never optional, that the old callers see exactly what they saw before, and
 * that a term containing `%` searches for a percent sign rather than for everything.
 */
describe('CustomersService.findAll', () => {
  interface Recorded {
    clause: string;
    parameters: Record<string, unknown>;
  }

  function build(): { service: CustomersService; calls: Recorded[]; taken: number[] } {
    const calls: Recorded[] = [];
    const taken: number[] = [];

    const query = {
      where: (clause: string, parameters: Record<string, unknown>) => {
        calls.push({ clause, parameters });
        return query;
      },
      andWhere: (clause: string, parameters: Record<string, unknown>) => {
        calls.push({ clause, parameters });
        return query;
      },
      orderBy: () => query,
      take: (limit: number) => {
        taken.push(limit);
        return query;
      },
      getMany: () => Promise.resolve([]),
    };

    const repository = { createQueryBuilder: () => query };
    const service = new CustomersService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, calls, taken };
  }

  it('filtra por inquilino siempre, con término o sin él', async () => {
    const { service, calls } = build();
    await service.findAll('org-1');

    expect(calls[0].clause).toContain('customer.organizationId = :organizationId');
    expect(calls[0].parameters).toEqual({ organizationId: 'org-1' });
  });

  it('no añade condición ni tope cuando no se pide ninguno', async () => {
    // El comportamiento que esta ruta ya tenía: quien llamaba ayer ve hoy exactamente lo mismo.
    const { service, calls, taken } = build();
    await service.findAll('org-1');

    expect(calls).toHaveLength(1);
    expect(taken).toEqual([]);
  });

  it('busca por nombre, documento y correo', async () => {
    const { service, calls } = build();
    await service.findAll('org-1', { search: 'ferre', limit: 25 });

    expect(calls[1].clause).toContain('customer.companyName ILIKE :term');
    expect(calls[1].clause).toContain('customer.taxId ILIKE :term');
    expect(calls[1].clause).toContain('customer.email ILIKE :term');
    expect(calls[1].parameters).toEqual({ term: '%ferre%' });
  });

  it('escapa los comodines del término', async () => {
    //  Sin esto, buscar «100%» devuelve la tabla entera, y buscar «a_b» encuentra «axb».
    const { service, calls } = build();
    await service.findAll('org-1', { search: '100% a_b' });

    expect(calls[1].parameters).toEqual({ term: '%100\\% a\\_b%' });
  });

  it('trata un término en blanco como ausencia de término', async () => {
    const { service, calls } = build();
    await service.findAll('org-1', { search: '   ' });

    expect(calls).toHaveLength(1);
  });

  it('aplica el tope solo cuando es un número útil', async () => {
    const { service, taken } = build();
    await service.findAll('org-1', { limit: 50 });
    await service.findAll('org-1', { limit: 0 });

    expect(taken).toEqual([50]);
  });
});
