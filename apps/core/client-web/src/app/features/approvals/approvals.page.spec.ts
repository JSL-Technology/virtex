import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DialogService } from '../../core/services/dialog.service';
import { NotificationService } from '../../core/services/notification';
import { ActiveOrganizationService } from '../../core/tenancy/active-organization.service';
import { apiErrorBody, useCatalogue } from '../../../testing/api-errors';
import { ApprovalsPage } from './approvals.page';
import { PendingDecision } from './data/approvals-inbox.service';
import { signal } from '@angular/core';
import { ModuleInbox, ModuleInboxService } from '../../core/inbox/module-inbox.service';

/**
 * The approvals inbox (QA A-11): purchase orders and requisitions waiting for a decision used to be
 * invisible here, because the page read only the workflow engine.
 */
describe('ApprovalsPage', () => {
  let http: HttpTestingController;
  const notifications = { showSuccess: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: jest.fn(() => 'x') };
  const dialog = { prompt: jest.fn() };
  const moduleInboxState = signal<ModuleInbox[]>([]);
  const moduleInbox = { modules: moduleInboxState.asReadonly(), refresh: jest.fn(async () => undefined) };

  const order: PendingDecision = {
    source: 'purchase_order',
    id: 'po-1',
    documentTypeKey: 'approvals.document_type.purchase_order',
    number: 'OC-0007',
    party: 'Ferretería Central',
    amount: 1500,
    currencyCode: 'DOP',
    requestedAt: '2026-09-30T12:00:00Z',
    route: '/purchasing/orders/po-1/edit',
    step: null,
    canDecide: true,
    blockedReasonKey: null,
  };
  const own: PendingDecision = {
    ...order,
    source: 'purchase_requisition',
    id: 'req-1',
    documentTypeKey: 'approvals.document_type.purchase_requisition',
    number: 'SC-0003',
    canDecide: false,
    blockedReasonKey: 'approvals.blocked.own_request',
  };

  function create() {
    TestBed.configureTestingModule({
      imports: [ApprovalsPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: NotificationService, useValue: notifications },
        { provide: DialogService, useValue: dialog },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => `/acme${path}` } },
        { provide: ModuleInboxService, useValue: moduleInbox },
      ],
    });
    useCatalogue({
      'approvals.document_type.purchase_order': 'Orden de compra',
      'approvals.document_type.purchase_requisition': 'Solicitud de compra',
      'approvals.blocked.own_request': 'Lo solicitaste tú',
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ApprovalsPage);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
    moduleInboxState.set([]);
  });

  it('lists purchase orders and requisitions, each linking to its document', () => {
    const fixture = create();
    http.expectOne((r) => r.url.endsWith('/approvals/inbox')).flush([order, own]);

    const sections = fixture.componentInstance.sections();
    expect(sections.map((s) => s.labelKey)).toEqual([
      'approvals.document_type.purchase_order',
      'approvals.document_type.purchase_requisition',
    ]);
    const [item] = sections[0].items;
    expect(item).toEqual(
      expect.objectContaining({ id: 'purchase_order:po-1', title: 'Orden de compra', link: '/acme/purchasing/orders/po-1/edit' }),
    );
    expect(item.detail).toContain('OC-0007');
  });

  it('decides through the source that owns the document', () => {
    const fixture = create();
    http.expectOne((r) => r.url.endsWith('/approvals/inbox')).flush([order]);

    fixture.componentInstance.approve('purchase_order:po-1');
    const req = http.expectOne((r) => r.url.endsWith('/approvals/inbox/purchase_order/po-1/approve'));
    expect(req.request.method).toBe('POST');
    req.flush({});

    expect(notifications.showSuccess).toHaveBeenCalledWith('approvals.request_approved');
    http.expectOne((r) => r.url.endsWith('/approvals/inbox')).flush([]);
  });

  it('asks for a reason before rejecting, and does nothing if the user backs out', async () => {
    const fixture = create();
    http.expectOne((r) => r.url.endsWith('/approvals/inbox')).flush([order]);

    dialog.prompt.mockResolvedValueOnce(null);
    await fixture.componentInstance.reject('purchase_order:po-1');
    http.expectNone((r) => r.url.includes('/reject'));

    dialog.prompt.mockResolvedValueOnce('Precio fuera de contrato');
    await fixture.componentInstance.reject('purchase_order:po-1');
    const req = http.expectOne((r) => r.url.endsWith('/approvals/inbox/purchase_order/po-1/reject'));
    expect(req.request.body).toEqual({ reason: 'Precio fuera de contrato' });
    req.flush({});
    http.expectOne((r) => r.url.endsWith('/approvals/inbox')).flush([]);
  });

  it('shows why an item cannot be decided instead of hiding it', () => {
    const fixture = create();
    http.expectOne((r) => r.url.endsWith('/approvals/inbox')).flush([own]);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Lo solicitaste tú');
    expect((fixture.nativeElement as HTMLElement).querySelector('.decide--approve')).toBeNull();
  });

  it('reports the server reason when a decision is refused', () => {
    const fixture = create();
    http.expectOne((r) => r.url.endsWith('/approvals/inbox')).flush([order]);

    fixture.componentInstance.approve('purchase_order:po-1');
    http
      .expectOne((r) => r.url.endsWith('/approve'))
      .flush(apiErrorBody(403, 'approvals.not_allowed_to_decide'), { status: 403, statusText: 'Forbidden' });

    expect(notifications.showHttpError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403 }),
      'approvals.decision_could_not_recorded',
    );
    expect(fixture.componentInstance.deciding()).toBeNull();
  });

  it('is the one inbox: each module\'s blocked work follows the decisions', () => {
    moduleInboxState.set([
      {
        moduleId: 'contabilidad',
        count: 1,
        items: [
          {
            id: 'je-9',
            titleKey: 'inbox.accounting.unposted_entry',
            titleParams: {},
            blockedSince: '2026-09-28T09:00:00Z',
            route: '/accounting/journal-entries/je-9/edit',
          },
        ],
      },
    ]);
    const fixture = create();
    http.expectOne((r) => r.url.endsWith('/approvals/inbox')).flush([order]);
    fixture.detectChanges();

    const sections = fixture.componentInstance.sections();
    expect(sections.map((s) => s.labelKey)).toEqual([
      'approvals.document_type.purchase_order',
      'modules.accounting',
    ]);
    expect(sections[1].items[0].link).toBe('/acme/accounting/journal-entries/je-9/edit');
    expect(moduleInbox.refresh).toHaveBeenCalled();
  });
});
