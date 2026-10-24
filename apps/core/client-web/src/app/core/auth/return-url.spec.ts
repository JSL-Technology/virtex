import { ReturnUrlService, isLandingUrl, sanitizeReturnUrl } from './return-url';

/**
 * The destination after signing in is untrusted input — it arrives in the address bar, in a query
 * parameter, in a link someone sent. These tests are mostly about what it must NOT become: an open
 * redirect that sends a person who just typed their password to another site.
 */
describe('sanitizeReturnUrl', () => {
  const origin = 'https://app.virtex.example';

  it.each([
    ['/e/acme/invoices/88', '/e/acme/invoices/88'],
    ['/invoices?status=open#lines', '/invoices?status=open#lines'],
    ['/accounting/journals/5/edit', '/accounting/journals/5/edit'],
  ])('keeps a page of this workspace: %s', (raw, expected) => {
    expect(sanitizeReturnUrl(raw, origin)).toBe(expected);
  });

  it.each([
    ['https://evil.example/login', 'an absolute URL to another site'],
    ['//evil.example/login', 'a protocol-relative URL'],
    ['/\\evil.example', 'a backslash a browser reads as a second slash'],
    ['javascript:alert(1)', 'a script URL'],
    ['%2F%2Fevil.example', 'an encoded protocol-relative URL'],
    ['invoices/88', 'a relative path'],
    ['/es/auth/login', 'the sign-in page itself, which would loop'],
    ['/auth/login', 'a public page'],
    ['/unauthorized', 'the page that explains a refusal'],
    ['', 'nothing'],
  ])('refuses %s (%s)', (raw) => {
    expect(sanitizeReturnUrl(raw, origin)).toBeNull();
  });

  it('refuses anything that is not a string', () => {
    expect(sanitizeReturnUrl({ url: '/invoices' }, origin)).toBeNull();
    expect(sanitizeReturnUrl(null, origin)).toBeNull();
  });
});

describe('isLandingUrl', () => {
  it('recognises the home page with and without the company', () => {
    expect(isLandingUrl('/overview')).toBe(true);
    expect(isLandingUrl('/e/acme/overview')).toBe(true);
    expect(isLandingUrl('/')).toBe(true);
    expect(isLandingUrl('/e/acme/invoices')).toBe(false);
  });
});

describe('ReturnUrlService', () => {
  let service: ReturnUrlService;

  beforeEach(() => {
    sessionStorage.clear();
    service = new ReturnUrlService();
  });

  afterEach(() => jest.useRealTimers());

  it('remembers once and forgets on use', () => {
    service.remember('/e/acme/invoices/88');
    expect(service.consume()).toBe('/e/acme/invoices/88');
    expect(service.consume()).toBeNull();
  });

  it('does not remember an unsafe destination, and forgets the previous one', () => {
    service.remember('/e/acme/invoices/88');
    expect(service.remember('//evil.example')).toBeNull();
    expect(service.peek()).toBeNull();
  });

  it('a destination abandoned for half an hour is no longer followed', () => {
    jest.useFakeTimers({ now: new Date('2026-10-23T10:00:00Z') });
    service.remember('/e/acme/invoices/88');
    jest.setSystemTime(new Date('2026-10-23T10:31:00Z'));
    expect(service.peek()).toBeNull();
  });

  it('re-checks what it reads back, since storage can be written by any script on the origin', () => {
    sessionStorage.setItem('virtex.auth.return_url', JSON.stringify({ url: '//evil.example', at: Date.now() }));
    expect(service.peek()).toBeNull();
  });
});
