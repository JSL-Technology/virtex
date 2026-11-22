import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AccountFormPage } from './account-form.page';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';

/**
 * The account form asks what the server keeps (FIN-AC-03, FIN-COA-05).
 *
 * Its «Reglas» tab had four switches and a list of dimensions the server discarded, and its
 * «Avanzado» tab a chart version and a hierarchy type that were constants. What it lacked was the
 * one thing the period close needs from an account: whether its foreign-currency balances are
 * revalued, and in which currency it is kept. And its parent picker offered every summary account,
 * of any type, the account itself included.
 */
describe('AccountFormPage', () => {
  let fixture: ComponentFixture<AccountFormPage>;
  let component: AccountFormPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  const chart = [
    { id: 'g-assets', code: '1100', name: { es: 'Activo corriente' }, type: 'ASSET', isPostable: false, parentId: null },
    { id: 'g-banks', code: '1110', name: { es: 'Bancos' }, type: 'ASSET', isPostable: false, parentId: 'g-assets' },
    { id: 'l-bank', code: '1111', name: { es: 'Banco en dólares' }, type: 'ASSET', isPostable: true, parentId: 'g-banks' },
    { id: 'g-payables', code: '2100', name: { es: 'Pasivo corriente' }, type: 'LIABILITY', isPostable: false, parentId: null },
    { id: 'g-revenue', code: '4100', name: { es: 'Ingresos' }, type: 'REVENUE', isPostable: false, parentId: null },
  ];

  const build = async (id: string | null, inflationPolicy = 'NONE') => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AccountFormPage],
      providers: [
        provideTranslateService(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: TAB_CONTEXT, useValue: null },
        {
          provide: NotificationService,
          useValue: { showSuccess: jest.fn(), showError: jest.fn(), showHttpError: jest.fn() },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', id]]) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountFormPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.url === `${API}/chart-of-accounts/segment-definitions`)
      .flush([{ id: 's1', name: 'Cuenta', length: 4, isRequired: true, order: 1 }]);
    httpMock.expectOne((r) => r.url === `${API}/currencies`).flush([{ code: 'DOP' }, { code: 'USD' }]);
    // Whether the company restates for inflation decides whether the account's restatement is asked.
    httpMock
      .expectOne((r) => r.url === `${API}/organizations/settings/closing`)
      .flush({ section: 'closing', accounts: {}, expectedTypes: {}, fields: { inflationAdjustmentPolicy: inflationPolicy } });
    // Opened on its own (a link, a restored tab), the form reads the chart for its parent picker.
    httpMock.expectOne((r) => r.url === `${API}/chart-of-accounts` && r.method === 'GET').flush(chart);
  };

  const form = () => component.accountForm;
  const optionIds = () => (component as unknown as { parentOptions: () => Array<{ id: string }> }).parentOptions().map((o) => o.id);

  afterEach(() => httpMock.verify());

  it('offers as parent only the summary accounts of the account’s own type', async () => {
    await build(null);
    expect(optionIds()).toEqual(['g-assets', 'g-banks', 'g-payables', 'g-revenue']);

    form().get('type')?.setValue('ASSET');
    expect(optionIds()).toEqual(['g-assets', 'g-banks']);

    // A parent of another type no longer fits: it is cleared rather than sent and refused.
    form().get('parentId')?.setValue('g-banks');
    form().get('type')?.setValue('REVENUE');
    expect(form().get('parentId')?.value).toBeNull();
    expect(optionIds()).toEqual(['g-revenue']);
  });

  it('gives a new sub-account its parent’s type when the parent is chosen first', async () => {
    await build(null);
    form().get('parentId')?.setValue('g-payables');
    expect(form().get('type')?.value).toBe('LIABILITY');
    expect(form().get('nature')?.value).toBe('CREDIT');
  });

  it('revalues a liability by default, never an expense, and lets an asset be revalued by choice', async () => {
    await build(null);
    const fx = form().get('fxTreatment');

    form().get('type')?.setValue('LIABILITY');
    expect(fx?.value).toBe('REVALUED');

    form().get('type')?.setValue('ASSET');
    expect(fx?.value).toBe('HISTORICAL');

    // A choice the person made is kept while the type allows it…
    fx?.setValue('REVALUED');
    form().get('type')?.setValue('LIABILITY');
    expect(fx?.value).toBe('REVALUED');

    // …and dropped when it does not: an expense stays at the rate of its day.
    form().get('type')?.setValue('EXPENSE');
    expect(fx?.value).toBe('HISTORICAL');
    expect((component as unknown as { revaluedAllowed: () => boolean }).revaluedAllowed()).toBe(false);
    // What replaced it was the system's, not a choice: the next type's default applies again.
    form().get('type')?.setValue('LIABILITY');
    expect(fx?.value).toBe('REVALUED');
  });

  it('a summary account has no currency and no treatment of its own', async () => {
    await build(null);
    form().get('type')?.setValue('LIABILITY');
    form().get('currency')?.setValue('USD');

    form().get('isPostable')?.setValue(false);
    expect(form().get('fxTreatment')?.disabled).toBe(true);
    expect(form().get('fxTreatment')?.value).toBe('HISTORICAL');
    expect(form().get('currency')?.value).toBeNull();

    form().get('isPostable')?.setValue(true);
    expect(form().get('fxTreatment')?.enabled).toBe(true);
    expect(form().get('fxTreatment')?.value).toBe('REVALUED');
  });

  it('sends the treatment and the currency, and nothing the server does not keep', async () => {
    await build(null);
    form().patchValue({
      code: '2105',
      name: 'Préstamo en dólares',
      type: 'LIABILITY',
      category: 'CURRENT_LIABILITY',
      parentId: 'g-payables',
      currency: 'USD',
    });
    component.onSave();

    const request = httpMock.expectOne((r) => r.url === `${API}/chart-of-accounts` && r.method === 'POST');
    expect(request.request.body).toMatchObject({
      segments: ['2105'],
      type: 'LIABILITY',
      nature: 'CREDIT',
      parentId: 'g-payables',
      fxTreatment: 'REVALUED',
      currency: 'USD',
    });
    for (const gone of ['rules', 'version', 'hierarchyType', 'advanced']) {
      expect(request.request.body).not.toHaveProperty(gone);
    }
    // A company that does not restate for inflation is not asked, and sends nothing about it.
    expect(request.request.body).not.toHaveProperty('isInflationAdjustable');
    request.flush({ id: 'new' });
    // The list is read again once the account exists.
    httpMock.expectOne((r) => r.url === `${API}/chart-of-accounts` && r.method === 'GET').flush(chart);
  });

  it('edits what the account holds, not the defaults of its type', async () => {
    await build('l-bank');
    httpMock.expectOne((r) => r.url === `${API}/chart-of-accounts/l-bank`).flush({
      ...chart[2],
      category: 'CURRENT_ASSET',
      nature: 'DEBIT',
      isActive: true,
      fxTreatment: 'REVALUED',
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      statementMapping: { cashFlowCategory: 'OPERATING' },
    });

    expect(form().get('fxTreatment')?.value).toBe('REVALUED');
    expect(form().get('currency')?.value).toBe('USD');
    expect(form().get('advanced.effectiveFrom')?.value).toBe('2026-01-01');
    expect(optionIds()).toEqual(['g-assets', 'g-banks']);
    // Opening an account is not changing it.
    expect(form().dirty).toBe(false);

    form().get('reasonForChange')?.setValue('Reclasificación de la moneda');
    component.onSave();
    const request = httpMock.expectOne((r) => r.url === `${API}/chart-of-accounts/l-bank` && r.method === 'PATCH');
    expect(request.request.body).toMatchObject({
      fxTreatment: 'REVALUED',
      currency: 'USD',
      reasonForChange: 'Reclasificación de la moneda',
    });
    expect(request.request.body).not.toHaveProperty('segments');
    request.flush({ id: 'l-bank' });
    httpMock.expectOne((r) => r.url === `${API}/chart-of-accounts` && r.method === 'GET').flush(chart);
  });

  it('never offers the account itself, or one of its sub-accounts, as its parent', async () => {
    await build('g-assets');
    httpMock.expectOne((r) => r.url === `${API}/chart-of-accounts/g-assets`).flush({
      ...chart[0],
      category: 'CURRENT_ASSET',
      nature: 'DEBIT',
      isActive: true,
      fxTreatment: 'HISTORICAL',
      currency: null,
    });

    // Under itself, or under «Bancos» (its child), the tree would loop.
    expect(optionIds()).toEqual([]);
    // A summary account: no currency or treatment of its own to choose.
    expect(form().get('fxTreatment')?.disabled).toBe(true);
    expect(form().get('currency')?.disabled).toBe(true);
  });

  it('asks a company that restates for inflation which accounts are restated, never a monetary one (FIN-AC-04)', async () => {
    await build(null, 'YEAR_END');
    expect((component as unknown as { inflationApplies: () => boolean }).inflationApplies()).toBe(true);
    const restated = form().get('isInflationAdjustable');

    // Non-monetary by default: equity, an asset held at its historical rate.
    form().get('type')?.setValue('EQUITY');
    expect(restated?.value).toBe(true);
    // A liability is money owed: revalued, and never restated.
    form().get('type')?.setValue('LIABILITY');
    expect(restated?.value).toBe(false);
    expect(restated?.disabled).toBe(true);
    // Back to an asset held at its historical rate, restated again by default.
    form().get('type')?.setValue('ASSET');
    expect(restated?.value).toBe(true);
    // A choice made by the person is kept while it is allowed.
    restated?.setValue(false);
    form().get('type')?.setValue('EQUITY');
    expect(restated?.value).toBe(false);

    form().patchValue({ code: '3100', name: 'Capital', category: 'OWNERS_EQUITY' });
    restated?.setValue(true);
    component.onSave();
    const request = httpMock.expectOne((r) => r.url === `${API}/chart-of-accounts` && r.method === 'POST');
    expect(request.request.body).toMatchObject({ isInflationAdjustable: true, inflationAdjustmentAccountId: null });
    request.flush({ id: 'new' });
    httpMock.expectOne((r) => r.url === `${API}/chart-of-accounts` && r.method === 'GET').flush(chart);
  });
});
