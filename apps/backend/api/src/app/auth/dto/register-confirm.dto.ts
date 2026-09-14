import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Confirms a signup after returning from Stripe Checkout. */
export class RegisterConfirmDto {
  @ApiProperty({ example: 'cs_test_...', description: 'Stripe Checkout session id' })
  @IsString({ message: 'validation.register_confirm.session_not_valid' })
  @IsNotEmpty({ message: 'validation.register_confirm.session_required' })
  sessionId: string;
}
