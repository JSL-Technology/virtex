import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArAgingChart } from './ar-aging-chart';

describe('ArAgingChart', () => {
  let component: ArAgingChart;
  let fixture: ComponentFixture<ArAgingChart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArAgingChart]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ArAgingChart);
    component = fixture.componentInstance;
    // `widget` is a required input the component dereferences while building its chart options,
    // so rendering without it threw before any assertion ran.
    fixture.componentRef.setInput('widget', {
      id: 'ar-aging-chart',
      componentType: 'ar-aging-chart',
      name: 'ArAgingChart',
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
