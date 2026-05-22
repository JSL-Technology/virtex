import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CustomerReturns } from './customer-returns';

describe('CustomerReturns', () => {
  let component: CustomerReturns;
  let fixture: ComponentFixture<CustomerReturns>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomerReturns]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CustomerReturns);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
