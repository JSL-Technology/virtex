import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const INVENTORY_STATUSES = ['STOCKOUT_RISK', 'REORDER', 'OVERSTOCK', 'DEAD_STOCK', 'OK'] as const;
const ANOMALY_STATUSES = ['OPEN', 'CONFIRMED', 'DISMISSED'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

class PageQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number;
}

export class InsightsQueryDto extends PageQuery {
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @IsIn(INVENTORY_STATUSES, { message: 'validation.constraints.is_in' })
  @IsOptional()
  status?: (typeof INVENTORY_STATUSES)[number];

  @IsString()
  @MaxLength(120)
  @IsOptional()
  search?: string;

  @IsIn(['risk', 'top_sellers'], { message: 'validation.constraints.is_in' })
  @IsOptional()
  sort?: 'risk' | 'top_sellers';
}

export class SeriesQueryDto {
  @IsUUID()
  productId: string;

  @IsUUID()
  warehouseId: string;

  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(730)
  @IsOptional()
  historyDays?: number;
}

export class TopByBranchQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  perBranch?: number;
}

export class AnomaliesQueryDto extends PageQuery {
  @IsIn(ANOMALY_STATUSES, { message: 'validation.constraints.is_in' })
  @IsOptional()
  status?: (typeof ANOMALY_STATUSES)[number];

  @IsIn(SEVERITIES, { message: 'validation.constraints.is_in' })
  @IsOptional()
  severity?: (typeof SEVERITIES)[number];

  @IsIn(['sales', 'purchases', 'inventory', 'cash'], { message: 'validation.constraints.is_in' })
  @IsOptional()
  category?: string;
}

export class AnomalyFeedbackDto {
  @IsIn(['USEFUL', 'FALSE_POSITIVE'], { message: 'validation.constraints.is_in' })
  verdict: 'USEFUL' | 'FALSE_POSITIVE';

  @IsString()
  @MaxLength(2_000)
  @IsOptional()
  comment?: string;
}
