import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RegisterUserDto } from './register-user.dto';

/**
 * Payment-first signup payload: the full registration plus the chosen plan.
 * No account is created from this — it produces a Stripe Checkout session.
 */
export class RegisterCheckoutDto extends RegisterUserDto {
  @ApiProperty({ example: 'pro', description: 'Selected plan slug or id' })
  @IsString({ message: 'El plan seleccionado no es válido.' })
  @IsNotEmpty({ message: 'Debes seleccionar un plan.' })
  planId: string;
}
