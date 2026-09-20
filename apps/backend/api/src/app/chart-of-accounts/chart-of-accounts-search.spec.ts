import { ChartOfAccountsService } from './chart-of-accounts.service';
import { queryBuilderSpy } from '../common/database/testing/query-builder-spy';

/** El plan contable, buscado en el servidor: el selector de cuenta ya no se lo trae entero. */
describe('ChartOfAccountsService — búsqueda de cuentas', () => {
  const build = () => {
    const spy = queryBuilderSpy();
    return {
      ...spy,
      service: new ChartOfAccountsService(
        spy.repository as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  };

  it('filtra por inquilino siempre', async () => {
    const { service, calls } = build();
    await service.findAllForOrg('org-1');
    expect(calls[0].parameters).toEqual({ organizationId: 'org-1' });
  });

  it('busca el nombre sobre el TEXTO del jsonb, no sobre un idioma', async () => {
    //  El nombre de una cuenta es `{ es: 'Efectivo', en: 'Cash' }`. Buscar solo en el idioma del
    //  lector dejaría fuera la cuenta que alguien nombró en otro.
    const { service, calls } = build();
    await service.findAllForOrg('org-1', { search: 'efec' });
    expect(calls[1].clause).toContain('account.name::text ILIKE :term');
    expect(calls[1].clause).toContain('account.code ILIKE :term');
  });

  it('escapa los comodines del término', async () => {
    const { service, calls } = build();
    await service.findAllForOrg('org-1', { search: '100%' });
    expect(calls[1].parameters).toEqual({ term: '%100\\%%' });
  });

  it('sigue trayendo el padre y los segmentos', async () => {
    //  La lista del plan los pinta; perderlos al cambiar de `find` a `createQueryBuilder` sería
    //  una consulta por fila.
    const { service, joined } = build();
    await service.findAllForOrg('org-1');
    expect(joined).toEqual(['account.parent', 'account.segments']);
  });
});
