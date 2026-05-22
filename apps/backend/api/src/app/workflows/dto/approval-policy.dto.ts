
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { DocumentTypeForApproval } from '../entities/approval-policy.entity';

class ApprovalPolicyStepDto {
  @IsNumber()
  @Min(0)
  order: number;

  @IsNumber()
  @Min(0)
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