import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ReconciliationSettingsDto {
  /** Confirm unambiguous matches on import, without a person. Off by default. */
  @IsBoolean()
  @IsOptional()
  autoConfirm?: boolean;

  /** The score a match needs to count as unambiguous (90–100). */
  @IsInt()
  @Min(90)
  @Max(100)
  @IsOptional()
  minScore?: number;
}
