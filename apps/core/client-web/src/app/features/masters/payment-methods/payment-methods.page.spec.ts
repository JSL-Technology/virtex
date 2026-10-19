import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { of } from 'rxjs';

import { PaymentMethodsPage } from './payment-methods.page';
import { PaymentMethodRow, PaymentMethodsService } from '../../../core/api/payment-methods.service';
import { CountryPackService } from '../../../core/api/country-pack.service';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';

/**
 * Payment methods per market (QA C-06): the DGII's fixed catalogue for a Dominican company, the
 * company's own — added, edited, retired — everywhere else. The screen used to show the DGII list
 * and its «fixed by the DGII» note to a US company.
 */
describe('PaymentMethodsPage', () => {
  let fixture: ComponentFixture<PaymentMethodsPage>;
  let page: PaymentMethodsPage;
  let api: { list: jest.Mock; create: jest.Mock; update: jest.Mock; active: jest.Mock };

  const row = (overrides: Partial<PaymentMethodRow>): PaymentMethodRow => ({
    id: 'pm-1',
    code: 'ACH',
    name: 'ACH transfer',
    kind: 'BANK_TRANSFER',
    fiscalCode: null,
    isSystem: false,
    isActive: true,
    sortOrder: 10,
    ...overrides,
  });

  function create(catalogue: 'EDITABLE' | 'AUTHORITY_FIXED', rows: PaymentMethodRow[]) {
    api = {
      list: jest.fn().mockReturnValue(of(rows)),
      active: jest.fn().mockReturnValue(of(rows)),
      create: jest.fn().mockReturnValue(of(row({}))),
      update: jest.fn().mockReturnValue(of(row({}))),
    };
    TestBed.configureTestingModule({
      imports: [PaymentMethodsPage, TranslateModule.forRoot()],
      providers: [
        { provide: PaymentMethodsService, useValue: api },
        {
          provide: CountryPackService,
          useValue: {
            pack: signal({
              countryCode: catalogue === 'EDITABLE' ? 'US' : 'DO',
              paymentMethods: { catalogue, authority: catalogue === 'EDITABLE' ? null : 'DGII' },
            }),
          },
        },
        {
          provide: NotificationService,
          useValue: { showSuccess: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: () => 'x' },
        },
        {
          provide: AuthService,
          useValue: {
            hasPermissions: () => true,
            isAuthenticated$: of(true),
            getPermissions$: () => of(['*']),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(PaymentMethodsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('lets a US company add ACH-like methods and edit or retire its own', () => {
    const text = create('EDITABLE', [row({}), row({ id: 'pm-2', code: 'ZELLE', name: 'Zelle' })]);
    expect(page.editable()).toBe(true);
    expect(text).not.toContain('masters.payment_methods.fixed_by_authority');
    expect(text).toContain('masters.payment_methods.edit');

    page.startNew();
    page.form.setValue({ code: 'paypal', name: 'PayPal', kind: 'BANK_TRANSFER', fiscalCode: '' });
    page.save();
    expect(api.create).toHaveBeenCalledWith({ code: 'PAYPAL', name: 'PayPal', kind: 'BANK_TRANSFER', fiscalCode: null });
  });

  it('edits without offering to change the code, and retires a method', () => {
    create('EDITABLE', [row({})]);
    page.startEdit(row({}));
    expect(page.form.controls.code.disabled).toBe(true);
    page.form.patchValue({ name: 'ACH (same day)' });
    page.save();
    expect(api.update).toHaveBeenCalledWith('pm-1', { name: 'ACH (same day)', kind: 'BANK_TRANSFER', fiscalCode: null });

    page.toggleActive(row({}));
    expect(api.update).toHaveBeenLastCalledWith('pm-1', { isActive: false });
  });

  it('shows a Dominican company the DGII catalogue read-only, saying whose it is', () => {
    const text = create('AUTHORITY_FIXED', [row({ code: '01', name: 'Efectivo', isSystem: true, fiscalCode: '01' })]);
    expect(page.fixed()).toBe(true);
    expect(page.editable()).toBe(false);
    expect(text).toContain('masters.payment_methods.fixed_by_authority');
    expect(text).not.toContain('masters.payment_methods.new_method');
    expect(text).not.toContain('masters.payment_methods.retire');
  });
});
