import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProfitabilityByCustomer } from './profitability-by-customer.page';

describe('ProfitabilityByCustomer', () => {
  let component: ProfitabilityByCustomer;
  let fixture: ComponentFixture<ProfitabilityByCustomer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfitabilityByCustomer]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProfitabilityByCustomer);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
