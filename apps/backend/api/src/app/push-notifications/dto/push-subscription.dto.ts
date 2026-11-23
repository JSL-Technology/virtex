import { Type } from 'class-transformer';
import { IsDefined, IsNumber, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { MAX_PUSH_ENDPOINT_LENGTH, isTrustedPushEndpoint } from '../push-endpoint';
import { ValidateBy, ValidationOptions } from 'class-validator';

/** base64url, as the Push API encodes both keys. */
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function IsTrustedPushEndpoint(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    { name: 'isTrustedPushEndpoint', validator: { validate: (value) => isTrustedPushEndpoint(value) } },
    { message: 'validation.push.endpoint_not_a_push_service', ...options },
  );
}

export class PushSubscriptionKeysDto {
  /** P-256 public key of the browser: 65 bytes uncompressed → 87 base64url characters. */
  @IsString()
  @Matches(BASE64URL)
  @MaxLength(128)
  p256dh!: string;

  /** 16-byte authentication secret → 22 base64url characters. */
  @IsString()
  @Matches(BASE64URL)
  @MaxLength(64)
  auth!: string;
}

/**
 * Exactly what `PushSubscription.toJSON()` produces in the browser, and nothing else: the global
 * whitelist strips any `id`, `userId` or other field a caller adds, which is what allowed one user to
 * overwrite another's row.
 */
export class SubscribePushDto {
  @IsString()
  @MaxLength(MAX_PUSH_ENDPOINT_LENGTH)
  @IsTrustedPushEndpoint()
  endpoint!: string;

  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;

  @IsDefined()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}

export class UnsubscribePushDto {
  @IsString()
  @MaxLength(MAX_PUSH_ENDPOINT_LENGTH)
  endpoint!: string;
}
