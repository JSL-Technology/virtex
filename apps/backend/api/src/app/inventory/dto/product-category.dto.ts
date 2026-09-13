import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductCategoryDto {
  @IsString()
  @IsNotEmpty({ message: 'VALIDATION.PRODUCT_CATEGORY.NAME_REQUIRED' })
  @MaxLength(100, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":100}' })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(32, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":32}' })
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** `null` puts the category at the top level; the service refuses a parent that is a descendant. */
  @IsUUID('4', { message: 'VALIDATION.PRODUCT_CATEGORY.PARENT_MUST_BE_UUID' })
  @IsOptional()
  parentId?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @IsOptional()
  sortOrder?: number;
}

/**
 * Every field optional, including `parentId`, which may be sent as `null` to move a category to
 * the top level. `PartialType` would make `null` indistinguishable from "not sent", and the
 * difference is exactly what "move this to the root" means.
 */
export class UpdateProductCategoryDto {
  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: 'VALIDATION.PRODUCT_CATEGORY.NAME_REQUIRED' })
  @MaxLength(100, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":100}' })
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":32}' })
  code?: string | null;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsUUID('4', { message: 'VALIDATION.PRODUCT_CATEGORY.PARENT_MUST_BE_UUID' })
  @IsOptional()
  parentId?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @IsOptional()
  sortOrder?: number;
}
