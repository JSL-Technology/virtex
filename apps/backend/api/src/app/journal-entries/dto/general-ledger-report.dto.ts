import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * The most accounts one request may ask for.
 *
 * Each account is its own ledger card with its own opening balance, running balance and closing
 * balance — one query per account, plus two balance queries. Unbounded, a single request could ask
 * for a thousand accounts and issue three thousand queries against the journal, which is a denial
 * of service anyone with a token could perform by accident.
 */
export const MAX_LEDGER_REPORT_ACCOUNTS = 50;

/** A ledger report may not span more than this. Roughly five fiscal years. */
export const MAX_LEDGER_REPORT_DAYS = 1_900;

export class GeneralLedgerReportDto {
  @IsUUID()
  @IsNotEmpty({ message: 'VALIDATION.GENERAL_LEDGER_REPORT.ID_LIBRO_CONTABLE_OBLIGATORIO' })
  ledgerId: string;

  @IsDateString()
  @IsNotEmpty({ message: 'VALIDATION.GENERAL_LEDGER_REPORT.FECHA_INICIO_OBLIGATORIA' })
  startDate: string;

  @IsDateString()
  @IsNotEmpty({ message: 'VALIDATION.GENERAL_LEDGER_REPORT.FECHA_FIN_OBLIGATORIA' })
  endDate: string;

  /**
   * Which accounts to print, at least one and at most `MAX_LEDGER_REPORT_ACCOUNTS`.
   *
   * It was `@IsOptional()`, and the service rejected an empty list afterwards with an error the
   * DTO could have produced — so the contract said the field was optional and the behaviour said
   * it was required.
   */
  @IsArray()
  @ArrayNotEmpty({ message: 'VALIDATION.GENERAL_LEDGER_REPORT.AL_MENOS_UNA_CUENTA' })
  @ArrayMaxSize(MAX_LEDGER_REPORT_ACCOUNTS, {
    message: 'VALIDATION.GENERAL_LEDGER_REPORT.DEMASIADAS_CUENTAS',
  })
  @IsUUID('4', {
    each: true,
    message: 'VALIDATION.GENERAL_LEDGER_REPORT.CADA_ID_CUENTA_DEBE_UUID_VALIDO',
  })
  accountIds: string[];

  /**
   * Show entries that are not posted.
   *
   * Named `includeUnposted`, matching `JournalReportDto` and `LedgersService`. It was
   * `includeDrafts`, which is narrower than what it does: an entry awaiting approval is not a
   * draft, and it was included too.
   *
   * The `@Transform` is not decoration. `@IsBoolean()` on a query string rejects `"true"`, and
   * without it the flag was only usable from a JSON body — which is why the same field on the
   * daybook DTO already had one and this one did not.
   */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  includeUnposted?: boolean;

  @Type(() => Number)
  @IsOptional()
  pageSize?: number;
}
