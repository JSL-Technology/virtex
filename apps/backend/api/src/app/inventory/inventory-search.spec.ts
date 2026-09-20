import { InventoryService } from './inventory.service';
import { queryBuilderSpy } from '../common/database/testing/query-builder-spy';

/**
 * El catálogo de productos, buscado en el servidor.
 *
 * Lo que se comprueba es lo que el cliente no puede comprobar: que el filtro de inquilino nunca es
 * opcional, que omitir los dos parámetros reproduce exactamente lo que esta ruta ya hacía, y que un
 * término con `%` busca un signo de porcentaje y no todo.
 */
describe('InventoryService — búsqueda de productos', () => {
  const build = () => {
    const spy = queryBuilderSpy();
    return {
      ...spy,
      service: new InventoryService(spy.repository as never, {} as never, {} as never, {} as never),
    };
  };

  it('filtra por inquilino siempre', async () => {
    const { service, calls } = build();
    await service.findAll('org-1');
    expect(calls[0].clause).toContain('product.organizationId = :organizationId');
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
    expect(calls[1].clause).toContain('product.name ILIKE :term');
    expect(calls[1].clause).toContain('product.sku ILIKE :term');
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
