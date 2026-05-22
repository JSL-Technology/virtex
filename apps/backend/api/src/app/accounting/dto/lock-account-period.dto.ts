
import { IsNotEmpty, IsUUID } from 'class-validator';

export class LockAccountInPeriodDto {
  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @IsUUID()
  @IsNotEmpty()
  periodId: string;
}