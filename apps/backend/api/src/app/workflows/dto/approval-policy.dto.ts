
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DocumentTypeForApproval } from '../entities/approval-policy.entity';

class ApprovalPolicyStepDto {
  /** Integer, because the chain is traversed in this order and a fraction has no successor. */
  @IsInt()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  order: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  minAmount: number;

  @IsUUID()
  @IsNotEmpty()
  roleId: string;
}

export class CreateApprovalPolicyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(DocumentTypeForApproval)
  @IsNotEmpty()
  documentType: DocumentTypeForApproval;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalPolicyStepDto)
  steps: ApprovalPolicyStepDto[];
}

export class UpdateApprovalPolicyDto {
    @IsString()
    @IsNotEmpty()
    @IsOptional()
    name?: string;
  
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ApprovalPolicyStepDto)
    @IsOptional()
    steps?: ApprovalPolicyStepDto[];
}

/** Optional note attached to an approval, kept on the step's decision row. */
export class DecideApprovalDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  comment?: string;
}

/**
 * A rejection needs a reason.
 *
 * `reject` used to take `@Body('reason')` with no DTO and no validation, so a request could be
 * refused with `undefined` and the document's author had nothing to act on.
 */
export class RejectApprovalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}
