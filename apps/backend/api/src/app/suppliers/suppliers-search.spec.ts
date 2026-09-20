import { SuppliersService } from './suppliers.service';
import { queryBuilderSpy } from '../common/database/testing/query-builder-spy';

/**
 * La lista de proveedores, buscada en el servidor.
 *
 * Mismo contrato que el catálogo de productos: filtro de inquilino siempre, término opcional que
 * escapa sus comodines, y tope que solo se aplica cuando se pide.
 */
describe('SuppliersService — búsqueda de proveedores', () => {
  const build = () => {
    const spy = queryBuilderSpy();
    return {
      ...spy,
      service: new SuppliersService(
        spy.repository as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  };

  it('filtra por inquilino siempre', async () => {
    const { service, calls } = build();
    await service.findAll('org-1');
    expect(calls[0].clause).toContain('supplier.organizationId = :organizationId');
    expect(calls[0].parameters).toEqual({ organizationId: 'org-1' });
  });

  it('sin parámetros, hace lo que hacía antes', async () => {
    const { service, calls, taken } = build();
    await service.findAll('org-1');
    expect(calls).toHaveLength(1);
    expect(taken).toEqual([]);
  });

  it('busca en las columnas que el operador tiene delante', async () => {
    const { service, calls } = build();
    await service.findAll('org-1', { search: 'tor', limit: 25 } as never);
    expect(calls[1].clause).toContain('supplier.name ILIKE :term');
    expect(calls[1].clause).toContain('supplier.taxId ILIKE :term');
    expect(calls[1].parameters).toEqual({ term: '%tor%' });
  });

  it('escapa los comodines del término', async () => {
    const { service, calls } = build();
    await service.findAll('org-1', { search: '100%' } as never);
    expect(calls[1].parameters).toEqual({ term: '%100\\%%' });
  });

  it('aplica el tope solo cuando es útil', async () => {
    const { service, taken } = build();
    await service.findAll('org-1', { limit: 50 } as never);
    await service.findAll('org-1', { limit: 0 } as never);
    expect(taken).toEqual([50]);
  });
});
