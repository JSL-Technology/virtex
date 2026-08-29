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
    // `widget` is a required input the component dereferences while building its chart options,
    // so rendering without it threw before any assertion ran.
    fixture.componentRef.setInput('widget', {
      id: 'invoice-status',
      componentType: 'invoice-status',
      name: 'InvoiceStatus',
      cols: 2,
      rows: 3,
      x: 0,
      y: 0,
    } as never);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
