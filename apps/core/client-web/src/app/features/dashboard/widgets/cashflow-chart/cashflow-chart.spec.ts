import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CashflowChart } from './cashflow-chart';

describe('CashflowChart', () => {
  let component: CashflowChart;
  let fixture: ComponentFixture<CashflowChart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CashflowChart]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CashflowChart);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
