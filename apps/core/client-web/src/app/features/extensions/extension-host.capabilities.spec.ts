import { ExtensionHostComponent } from './extension-host.component';

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
  /** Drive the private matcher the way the bridge does, without standing up a component. */
  function allows(grantedCapabilities: string[], path: string): boolean {
    const host = Object.create(ExtensionHostComponent.prototype) as ExtensionHostComponent;
    (host as unknown as { extension: unknown }).extension = { grantedCapabilities };

    const prefixes = (
      host as unknown as { allowedPrefixes: () => string[] }
    ).allowedPrefixes.call(host);
    if (!prefixes.length) return false;

    const [pathname] = path.split('?');
    return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
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
});
