import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExpensesDistribution } from './expenses-distribution';

describe('ExpensesDistribution', () => {
  let component: ExpensesDistribution;
  let fixture: ComponentFixture<ExpensesDistribution>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExpensesDistribution]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ExpensesDistribution);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
