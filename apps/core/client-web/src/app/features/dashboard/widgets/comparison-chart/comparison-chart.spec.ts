import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComparisonChart } from './comparison-chart';

describe('ComparisonChart', () => {
  let component: ComparisonChart;
  let fixture: ComponentFixture<ComparisonChart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComparisonChart]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ComparisonChart);
    component = fixture.componentInstance;
    // `widget` is a required input the component dereferences while building its chart options,
    // so rendering without it threw before any assertion ran.
    fixture.componentRef.setInput('widget', {
      id: 'comparison-chart',
      componentType: 'comparison-chart',
      name: 'ComparisonChart',
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
