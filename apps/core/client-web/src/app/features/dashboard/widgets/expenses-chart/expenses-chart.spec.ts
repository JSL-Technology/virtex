import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExpensesChart } from './expenses-chart';

describe('ExpensesChart', () => {
  let component: ExpensesChart;
  let fixture: ComponentFixture<ExpensesChart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExpensesChart]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ExpensesChart);
    component = fixture.componentInstance;
    // `widget` is a required input the component dereferences while building its chart options,
    // so rendering without it threw before any assertion ran.
    fixture.componentRef.setInput('widget', {
      id: 'expenses-chart',
      componentType: 'expenses-chart',
      name: 'ExpensesChart',
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
