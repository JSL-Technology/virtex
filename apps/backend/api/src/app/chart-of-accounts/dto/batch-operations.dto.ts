
import { IsArray, IsNotEmpty, IsUUID } from 'class-validator';

export class BatchDeactivateAccountsDto {
  @IsArray()
  @IsUUID('4', { each: true, message: 'validation.batch_operations.each_account_id_must_valid_uuid' })
  @IsNotEmpty({ message: 'validation.batch_operations.list_account_ids_cannot_empty' })
  accountIds: string[];
}