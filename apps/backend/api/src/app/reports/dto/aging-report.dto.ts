
import { IsOptional, IsUUID } from 'class-validator';

export class AgingReportDto {
  @IsUUID()
  @IsOptional()
  ledgerId?: string;
}