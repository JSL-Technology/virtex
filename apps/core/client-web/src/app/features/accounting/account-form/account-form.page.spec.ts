import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccountForm } from './account-form.page';

describe('AccountForm', () => {
  let component: AccountForm;
  let fixture: ComponentFixture<AccountForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountForm]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should set isConfigMissing if segment definitions are empty', () => {
    apiService.getSegmentDefinitions.mockReturnValue(of([]));

    component.ngOnInit();

    expect(component.isConfigMissing()).toBe(true);
  });
});
