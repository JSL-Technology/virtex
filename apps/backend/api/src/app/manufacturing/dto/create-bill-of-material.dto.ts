import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class BillOfMaterialItemDto {
  @IsUUID()
  @IsNotEmpty()
  componentProductId: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  quantity: number;

  @IsUUID()
  @IsOptional()
  unitOfMeasureId?: string;
}

export class CreateBillOfMaterialDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsOptional()
  version?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BillOfMaterialItemDto)
  @IsOptional()
  items?: BillOfMaterialItemDto[];
}
