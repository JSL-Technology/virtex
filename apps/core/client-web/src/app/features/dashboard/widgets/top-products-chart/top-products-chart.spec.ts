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
    // `widget` is a required input the component dereferences while building its chart options,
    // so rendering without it threw before any assertion ran.
    fixture.componentRef.setInput('widget', {
      id: 'top-products',
      componentType: 'top-products',
      name: 'TopProductsChart',
      cols: 2,
      rows: 3,
      x: 0,
      y: 0,
    } as never);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
