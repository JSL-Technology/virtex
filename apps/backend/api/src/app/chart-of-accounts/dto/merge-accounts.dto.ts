
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class MergeAccountsDto {
  @IsUUID()
  @IsNotEmpty()
  sourceAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  destinationAccountId: string;

  @IsString()
  @IsNotEmpty({ message: 'VALIDATION.MERGE_ACCOUNTS.REQUIERE_RAZON_PARA_FUSION' })
  reason: string;
}