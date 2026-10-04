import { NotificationsService } from './notifications.service';

/**
 * «Solicitar permiso» reaches the tenant's administrators (QA M-09). It used to be a `mailto:`
 * with no recipient.
 */
describe('access requests', () => {
  const saved: Array<{ userId: string; titleKey: string; bodyKey: string; params: Record<string, unknown> }> = [];
  const repo = {
    create: (row: never) => row,
    save: jest.fn(async (row: { userId: string; titleKey: string; bodyKey: string; params: Record<string, unknown> }) => {
      saved.push(row);
      return row;
    }),
  };
  const query = jest.fn();
  const service = new NotificationsService(
    repo as never,
    { find: jest.fn().mockResolvedValue([]) } as never,
    {} as never,
    { sendToUser: jest.fn() } as never,
    { translate: (key: string) => key } as never,
    { query } as never,
  );
  const requester = { id: 'me', organizationId: 'org', firstName: 'Ana', lastName: 'Pérez', email: 'ana@x.test' };

  beforeEach(() => {
    saved.length = 0;
    query.mockReset();
  });

  it('notifies every administrator — users:edit and roles:edit here — and nobody else', async () => {
    query.mockResolvedValue([
      { id: 'admin', language: 'en', permissions: '*' },
      { id: 'split', language: null, permissions: 'users:edit' },
      { id: 'split', language: null, permissions: 'roles:edit' },
      { id: 'seller', language: 'es', permissions: 'invoices:view,invoices:create' },
    ]);
    const result = await service.requestAccess(requester, { path: '/accounting/journal-entries', reason: '  Cierre de mes ' });

    expect(result).toEqual({ notified: 2 });
    expect(saved.map((n) => n.userId).sort()).toEqual(['admin', 'split']);
    expect(saved[0]).toMatchObject({
      titleKey: 'notifications.access_request.title',
      bodyKey: 'notifications.access_request.body_with_reason',
      params: { name: 'Ana Pérez', email: 'ana@x.test', path: '/accounting/journal-entries', reason: 'Cierre de mes' },
    });
    // The requester is excluded in the query itself, and the tenant is the requester's.
    expect(query.mock.calls[0][1]).toEqual(['org', 'me']);
  });

  it('refuses rather than losing the request when there is no administrator to receive it', async () => {
    query.mockResolvedValue([{ id: 'seller', language: 'es', permissions: 'invoices:view' }]);
    await expect(service.requestAccess(requester, { path: '/x' })).rejects.toMatchObject({
      messageKey: 'notifications.access_request_no_administrator',
    });
    expect(saved).toHaveLength(0);
  });
});
