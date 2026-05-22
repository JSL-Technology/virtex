import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InvoiceStatus } from './invoice-status';

describe('InvoiceStatus', () => {
  let component: InvoiceStatus;
  let fixture: ComponentFixture<InvoiceStatus>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvoiceStatus]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InvoiceStatus);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
