import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LoginUserDto } from './login-user.dto';
import { ForgotPasswordDto } from './forgot-password.dto';

/**
 * `RECAPTCHA_DISABLED=true` is documented as the way to turn the bot check off, and
 * `GoogleRecaptchaModule` honours it with `skipIf`. The DTOs did not: they demanded the token
 * unconditionally, so the request was rejected with 400 before the guard that was supposed to be
 * skipping the check ever ran. Login was therefore impossible in every environment that used the
 * switch — which is every local checkout, and the reason a browser console showed a failing
 * POST /auth/login next to the connection errors.
 *
 * Both directions are pinned, because only one of them is dangerous: the token must become
 * optional when the flag is exactly 'true', and must stay MANDATORY for every other value.
 */
describe('IsRecaptchaToken', () => {
  const original = process.env['RECAPTCHA_DISABLED'];

  afterEach(() => {
    if (original === undefined) delete process.env['RECAPTCHA_DISABLED'];
    else process.env['RECAPTCHA_DISABLED'] = original;
  });

  const errorsFor = async (dto: object) =>
    (await validate(dto)).map((e) => e.property);

  const login = (extra: Record<string, unknown> = {}) =>
    plainToInstance(LoginUserDto, { email: 'a@b.com', password: 'Secret123456!', ...extra });

  describe('when the check is switched off', () => {
    beforeEach(() => {
      process.env['RECAPTCHA_DISABLED'] = 'true';
    });

    it('accepts a login with no token at all', async () => {
      expect(await errorsFor(login())).not.toContain('recaptchaToken');
    });

    it('accepts a password reset with no token at all', async () => {
      const dto = plainToInstance(ForgotPasswordDto, { email: 'a@b.com' });
      expect(await errorsFor(dto)).not.toContain('recaptchaToken');
    });

    it('still validates every other field', async () => {
      const errors = await errorsFor(plainToInstance(LoginUserDto, { email: 'not-an-email' }));
      expect(errors).toContain('email');
      expect(errors).toContain('password');
    });
  });

  describe('when the check is on', () => {
    it.each([
      ['unset', undefined],
      ['empty', ''],
      ['false', 'false'],
      ['0', '0'],
      ['no', 'no'],
      ['TRUE (wrong case)', 'TRUE'],
      ['1', '1'],
    ])('requires the token when RECAPTCHA_DISABLED is %s', async (_label, flag) => {
      // Anything but the exact string 'true' leaves the bot check in force. A typo in the flag
      // must cost a developer an error message, never cost a deployment its protection.
      if (flag === undefined) delete process.env['RECAPTCHA_DISABLED'];
      else process.env['RECAPTCHA_DISABLED'] = flag;

      expect(await errorsFor(login())).toContain('recaptchaToken');
    });

    it('accepts a login that carries a token', async () => {
      process.env['RECAPTCHA_DISABLED'] = 'false';
      expect(await errorsFor(login({ recaptchaToken: 'tok' }))).not.toContain('recaptchaToken');
    });

    it('rejects an empty-string token', async () => {
      process.env['RECAPTCHA_DISABLED'] = 'false';
      expect(await errorsFor(login({ recaptchaToken: '' }))).toContain('recaptchaToken');
    });
  });

  it('is read per request, not captured when the class is first evaluated', async () => {
    // ConfigModule copies the validated environment into process.env during forRoot(), which runs
    // AFTER these DTO classes are evaluated. A decorator argument computed at import time would
    // never see the schema's default; a ValidateIf callback does.
    process.env['RECAPTCHA_DISABLED'] = 'false';
    expect(await errorsFor(login())).toContain('recaptchaToken');

    process.env['RECAPTCHA_DISABLED'] = 'true';
    expect(await errorsFor(login())).not.toContain('recaptchaToken');
  });
});
