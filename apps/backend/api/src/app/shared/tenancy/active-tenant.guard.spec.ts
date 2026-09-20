import { ExecutionContext } from '@nestjs/common';

import { ActiveTenantGuard, ACTIVE_ORGANIZATION_HEADER } from './active-tenant.guard';
import { OrganizationLookupPort, PrincipalResolverPort } from './ports/active-tenant.ports';
import { AuthenticatedUser } from '../../security/principal';

/**
 * La empresa activa la nombra el CLIENTE, así que estas pruebas son las que impiden que eso sea
 * un agujero: comprueban que se resuelve, que se autoriza, y que lo que se reemplaza es el
 * principal completo y no solo su `organizationId`.
 */
describe('ActiveTenantGuard', () => {
  const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const principal = (organizationId: string, permissions: string[]): AuthenticatedUser =>
    ({
      id: 'user-1',
      email: 'ana@example.test',
      organizationId,
      permissions,
      roles: [],
    }) as unknown as AuthenticatedUser;

  let lookup: jest.Mocked<OrganizationLookupPort>;
  let resolver: jest.Mocked<PrincipalResolverPort>;
  let guard: ActiveTenantGuard;

  const contextFor = (request: unknown): ExecutionContext =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    lookup = { findIdByRef: jest.fn() } as unknown as jest.Mocked<OrganizationLookupPort>;
    resolver = {
      resolveForOrganization: jest.fn(),
    } as unknown as jest.Mocked<PrincipalResolverPort>;
    guard = new ActiveTenantGuard(lookup, resolver);
  });

  it('sin cabecera, la empresa sigue siendo la del token', async () => {
    const request = { user: principal(ORG_A, ['coa:view']), headers: {} };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(lookup.findIdByRef).not.toHaveBeenCalled();
    expect(resolver.resolveForOrganization).not.toHaveBeenCalled();
    expect(request.user.organizationId).toBe(ORG_A);
  });

  it('con la cabecera apuntando a la misma empresa, no vuelve a resolver nada', async () => {
    lookup.findIdByRef.mockResolvedValue(ORG_A);
    const request = {
      user: principal(ORG_A, ['coa:view']),
      headers: { [ACTIVE_ORGANIZATION_HEADER]: 'nortex-comercial' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(resolver.resolveForOrganization).not.toHaveBeenCalled();
  });

  it('reemplaza el principal COMPLETO al cambiar de empresa, no solo el identificador', async () => {
    lookup.findIdByRef.mockResolvedValue(ORG_B);
    // En la empresa B esta persona es solo lectora: si el guard copiase el organizationId y dejase
    // los permisos del token, actuaría en B con los derechos que tiene en A.
    resolver.resolveForOrganization.mockResolvedValue(principal(ORG_B, ['coa:view']));
    const request = {
      user: principal(ORG_A, ['coa:view', 'coa:create', 'journal:post']),
      headers: { [ACTIVE_ORGANIZATION_HEADER]: 'otra-empresa' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(resolver.resolveForOrganization).toHaveBeenCalledWith(expect.anything(), ORG_B);
    expect(request.user.organizationId).toBe(ORG_B);
    expect(request.user.permissions).toEqual(['coa:view']);
  });

  it('una empresa ajena responde LO MISMO que una inexistente: 403 y el mismo motivo', async () => {
    lookup.findIdByRef.mockResolvedValue(ORG_B);
    // Así rechaza `resolveOrganizationContext` a quien no pertenece.
    resolver.resolveForOrganization.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), {
        status: 401,
        response: { code: 'AUTH_INVALID_CREDENTIALS' },
      }),
    );
    const request = {
      user: principal(ORG_A, []),
      headers: { [ACTIVE_ORGANIZATION_HEADER]: 'empresa-ajena' },
    };

    // Sin esta traducción daba 401 para una empresa que existe y 403 para una que no, y esa
    // diferencia permite enumerar qué empresas hay en el producto probando slugs.
    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({ status: 403 });
  });

  it('un motivo que NO habla de la empresa se propaga tal cual', async () => {
    lookup.findIdByRef.mockResolvedValue(ORG_B);
    resolver.resolveForOrganization.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), {
        status: 401,
        response: { code: 'AUTH_USER_BLOCKED' },
      }),
    );
    const request = {
      user: principal(ORG_A, []),
      headers: { [ACTIVE_ORGANIZATION_HEADER]: 'otra-empresa' },
    };

    // Una cuenta bloqueada entre dos peticiones no es un problema de la empresa, y convertirlo en
    // 403 «no tienes acceso a esa empresa» mandaría a alguien a buscar el problema donde no está.
    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({ status: 401 });
  });

  it('un identificador que no existe se rechaza', async () => {
    lookup.findIdByRef.mockResolvedValue(null);
    const request = {
      user: principal(ORG_A, []),
      headers: { [ACTIVE_ORGANIZATION_HEADER]: 'empresa-que-no-existe' },
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    ['un recorrido de rutas', '../../../etc/passwd'],
    ['una inyección de SQL', "nortex' OR 1=1--"],
    ['mayúsculas y espacios', 'Nortex Comercial'],
    ['un slug que empieza por guion', '-nortex'],
  ])('no consulta el repositorio con %s', async (_caso, valor) => {
    const request = {
      user: principal(ORG_A, []),
      headers: { [ACTIVE_ORGANIZATION_HEADER]: valor },
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({ status: 403 });
    expect(lookup.findIdByRef).not.toHaveBeenCalled();
  });

  it('acepta el uuid además del slug', async () => {
    lookup.findIdByRef.mockResolvedValue(ORG_B);
    resolver.resolveForOrganization.mockResolvedValue(principal(ORG_B, []));
    const request = {
      user: principal(ORG_A, []),
      headers: { [ACTIVE_ORGANIZATION_HEADER]: ORG_B },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(lookup.findIdByRef).toHaveBeenCalledWith(ORG_B);
  });

  it('una petición sin usuario —ruta pública— pasa sin tocar nada', async () => {
    const request = { headers: { [ACTIVE_ORGANIZATION_HEADER]: 'nortex-comercial' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(lookup.findIdByRef).not.toHaveBeenCalled();
  });

  it('lo que no es HTTP —una cola, un websocket— no lleva cabeceras y no se toca', async () => {
    const context = { getType: () => 'ws' } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
