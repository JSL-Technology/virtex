import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccountsPayable } from './accounts-payable';

describe('AccountsPayable', () => {
  let component: AccountsPayable;
  let fixture: ComponentFixture<AccountsPayable>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountsPayable]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountsPayable);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
