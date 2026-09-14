
import { PartialType } from '@nestjs/mapped-types';
import { CreateAccountDto } from './create-account.dto';
import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  @IsString()
  @IsNotEmpty({ message: 'validation.update_account.reason_change_required' })
  reasonForChange: string;
}