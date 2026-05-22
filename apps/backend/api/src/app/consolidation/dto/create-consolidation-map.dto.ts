
import { IsUUID, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class MappingItemDto {
  @IsUUID()
  subsidiaryAccountId: string;

  @IsUUID()
  parentAccountId: string;
}

export class CreateConsolidationMapDto {
  @IsUUID()
  subsidiaryOrganizationId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappingItemDto)
  mappings: MappingItemDto[];
}