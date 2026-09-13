import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AdjustmentStatus } from '../entities/proposed-adjustment.entity';

/** Filters for the proposed-adjustment list: one fiscal year, one status, or the lot. */
export class ListProposedAdjustmentsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Restringe a un año fiscal.' })
  @IsUUID('4')
  @IsOptional()
  fiscalYearId?: string;

  @ApiPropertyOptional({ enum: AdjustmentStatus, description: 'Restringe a un estado.' })
  @IsEnum(AdjustmentStatus)
  @IsOptional()
  status?: AdjustmentStatus;
}
