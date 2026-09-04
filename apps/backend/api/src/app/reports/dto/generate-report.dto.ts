import { IsIn, IsNotEmpty, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { GeneralLedgerReportDto } from '../../journal-entries/dto/general-ledger-report.dto';
import { JournalReportDto } from '../../journal-entries/dto/journal-report.dto';
import { AgingReportDto } from './aging-report.dto';

/** The reports `POST /reports/generate` knows how to build. */
export const REPORT_TYPES = ['general-ledger', 'journal', 'aging-report'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** The output formats the endpoint accepts. */
export const OUTPUT_FORMATS = ['json', 'pdf', 'csv'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * A report request: which report, and its parameters.
 *
 * ## Why the discriminator had to become exhaustive
 *
 * `@Type()` resolved `general-ledger` and `journal` to their DTOs and **everything else to
 * `Object`**. A metatype of `Object` means `class-validator` finds no rules to apply, so
 * `@ValidateNested()` passes whatever it is handed and `forbidNonWhitelisted` has nothing to
 * forbid. Two consequences:
 *
 * - `reportType: 'aging-report'` accepted an arbitrary object as `options` — no shape, no types,
 *   nothing stripped.
 * - `reportType` itself was only `@IsString()`, typed as a union that TypeScript erases at run
 *   time. Any string passed validation and reached the handler's `switch`, whose default branch is
 *   the only thing that caught it — after the body had already been accepted as valid.
 *
 * Both are now decided in one place: `reportType` must be one of the three, and each of the three
 * names a real DTO whose rules actually run.
 */
export class GenerateReportDto {
  @IsIn(REPORT_TYPES, { message: 'VALIDATION.GENERATE_REPORT.TIPO_REPORTE_NO_SOPORTADO' })
  @IsNotEmpty()
  reportType: ReportType;

  @IsObject()
  @IsNotEmpty()
  @ValidateNested()
  @Type((options) => {
    const dto = options?.object as GenerateReportDto | undefined;
    switch (dto?.reportType) {
      case 'general-ledger':
        return GeneralLedgerReportDto;
      case 'journal':
        return JournalReportDto;
      case 'aging-report':
        return AgingReportDto;
      default:
        // `reportType` has already failed `@IsIn` by the time this is reached, so the request is
        // rejected either way. Resolving to a real DTO rather than to `Object` keeps the failure a
        // validation error instead of an unvalidated object reaching the handler.
        return AgingReportDto;
    }
  })
  options: GeneralLedgerReportDto | JournalReportDto | AgingReportDto;

  @IsIn(OUTPUT_FORMATS, { message: 'VALIDATION.GENERATE_REPORT.FORMATO_NO_SOPORTADO' })
  @IsOptional()
  outputFormat?: OutputFormat = 'json';
}
