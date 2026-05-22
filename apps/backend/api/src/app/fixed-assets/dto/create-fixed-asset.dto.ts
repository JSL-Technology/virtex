
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateFixedAssetDto {

  name: string;
  description: string;
  cost: number;
  purchaseDate: Date;
  usefulLife: number;
  residualValue: number;
  depreciationMethod: string;
  

  @IsUUID()
  @IsOptional()
  assetAccountId: string;

  @IsUUID()
  @IsOptional()
  depreciationAccountId: string;

  @IsUUID()
  @IsOptional()
  accumulatedDepreciationAccountId: string;
  
  @IsUUID()
  @IsOptional()
  vendorBillLineId?: string;
}