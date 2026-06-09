import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProfitabilityByProductPage } from './profitability-by-product.page';

describe('ProfitabilityByProduct', () => {
  let component: ProfitabilityByProductPage;
  let fixture: ComponentFixture<ProfitabilityByProductPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfitabilityByProductPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProfitabilityByProductPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
