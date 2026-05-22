
import { IsArray, IsNotEmpty, IsUUID } from 'class-validator';

export class BatchDeactivateAccountsDto {
  @IsArray()
  @IsUUID('4', { each: true, message: 'Cada ID de cuenta debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'La lista de IDs de cuenta no puede estar vacía.' })
  accountIds: string[];
}