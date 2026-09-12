import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** One per-employee, per-concept variable input for a run. */
export class PayrollInputItemDto {
  @IsUUID()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  conceptCode: string;

  /** For FIXED concepts. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  amount?: number;

  /** For HOURLY concepts — hours. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsOptional()
  quantity?: number;

  /** Overrides the concept's own rate/premium when set. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsOptional()
  rate?: number;

  @IsString()
  @IsOptional()
  note?: string;
}

/** A bulk replace of a run's inputs — the whole set is submitted before calculating. */
export class UpsertInputsDto {
  @IsArray()
  @ArrayMaxSize(50000)
  @ValidateNested({ each: true })
  @Type(() => PayrollInputItemDto)
  items: PayrollInputItemDto[];
}
