
import { IsDate, IsNotEmpty, IsNumber, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DisposeAssetDto {
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  disposalDate: Date;

  @IsNumber()
  @Min(0)
  salePrice: number;

  @IsString()
  @IsNotEmpty()
  disposalReason: string;

  @IsUUID()
  @IsNotEmpty()
  cashAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  gainOnDisposalAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  lossOnDisposalAccountId: string;
}