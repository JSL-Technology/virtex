import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as Handlebars from 'handlebars';

import { MAIL_BRAND, registerMailPartials } from './mail-brand';
import { mailTemplateHelpers } from './mail-template.helpers';
import type { I18nService } from '../i18n/i18n.service';

/**
 * Every transactional email is compiled and rendered here, with a context that carries exactly
 * what `MailService` sends.
 *
 * ## Why this test exists
 *
 * Handlebars is configured with `strict: true`, which throws on a property the context does not
 * have. That is the right setting — it turns a silently blank paragraph into a loud failure —
 * but the failure happens inside `MailProcessor`, on a queue, while somebody is waiting for a
 * password reset. A template referencing `{{expiresMinutes}}` when the sender passes
 * `expiration` is a production incident that no compiler catches.
 *
 * So the templates are rendered here instead, against the same helpers, the same partials and
 * the same strict mode. A missing variable is a red test, not a support ticket.
 *
 * The second thing it pins is the brand. Ten templates used to carry ten private ideas of what
 * the product looks like — `#0A66FF` in one, `#3498db` in another, unstyled HTML in two more.
 * Now they all opt into the `shell` partial, and the assertions below fail if one stops.
 */

const TEMPLATES_DIR = join(__dirname, 'templates');

/** Translation stands in for itself: the key comes back, so a missing key is visible. */
const i18nStub = {
  translate: (key: string) => `[${key}]`,
} as unknown as I18nService;

/** What `MailService` actually puts in every context. See `baseContext()`. */
const baseContext = {
  appName: 'Virtex',
  currentYear: 2026,
  appUrl: 'https://app.example.test',
  logoUrl: 'https://app.example.test/icons/icon-192x192.png',
  language: 'es',
};

/**
 * The per-template variables, copied from the `enqueue` calls in `MailService`.
 *
 * When a send grows a new variable, its entry here grows with it — which is the point: the list
 * is a written-down contract between the service and its templates.
 */
const CONTEXTS: Record<string, Record<string, unknown>> = {
  'password-reset': {
    name: 'Ana',
    resetLink: 'https://app.example.test/es/auth/reset-password#token=abc',
    expiration: { unitKey: 'TIME.MINUTES', count: 30 },
  },
  'registration-email-verify': {
    name: 'Ana',
    code: '482913',
    magicLinkUrl: 'https://app.example.test/es/do/auth/register?token=abc',
    expiresMinutes: 15,
  },
  'email-change-confirm': {
    name: 'Ana',
    confirmUrl: 'https://app.example.test/es/settings/email?token=abc',
    expiresMinutes: 30,
  },
  'email-changed-notice': { name: 'Ana', newEmail: 'nueva@example.test' },
  'verification-code': { name: 'Ana', code: '482913' },
  'user-invitation': {
    name: 'Ana',
    url: 'https://app.example.test/es/auth/set-password?token=abc',
  },
  'organization-added': {
    name: 'Ana',
    organizationName: 'Caribe Logística SRL',
    url: 'https://app.example.test/es/auth/login',
  },
  'duplicate-registration': {
    name: 'Ana',
    loginUrl: 'https://app.example.test/es/auth/login',
    resetPasswordUrl: 'https://app.example.test/es/auth/forgot-password',
  },
  'registration-failed': {
    name: 'Ana',
    registerUrl: 'https://app.example.test/es/do/auth/register',
    reference: 'pi_3Ab0Cd',
  },
  welcome: {
    name: 'Ana',
    organizationName: 'Caribe Logística SRL',
    dashboardUrl: 'https://app.example.test/dashboard',
  },
  'billing-notice': {
    titleKey: 'MAIL.BILLING_NOTICE.PAYMENT_FAILED_TITLE',
    bodyKey: 'MAIL.BILLING_NOTICE.PAYMENT_FAILED_BODY',
    params: { amount: 1200, currency: 'DOP' },
    billingUrl: 'https://app.example.test/es/settings/billing',
  },
};

function render(template: string): string {
  const source = readFileSync(join(TEMPLATES_DIR, `${template}.hbs`), 'utf8');
  const compiled = Handlebars.compile(source, { strict: true });
  return compiled({ ...baseContext, ...CONTEXTS[template] });
}

describe('transactional email templates', () => {
  beforeAll(() => {
    registerMailPartials(TEMPLATES_DIR);
    Handlebars.registerHelper(mailTemplateHelpers(i18nStub));
  });

  /** Every `.hbs` at the top level is a template a send can name. None may be forgotten here. */
  const templates = readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.hbs'))
    .map((f) => f.replace(/\.hbs$/, ''));

  it('are all covered by this test', () => {
    expect(templates.sort()).toEqual(Object.keys(CONTEXTS).sort());
  });

  describe.each(templates)('%s', (template) => {
    it('renders under strict mode with the context the service sends', () => {
      expect(() => render(template)).not.toThrow();
      expect(render(template)).toContain('<!DOCTYPE html>');
    });

    it('wears the brand rather than its own colours', () => {
      const html = render(template);
      // The shell paints the canvas; a template that stopped using it would not have this.
      expect(html).toContain(MAIL_BRAND.ground);
      expect(html).toContain(MAIL_BRAND.font);
      // The palettes the templates used to invent, one per file.
      expect(html).not.toMatch(/#0A66FF|#3498db|#2c3e50|#f4f4f4/i);
      // `font-family: Arial` as the whole stack — how three of them used to be set.
      expect(html).not.toMatch(/font(-family)?:\s*(400 \d+px\/[\d.]+ )?Arial/);
    });

    it('leaves no empty href or src, which is what the old header shipped', () => {
      const html = render(template);
      expect(html).not.toMatch(/(href|src)=""/);
    });

    it('names the product once, from configuration', () => {
      expect(render(template)).toContain('Virtex');
    });
  });
});
