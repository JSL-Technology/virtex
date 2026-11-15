import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { BillingPage } from './billing.page';
import { BillingOverview, BillingService } from '../../../core/services/billing';
import { StepUpService } from '../../../core/services/step-up.service';

/**
 * The billing screen has one way to change plan, and it is the server's to route.
 *
 * It used to choose: a subscription it recognised as live went to the provider's portal, anything
 * else to a checkout that BUYS a subscription — so every tenant whose subscription the screen did
 * not recognise was sold a second one beside the first. And a company billed through its parent
 * was offered the parent's card and the parent's plan to change.
 */
describe('BillingPage', () => {
  let fixture: ComponentFixture<BillingPage>;
  let page: BillingPage;

  const overview = (over: Partial<BillingOverview> = {}): BillingOverview => ({
    plan: { slug: 'starter', name: 'Starter', monthlyPrice: 2900, currency: 'USD', minorUnits: 100 },
    subscription: { status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, managedBy: 'provider' },
    paymentMethod: null,
    billedThrough: null,
    ...over,
  });

  const billing = {
    plans: signal([{ id: 'p-pro', slug: 'pro', name: 'Pro', description: '', monthlyPrice: 7900, currency: 'USD', minorUnits: 100 }]),
    plansState: signal('loaded'),
    getUsage: jest.fn(() => of([])),
    getOverview: jest.fn(() => of(overview())),
    getInvoices: jest.fn(() => of([])),
    confirmCheckout: jest.fn(() => of(overview())),
    reconcileSubscription: jest.fn(() => of(overview({ plan: { slug: 'pro', name: 'Pro', monthlyPrice: 7900, currency: 'USD', minorUnits: 100 } }))),
    changePlan: jest.fn(() => of(true)),
    openBillingPortal: jest.fn(() => of(true)),
    loadPlans: jest.fn(),
  };
  const stepUp = {
    requireStepUp: jest.fn((_scope: unknown, _vcr: unknown, action: () => unknown) => action()),
  };

  const create = async (search = '') => {
    window.history.replaceState({}, '', `/settings/billing${search}`);
    await TestBed.configureTestingModule({
      imports: [BillingPage],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: BillingService, useValue: billing },
        { provide: StepUpService, useValue: stepUp },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BillingPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    billing.getOverview.mockReturnValue(of(overview()));
  });

  it('changes plan through the one call, whatever the subscription looks like from here', async () => {
    await create();
    page.selectPlan('pro');
    page.confirmPlanChange();

    expect(billing.changePlan).toHaveBeenCalledWith('pro');
    // The portal is for the card and for cancelling; choosing a plan never opens it blind.
    expect(billing.openBillingPortal).not.toHaveBeenCalled();
  });

  it('records a plan change the customer confirmed on the provider’s page, without waiting for the webhook', async () => {
    await create('?plan_change=confirmed');

    expect(billing.reconcileSubscription).toHaveBeenCalledTimes(1);
    expect(page.overview()?.plan?.slug).toBe('pro');
    // The marker is removed, so a reload does not reconcile again.
    expect(window.location.search).toBe('');
  });

  it('a company billed through its parent sees whose billing it is, and is offered nothing to change', async () => {
    billing.getOverview.mockReturnValue(
      of(
        overview({
          subscription: { status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, managedBy: 'parent_organization' },
          billedThrough: { organizationId: 'org-parent', name: 'QA Matriz' },
        }),
      ),
    );
    await create();

    expect(page.billedThrough()?.name).toBe('QA Matriz');
    // Its invoices are the parent's: they are not asked for.
    expect(billing.getInvoices).not.toHaveBeenCalled();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('billing.billed_through_parent');
    expect(element.querySelector('.plan-card, .btn-checkout')).toBeNull();
  });

  it('words an invoice the provider did not describe in the reader’s language', async () => {
    await create();
    const base = { id: 'in_1', date: '2026-11-01', amount: 2900, currency: 'USD', status: 'paid', pdfUrl: null, hostedUrl: null };

    expect(page.invoiceDescription({ ...base, number: 'A-1', description: 'Pro plan' })).toBe('Pro plan');
    expect(page.invoiceDescription({ ...base, number: 'A-1', description: null })).toBe('billing.invoice_numbered');
    expect(page.invoiceDescription({ ...base, number: null, description: null })).toBe('billing.subscription_invoice');
  });
});
