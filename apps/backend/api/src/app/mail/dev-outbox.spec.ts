import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { devOutboxEnabled, saveToDevOutbox } from './dev-outbox';

/**
 * Without SMTP a developer could not read the code signup e-mails, so signup could not be finished
 * locally. The development mailbox keeps the message; these tests pin when it applies and what it
 * writes.
 */
describe('development mailbox', () => {
  const config = (values: Record<string, string | undefined>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;
  const originalEnv = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
  });

  it('applies in development when no SMTP server is configured', () => {
    process.env['NODE_ENV'] = 'development';
    expect(devOutboxEnabled(config({}))).toBe(true);
  });

  it('never replaces a configured SMTP server', () => {
    process.env['NODE_ENV'] = 'development';
    expect(devOutboxEnabled(config({ MAIL_HOST: 'smtp.example.com' }))).toBe(false);
  });

  it('never applies to a deployment', () => {
    process.env['NODE_ENV'] = 'production';
    expect(devOutboxEnabled(config({}))).toBe(false);
  });

  it('writes the rendered message, so the code in it can be read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'outbox-'));
    try {
      const info = {
        message: JSON.stringify({ subject: 'Confirma tu correo', html: '<p>Código: 948071</p>', to: [{ address: 'a@b.do' }] }),
      };
      const file = saveToDevOutbox(info, dir, new Date('2026-10-11T01:00:00Z'));
      expect(file).toMatch(/confirma-tu-correo\.html$/);
      expect(readFileSync(file as string, 'utf8')).toContain('948071');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
