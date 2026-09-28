import { ExecutionContext } from '@nestjs/common';
import { ExtensionScopeGuard } from './extension-scope.guard';
import { PluginStatus } from '../entities/plugin.entity';
import { normalizeExtensionApiPath, extensionMayRead } from '@virteex/shared/util-auth';

/**
 * S-6: an extension granted `api:read:sales` could read any GET route the viewer could, by asking
 * the host for `/sales/%2e%2e/users`. The host now normalises before checking, and the API checks
 * again, against the capabilities the tenant granted in the database.
 */
describe('extension scope', () => {
  describe('normalizeExtensionApiPath (shared by host and API)', () => {
    it.each([
      '/sales/%2e%2e/users',
      '/sales/%2E%2e/users',
      '/sales/.%2e/users',
      '/sales/%2e./users',
      '/sales/../users',
      '/sales/./x',
      '/sales/%2fusers',
      '/sales/%5cusers',
      '/sales/%252e%252e/users',
      '/sales\\..\\users',
      '//evil.example/sales',
      '/sales#frag',
      'sales',
      '',
    ])('refuses %p', (path) => {
      expect(normalizeExtensionApiPath(path)).toBeNull();
    });

    it('accepts a canonical path and keeps its query', () => {
      expect(normalizeExtensionApiPath('/invoices/42?page=2')).toEqual({
        pathname: '/invoices/42',
        search: '?page=2',
      });
    });

    it('matches a prefix by segment, not by text', () => {
      expect(extensionMayRead('/invoices', ['api:read:sales'])).toBe(true);
      expect(extensionMayRead('/invoices/42', ['api:read:sales'])).toBe(true);
      expect(extensionMayRead('/invoices-internal', ['api:read:sales'])).toBe(false);
      expect(extensionMayRead('/users', ['api:read:sales'])).toBe(false);
    });
  });

  describe('ExtensionScopeGuard', () => {
    let consent: unknown;
    let guard: ExtensionScopeGuard;

    const runner = {
      connect: jest.fn(),
      query: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      createQueryRunner: () => runner,
      createEntityManager: () => ({}),
    };

    beforeEach(() => {
      consent = {
        enabled: true,
        grantedCapabilities: ['api:read:sales'],
        plugin: { name: 'sales-chart', status: PluginStatus.ACTIVE },
      };
      const qb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => consent),
      };
      guard = new ExtensionScopeGuard(
        { createQueryBuilder: () => qb } as never,
        dataSource as never,
        { get: (_key: string, fallback: string) => fallback } as never,
      );
    });

    const context = (request: Record<string, unknown>) =>
      ({
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => request }),
      }) as unknown as ExecutionContext;

    const request = (url: string, extra: Record<string, unknown> = {}) => ({
      method: 'GET',
      url,
      user: { id: 'u1', organizationId: 'org-1' },
      headers: { 'x-virtex-extension': 'sales-chart' },
      ...extra,
    });

    it('leaves requests that are not extension traffic alone', async () => {
      await expect(
        guard.canActivate(context({ method: 'POST', url: '/api/v1/users', headers: {} })),
      ).resolves.toBe(true);
    });

    it('lets an extension read what it was granted', async () => {
      await expect(guard.canActivate(context(request('/api/v1/invoices?page=2')))).resolves.toBe(true);
    });

    it('refuses a path outside its capabilities', async () => {
      await expect(guard.canActivate(context(request('/api/v1/users')))).rejects.toThrow();
    });

    it('refuses the encoded traversal the host used to let through', async () => {
      await expect(guard.canActivate(context(request('/api/v1/sales/%2e%2e/users')))).rejects.toThrow();
    });

    it('refuses anything but a read', async () => {
      await expect(
        guard.canActivate(context(request('/api/v1/invoices', { method: 'POST' }))),
      ).rejects.toThrow();
    });

    it('refuses an extension the tenant has not enabled, or one that was revoked', async () => {
      consent = null;
      await expect(guard.canActivate(context(request('/api/v1/invoices')))).rejects.toThrow();
      consent = {
        enabled: true,
        grantedCapabilities: ['api:read:sales'],
        plugin: { name: 'sales-chart', status: PluginStatus.REVOKED },
      };
      await expect(guard.canActivate(context(request('/api/v1/invoices')))).rejects.toThrow();
    });

    it('reads the grant as the tenant the request acts in', async () => {
      await guard.canActivate(context(request('/api/v1/invoices')));
      expect(runner.query).toHaveBeenCalledWith(
        expect.stringContaining("set_config('app.current_organization'"),
        ['org-1'],
      );
    });
  });
});
