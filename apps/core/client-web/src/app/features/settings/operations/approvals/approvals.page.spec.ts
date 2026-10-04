import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { RolesService } from '../../data/roles.service';
import { ApprovalPoliciesPage } from './approvals.page';

/**
 * QA M-09: «Aprobaciones» said «En desarrollo» while the policy API existed and nothing could
 * write a policy.
 */
describe('ApprovalPoliciesPage', () => {
  let http: HttpTestingController;
  const notifications = { showSuccess: jest.fn(), showError: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: jest.fn(() => 'x') };
  const dialog = { confirm: jest.fn() };
  const roles = [
    { id: 'r-acc', name: 'Contador' },
    { id: 'r-cfo', name: 'Gerente financiero' },
  ];
  const policy = {
    id: 'p1',
    name: 'Asientos',
    documentType: 'JOURNAL_ENTRY',
    steps: [
      { order: 2, minAmount: 100000, roleId: 'r-cfo' },
      { order: 1, minAmount: 0, roleId: 'r-acc' },
    ],
  };

  function create() {
    TestBed.configureTestingModule({
      imports: [ApprovalPoliciesPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NotificationService, useValue: notifications },
        { provide: DialogService, useValue: dialog },
        { provide: RolesService, useValue: { getRoles: () => of(roles) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ApprovalPoliciesPage);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/workflows/policies')).flush([policy]);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
  });

  it('shows each policy as its chain, in order, with role names', () => {
    const page = create();
    expect(page.policies()[0].steps.map((s) => s.order)).toEqual([1, 2]);
    expect(page.roleName('r-cfo')).toBe('Gerente financiero');
  });

  it('offers only the document types that have no policy yet', () => {
    const page = create();
    expect(page.freeTypes()).not.toContain('JOURNAL_ENTRY');
    expect(page.freeTypes()).toContain('VENDOR_BILL');
  });

  it('says what is missing before sending, and sends nothing', () => {
    const page = create();
    page.startNew();
    page.save();
    expect(notifications.showError).toHaveBeenCalledWith('settings.approvals.name_required');

    page.patchDraft({ name: 'Facturas de proveedor' });
    page.save();
    expect(notifications.showError).toHaveBeenCalledWith('settings.approvals.role_required');
  });

  it('creates a policy with its steps renumbered from one', () => {
    const page = create();
    page.startNew();
    page.patchDraft({ name: 'Facturas de proveedor' });
    page.patchStep(0, { roleId: 'r-acc' });
    page.addStep();
    page.patchStep(1, { roleId: 'r-cfo', minAmount: 50000 });
    page.save();

    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/workflows/policies'));
    expect(req.request.body).toEqual({
      name: 'Facturas de proveedor',
      documentType: 'VENDOR_BILL',
      steps: [
        { order: 1, minAmount: 0, roleId: 'r-acc' },
        { order: 2, minAmount: 50000, roleId: 'r-cfo' },
      ],
    });
    req.flush({});
    expect(notifications.showSuccess).toHaveBeenCalledWith('settings.approvals.saved');
    http.expectOne((r) => r.url.endsWith('/workflows/policies')).flush([]);
  });

  it('edits name and steps only: the document type is what the policy governs', () => {
    const page = create();
    page.edit(page.policies()[0]);
    page.patchDraft({ name: 'Asientos manuales' });
    page.save();
    const req = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/workflows/policies/p1'));
    expect(Object.keys(req.request.body)).toEqual(['name', 'steps']);
    req.flush({});
    http.expectOne((r) => r.url.endsWith('/workflows/policies')).flush([]);
  });

  it('deletes only after confirmation', async () => {
    const page = create();
    dialog.confirm.mockResolvedValueOnce(false);
    await page.remove(page.policies()[0]);
    http.expectNone((r) => r.method === 'DELETE');

    dialog.confirm.mockResolvedValueOnce(true);
    await page.remove(page.policies()[0]);
    http.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/workflows/policies/p1')).flush(null);
    http.expectOne((r) => r.url.endsWith('/workflows/policies')).flush([]);
  });
});
