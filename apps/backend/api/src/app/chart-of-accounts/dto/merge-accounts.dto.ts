
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class MergeAccountsDto {
  @IsUUID()
  @IsNotEmpty()
  sourceAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  destinationAccountId: string;

  @IsString()
  @IsNotEmpty({ message: 'validation.merge_accounts.reason_merge_required' })
  reason: string;
}