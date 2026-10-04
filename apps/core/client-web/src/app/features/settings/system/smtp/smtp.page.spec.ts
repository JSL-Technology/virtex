import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NotificationService } from '../../../../core/services/notification';
import { MailSettings, SmtpSettingsPage } from './smtp.page';

/** QA M-09: the company's identity on the documents it e-mails. */
describe('SmtpSettingsPage (outgoing e-mail)', () => {
  let http: HttpTestingController;
  const notifications = { showSuccess: jest.fn(), showError: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: jest.fn(() => 'x') };
  const settings: MailSettings = {
    senderName: 'Caribe Logística',
    replyTo: 'info@caribe.test',
    copyTo: null,
    configured: { senderName: null, replyTo: null, copyTo: null },
    defaults: { senderName: 'Caribe Logística', replyTo: 'info@caribe.test' },
    platformAddress: 'no-reply@virtex.test',
  };

  function create() {
    TestBed.configureTestingModule({
      imports: [SmtpSettingsPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: NotificationService, useValue: notifications }],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SmtpSettingsPage);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/organizations/mail-settings')).flush(settings);
    return fixture.componentInstance;
  }

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
  });

  it('previews the sender as the customer will see it, falling back to the company defaults', () => {
    const page = create();
    expect(page.preview()).toBe('Caribe Logística <no-reply@virtex.test>');
    expect(page.replyPreview()).toBe('info@caribe.test');
    page.patch({ senderName: 'Caribe Cobros' });
    expect(page.preview()).toBe('Caribe Cobros <no-reply@virtex.test>');
    expect(page.dirty()).toBe(true);
  });

  it('refuses an invalid address before sending', () => {
    const page = create();
    page.patch({ replyTo: 'cobros@' });
    page.save();
    expect(notifications.showError).toHaveBeenCalledWith('settings.mail.invalid_address');
    http.expectNone((r) => r.method === 'PATCH');
  });

  it('saves trimmed values, an empty one clearing back to the default', () => {
    const page = create();
    page.patch({ senderName: '  Caribe Cobros ', replyTo: 'cobros@caribe.test', copyTo: '' });
    page.save();
    const req = http.expectOne((r) => r.method === 'PATCH');
    expect(req.request.body).toEqual({ senderName: 'Caribe Cobros', replyTo: 'cobros@caribe.test', copyTo: null });
    req.flush({ ...settings, configured: { senderName: 'Caribe Cobros', replyTo: 'cobros@caribe.test', copyTo: null } });
    expect(page.dirty()).toBe(false);
    expect(notifications.showSuccess).toHaveBeenCalledWith('settings.mail.saved');
  });

  it('sends a test to the caller and says where it went', () => {
    const page = create();
    page.sendTest();
    http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/mail-settings/test')).flush({ queued: true, to: 'ana@caribe.test' });
    expect(notifications.showSuccess).toHaveBeenCalledWith('settings.mail.test_sent', { to: 'ana@caribe.test' });
  });
});
