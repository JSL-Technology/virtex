import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProfitabilityByProduct } from './profitability-by-product.page';

describe('ProfitabilityByProduct', () => {
  let component: ProfitabilityByProduct;
  let fixture: ComponentFixture<ProfitabilityByProduct>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfitabilityByProduct]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProfitabilityByProduct);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
