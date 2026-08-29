import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SalesChart } from './sales-chart';

describe('SalesChart', () => {
  let component: SalesChart;
  let fixture: ComponentFixture<SalesChart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalesChart]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SalesChart);
    component = fixture.componentInstance;
    // `widget` is a required input the component dereferences while building its chart options,
    // so rendering without it threw before any assertion ran.
    fixture.componentRef.setInput('widget', {
      id: 'sales-chart',
      componentType: 'sales-chart',
      name: 'SalesChart',
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
