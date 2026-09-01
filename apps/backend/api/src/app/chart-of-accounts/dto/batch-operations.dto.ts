
import { IsArray, IsNotEmpty, IsUUID } from 'class-validator';

export class BatchDeactivateAccountsDto {
  @IsArray()
  @IsUUID('4', { each: true, message: 'VALIDATION.BATCH_OPERATIONS.CADA_ID_CUENTA_DEBE_UUID_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.BATCH_OPERATIONS.LISTA_IDS_CUENTA_NO_PUEDE_ESTAR_VACIA' })
  accountIds: string[];
}