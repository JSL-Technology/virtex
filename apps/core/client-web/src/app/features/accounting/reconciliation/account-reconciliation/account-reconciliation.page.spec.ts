import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccountReconciliation } from './account-reconciliation.page';

describe('AccountReconciliation', () => {
  let component: AccountReconciliation;
  let fixture: ComponentFixture<AccountReconciliation>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountReconciliation]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountReconciliation);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
