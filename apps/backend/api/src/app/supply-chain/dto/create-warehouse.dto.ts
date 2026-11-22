import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { IsLocalizedName } from '../../common/validators/is-localized-name.validator';
import type { LocalizedName } from '@virtex/shared/types';

export class CreateWarehouseDto {
  /** The branch this warehouse serves. Omitted: none, which is right for a company without branches. */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * The name in other languages — `{ en: 'Sales journal' }` — for whoever reads it in one of them.
   * The books language is not among them: `name` is that one, the record. An empty text removes a
   * language; a language left out keeps what it had.
   */
  @IsOptional()
  @IsLocalizedName()
  nameTranslations?: LocalizedName;

  @IsString()
  @IsOptional()
  code?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /**
   * Make it where stock goes when nothing says otherwise. Moves the designation from the previous
   * default; there is always exactly one, so `false` is not a way to have none.
   */
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsString()
  @IsOptional()
  addressLine1?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  countryCode?: string;
}
