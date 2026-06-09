import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MonthEndClosePage } from './month-end-close.page';

describe('MonthEndClose', () => {
  let component: MonthEndClosePage;
  let fixture: ComponentFixture<MonthEndClosePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonthEndClosePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MonthEndClosePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
