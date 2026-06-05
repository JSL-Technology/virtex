import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PaymentTermsPage } from './payment-terms.page';

describe('PaymentTermsPage', () => {
  let component: PaymentTermsPage;
  let fixture: ComponentFixture<PaymentTermsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentTermsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PaymentTermsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
