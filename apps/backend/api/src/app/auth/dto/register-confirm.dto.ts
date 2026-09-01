import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Confirms a signup after returning from Stripe Checkout. */
export class RegisterConfirmDto {
  @ApiProperty({ example: 'cs_test_...', description: 'Stripe Checkout session id' })
  @IsString({ message: 'VALIDATION.REGISTER_CONFIRM.SESION_NO_VALIDA' })
  @IsNotEmpty({ message: 'VALIDATION.REGISTER_CONFIRM.SESION_OBLIGATORIA' })
  sessionId: string;
}
