import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CustomerListPage } from './customer-list.page';

describe('CustomerList', () => {
  let component: CustomerListPage;
  let fixture: ComponentFixture<CustomerListPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomerListPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CustomerListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
