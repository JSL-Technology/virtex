import { IsEnum, IsInt, IsString, Matches, Min } from 'class-validator';
import { NcfType } from '../entities/ncf-sequence.entity';

/**
 * Registers a DGII-authorized NCF / e-NCF range for the current tenant.
 * `prefix` is the series + document-type code as authorized by the DGII (e.g. `B01`, `E31`).
 */
export class ProvisionNcfSequenceDto {
  @IsEnum(NcfType)
  type: NcfType;

  @IsString()
  @Matches(/^[BE]\d{2}$/, { message: 'El prefijo debe tener el formato de serie DGII, p. ej. B01 o E31.' })
  prefix: string;

  @IsInt()
  @Min(1)
  startsAt: number;

  @IsInt()
  @Min(1)
  endsAt: number;
}
