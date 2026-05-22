import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TotalExpenses } from './total-expenses';

describe('TotalExpenses', () => {
  let component: TotalExpenses;
  let fixture: ComponentFixture<TotalExpenses>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TotalExpenses]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TotalExpenses);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
