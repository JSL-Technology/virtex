
import { IsArray, IsNotEmpty, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class MatchDto {
  @IsUUID()
  @IsNotEmpty()
  bankTransactionId: string;

  @IsUUID()
  @IsNotEmpty()
  journalEntryLineId: string;
}

export class MatchTransactionsDto {
  @IsUUID()
  @IsNotEmpty()
  statementId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchDto)
  matches: MatchDto[];
}