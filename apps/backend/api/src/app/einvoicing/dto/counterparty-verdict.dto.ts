import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CounterpartyVerdict } from '../entities/fiscal-document-event.entity';

/**
 * What the receiver of a document answers about it.
 *
 * The shapes are checked by the market's own rules in the service — the identifier by its
 * validator, the number by its received-document rule — because they are not the same in two
 * markets. What this door enforces is only what is true everywhere: present, of a sane length, a
 * date, a positive amount, and a verdict the product has a name for. It used to demand a Dominican
 * RNC (`^[\d-]{9,13}$`) and a Dominican e-NCF (`^E\d{12}$`) of every tenant, and the verdict
 * arrived as the DGII's own code (`1`, `2`).
 */
export class CounterpartyVerdictDto {
  /** The identifier of the party that issued the document. Accepted as printed; stored as digits. */
  @IsString()
  @Matches(/^[\p{L}\d .,'()/-]{5,32}$/u, { message: 'validation.counterparty_verdict.issuer_tax_id_format' })
  counterpartyTaxId!: string;

  /** The number their authority assigned to the document. */
  @IsString()
  @Matches(/^[\p{L}\d .,'()/-]{3,64}$/u, {
    message: 'validation.counterparty_verdict.document_number_format',
  })
  documentNumber!: string;

  /** Issue date they stated, `YYYY-MM-DD`. */
  @IsISO8601({ strict: true }, { message: 'validation.counterparty_verdict.issue_date_format' })
  documentDate!: string;

  /**
   * Total they stated.
   *
   * The authority matches it against the document it holds; a mismatch of one cent is a rejection,
   * so it is taken from the operator rather than recomputed from anything on this side.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  documentTotal!: number;

  @IsEnum(CounterpartyVerdict, { message: 'validation.counterparty_verdict.verdict_not_known' })
  verdict!: CounterpartyVerdict;

  /** Required on a rejection; the service refuses one without it. */
  @ValidateIf((dto: CounterpartyVerdictDto) => dto.verdict === CounterpartyVerdict.REJECTED)
  @IsString()
  @MaxLength(250, { message: 'validation.constraints.max_length|{"max":250}' })
  @IsOptional()
  rejectionReason?: string;
}
