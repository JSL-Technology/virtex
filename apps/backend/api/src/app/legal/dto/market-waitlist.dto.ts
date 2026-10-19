import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NormalizeEmail } from '../../common/transformers/normalize-email.transformer';

/** "Tell me when you open in my country" (QA A-13). */
export class MarketWaitlistDto {
  @ApiProperty({ example: 'ana@example.com' })
  @NormalizeEmail()
  @IsNotEmpty({ message: 'validation.register_user.email_address_cannot_empty' })
  @IsEmail({}, { message: 'validation.register_user.email_address_not_valid' })
  @MaxLength(254, { message: 'validation.register_user.email_cannot_longer_than_254_characters' })
  email: string;

  /** ISO 3166-1 alpha-2 of the market asked for. Any country: these are the ones not served. */
  @ApiProperty({ example: 'ES' })
  @IsString({ message: 'validation.legal.country_code_invalid' })
  @Matches(/^[A-Za-z]{2}$/, { message: 'validation.legal.country_code_invalid' })
  countryCode: string;

  /** The language the visitor was reading, to write back in it. */
  @ApiProperty({ example: 'es', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  language?: string;
}
