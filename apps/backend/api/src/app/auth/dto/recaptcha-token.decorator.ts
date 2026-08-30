import { applyDecorators } from '@nestjs/common';
import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Is the bot check switched off for this process?
 *
 * Read at call time, never at import time. `ConfigModule` copies the validated environment into
 * `process.env` during `forRoot()`, which runs after these DTO classes are evaluated, so a
 * decorator argument computed at import time would always see the raw, pre-validation value and
 * miss the schema's default. `ValidateIf` takes a callback that runs per request, which is late
 * enough to see it.
 *
 * The comparison is against the exact string `'true'` so that every other value — unset, empty,
 * `'0'`, `'no'`, a typo — leaves the token REQUIRED. The failure direction matters: getting this
 * predicate wrong must cost a developer an error message, never cost production its bot check.
 */
const recaptchaDisabled = () => process.env['RECAPTCHA_DISABLED'] === 'true';

/**
 * The reCAPTCHA token on a public, unauthenticated endpoint.
 *
 * `RECAPTCHA_DISABLED=true` is the documented way to turn the bot check off, and
 * `GoogleRecaptchaModule` honours it via `skipIf`. The DTOs did not: they demanded the token
 * unconditionally, so a request without one was rejected with 400 "El token de reCAPTCHA es
 * obligatorio" before the guard — the thing that was supposed to be skipping the check — ever ran.
 * The switch therefore did nothing observable, and login was impossible in any environment that
 * used it, which is every local checkout.
 */
export const IsRecaptchaToken = () =>
  applyDecorators(
    ApiProperty({
      description: 'Google reCAPTCHA v3 token. Optional only when RECAPTCHA_DISABLED=true.',
      required: true,
    }),
    ValidateIf(() => !recaptchaDisabled()),
    IsString(),
    IsNotEmpty({ message: 'El token de reCAPTCHA es obligatorio.' }),
  );
