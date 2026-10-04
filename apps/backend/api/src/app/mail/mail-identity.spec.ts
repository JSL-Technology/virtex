import { MailProcessor } from './mail.processor';
import { MailJob } from './mail.queue';

/**
 * A document a company e-mails its customer carries the company's name as sender and its address
 * for replies, while leaving from the platform's authenticated domain (QA M-09).
 */
describe('mail sender identity', () => {
  const sendMail = jest.fn().mockResolvedValue(undefined);
  const config = { get: jest.fn((key: string) => (key === 'MAIL_FROM_ADDRESS' ? 'no-reply@virtex.test' : undefined)) };
  const i18n = { translate: jest.fn(() => 'Asunto') };
  const processor = new MailProcessor({ sendMail } as never, i18n as never, config as never);

  const job = (data: Partial<MailJob>) =>
    ({ data: { to: 'cliente@x.test', subjectKey: 's', language: 'es', template: 'invoice', context: {}, ...data } }) as never;

  beforeEach(() => sendMail.mockClear());

  it('sends from the company name on the platform address, replying to the company', async () => {
    await processor.process(job({ fromName: 'Caribe Logística SRL', replyTo: 'cobros@caribe.test', bcc: 'archivo@caribe.test' }));
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Caribe Logística SRL" <no-reply@virtex.test>',
        replyTo: 'cobros@caribe.test',
        bcc: 'archivo@caribe.test',
      }),
    );
  });

  it('cannot be made to name another address through the display name', async () => {
    await processor.process(job({ fromName: 'Evil" <ceo@bank.test>\r\nBcc: all@x.test' }));
    const { from } = sendMail.mock.calls[0][0];
    expect(from).toBe('"Evil ceo@bank.testBcc: all@x.test" <no-reply@virtex.test>');
  });

  it('keeps the platform default when the job names no sender', async () => {
    await processor.process(job({}));
    const message = sendMail.mock.calls[0][0];
    expect(message).not.toHaveProperty('from');
    expect(message).not.toHaveProperty('replyTo');
  });
});
