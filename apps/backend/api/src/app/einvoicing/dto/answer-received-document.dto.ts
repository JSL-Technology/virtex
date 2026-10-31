import { IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { CommercialApprovalVerdict } from '../entities/ecf-lifecycle-message.entity';

/** The tenant's verdict on a comprobante it received. A rejection states why — the DGII requires it. */
export class AnswerReceivedDocumentDto {
  @IsEnum(CommercialApprovalVerdict, { message: 'validation.commercial_approval.status_must_approved_rejected' })
  verdict: CommercialApprovalVerdict;

  @ValidateIf((dto: AnswerReceivedDocumentDto) => dto.verdict === CommercialApprovalVerdict.REJECTED)
  @IsString()
  @MinLength(5, { message: 'validation.constraints.min_length|{"min":5}' })
  @MaxLength(250, { message: 'validation.constraints.max_length|{"max":250}' })
  @IsOptional()
  rejectionReason?: string;
}
