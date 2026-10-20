import { IsString, MaxLength, MinLength } from 'class-validator';

export class VoidSaleDto {
  /** Why the sale is voided. Kept on the sale; a void with no reason is unauditable. */
  @IsString()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  reason: string;
}
