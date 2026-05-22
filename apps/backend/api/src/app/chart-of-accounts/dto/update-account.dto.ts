
import { PartialType } from '@nestjs/mapped-types';
import { CreateAccountDto } from './create-account.dto';
import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  @IsString()
  @IsNotEmpty({ message: 'Se requiere una razón para la modificación.' })
  reasonForChange: string;
}