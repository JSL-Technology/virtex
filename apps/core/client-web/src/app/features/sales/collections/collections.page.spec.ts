import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CollectionsPage } from './collections.page';
import { CollectionActivity, CollectionsApiService, CollectionsWorklist, CollectionsWorklistItem } from './collections.service';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';

const item = (overrides: Partial<CollectionsWorklistItem> = {}): CollectionsWorklistItem => ({
  invoiceId: 'i1',
  number: 'E310000000123',
  customerId: 'c1',
  customerName: 'Tardío SRL',
  email: 'pagos@tardio.do',
  phone: null,
  issueDate: '2026-08-01',
  dueDate: '2026-09-01',
  daysOverdue: 47,
  currencyCode: 'DOP',
  balance: 48000,
  balanceBase: 48000,
  pBy7: 0.05,
  pBy30: 0.2,
  expectedDate: null,
  likelihoodSource: 'projection',
  doubtful: false,
  priority: 70000,
  action: 'firm_reminder',
  suggestedTone: 'firm',
  reasons: ['unlikely_soon'],
  lastContact: null,
  openPromise: null,
  brokenPromises: 0,
  draftReminderId: null,
  ...overrides,
});

const list = (items: CollectionsWorklistItem[]): CollectionsWorklist => ({
  asOfDate: '2026-10-18',
  baseCurrency: 'DOP',
  projectionAt: '2026-10-18T02:30:00Z',
  totals: { invoices: items.length, balanceBase: 48000, overdueBase: 48000, byAction: { firm_reminder: items.length } },
  total: items.length,
  items,
});

describe('CollectionsPage', () => {
  let fixture: ComponentFixture<CollectionsPage>;
  let page: CollectionsPage;
  let api: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;

  const setup = async (items: CollectionsWorklistItem[], activities: CollectionActivity[] = [], draft: string | null = null) => {
    api = {
      worklist: jest.fn().mockReturnValue(of(list(items))),
      activities: jest.fn().mockReturnValue(of(activities)),
      compose: jest.fn().mockReturnValue(of({ message: 'Le recordamos el saldo de DOP 48,000.00.', tone: 'firm' })),
      saveDraft: jest.fn().mockReturnValue(of({ id: 'd2' })),
      send: jest.fn().mockReturnValue(of({ queued: true, to: 'pagos@tardio.do', activityId: 'a1' })),
      log: jest.fn().mockReturnValue(of([])),
      cancelDraft: jest.fn().mockReturnValue(of(undefined)),
    };
    notifications = { showHttpError: jest.fn(), showError: jest.fn(), showSuccess: jest.fn(), httpErrorMessage: jest.fn(() => 'x') };
    await TestBed.configureTestingModule({
      imports: [CollectionsPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(draft ? { draft } : {}) } } },
        { provide: CollectionsApiService, useValue: api },
        { provide: NotificationService, useValue: notifications },
        { provide: AuthService, useValue: { isAuthenticated$: of(true), getPermissions$: () => of(['ai_collections:act']), hasPermissions: () => true } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CollectionsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  };

  afterEach(() => fixture?.destroy());

  it('lists the ranked invoices with the suggested action and its reasons', async () => {
    await setup([item()]);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Tardío SRL');
    expect(text).toContain('collections.action.firm_reminder');
    expect(text).toContain('collections.reason.unlikely_soon');
    expect(api['worklist']).toHaveBeenCalledWith({ action: null, limit: 200 });
  });

  it('filters by an action, and a second press clears the filter', async () => {
    await setup([item()]);
    page.setFilter('call');
    expect(api['worklist']).toHaveBeenLastCalledWith({ action: 'call', limit: 200 });
    page.setFilter('call');
    expect(api['worklist']).toHaveBeenLastCalledWith({ action: null, limit: 200 });
  });

  it('starts the reminder in the suggested tone, drafts it with the assistant, and sends it', async () => {
    await setup([item()]);
    page.open(page.items()[0]);
    expect(page.tone()).toBe('firm');
    expect(page.to()).toBe('pagos@tardio.do');

    page.compose();
    expect(api['compose']).toHaveBeenCalledWith('i1', 'firm');
    expect(page.message()).toContain('48,000.00');

    page.send();
    expect(api['send']).toHaveBeenCalledWith('i1', expect.objectContaining({ tone: 'firm', to: 'pagos@tardio.do', message: expect.stringContaining('48,000.00') }));
    expect(notifications['showSuccess']).toHaveBeenCalledWith('collections.reminder_sent', { to: 'pagos@tardio.do' });
  });

  it('opens the draft the assistant left, from the link', async () => {
    const draft: CollectionActivity = {
      id: 'd1', invoiceId: 'i1', kind: 'REMINDER', status: 'DRAFT', occurredAt: '2026-10-18T10:00:00Z', userId: null, userName: null,
      channel: 'email', outcome: null, promisedDate: null, promisedAmount: null, recipient: 'cxp@tardio.do', message: 'Borrador del asistente', tone: 'cordial',
    };
    await setup([item({ draftReminderId: 'd1' })], [draft], 'd1');

    expect(page.selected()?.invoiceId).toBe('i1');
    expect(page.draftId()).toBe('d1');
    expect(page.message()).toBe('Borrador del asistente');
    expect(page.tone()).toBe('cordial');
    expect(page.to()).toBe('cxp@tardio.do');

    page.send();
    expect(api['send']).toHaveBeenCalledWith('i1', expect.objectContaining({ draftId: 'd1' }));
  });

  it('records a call that ended in a promise, and asks for the date first', async () => {
    await setup([item()]);
    page.open(page.items()[0]);
    page.logKind.set('CALL');
    page.logOutcome.set('promised');
    page.record();
    expect(api['log']).not.toHaveBeenCalled();
    expect(notifications['showError']).toHaveBeenCalledWith('collections.promise_needs_date');

    page.logDate.set('2026-10-25');
    page.logAmount.set(20000);
    page.record();
    expect(api['log']).toHaveBeenCalledWith({
      invoiceId: 'i1',
      kind: 'CALL',
      outcome: 'promised',
      promisedDate: '2026-10-25',
      promisedAmount: 20000,
      message: undefined,
    });
  });
});
