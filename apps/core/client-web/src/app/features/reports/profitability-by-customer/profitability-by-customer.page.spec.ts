import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProfitabilityByCustomerPage } from './profitability-by-customer.page';

describe('ProfitabilityByCustomerPage', () => {
  let component: ProfitabilityByCustomerPage;
  let fixture: ComponentFixture<ProfitabilityByCustomerPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfitabilityByCustomerPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProfitabilityByCustomerPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
