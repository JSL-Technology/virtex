import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccountReconciliationPage } from './account-reconciliation.page';

describe('AccountReconciliationPage', () => {
  let component: AccountReconciliationPage;
  let fixture: ComponentFixture<AccountReconciliationPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountReconciliationPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountReconciliationPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
