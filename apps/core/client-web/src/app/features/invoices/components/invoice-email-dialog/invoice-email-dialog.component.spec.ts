import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { InvoiceEmailDialogComponent } from './invoice-email-dialog.component';
import { InvoicesService } from '../../../../core/services/invoices';
import { NotificationService } from '../../../../core/services/notification';
import { AiService } from '../../../ai/data/ai.service';

describe('InvoiceEmailDialogComponent', () => {
  let fixture: ComponentFixture<InvoiceEmailDialogComponent>;
  let component: InvoiceEmailDialogComponent;
  let invoices: { composeMessage: jest.Mock };
  let notifications: { showHttpError: jest.Mock };

  beforeEach(async () => {
    invoices = { composeMessage: jest.fn().mockReturnValue(of({ message: 'Adjuntamos la factura B0100000001 por RD$1,180.00.' })) };
    notifications = { showHttpError: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [InvoiceEmailDialogComponent],
      providers: [
        { provide: InvoicesService, useValue: invoices },
        { provide: NotificationService, useValue: notifications },
        { provide: AiService, useValue: { status: () => of({ languageModel: { available: true } }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InvoiceEmailDialogComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('invoiceId', 'inv-1');
    fixture.componentRef.setInput('canCompose', true);
    fixture.detectChanges();
  });

  it('drafts the note in the chosen tone into the box, and sends only what the person sends', () => {
    const sent = jest.fn();
    component.sent.subscribe(sent);
    component.tone.set('firm');
    component.compose();
    expect(invoices.composeMessage).toHaveBeenCalledWith('inv-1', 'firm');
    expect(component.message()).toContain('B0100000001');
    expect(sent).not.toHaveBeenCalled();

    component.message.set('Texto editado.');
    component.send();
    expect(sent).toHaveBeenCalledWith({ to: undefined, message: 'Texto editado.' });
  });

  it('will not send to a malformed address', () => {
    const sent = jest.fn();
    component.sent.subscribe(sent);
    component.to.set('no-es-correo');
    component.send();
    expect(sent).not.toHaveBeenCalled();
    expect(component.addressInvalid()).toBe(true);
  });

  it('a failed draft leaves the note as it was and says why', () => {
    invoices.composeMessage.mockReturnValue(throwError(() => ({ status: 402 })));
    component.message.set('Mi nota');
    component.compose();
    expect(component.message()).toBe('Mi nota');
    expect(notifications.showHttpError).toHaveBeenCalled();
  });
});

describe('InvoiceEmailDialogComponent without a language model', () => {
  it('does not offer to draft the note (QA R3-M08)', async () => {
    await TestBed.configureTestingModule({
      imports: [InvoiceEmailDialogComponent],
      providers: [
        { provide: InvoicesService, useValue: { composeMessage: jest.fn() } },
        { provide: NotificationService, useValue: { showHttpError: jest.fn() } },
        { provide: AiService, useValue: { status: () => of({ languageModel: { available: false } }) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(InvoiceEmailDialogComponent);
    fixture.componentRef.setInput('invoiceId', 'inv-1');
    fixture.componentRef.setInput('canCompose', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.composeAvailable()).toBe(false);
    expect(fixture.nativeElement.querySelector('.email-dialog__compose')).toBeNull();
  });
});
