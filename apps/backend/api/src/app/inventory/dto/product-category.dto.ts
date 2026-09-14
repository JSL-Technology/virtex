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
  @IsNotEmpty({ message: 'validation.product_category.name_required' })
  @MaxLength(100, { message: 'validation.constraints.max_length|{"max":100}' })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(32, { message: 'validation.constraints.max_length|{"max":32}' })
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** `null` puts the category at the top level; the service refuses a parent that is a descendant. */
  @IsUUID('4', { message: 'validation.product_category.parent_must_be_uuid' })
  @IsOptional()
  parentId?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
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
  @IsNotEmpty({ message: 'validation.product_category.name_required' })
  @MaxLength(100, { message: 'validation.constraints.max_length|{"max":100}' })
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32, { message: 'validation.constraints.max_length|{"max":32}' })
  code?: string | null;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsUUID('4', { message: 'validation.product_category.parent_must_be_uuid' })
  @IsOptional()
  parentId?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  sortOrder?: number;
}
