import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccountingLayout } from './accounting.layout';

describe('Layout', () => {
  let component: AccountingLayout;
  let fixture: ComponentFixture<AccountingLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountingLayout]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountingLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
