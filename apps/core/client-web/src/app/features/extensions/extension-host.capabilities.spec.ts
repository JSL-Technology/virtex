import { of } from 'rxjs';
import { ExtensionHostComponent } from './extension-host.component';
import { normalizeExtensionApiPath, extensionMayRead } from '@virteex/shared/util-auth';

/**
 * What a granted capability actually opens.
 *
 * `api:read` used to be the entire gate on the bridge between an extension's iframe and the app's
 * session. The only other checks were that the method was GET and that the path started with a
 * slash — so an extension installed to draw a sales chart could read `/payroll/runs`, `/users`
 * and `/audit`, using the session of whoever had the screen open. For an administrator holding
 * `'*'`, that is every record in the tenant.
 *
 * The consent screen showed the literal string `api:read`. What the customer approved did not
 * describe what they were granting, which is the part that makes this a security defect rather
 * than a design preference.
 *
 * These tests pin the scoping — including the boundary cases where a naive `startsWith` would
 * hand over exactly the data the scopes exist to withhold.
 */
describe('ExtensionHostComponent · alcance de las capacidades', () => {
  /** The same two steps the bridge takes: normalise (or refuse), then match. */
  function allows(grantedCapabilities: string[], path: string): boolean {
    const normalized = normalizeExtensionApiPath(path);
    return normalized !== null && extensionMayRead(normalized.pathname, grantedCapabilities);
  }

  it('permite lo que la capacidad concedida nombra', () => {
    expect(allows(['api:read:sales'], '/invoices')).toBe(true);
    expect(allows(['api:read:sales'], '/customers/42')).toBe(true);
    expect(allows(['api:read:inventory'], '/products?page=2')).toBe(true);
  });

  it('niega lo que no nombra', () => {
    expect(allows(['api:read:sales'], '/payroll/runs')).toBe(false);
    expect(allows(['api:read:sales'], '/users')).toBe(false);
    expect(allows(['api:read:inventory'], '/audit')).toBe(false);
  });

  it('el permiso heredado api:read ya no es una llave maestra', () => {
    // Se conserva para extensiones publicadas antes de que existieran los alcances, acotado a los
    // datos de referencia que lo motivaron. Nunca nóminas, usuarios, auditoría ni tesorería.
    expect(allows(['api:read'], '/currencies')).toBe(true);
    expect(allows(['api:read'], '/payroll/runs')).toBe(false);
    expect(allows(['api:read'], '/users')).toBe(false);
    expect(allows(['api:read'], '/audit')).toBe(false);
    expect(allows(['api:read'], '/treasury/accounts')).toBe(false);
  });

  it('una extensión sin capacidad de lectura no llega a nada', () => {
    expect(allows([], '/currencies')).toBe(false);
    expect(allows(['ui:toast'], '/invoices')).toBe(false);
  });

  it('el prefijo casa por segmento, no por texto', () => {
    // Un `startsWith` ingenuo abriría `/users` con una concesión de `/user`, y
    // `/payroll-summary` con una de `/payroll`. Esa es la forma en que un control de prefijos
    // devuelve justo lo que pretende retener.
    expect(allows(['api:read:sales'], '/invoices-internal')).toBe(false);
    expect(allows(['api:read:accounting'], '/reports-payroll')).toBe(false);
  });

  it('varias capacidades suman sus alcances y nada más', () => {
    const both = ['api:read:sales', 'api:read:inventory'];
    expect(allows(both, '/invoices')).toBe(true);
    expect(allows(both, '/products')).toBe(true);
    expect(allows(both, '/payroll/runs')).toBe(false);
  });

  /**
   * S-6: the prefix was compared against the path as WRITTEN while the browser fetched it as
   * NORMALISED. `%2e%2e` is `..` to a URL parser, so `/sales/%2e%2e/users` passed as `/sales/…`
   * and fetched `/users`.
   */
  it('no se deja engañar por segmentos de punto, codificados o no', () => {
    const sales = ['api:read:sales'];
    for (const path of [
      '/sales/%2e%2e/users',
      '/sales/%2E%2E/payroll/runs',
      '/sales/.%2e/users',
      '/sales/%2e./users',
      '/sales/../users',
      '/sales/./../users',
      '/sales/%2fusers',
      '/sales/%5cusers',
      '/sales\\..\\users',
      '//evil.example/sales',
      '/sales#/../users',
    ]) {
      expect({ path, allowed: allows(sales, path) }).toEqual({ path, allowed: false });
    }
  });

  it('el puente rechaza una ruta que se normaliza a otra, y marca las válidas para el servidor', async () => {
    const host = Object.create(ExtensionHostComponent.prototype) as ExtensionHostComponent;
    const posted: Array<Record<string, unknown>> = [];
    const get = jest.fn(() => of({ ok: true }));
    Object.assign(host as unknown as Record<string, unknown>, {
      extension: { name: 'sales-chart', grantedCapabilities: ['api:read:sales'] },
      http: { get },
      post: (message: Record<string, unknown>) => posted.push(message),
    });
    const bridge = host as unknown as { handleApiRequest(id: number, payload: unknown): Promise<void> };

    await bridge.handleApiRequest(1, { path: '/sales/%2e%2e/users' });
    expect(get).not.toHaveBeenCalled();
    // A stable code, not an English sentence: the extension branches on it.
    expect(posted[0]).toMatchObject({ id: 1, error: 'INVALID_PATH' });

    await bridge.handleApiRequest(2, { path: '/invoices?page=2' });
    expect(get).toHaveBeenCalledTimes(1);
    const [url, options] = get.mock.calls[0] as unknown as [string, { headers: { get(name: string): string } }];
    expect(url).toMatch(/\/invoices\?page=2$/);
    expect(options.headers.get('x-virtex-extension')).toBe('sales-chart');
  });
});
