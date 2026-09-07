import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * The period and the filing's own parameters, for Mexico's electronic accounting.
 *
 * `tipoEnvio` and `fechaModBal` belong to the Balanza; `tipoSolicitud`, `numOrden` and
 * `numTramite` to the Pólizas. They share a DTO because they share a route, and the generator
 * ignores the ones that do not apply to the document asked for — the SAT rejects a file carrying
 * an attribute its schema does not declare, so which ones are written is decided there, against
 * the document being built, rather than here.
 */
export class MexicanAccountingQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2999)
  year: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  @Max(12, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":12}' })
  month: number;

  /** `N` for the ordinary monthly filing, `C` for one that corrects it. */
  @IsIn(['N', 'C'])
  @IsOptional()
  tipoEnvio?: 'N' | 'C';

  /** The date the corrected balanza was modified. Required by the SAT only when `tipoEnvio` is C. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsOptional()
  fechaModBal?: string;

  /** `AF` audit, `FC` offset, `DE` refund, `CO` certification. */
  @IsIn(['AF', 'FC', 'DE', 'CO'])
  @IsOptional()
  tipoSolicitud?: 'AF' | 'FC' | 'DE' | 'CO';

  /** The audit order the file answers. Only for `AF` and `CO`. */
  @IsString()
  @IsOptional()
  numOrden?: string;

  /** The refund or offset procedure the file answers. Only for `DE` and `FC`. */
  @IsString()
  @IsOptional()
  numTramite?: string;
}
