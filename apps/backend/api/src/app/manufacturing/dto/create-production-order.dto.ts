import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ProductionStatus } from '../entities/production-order.entity';

/**
 * A production order the caller may create.
 *
 * The controller used to take `@Body() : any` and the service saved it verbatim, so a client could
 * set `organizationId` to any value or omit fields the column requires. The tenant is now stamped
 * by the service from the authenticated principal and never read from the body, and every field is
 * validated here.
 */
export class CreateProductionOrderDto {
  @IsString()
  @IsNotEmpty()
  orderNumber: string;

  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsUUID()
  @IsOptional()
  billOfMaterialId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  quantityPlanned: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @IsOptional()
  quantityProduced?: number;

  @IsEnum(ProductionStatus)
  @IsOptional()
  status?: ProductionStatus;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
