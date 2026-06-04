import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Confirms a signup after returning from Stripe Checkout. */
export class RegisterConfirmDto {
  @ApiProperty({ example: 'cs_test_...', description: 'Stripe Checkout session id' })
  @IsString({ message: 'La sesión no es válida.' })
  @IsNotEmpty({ message: 'La sesión es obligatoria.' })
  sessionId: string;
}
