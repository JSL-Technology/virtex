import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../../core/services/auth';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { useCatalogue } from '../../../../../testing/api-errors';
import { UsersService } from '../../data/users.service';
import { AuditRow, SecuritySettingsPage } from './security.page';

/**
 * QA M-09: «Seguridad y auditoría» said «En desarrollo» while the MFA requirement, the password
 * policy and the audit trail all existed on the server.
 */
describe('SecuritySettingsPage', () => {
  let http: HttpTestingController;
  const notifications = { showSuccess: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: jest.fn(() => 'x') };
  const dialog = { confirm: jest.fn() };
  const row: AuditRow = {
    id: 'a1',
    userId: 'u1',
    actorName: 'Ana Pérez',
    entity: 'bank_accounts',
    entityId: '9c000000-0000-4000-8000-000000000001',
    actionType: 'UPDATE',
    previousValue: { name: 'Caja', currency: 'DOP' },
    newValue: { name: 'Caja chica', currency: 'DOP' },
    timestamp: '2026-10-01T12:00:00Z',
  };

  function create(canReadTrail = true, usersFail = false) {
    TestBed.configureTestingModule({
      imports: [SecuritySettingsPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: NotificationService, useValue: notifications },
        { provide: DialogService, useValue: dialog },
        { provide: AuthService, useValue: { hasPermissions: () => canReadTrail } },
        {
          provide: UsersService,
          useValue: {
            getUsers: () =>
              usersFail
                ? throwError(() => new Error('403'))
                : of({ data: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@x.do' }], total: 1 }),
          },
        },
      ],
    });
    useCatalogue({ 'settings.security.entity.bank_accounts': 'Cuenta bancaria' });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SecuritySettingsPage);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/organizations/security-settings')).flush({ requireMfa: false });
    return fixture;
  }

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
  });

  it('reads the trail with the filters as query parameters, from page one', () => {
    const page = create().componentInstance;
    http.expectOne((r) => r.url.endsWith('/audit/entities')).flush(['bank_accounts']);
    http.expectOne((r) => r.url.endsWith('/audit')).flush({ rows: [row], page: 1, pageSize: 50, total: 1, hasMore: false });
    expect(page.people()).toEqual([{ id: 'u1', name: 'Ana Pérez' }]);

    page.setFilter({ actionType: 'UPDATE', from: '2026-10-01', to: '2026-10-31' });
    const req = http.expectOne((r) => r.url.endsWith('/audit'));
    expect(req.request.params.get('actionType')).toBe('UPDATE');
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.has('userId')).toBe(false);
    req.flush({ rows: [], page: 1, pageSize: 50, total: 0, hasMore: false });
  });

  it('refuses a range that ends before it starts, without asking the server', () => {
    const page = create().componentInstance;
    http.expectOne((r) => r.url.endsWith('/audit/entities')).flush([]);
    http.expectOne((r) => r.url.endsWith('/audit')).flush({ rows: [], page: 1, pageSize: 50, total: 0, hasMore: false });

    page.setFilter({ from: '2026-10-31', to: '2026-10-01' });
    http.expectNone((r) => r.url.endsWith('/audit'));
    expect(page.trailError()).toBe('settings.security.range_invalid');
  });

  it('shows only what changed, and names the record type in the reader’s language', () => {
    const page = create().componentInstance;
    http.expectOne((r) => r.url.endsWith('/audit/entities')).flush([]);
    http.expectOne((r) => r.url.endsWith('/audit')).flush({ rows: [row], page: 1, pageSize: 50, total: 1, hasMore: false });

    expect(page.changes(row)).toEqual([{ field: 'name', before: 'Caja', after: 'Caja chica' }]);
    expect(page.entityName('bank_accounts')).toBe('Cuenta bancaria');
    expect(page.entityName('price_lists')).toBe('Price lists');
  });

  it('does not offer the trail without audit:view_trail', () => {
    const fixture = create(false);
    http.expectNone((r) => r.url.includes('/audit'));
    expect((fixture.nativeElement as HTMLElement).querySelector('#sec-trail')).toBeNull();
  });

  it('still reads the trail when the member list is not readable; only the «who» filter goes', () => {
    const page = create(true, true).componentInstance;
    http.expectOne((r) => r.url.endsWith('/audit/entities')).flush([]);
    http.expectOne((r) => r.url.endsWith('/audit')).flush({ rows: [row], page: 1, pageSize: 50, total: 1, hasMore: false });
    expect(page.people()).toEqual([]);
    expect(page.trail()?.rows).toHaveLength(1);
  });

  it('asks before requiring a second factor of everyone, and sends nothing if declined', async () => {
    const page = create(false).componentInstance;
    dialog.confirm.mockResolvedValueOnce(false);
    await page.toggleMfa(true);
    http.expectNone((r) => r.method === 'PATCH');

    dialog.confirm.mockResolvedValueOnce(true);
    await page.toggleMfa(true);
    const req = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/organizations/security-settings'));
    expect(req.request.body).toEqual({ requireMfa: true });
    req.flush({ requireMfa: true });
    expect(page.requireMfa()).toBe(true);
  });

  it('reports the server’s refusal when the caller is not the owner', async () => {
    const page = create(false).componentInstance;
    await page.toggleMfa(false);
    http
      .expectOne((r) => r.method === 'PATCH')
      .flush({ statusCode: 403, code: 'FORBIDDEN', messageKey: 'errors.forbidden' }, { status: 403, statusText: 'Forbidden' });
    expect(notifications.showHttpError).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }), 'settings.security.mfa_save_failed');
    expect(page.requireMfa()).toBe(false);
  });
});
