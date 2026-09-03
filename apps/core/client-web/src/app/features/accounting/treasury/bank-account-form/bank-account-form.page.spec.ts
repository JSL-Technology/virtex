import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BankAccountFormPage } from './bank-account-form.page';
import { environment } from '../../../../../environments/environment';

/**
 * Nothing could create a bank account, and every settlement route depends on one. The assertions
 * that matter: only accounts that can take a movement are offered, and the two fields the server
 * refuses to change are not offered for change either.
 */
describe('BankAccountFormPage', () => {
  let fixture: ComponentFixture<BankAccountFormPage>;
  let component: BankAccountFormPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  const accounts = [
    { id: 'gl1', code: '1102', name: { es: 'Banco', en: 'Bank' }, isPostable: true },
    { id: 'gl2', code: '11', name: { es: 'Activo corriente', en: 'Current assets' }, isPostable: false },
  ];

  const build = async (id: string | null) => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [BankAccountFormPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['id', id]]) } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BankAccountFormPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock.expectOne((c) => c.url === `${API}/chart-of-accounts`).flush(accounts);
    httpMock.expectOne((c) => c.url === `${API}/currencies`).flush([{ code: 'DOP' }, { code: 'USD' }]);
  };

  it('offers only accounts that can take a movement', async () => {
    await build(null);
    fixture.detectChanges();

    // A summary account cannot be posted to; the server refuses it, so it is never offered.
    expect(component.postableAccounts().map((a) => a.id)).toEqual(['gl1']);
    httpMock.verify();
  });

  it('posts what the form holds', async () => {
    await build(null);
    component.form.patchValue({
      name: 'Popular corriente',
      accountType: 'CHECKING',
      currencyCode: 'DOP',
      glAccountId: 'gl1',
      accountNumber: '7901234567',
    });
    component.save();

    const request = httpMock.expectOne((c) => c.url === `${API}/treasury/bank-accounts`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({
      name: 'Popular corriente',
      currencyCode: 'DOP',
      glAccountId: 'gl1',
    });
    request.flush({ id: 'b1' });
    httpMock.verify();
  });

  it('locks the currency and the control account when editing', async () => {
    await build('b1');
    httpMock.expectOne((c) => c.url === `${API}/treasury/bank-accounts/b1`).flush({
      id: 'b1',
      name: 'Popular corriente',
      bankName: null,
      accountNumber: '7901234567',
      iban: null,
      swiftBic: null,
      accountType: 'CHECKING',
      currencyCode: 'DOP',
      glAccountId: 'gl1',
      openingBalance: 0,
      openingDate: null,
      isActive: true,
      notes: null,
    });
    fixture.detectChanges();

    expect(component.isEditMode()).toBe(true);
    expect(component.form.get('currencyCode')?.disabled).toBe(true);
    expect(component.form.get('glAccountId')?.disabled).toBe(true);

    component.save();
    const request = httpMock.expectOne((c) => c.url === `${API}/treasury/bank-accounts/b1`);
    expect(request.request.method).toBe('PATCH');
    // Movements already posted were measured against both, so neither is sent.
    expect(request.request.body).not.toHaveProperty('currencyCode');
    expect(request.request.body).not.toHaveProperty('glAccountId');
    request.flush({ id: 'b1' });
    httpMock.verify();
  });

  it('does not post an incomplete form', async () => {
    await build(null);
    component.save();
    httpMock.expectNone((c) => c.url === `${API}/treasury/bank-accounts`);
    httpMock.verify();
  });
});
