import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * The fields a caller may set on a ledger.
 *
 * ## Why this exists
 *
 * The controller typed its body as `Partial<Ledger>`. A TypeScript type leaves `Object` as the
 * runtime metatype, and `ValidationPipe` skips validation entirely for `Object` — so neither
 * `whitelist` nor `forbidNonWhitelisted` applied, and the raw request body reached the service.
 * The service then ran `Object.assign(ledger, updateDto)` and saved, which meant a body carrying
 * `organizationId` moved the ledger — and the accounting hanging off it — into another tenant.
 * The route required no permission either.
 *
 * Naming the fields is the fix: `organizationId` and `id` are not among them, so they cannot be
 * assigned no matter what the body contains.
 */
export class CreateLedgerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  /** ISO 4217. The currency every amount in this ledger is measured in. */
  @IsString()
  @Length(3, 3)
  currency: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateLedgerDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  /**
   * Deliberately absent: a ledger's currency is not editable.
   *
   * Every amount already posted to it was measured in the old currency. Changing the label without
   * restating the entries would silently reinterpret the whole book, so a new currency means a new
   * ledger.
   */

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
