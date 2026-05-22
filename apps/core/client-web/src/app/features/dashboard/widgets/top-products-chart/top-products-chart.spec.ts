import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TopProductsChart } from './top-products-chart';

describe('TopProductsChart', () => {
  let component: TopProductsChart;
  let fixture: ComponentFixture<TopProductsChart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopProductsChart]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TopProductsChart);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
