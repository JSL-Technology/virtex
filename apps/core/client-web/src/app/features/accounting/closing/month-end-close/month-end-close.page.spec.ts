import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MonthEndClose } from './month-end-close.page';

describe('MonthEndClose', () => {
  let component: MonthEndClose;
  let fixture: ComponentFixture<MonthEndClose>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonthEndClose]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MonthEndClose);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
