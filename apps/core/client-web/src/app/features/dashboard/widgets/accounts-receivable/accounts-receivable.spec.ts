import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccountsReceivable } from './accounts-receivable';

describe('AccountsReceivable', () => {
  let component: AccountsReceivable;
  let fixture: ComponentFixture<AccountsReceivable>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountsReceivable]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountsReceivable);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
