import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { InboundMailInboxComponent } from './inbound-mail-inbox.component';
import { InboundMailService, InboundMessage } from './inbound-mail.service';

const message = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  id: 'm1',
  from: 'ana@supplier.com',
  fromName: 'Ana',
  subject: 'Factura B0100000123',
  receivedAt: '2026-10-22T10:00:00Z',
  status: 'NEEDS_REVIEW',
  reason: null,
  records: [],
  review: { bills: [{ attachmentId: 'a1', fileName: 'factura.pdf', reasons: ['unknown_supplier'], purchaseOrder: { id: 'po-1' } }] },
  attachments: [{ id: 'x1', fileName: 'factura.pdf', mimeType: 'application/pdf', size: 10 }],
  ...overrides,
});

describe('InboundMailInboxComponent', () => {
  function render(messages: InboundMessage[]) {
    const api = { messages: jest.fn(() => of(messages)), dismiss: jest.fn(() => of({ id: 'm1', status: 'DISMISSED' })), retry: jest.fn(() => of({})) };
    TestBed.configureTestingModule({ imports: [InboundMailInboxComponent], providers: [provideRouter([]), { provide: InboundMailService, useValue: api }] });
    const fixture = TestBed.createComponent(InboundMailInboxComponent);
    fixture.componentRef.setInput('purpose', 'BILLS');
    fixture.detectChanges();
    return { fixture, api };
  }

  it('sends a bill left for review to the form, prefilled, with the order it matched', () => {
    const { fixture } = render([message()]);
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.mail-inbox__review a');
    expect(link.getAttribute('href')).toBe('/accounts-payable/new?fromMail=m1&attachment=a1&purchaseOrderId=po-1');
    expect(fixture.nativeElement.textContent).toContain('inbound_mail.bill_reason.unknown_supplier');
  });

  it('links the drafts it made, and lets a message be archived', () => {
    const { fixture, api } = render([message({ status: 'PROCESSED', review: null, records: [{ type: 'vendor_bill', id: 'b1', label: 'B01', link: '/accounts-payable/b1' }] })]);
    expect(fixture.nativeElement.querySelector('.mail-inbox__record').getAttribute('href')).toBe('/accounts-payable/b1');
    fixture.componentInstance.dismiss(fixture.componentInstance.messages()[0]);
    expect(api.dismiss).toHaveBeenCalledWith('BILLS', 'm1');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mail-inbox')).toBeNull();
  });

  it('shows nothing when nothing arrived', () => {
    const { fixture } = render([]);
    expect(fixture.nativeElement.querySelector('.mail-inbox')).toBeNull();
  });
});
