
import { PartialType } from '@nestjs/mapped-types';
import { CreateAccountDto } from './create-account.dto';
import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  @IsString()
  @IsNotEmpty({ message: 'VALIDATION.UPDATE_ACCOUNT.REQUIERE_RAZON_PARA_MODIFICACION' })
  reasonForChange: string;
}