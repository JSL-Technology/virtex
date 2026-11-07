import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PortalListQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  page?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(100, { message: 'validation.constraints.max|{"max":100}' })
  limit?: number;
}
