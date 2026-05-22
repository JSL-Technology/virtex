
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class MergeAccountsDto {
  @IsUUID()
  @IsNotEmpty()
  sourceAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  destinationAccountId: string;

  @IsString()
  @IsNotEmpty({ message: 'Se requiere una razón para la fusión.' })
  reason: string;
}