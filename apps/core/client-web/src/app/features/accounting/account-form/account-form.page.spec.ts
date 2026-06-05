import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccountFormPage } from './account-form.page';

describe('AccountFormPage', () => {
  let component: AccountFormPage;
  let fixture: ComponentFixture<AccountFormPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountFormPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountFormPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

});
