import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsPositive } from 'class-validator';

export class StockTransferLineDto {
  @IsUUID()
  productId: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive({ message: 'validation.constraints.min|{"min":0}' })
  quantity: number;
}

export class SaveStockTransferDto {
  @IsDateString()
  date: string;

  @IsUUID()
  fromWarehouseId: string;

  @IsUUID()
  toWarehouseId: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => StockTransferLineDto)
  lines: StockTransferLineDto[];
}

export class StockTransferQueryDto {
  @IsIn(['DRAFT', 'POSTED', 'CANCELLED'])
  @IsOptional()
  status?: 'DRAFT' | 'POSTED' | 'CANCELLED';

  @IsUUID()
  @IsOptional()
  warehouseId?: string;
}
